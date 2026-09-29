from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import DbSession, OptionalUser
from app.api.errors import ApiValidationError, FieldError
from app.core.permissions import sees_unpublished
from app.models import Product, SpecDefinition
from app.models.enums import ValueDataType
from app.schemas.catalog import CatalogFilterInfo, Comparison, SpecFilterInfo, TreeNode
from app.services.catalog_query import FILTER_OPERATOR, NUMERIC, build_tree, load_entries, load_hierarchy, make_entry
from app.services.catalog_view import mandatory_specs
from app.services.comparison import MAX_COMPARE, build_groups
from app.services.products import PRODUCT_DETAIL_OPTIONS
from app.services.catalog_scope import eligible

router = APIRouter(prefix="/catalog", tags=["Каталог: решения"])

# Подсказки для текстовых фильтров: термин показывается, если встречается в значениях каталога.
# Словарь, а не частотные слова: в строке «без магнитных лент и QR-меток» слова из отрицания не подсказываются.
TEXT_TERMS = {
    "navigation_type": ["SLAM", "Лидар", "QR-метки", "Камеры", "VSLAM", "Автопилот", "GNSS", "Магнитная лента"],
}


@router.get("/tree", response_model=list[TreeNode], summary="Иерархия каталога")
async def tree(db: DbSession, user: OptionalUser) -> list[TreeNode]:
    """Отрасль → тип объекта → процесс → тип решения со счётчиками товаров (п. 3.3.1 ТЗ).
    Параметры узла `params` передаются в GET /products, чтобы получить его товары."""
    hierarchy = await load_hierarchy(db)
    entries = await load_entries(db, user, hierarchy, await mandatory_specs(db))
    return build_tree(entries, hierarchy)


def _suggestions(code: str, texts: list[str]) -> list[str]:
    lowered = [t.lower() for t in texts]
    counts = {term: sum(term.lower() in text for text in lowered) for term in TEXT_TERMS.get(code, [])}
    return [term for term, count in sorted(counts.items(), key=lambda item: -item[1]) if count]


@router.get("/filters", response_model=CatalogFilterInfo, summary="Фильтруемые характеристики и диапазоны")
async def filters(db: DbSession, user: OptionalUser) -> CatalogFilterInfo:
    """Характеристики с признаком «фильтруемая» и границы их значений в видимой части каталога."""
    hierarchy = await load_hierarchy(db)
    entries = await load_entries(db, user, hierarchy, await mandatory_specs(db))
    definitions = (
        await db.scalars(select(SpecDefinition).where(SpecDefinition.is_filterable.is_(True)).order_by(SpecDefinition.sort_order))
    ).all()
    specs = []
    for definition in definitions:
        values = [e.specs[definition.code] for e in entries if definition.code in e.specs]
        numbers = [float(v.value_numeric) for v in values if v.value_numeric is not None]
        uppers = [float(v.value_numeric_max if v.value_numeric_max is not None else v.value_numeric)
                  for v in values if v.value_numeric is not None]
        if definition.data_type in NUMERIC:
            operator = FILTER_OPERATOR.get(definition.code, "range")
        else:
            operator = "=" if definition.data_type == ValueDataType.BOOLEAN else "~"
        specs.append(
            SpecFilterInfo(
                code=definition.code, name=definition.name, group=definition.group, unit=definition.unit,
                data_type=definition.data_type, operator=operator, count=len(values),
                min=min(numbers) if numbers else None, max=max(uppers) if uppers else None,
                suggestions=_suggestions(definition.code, [v.value_text for v in values if v.value_text]),
            )
        )
    prices = [e.summary.price_from for e in entries if e.summary.price_from is not None]
    return CatalogFilterInfo(
        specs=specs, price_min=min(prices) if prices else None, price_max=max(prices) if prices else None, total=len(entries)
    )


@router.get("/compare", response_model=Comparison, summary="Сравнение решений")
async def compare(
    db: DbSession,
    user: OptionalUser,
    ids: Annotated[list[int], Query(description=f"От 1 до {MAX_COMPARE} товаров: ids=1&ids=4")],
) -> Comparison:
    """Таблица сравнения по группам характеристик п. 3.3.7 ТЗ и дополнительным показателям с формулами."""
    unique = list(dict.fromkeys(ids))
    if not 1 <= len(unique) <= MAX_COMPARE:
        raise ApiValidationError([FieldError("ids", f"Сравнивать можно от 1 до {MAX_COMPARE} решений.")])
    found = {
        p.id: p
        for p in (await db.scalars(select(Product).where(Product.id.in_(unique)).options(*PRODUCT_DETAIL_OPTIONS))).all()
        if eligible(p) and (p.is_published or sees_unpublished(user, p.manufacturer_id))
    }
    hierarchy = await load_hierarchy(db)
    mandatory = await mandatory_specs(db)
    entries = [make_entry(found[i], hierarchy, mandatory) for i in unique if i in found]
    definitions = (await db.scalars(select(SpecDefinition).order_by(SpecDefinition.sort_order))).all()
    return Comparison(
        products=[e.summary for e in entries],
        groups=build_groups(entries, definitions, hierarchy) if entries else [],
        missing=[i for i in unique if i not in found],
    )
