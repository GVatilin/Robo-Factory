"""Импорт таблицы решений организатора (catalog_export_*.csv) — п. 3.3.2 ТЗ.

Особенности файла:
* разделитель «;», кодировка UTF-8 с BOM, цены вида «2 700 000,00» (с НДС, п. 6 дополнений к ТЗ);
* один продукт (один id) повторяется в нескольких строках с разными отраслями/сценариями/кейсами —
  строки группируются в продукт + список применений;
* если цены в строках одного продукта различаются, каждая цена становится альтернативным предложением.

Повторный импорт того же файла (та же контрольная сумма) пропускается.
"""

import csv
import hashlib
import io
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    DatasetVersion,
    DataSource,
    Industry,
    Manufacturer,
    Product,
    ProductApplication,
    ProductOffer,
    SolutionType,
)
from app.models.enums import AcquisitionModel, DatasetKind, ProductClass, ReadinessStatus, SourceType
from app.services.taxonomy import resolve_category, resolve_type
from app.utils.text import normalize_spaces, slugify

REQUIRED_COLUMNS = ["id", "Название", "тип", "статус", "компания", "Тип", "Подтип", "Отрасль", "Цена изделия"]
CATALOG_SOURCE_PREFIX = "catalog_import:"


class CatalogFormatError(ValueError):
    """Файл не соответствует шаблону каталога организатора."""


@dataclass
class CatalogRecord:
    external_id: str
    name: str
    company: str | None
    product_class: ProductClass
    readiness: ReadinessStatus | None
    description: str | None
    category_raw: str | None
    subtype_raw: str | None
    trl: int | None
    market_potential: Decimal | None
    region: str | None
    applications: list[dict[str, str | None]] = field(default_factory=list)
    prices: list[tuple[Decimal, str | None]] = field(default_factory=list)
    rows: list[dict[str, str]] = field(default_factory=list)


@dataclass
class ImportStats:
    status: str = "imported"
    dataset_version_id: int | None = None
    rows: int = 0
    products_created: int = 0
    products_updated: int = 0
    applications: int = 0
    offers: int = 0
    manufacturers_created: int = 0
    solution_types_created: int = 0
    industries_created: int = 0
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


def parse_price(raw: str | None) -> Decimal | None:
    text = normalize_spaces(raw)
    if not text:
        return None
    cleaned = text.replace(" ", "").replace(",", ".")
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    return value if value > 0 else None


def _parse_int(raw: str | None) -> int | None:
    text = normalize_spaces(raw)
    try:
        return int(float(text.replace(",", "."))) if text else None
    except ValueError:
        return None


def _parse_decimal(raw: str | None) -> Decimal | None:
    text = normalize_spaces(raw)
    try:
        return Decimal(text.replace(",", ".")) if text else None
    except InvalidOperation:
        return None


def parse_catalog_csv(content: bytes) -> tuple[list[CatalogRecord], list[str]]:
    """Разбирает CSV в записи продуктов. Чистая функция — не обращается к БД."""
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise CatalogFormatError("Файл должен быть в кодировке UTF-8. Пересохраните его как «CSV UTF-8».") from exc

    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
    if missing:
        raise CatalogFormatError(
            f"В файле нет обязательных колонок: {', '.join(missing)}. Используйте шаблон catalog_export организатора "
            "(разделитель «;»)."
        )

    warnings: list[str] = []
    grouped: OrderedDict[str, CatalogRecord] = OrderedDict()
    for line_no, row in enumerate(reader, start=2):
        external_id = normalize_spaces(row.get("id"))
        name = normalize_spaces(row.get("Название"))
        if not external_id or not name:
            warnings.append(f"Строка {line_no}: пустой id или название — строка пропущена.")
            continue
        try:
            product_class = ProductClass(normalize_spaces(row.get("тип")) or "brs")
        except ValueError:
            warnings.append(f"Строка {line_no}: неизвестный тип «{row.get('тип')}», принят «brs».")
            product_class = ProductClass.BRS
        try:
            readiness = ReadinessStatus(normalize_spaces(row.get("статус"))) if row.get("статус") else None
        except ValueError:
            warnings.append(f"Строка {line_no}: неизвестный статус «{row.get('статус')}».")
            readiness = None

        record = grouped.get(external_id)
        if record is None:
            record = CatalogRecord(
                external_id=external_id,
                name=name,
                company=normalize_spaces(row.get("компания")),
                product_class=product_class,
                readiness=readiness,
                description=normalize_spaces(row.get("описание")),
                category_raw=row.get("Тип"),
                subtype_raw=row.get("Подтип"),
                trl=_parse_int(row.get("УГТ")),
                market_potential=_parse_decimal(row.get("Рын Потенциал")),
                region=normalize_spaces(row.get("Регион")),
            )
            grouped[external_id] = record
        record.rows.append(dict(row))
        scenario = normalize_spaces(row.get("Сценарий"))
        record.applications.append(
            {
                "industry": normalize_spaces(row.get("Отрасль")),
                "scenario": scenario,
                "cases": normalize_spaces(row.get("Кейсы")),
            }
        )
        price = parse_price(row.get("Цена изделия"))
        if price is not None and price not in {p for p, _ in record.prices}:
            record.prices.append((price, scenario))
    return list(grouped.values()), warnings


