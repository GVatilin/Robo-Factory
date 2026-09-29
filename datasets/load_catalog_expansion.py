"""Import a reviewed expansion atomically. No remote requests or user changes.

Run inside backend: python /datasets/load_catalog_expansion.py [--preview]
An applied package is immutable: future releases preserve manual edits/deletions.
"""
import argparse
import asyncio
from datetime import date
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, "/app")

from sqlalchemy import select, text
from app.db.session import SessionLocal
from app.models import (DataSource, DatasetVersion, FacilityType, Manufacturer,
                        Process, Product, ProductApplication, ProductOffer, SolutionType)
from app.models.enums import AcquisitionModel, DatasetKind, ProductClass, ReadinessStatus, SourceType
from app.services import audit, catalog_updates
from app.services.catalog_scope import is_russian


async def main(package: Path, preview: bool):
    # This is a one-off operator process; its package path never changes in the API.
    catalog_updates.PACKAGE_DIR = package.resolve()
    bundle, checksum = catalog_updates.read_package()
    batch = bundle["expansion_id"]
    rows = bundle["products"]
    identities = {(r["manufacturer"], r["product_name"]) for r in rows}
    if not rows or len(identities) != len(rows):
        raise ValueError("Empty package or duplicate identities")
    for row in rows:
        asset = row["image"]
        if not asset.get("approved") or asset.get("is_illustration"):
            raise ValueError("Each new model needs an approved exact product image")
        catalog_updates.image_content(asset)

    async with SessionLocal() as session:
        await session.execute(text("SELECT pg_advisory_xact_lock(7340033)"))
        applied = await session.scalar(select(DatasetVersion).where(
            DatasetVersion.kind == DatasetKind.CATALOG,
            DatasetVersion.file_name == batch + ".json"))
        if applied:
            if applied.checksum_sha256 != checksum:
                raise ValueError("Applied expansion is immutable; create a new reviewed package")
            print(json.dumps({"already_applied": True, "batch": batch, "created": 0}))
            return
        makers = {m.name: m for m in (await session.scalars(select(Manufacturer))).all()}
        countries = {m["name"]: m.get("country") for m in bundle.get("manufacturers", [])}
        countries.update({m.name: m.country for m in makers.values()})
        rows = [r for r in rows if is_russian(countries.get(r["manufacturer"]))
                and is_russian(r.get("fields", {}).get("country_of_origin"))]
        if not rows:
            print(json.dumps({"batch": batch, "created": 0, "skipped": "Russian-only catalog"}))
            return
        identities = {(r["manufacturer"], r["product_name"]) for r in rows}
        types = {t.code: t for t in (await session.scalars(select(SolutionType))).all()}
        processes = {(f.code, p.code): p for p, f in (await session.execute(
            select(Process, FacilityType).join(FacilityType, Process.facility_type_id == FacilityType.id))).all()}
        existing = {(m, n) for m, n in (await session.execute(
            select(Manufacturer.name, Product.name).join(Product, Product.manufacturer_id == Manufacturer.id))).all()}
        if identities & existing:
            raise ValueError("Expansion matches existing products; review identities before importing")
        for entry in bundle.get("manufacturers", []):
            if entry["name"] not in makers and any(r["manufacturer"] == entry["name"] for r in rows):
                company = Manufacturer(**entry)
                session.add(company)
                makers[company.name] = company
        await session.flush()

        sources = {s.code: s for s in (await session.scalars(select(DataSource))).all()}
        async def source(row, url=None, case=False):
            url = catalog_updates.checked_url(url or row["url"])
            key = "reviewed-catalog:" + hashlib.sha256(url.encode()).hexdigest()[:32]
            if key not in sources:
                sources[key] = DataSource(code=key, title=row["title"], url=url,
                    publisher=row["manufacturer"], retrieved_at=date.fromisoformat(row["retrieved_at"]),
                    source_type=SourceType.CASE_STUDY if case else SourceType(row["source_type"]),
                    notes="Официальная публикация; характеристики не являются независимыми испытаниями.")
                session.add(sources[key])
                await session.flush()
            return sources[key]

        version = DatasetVersion(kind=DatasetKind.CATALOG, label="Новые модели из официальных источников: 29.09.2026",
            file_name=batch + ".json", checksum_sha256=checksum, row_count=len(rows),
            stats={"created": len(rows), "operator_import": True})
        session.add(version)
        await session.flush()
        created = []
        for row in rows:
            primary = await source(row)
            origin_source = await source(row, row.get("field_sources", {}).get("country_of_origin"))
            verified = {"source_id": primary.id, "retrieved_at": row["retrieved_at"], "is_confirmed": True}
            p = Product(name=row["product_name"], manufacturer=makers[row["manufacturer"]],
                solution_type=types[row["solution_type"]], product_class=ProductClass.BRS,
                readiness_status=ReadinessStatus.OPERATION, is_published=True,
                country_of_origin=row["fields"]["country_of_origin"],
                dataset_version_id=version.id, spec_values=[], applications=[], offers=[],
                sources=list({s.id: s for s in (primary, origin_source)}.values()),
                processes=[processes[tuple(key)] for key in row["processes"]],
                source_payload={"expansion_id": batch, "field_evidence": {
                    "name": verified, "manufacturer_id": verified, "readiness_status": verified,
                    "country_of_origin": {**verified, "source_id": origin_source.id}},
                    "availability_note": "Есть в официальном коммерческом каталоге. Наличие, поставка в РФ и комплектация подтверждаются запросом поставщику."})
            session.add(p)
            for case in row.get("cases", []):
                evidence = await source(row, case["url"], case=True)
                if evidence not in p.sources:
                    p.sources.append(evidence)
                p.applications.append(ProductApplication(scenario="Опубликованный кейс применения",
                    case_description=case["description"], source_id=evidence.id))
            for url in row.get("reviewed_urls", []):
                evidence = await source(row, url)
                if evidence not in p.sources:
                    p.sources.append(evidence)
            if not row.get("offers"):
                p.offers.append(ProductOffer(label="Стоимость по запросу поставщику",
                    acquisition_model=AcquisitionModel.PURCHASE, is_default=True, currency="RUB",
                    price_includes_vat=False, is_confirmed=False, source=primary,
                    valid_from=date.fromisoformat(row["retrieved_at"]),
                    terms={"vat_status": "unknown", "estimation_eligible": False, "minimum_quantity": 1},
                    notes="Публичная цена не найдена в проверенных источниках. Оборудование, ПО, внедрение и сервис запрашиваются отдельно; это не нулевая стоимость."))
            await session.flush()
            audit.record(session, None, "product", p.id, "create", {"name": p.name, "batch": batch, "source": primary.url})
            created.append({"id": p.id, "name": p.name})
        # update_catalog commits all products, sources, offers and images together;
        # on failure it rolls back SQL and removes files written during the import.
        report = await catalog_updates.update_catalog(session, apply=not preview, expected_checksum=checksum)
        report["created_products"] = created
        report["preview"] = preview
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=Path(__file__).parent / "catalog_expansion_20260929")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.package, args.preview))
