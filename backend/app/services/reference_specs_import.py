"""Импорт ТТХ эталонных решений (datasets/reference_specs.json).

Файл — структурированная выписка из документа организатора «Примеры решений по типам объектов».
Продукт ищется в каталоге по префиксу названия (`match`); если его нет — создаётся.
Значения ТТХ обновляются по коду характеристики (upsert), источник фиксируется для каждого значения.
"""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    DatasetVersion,
    DataSource,
    Manufacturer,
    Product,
    ProductSpecValue,
    SolutionType,
    SpecDefinition,
)
from app.models.enums import DatasetKind, ProductClass, ReadinessStatus, SourceType


class ReferenceSpecsError(ValueError):
    """Файл эталонных ТТХ не соответствует ожидаемой структуре."""


@dataclass
class ReferenceImportStats:
    status: str = "imported"
    dataset_version_id: int | None = None
    products_matched: int = 0
    products_created: int = 0
    specs_created: int = 0
    specs_updated: int = 0
    warnings: list[str] = field(default_factory=list)


def _decimal(value: Any) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


async def _source(session: AsyncSession, data: dict[str, Any]) -> DataSource:
    source = await session.scalar(select(DataSource).where(DataSource.code == data["code"]))
    if source is None:
        source = DataSource(
            code=data["code"],
            title=data["title"],
            source_type=SourceType(data.get("type", SourceType.MANUFACTURER.value)),
            url=data.get("url"),
            publisher=data.get("publisher"),
            retrieved_at=date.fromisoformat(data["retrieved_at"]) if data.get("retrieved_at") else None,
        )
        session.add(source)
        await session.flush()
    return source


async def import_reference_specs(session: AsyncSession, content: bytes, file_name: str) -> ReferenceImportStats:
    stats = ReferenceImportStats()
    checksum = hashlib.sha256(content).hexdigest()
    existing_version = await session.scalar(
        select(DatasetVersion).where(
            DatasetVersion.kind == DatasetKind.REFERENCE_SPECS, DatasetVersion.checksum_sha256 == checksum
        )
    )
    if existing_version:
        stats.status = "skipped"
        stats.dataset_version_id = existing_version.id
        return stats

    try:
        data = json.loads(content.decode("utf-8"))
        products = data["products"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise ReferenceSpecsError("Файл эталонных ТТХ должен быть JSON с ключом «products».") from exc

    specs = {s.code: s for s in (await session.scalars(select(SpecDefinition))).all()}
    types = {t.code: t for t in (await session.scalars(select(SolutionType))).all()}
    if not specs or not types:
        raise ReferenceSpecsError("В БД нет справочников ТТХ и типов решений. Сначала запустите backend.")

    document_source = await session.scalar(
        select(DataSource).where(DataSource.code == data.get("document_source_code", "organizer_solution_examples"))
    )
    retrieved_at = date.fromisoformat(data["retrieved_at"]) if data.get("retrieved_at") else None

    from app.services.catalog_scope import is_russian
    for item in products:
        if not is_russian(item.get("country")):
            stats.warnings.append(f"{item.get('name')}: пропущен — российское происхождение не указано.")
            continue
        product = None
        if item.get("match"):
            product = await session.scalar(
                select(Product).where(Product.name.startswith(item["match"])).order_by(Product.id).limit(1)
            )
        if product is None:
            product = await session.scalar(select(Product).where(Product.name == item["name"]))
        if product is None:
            manufacturer = await session.scalar(select(Manufacturer).where(Manufacturer.name == item["manufacturer"]))
            if manufacturer is not None and not is_russian(manufacturer.country):
                stats.warnings.append(f"{item['name']}: пропущен — производитель не российский.")
                continue
            if manufacturer is None:
                manufacturer = Manufacturer(name=item["manufacturer"], country=item.get("country"))
                session.add(manufacturer)
                await session.flush()
            product = Product(
                name=item["name"],
                manufacturer_id=manufacturer.id,
                product_class=ProductClass.BRS,
                readiness_status=ReadinessStatus.OPERATION,
                description=item.get("description"),
                purpose=item.get("description"),
                country_of_origin=item.get("country"),
            )
            session.add(product)
            await session.flush()
            stats.products_created += 1
        else:
            stats.products_matched += 1

        solution_type = types.get(item.get("solution_type", ""))
        if solution_type is None:
            stats.warnings.append(f"«{item['name']}»: неизвестный тип решения «{item.get('solution_type')}».")
        else:
            product.solution_type_id = solution_type.id
        product.country_of_origin = product.country_of_origin or item.get("country")

        product_source = await _source(session, item["source"])
        await session.refresh(product, ["spec_values", "sources"])
        current = {v.spec_definition_id: v for v in product.spec_values}
        for spec in item["specs"]:
            definition = specs.get(spec["code"])
            if definition is None:
                stats.warnings.append(f"«{item['name']}»: неизвестная характеристика «{spec['code']}» пропущена.")
                continue
            values = {
                "value_numeric": _decimal(spec.get("value")),
                "value_numeric_max": _decimal(spec.get("value_max")),
                "value_text": spec.get("text"),
                "unit": spec.get("unit"),
                "note": spec.get("note"),
                "source_id": (document_source or product_source).id,
                "retrieved_at": retrieved_at,
                "is_confirmed": True,
            }
            value = current.get(definition.id)
            if value is None:
                session.add(ProductSpecValue(product_id=product.id, spec_definition_id=definition.id, **values))
                stats.specs_created += 1
            else:
                for key, val in values.items():
                    setattr(value, key, val)
                stats.specs_updated += 1
        for source in (document_source, product_source):
            if source is not None and source not in product.sources:
                product.sources.append(source)

    await session.execute(
        update(DatasetVersion).where(DatasetVersion.kind == DatasetKind.REFERENCE_SPECS).values(is_current=False)
    )
    version = DatasetVersion(
        kind=DatasetKind.REFERENCE_SPECS,
        label=file_name.rsplit(".", 1)[0],
        file_name=file_name,
        checksum_sha256=checksum,
        source_id=document_source.id if document_source else None,
        row_count=len(products),
        stats={k: v for k, v in stats.__dict__.items() if k not in ("warnings", "status", "dataset_version_id")},
        is_current=True,
    )
    session.add(version)
    await session.flush()
    stats.dataset_version_id = version.id
    return stats