async def import_catalog(
    session: AsyncSession,
    content: bytes,
    file_name: str,
    user_id: uuid.UUID | None = None,
) -> ImportStats:
    """Загружает каталог в БД (upsert по id организатора). Коммит — на стороне вызывающего кода."""
    checksum = hashlib.sha256(content).hexdigest()
    stats = ImportStats()

    existing = await session.scalar(
        select(DatasetVersion).where(
            DatasetVersion.kind == DatasetKind.CATALOG, DatasetVersion.checksum_sha256 == checksum
        )
    )
    if existing:
        stats.status = "skipped"
        stats.dataset_version_id = existing.id
        stats.warnings.append("Этот файл уже был загружен ранее — повторный импорт не требуется.")
        return stats

    records, warnings = parse_catalog_csv(content)
    stats.warnings.extend(warnings)
    stats.rows = sum(len(r.rows) for r in records)

    source = DataSource(
        code=f"{CATALOG_SOURCE_PREFIX}{checksum[:16]}",
        title=f"Каталог решений организатора ({file_name})",
        source_type=SourceType.ORGANIZER,
        publisher="ФЦ БАС",
        notes="Цены указаны с НДС, без доставки, пусконаладки и глубокой интеграции (п. 6 дополнений к ТЗ).",
    )
    session.add(source)
    await session.flush()

    await session.execute(
        update(DatasetVersion).where(DatasetVersion.kind == DatasetKind.CATALOG).values(is_current=False)
    )
    version = DatasetVersion(
        kind=DatasetKind.CATALOG,
        label=file_name.rsplit(".", 1)[0],
        file_name=file_name,
        checksum_sha256=checksum,
        source_id=source.id,
        imported_by_id=user_id,
        row_count=stats.rows,
        is_current=True,
    )
    session.add(version)
    await session.flush()

    catalog_source_ids = select(DataSource.id).where(DataSource.code.like(f"{CATALOG_SOURCE_PREFIX}%"))
    industries = {i.name: i for i in (await session.scalars(select(Industry))).all()}
    manufacturers = {m.name: m for m in (await session.scalars(select(Manufacturer))).all()}
    solution_types = {s.code: s for s in (await session.scalars(select(SolutionType))).all()}
    products = {
        p.external_id: p
        for p in (await session.scalars(select(Product).where(Product.external_id.is_not(None)))).all()
    }

    async def get_solution_type(record: CatalogRecord) -> SolutionType:
        cat_code, cat_name = resolve_category(record.category_raw, record.product_class)
        category = solution_types.get(cat_code)
        if category is None:
            category = SolutionType(code=cat_code, name=cat_name, sort_order=900)
            session.add(category)
            await session.flush()
            solution_types[cat_code] = category
            stats.solution_types_created += 1
        resolved = resolve_type(record.subtype_raw)
        if resolved is None:
            return category
        type_code, type_name = resolved
        node = solution_types.get(type_code)
        if node is None:
            node = SolutionType(code=type_code, name=type_name, parent_id=category.id, sort_order=900)
            session.add(node)
            await session.flush()
            solution_types[type_code] = node
            stats.solution_types_created += 1
        return node

    async def get_industry(name: str | None) -> Industry | None:
        if not name:
            return None
        industry = industries.get(name)
        if industry is None:
            industry = Industry(code=slugify(name), name=name, sort_order=900)
            session.add(industry)
            await session.flush()
            industries[name] = industry
            stats.industries_created += 1
        return industry

    for record in records:
        manufacturer = None
        if record.company:
            manufacturer = manufacturers.get(record.company)
            if manufacturer is None:
                # Все организации каталога — российские юрлица с указанием региона РФ.
                manufacturer = Manufacturer(
                    name=record.company, country="Россия" if record.region else None, region=record.region
                )
                session.add(manufacturer)
                await session.flush()
                manufacturers[record.company] = manufacturer
                stats.manufacturers_created += 1

        solution_type = await get_solution_type(record)
        fields = {
            "name": record.name,
            "manufacturer_id": manufacturer.id if manufacturer else None,
            "solution_type_id": solution_type.id,
            "product_class": record.product_class,
            "readiness_status": record.readiness,
            "description": record.description,
            "purpose": record.applications[0]["scenario"] if record.applications else None,
            "trl": record.trl,
            "market_potential": record.market_potential,
            "region": record.region,
            "country_of_origin": "Россия" if record.region else None,
            "dataset_version_id": version.id,
            "source_payload": {"rows": record.rows},
        }
        product = products.get(record.external_id)
        if product is None:
            product = Product(external_id=record.external_id, **fields)
            session.add(product)
            await session.flush()
            products[record.external_id] = product
            stats.products_created += 1
        else:
            for key, value in fields.items():
                setattr(product, key, value)
            await session.execute(
                delete(ProductApplication).where(
                    ProductApplication.product_id == product.id,
                    ProductApplication.source_id.in_(catalog_source_ids),
                )
            )
            await session.execute(
                delete(ProductOffer).where(
                    ProductOffer.product_id == product.id, ProductOffer.source_id.in_(catalog_source_ids)
                )
            )
            stats.products_updated += 1

        for app_data in record.applications:
            industry = await get_industry(app_data["industry"])
            session.add(
                ProductApplication(
                    product_id=product.id,
                    industry_id=industry.id if industry else None,
                    scenario=app_data["scenario"],
                    case_description=app_data["cases"],
                    source_id=source.id,
                )
            )
            stats.applications += 1

        multiple = len(record.prices) > 1
        for index, (price, scenario) in enumerate(record.prices):
            label = f"Вариант для сценария «{scenario}»" if multiple and scenario else "Базовая комплектация"
            session.add(
                ProductOffer(
                    product_id=product.id,
                    label=label,
                    acquisition_model=AcquisitionModel.PURCHASE,
                    is_default=index == 0,
                    price_includes_vat=True,
                    equipment_price=price,
                    included_services="Только оборудование: без доставки, пусконаладки и интеграции.",
                    source_id=source.id,
                    is_confirmed=True,
                )
            )
            stats.offers += 1

    version.stats = {k: v for k, v in stats.as_dict().items() if k != "warnings"}
    stats.dataset_version_id = version.id
    await session.flush()
    return stats
