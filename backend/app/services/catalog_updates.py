"""Apply reviewed, locally staged catalog evidence without fetching arbitrary URLs.

The package contains exact product identities, source URLs, dates and hashed image
files. It is prepared by an operator; only administrators can apply it. Existing
manual edits and conflicting official specifications are retained for review.
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.models import DataSource, DatasetVersion, Product, ProductImage, ProductOffer, ProductSpecValue, SpecDefinition, User
from app.models.enums import AcquisitionModel, DatasetKind, SourceType
from app.services import audit
from app.services.product_images import decode_upload, remove_files, write_files
from app.services.products import PRODUCT_DETAIL_OPTIONS

PACKAGE_DIR = settings.upload_dir / "catalog-updates"
PRIMARY = {SourceType.MANUFACTURER, SourceType.INTEGRATOR, SourceType.PUBLIC_SPEC, SourceType.CASE_STUDY}
FIELDS = {"purpose", "description", "limitations", "country_of_origin", "service_life_years"}
PRICES = {"equipment_price", "software_price", "implementation_price", "annual_service_cost", "monthly_fee"}


def read_package() -> tuple[dict, str]:
    path = PACKAGE_DIR / "bundle.json"
    if not path.is_file():
        raise ValueError("Пакет обновления ещё не подготовлен на сервере.")
    content = path.read_bytes()
    bundle = json.loads(content)
    if bundle.get("version") != 2 or not isinstance(bundle.get("products"), list):
        raise ValueError("Неверный формат пакета обновления.")
    return bundle, hashlib.sha256(content).hexdigest()


def checked_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or len(value) > 1000:
        raise ValueError("Некорректная ссылка на источник.")
    return value


def number(value, places=4):
    if value is None:
        return None
    result = Decimal(str(value))
    if not result.is_finite() or abs(result) >= Decimal("1e14"):
        raise ValueError("Некорректное числовое значение.")
    return result.quantize(Decimal(10) ** -places, rounding=ROUND_HALF_UP)


def image_content(item: dict) -> bytes:
    relative = item["file"]
    path = (PACKAGE_DIR / relative).resolve()
    if not path.is_relative_to(PACKAGE_DIR.resolve()) or not path.is_file():
        raise ValueError("Файл изображения отсутствует в пакете.")
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != item["sha256"]:
        raise ValueError("Контрольная сумма изображения не совпадает.")
    return content


async def update_catalog(session: AsyncSession, *, apply: bool, expected_checksum: str | None = None,
                         user: User | None = None) -> dict:
    bundle, checksum = read_package()
    if expected_checksum and expected_checksum != checksum:
        raise ValueError("Пакет изменился. Откройте предварительный просмотр ещё раз.")
    await session.execute(text("SELECT pg_advisory_xact_lock(7340033)"))
    products = list((await session.scalars(select(Product).options(*PRODUCT_DETAIL_OPTIONS).with_for_update())).all())
    lookup = {(p.name, p.manufacturer.name if p.manufacturer else ""): p for p in products}
    definitions = {d.code: d for d in (await session.scalars(select(SpecDefinition))).all()}
    sources = {s.code: s for s in (await session.scalars(select(DataSource))).all()}
    for source in sources.values():
        if source.retrieved_at is None and (source.code or "").startswith("catalog_import:"):
            first_import = await session.scalar(select(DatasetVersion.imported_at).where(
                DatasetVersion.source_id == source.id).order_by(DatasetVersion.imported_at).limit(1))
            if first_import:
                source.retrieved_at = first_import.date()
                source.notes = (source.notes or "") + " Дата получения зафиксирована по первой загрузке файла в платформу."
    report = {"checksum": checksum, "applied": apply, "products_reviewed": 0, "specs_added": 0,
              "specs_updated": 0, "images_updated": 0, "fields_added": 0, "offers_added": 0,
              "sources_added": 0, "protected": [], "conflicts": [], "changes": []}
    reviewed = set()
    written = []

    async def source_for(item, url=None, *, image=False):
        url = checked_url(url or item["url"])
        code = "reviewed-image:" if image else "reviewed-catalog:"
        code += hashlib.sha256(url.encode()).hexdigest()[:32]
        source = sources.get(code)
        received = date.fromisoformat(item["retrieved_at"])
        if received > date.today():
            raise ValueError("Дата получения источника не может быть в будущем.")
        if source is None:
            source = DataSource(code=code, title=item["title"][:500], url=url,
                source_type=SourceType(item.get("source_type", "manufacturer")),
                publisher=item["manufacturer"], retrieved_at=received,
                notes="Сведения из открытой публикации. Подтверждение источником не означает независимые испытания.")
            session.add(source)
            await session.flush()
            sources[code] = source
            report["sources_added"] += 1
        return source

    def change(product, kind, label):
        report["changes"].append({"product_id": product.id, "product": product.name, "kind": kind, "label": label})

    try:
        for item in bundle["products"]:
            key = (item["product_name"], item["manufacturer"])
            if key not in lookup:
                report["protected"].append({"product": item["product_name"], "reason": "Товар удалён или переименован: необходимо вручную подтвердить соответствие модели."})
                continue
            product = lookup[key]
            from app.services.catalog_scope import eligible, is_russian
            proposed_country = item.get("fields", {}).get("country_of_origin", product.country_of_origin)
            if not eligible(product) or not is_russian(proposed_country):
                report["protected"].append({"product": product.name, "reason": "Каталог ограничен российскими производителями и моделями."})
                continue
            reviewed.add(product.id)
            received = date.fromisoformat(item["retrieved_at"])
            payload = dict(product.source_payload or {})
            research = dict(payload.get("catalog_research", {}))
            research["checked_at"] = received.isoformat()
            research["note"] = item.get("research_note", research.get("note", ""))
            research["reviewed_urls"] = list(dict.fromkeys(research.get("reviewed_urls", []) + item.get("reviewed_urls", [])))
            payload["catalog_research"] = research
            source = await source_for(item) if item.get("url") else None
            if source and source not in product.sources:
                product.sources.append(source)
            if item.get("manufacturer_url") and product.manufacturer and not product.manufacturer.website:
                product.manufacturer.website = checked_url(item["manufacturer_url"])
            values = {v.definition.code: v for v in product.spec_values}
            alternatives = list(payload.get("specification_alternatives", []))
            history = list(payload.get("enrichment_history", []))
            for spec in item.get("specs", []):
                code = spec["code"]
                if code in payload.get("manual_specs", []):
                    report["protected"].append({"product": product.name, "spec": code})
                    continue
                definition = definitions.get(code)
                if definition is None:
                    raise ValueError("Неизвестный код характеристики: " + code)
                spec_source = await source_for(item, spec.get("source_url"))
                if spec_source not in product.sources:
                    product.sources.append(spec_source)
                numeric, upper = number(spec.get("value")), number(spec.get("value_max"))
                if numeric is not None and numeric < 0 and definition.unit != "°C":
                    raise ValueError("Отрицательное значение: " + code)
                if upper is not None and (numeric is None or upper < numeric):
                    raise ValueError("Неверный диапазон: " + code)
                if definition.unit is not None and spec.get("unit", definition.unit) != definition.unit:
                    raise ValueError("Единицу измерения нужно привести к справочнику: " + code)
                if numeric is None and not spec.get("text") and spec.get("flag") is None:
                    raise ValueError("Пустая характеристика: " + code)
                existing = values.get(code)
                incoming = (numeric, upper, spec.get("text"), spec.get("flag"))
                if existing:
                    current = (existing.value_numeric, existing.value_numeric_max, existing.value_text, existing.value_bool,
                               existing.unit or definition.unit)
                    same_value = current == (*incoming, spec.get("unit", definition.unit))
                    old_source = existing.source
                    if old_source is None or (old_source.code or "").startswith(("admin_input", "vendor_input")) or old_source.source_type == SourceType.USER_INPUT:
                        report["protected"].append({"product": product.name, "spec": code})
                        continue
                    upgrade = (spec_source.source_type in PRIMARY and bool(spec.get("confirmed"))
                               and (old_source.source_type == SourceType.ORGANIZER or existing.is_assumption or not existing.is_confirmed))
                    metadata_changed = (old_source.id == spec_source.id and received >= (existing.retrieved_at or received)
                                        and (existing.note != spec.get("note")
                                             or existing.is_confirmed != (bool(spec.get("confirmed")) and spec_source.source_type in PRIMARY)))
                    if same_value and not (upgrade or metadata_changed):
                        continue
                    if not same_value and old_source.source_type != SourceType.ORGANIZER:
                        alternative = {"code": code, "source_url": spec_source.url, "retrieved_at": received.isoformat(),
                            "value": spec.get("value"), "value_max": spec.get("value_max"), "text": spec.get("text"),
                            "unit": spec.get("unit", definition.unit), "note": spec.get("note"), "current_source_url": old_source.url}
                        if alternative not in alternatives:
                            alternatives.append(alternative)
                        report["conflicts"].append({"product": product.name, **alternative})
                        continue
                    history.append({"code": code, "numeric": str(existing.value_numeric) if existing.value_numeric is not None else None,
                        "max": str(existing.value_numeric_max) if existing.value_numeric_max is not None else None,
                        "text": existing.value_text, "source_id": existing.source_id,
                        "retrieved_at": str(existing.retrieved_at), "replaced_at": received.isoformat()})
                    report["specs_updated"] += 1
                else:
                    existing = ProductSpecValue(product_id=product.id, spec_definition_id=definition.id)
                    existing.definition = definition
                    product.spec_values.append(existing)
                    values[code] = existing
                    report["specs_added"] += 1
                existing.value_numeric, existing.value_numeric_max, existing.value_text, existing.value_bool = incoming
                existing.unit, existing.source, existing.retrieved_at = spec.get("unit", definition.unit), spec_source, received
                existing.is_confirmed = bool(spec.get("confirmed")) and spec_source.source_type in PRIMARY
                existing.is_assumption, existing.note = False, spec.get("note")
                change(product, "spec", definition.name)
            payload["enrichment_history"] = history
            payload["specification_alternatives"] = alternatives
            evidence = dict(payload.get("field_evidence", {}))
            for field, value in item.get("fields", {}).items():
                if field not in FIELDS or source is None:
                    raise ValueError("Неподдерживаемое поле или отсутствует источник: " + field)
                if field not in payload.get("manual_fields", []) and not getattr(product, field) and value is not None:
                    field_source = await source_for(item, item.get("field_sources", {}).get(field))
                    if field_source not in product.sources:
                        product.sources.append(field_source)
                    setattr(product, field, number(value, 1) if field == "service_life_years" else value)
                    evidence[field] = {"source_id": field_source.id, "retrieved_at": received.isoformat(),
                                       "is_confirmed": field_source.source_type in PRIMARY}
                    report["fields_added"] += 1
                    change(product, "field", field)
            payload["field_evidence"] = evidence
            for offer in item.get("offers", []):
                if payload.get("manual_offers_deleted"):
                    report["protected"].append({"product": product.name, "reason": "Коммерческие предложения удалялись вручную."})
                    continue
                offer_source = await source_for(item, offer.get("source_url"))
                if offer.get("currency", "RUB") != "RUB":
                    continue  # Comparison currently uses RUB; do not mix currencies.
                label = offer.get("label", "Опубликованная стоимость")[:300]
                amounts = {k: number(offer.get(k), 2) for k in PRICES}
                if not any(v is not None for v in amounts.values()) or any(v is not None and v < 0 for v in amounts.values()):
                    continue
                acquisition = AcquisitionModel(offer.get("acquisition_model", "purchase"))
                terms = {"vat_status": "included" if offer.get("price_includes_vat") is True else "excluded" if offer.get("price_includes_vat") is False else "unknown",
                         "estimation_eligible": offer.get("estimation_eligible", True),
                         "minimum_quantity": max(1, int(offer.get("minimum_quantity", 1)))}
                previous_offers = [o for o in product.offers if (o.source_id == offer_source.id or o.source is offer_source) and o.label == label]
                if any(o.id in payload.get("manual_offer_ids", []) for o in previous_offers):
                    report["protected"].append({"product": product.name, "reason": "Предложение отредактировано вручную: " + label})
                    continue
                if any(all(getattr(o, k) == v for k, v in amounts.items()) and o.acquisition_model == acquisition
                       and o.terms == terms and o.notes == offer.get("notes")
                       and o.included_services == offer.get("included_services")
                       and o.min_contract_months == offer.get("min_contract_months") for o in previous_offers):
                    continue
                # Keep older published quotes, so price changes have an inspectable history.
                was_default = any(o.is_default for o in previous_offers)
                for previous_offer in previous_offers:
                    if not (previous_offer.terms or {}).get("superseded_at"):
                        previous_offer.terms = {**(previous_offer.terms or {}), "estimation_eligible": False,
                                                "superseded_at": received.isoformat()}
                        previous_offer.notes = ((previous_offer.notes or "") + " Архивная публикация: обновлена " + received.isoformat() + ".").strip()
                        previous_offer.is_default = False
                product.offers.append(ProductOffer(label=label, acquisition_model=acquisition,
                    currency="RUB", source=offer_source, source_id=offer_source.id, valid_from=received, is_default=was_default,
                    price_includes_vat=offer.get("price_includes_vat", False),
                    terms=terms,
                    is_confirmed=bool(offer.get("confirmed")) and offer_source.source_type in PRIMARY,
                    notes=offer.get("notes"), included_services=offer.get("included_services"),
                    min_contract_months=offer.get("min_contract_months"), **amounts))
                if offer_source not in product.sources:
                    product.sources.append(offer_source)
                report["offers_added"] += 1
                change(product, "offer", label)
            asset = item.get("image")
            if asset and asset.get("file") and asset.get("approved") and not payload.get("manual_image_deleted"):
                image = product.image
                previous = payload.get("official_image", {})
                if not (image and image.uploaded_by_id) and previous.get("sha256") != asset["sha256"]:
                    prepared = await run_in_threadpool(decode_upload, image_content(asset))
                    checked_url(asset["url"])
                    img_source = await source_for({**item, "retrieved_at": asset.get("retrieved_at", item["retrieved_at"])}, asset["page_url"], image=True)
                    if img_source not in product.sources:
                        product.sources.append(img_source)
                    if apply:
                        image_id = uuid.uuid4()
                        written.append(image_id)
                        width, height, size = await run_in_threadpool(write_files, prepared, image_id)
                        if image is None:
                            image = ProductImage(product_id=product.id)
                            product.image = image
                        image.id, image.width, image.height, image.size_bytes = image_id, width, height, size
                        image.original_name = "official-" + asset["sha256"][:16] + ".webp"
                        image.source = img_source
                        image.caption = asset.get("caption", product.name)[:500]
                        image.is_illustration = bool(asset.get("is_illustration", False))
                    payload["official_image"] = {k: v for k, v in asset.items() if k != "file"}
                    report["images_updated"] += 1
                    change(product, "image", "Фотография модели из официального источника")
            product.source_payload = payload
            if source and (item.get("specs") or item.get("fields")):
                product.last_verified_at = received
        report["products_reviewed"] = len(reviewed)
        if apply:
            version = await session.scalar(select(DatasetVersion).where(DatasetVersion.checksum_sha256 == checksum,
                DatasetVersion.kind == DatasetKind.REFERENCE_SPECS))
            if version is None:
                session.add(DatasetVersion(kind=DatasetKind.REFERENCE_SPECS, label="Открытые источники: дополнение каталога",
                    file_name="bundle.json", checksum_sha256=checksum, imported_by_id=user.id if user else None,
                    row_count=len(reviewed), stats={k: v for k, v in report.items() if not isinstance(v, list)}))
            audit.record(session, user, "catalog", checksum, "refresh", {k: v for k, v in report.items() if not isinstance(v, list)})
            await session.commit()
            written.clear()
        else:
            await session.rollback()
        return report
    except BaseException:
        await session.rollback()
        remove_files(*written)
        raise
