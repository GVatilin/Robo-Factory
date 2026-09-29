"""Каталог решений: иерархия п. 3.3.1 ТЗ, фильтры, сортировка и фасеты по группам характеристик п. 3.3.7.

Иерархия: отрасль → тип объекта → процесс → тип решения → продукт.
* Продукт относится к процессу, указанному в его карточке. Если процессы в карточке не указаны — ко всем
  процессам, к которым применим его тип решения (справочник process_solution_types).
* К отрасли продукт относится через процессы её объектов и через отрасли реализованных кейсов.
  Отрасли без описанных объектов (ТЭК, сельское хозяйство...) раскрываются сразу по типам решений.

Фильтрация выполняется в памяти по видимой пользователю части каталога. При пилотной нагрузке (сотни и тысячи
товаров) это быстро, а правила принадлежности одинаковы для дерева, фильтров и счётчиков фасетов.
При росте каталога на порядки выборку стоит перенести в SQL или поисковый индекс.
"""

import re
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import and_, or_, select
from app.services.catalog_scope import russian_product
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.errors import ApiValidationError, FieldError
from app.core import labels
from app.core.permissions import Permission, has_permission, sees_unpublished
from app.models import FacilityType, Industry, Process, Product, ProductSpecValue, SolutionType, SpecDefinition, User
from app.models.enums import ValueDataType
from app.schemas.catalog import FacetValue, TreeNode
from app.schemas.products import ProductSummary
from app.services.catalog_view import product_summary
from app.services.products import PRODUCT_SUMMARY_OPTIONS

CATALOG_OPTIONS = (*PRODUCT_SUMMARY_OPTIONS, selectinload(Product.applications))

NUMERIC = {ValueDataType.NUMBER, ValueDataType.INTEGER, ValueDataType.RANGE}

# Какой порог естественен для фильтра: «не меньше» (грузоподъёмность) или «не больше» (габариты, проход).
FILTER_OPERATOR: dict[str, str] = {
    "payload_kg": ">=", "max_speed_mps": ">=", "runtime_h": ">=", "lift_height_mm": ">=",
    "cleaning_width_mm": ">=", "tank_volume_l": ">=", "battery_capacity_kwh": ">=", "range_km": ">=",
    "throughput": ">=",
    "length_mm": "<=", "width_mm": "<=", "height_mm": "<=", "weight_kg": "<=", "positioning_accuracy_mm": "<=",
    "noise_dba": "<=", "min_aisle_width_mm": "<=", "charge_time_h": "<=",
}

SPEC_FILTER = re.compile(r"^(?P<code>[a-z0-9_]+)(?P<op>>=|<=|~|=)(?P<value>.+)$")

Sort = Literal["name", "price", "price_desc", "payload", "completeness", "updated"]


# ---------- иерархия ----------


@dataclass
class Hierarchy:
    industries: list[Industry]
    facilities: list[FacilityType]
    types: dict[int, SolutionType]
    process_types: dict[int, set[int]]
    process_facility: dict[int, int]
    facility_industry: dict[int, int]

    def industry_facilities(self, industry_id: int) -> set[int]:
        return {f for f, i in self.facility_industry.items() if i == industry_id}


async def load_hierarchy(session: AsyncSession) -> Hierarchy:
    facilities = list(
        (
            await session.scalars(
                select(FacilityType)
                .where(FacilityType.is_active.is_(True))
                .options(selectinload(FacilityType.processes).selectinload(Process.solution_types))
                .order_by(FacilityType.sort_order)
            )
        ).all()
    )
    industries = list((await session.scalars(select(Industry).order_by(Industry.sort_order, Industry.name))).all())
    types = {t.id: t for t in (await session.scalars(select(SolutionType))).all()}
    return Hierarchy(
        industries=industries,
        facilities=facilities,
        types=types,
        process_types={p.id: {t.id for t in p.solution_types} for f in facilities for p in f.processes},
        process_facility={p.id: f.id for f in facilities for p in f.processes},
        facility_industry={f.id: f.industry_id for f in facilities},
    )


# ---------- записи каталога ----------


@dataclass
class Entry:
    product: Product
    summary: ProductSummary
    processes: frozenset[int]
    facilities: frozenset[int]
    industries: frozenset[int]
    case_industries: frozenset[int]
    specs: dict[str, ProductSpecValue]
    haystack: str
    has_cases: bool


def visibility_filter(user: User | None):
    """Гость и пользователь видят опубликованные товары; вендор — ещё и свои; администратор — все."""
    if user is not None and has_permission(user.role, Permission.PRODUCTS_MANAGE):
        return russian_product()
    if user is not None and user.manufacturer_id is not None and sees_unpublished(user, user.manufacturer_id):
        return and_(russian_product(), or_(Product.is_published.is_(True), Product.manufacturer_id == user.manufacturer_id))
    return and_(russian_product(), Product.is_published.is_(True))


def make_entry(product: Product, hierarchy: Hierarchy, mandatory: Sequence[SpecDefinition]) -> Entry:
    explicit = frozenset(p.id for p in product.processes)
    processes = explicit or frozenset(
        pid for pid, types in hierarchy.process_types.items() if product.solution_type_id in types
    )
    facilities = frozenset(hierarchy.process_facility[p] for p in processes if p in hierarchy.process_facility)
    case_industries = frozenset(a.industry_id for a in product.applications if a.industry_id is not None)
    industries = case_industries | {hierarchy.facility_industry[f] for f in facilities}
    manufacturer = product.manufacturer.name if product.manufacturer else ""
    type_name = product.solution_type.name if product.solution_type else ""
    return Entry(
        product=product,
        summary=product_summary(product, mandatory),
        processes=processes,
        facilities=facilities,
        industries=frozenset(industries),
        case_industries=case_industries,
        specs={v.definition.code: v for v in product.spec_values},
        haystack=" ".join(filter(None, [product.name, manufacturer, type_name, product.purpose, product.description])).lower(),
        has_cases=any(a.case_description for a in product.applications),
    )


async def load_entries(
    session: AsyncSession, user: User | None, hierarchy: Hierarchy, mandatory: Sequence[SpecDefinition]
) -> list[Entry]:
    stmt = select(Product).options(*CATALOG_OPTIONS)
    visible = visibility_filter(user)
    if visible is not None:
        stmt = stmt.where(visible)
    products = (await session.scalars(stmt)).all()
    return [make_entry(p, hierarchy, mandatory) for p in products]


# ---------- фильтры ----------


@dataclass(frozen=True)
class SpecFilter:
    code: str
    name: str
    op: str
    value: float | bool | str


@dataclass
class CatalogFilters:
    q: str | None = None
    manufacturer_id: int | None = None
    industry_id: int | None = None
    facility_type_id: int | None = None
    process_id: int | None = None
    other_in_industry: bool = False
    solution_type_id: int | None = None
    product_classes: list[str] = field(default_factory=list)
    readiness_statuses: list[str] = field(default_factory=list)
    countries: list[str] = field(default_factory=list)
    acquisition_models: list[str] = field(default_factory=list)
    price_max: float | None = None
    has_image: bool = False
    has_cases: bool = False
    min_completeness: int | None = None
    specs: list[SpecFilter] = field(default_factory=list)
    with_unknown: bool = False
    confirmed_only: bool = False
    published: bool | None = None


def parse_spec_filters(raw: Sequence[str], definitions: Sequence[SpecDefinition]) -> list[SpecFilter]:
    """«payload_kg>=500», «navigation_type~slam», «elevator_integration=true» → фильтры с проверкой типа."""
    by_code = {d.code: d for d in definitions}
    result: list[SpecFilter] = []
    errors: list[FieldError] = []
    for item in raw:
        match = SPEC_FILTER.match(item.strip())
        definition = by_code.get(match["code"]) if match else None
        if match is None or definition is None:
            errors.append(FieldError("spec", f"Неизвестный фильтр «{item}». Формат: код>=число, код<=число, код~текст."))
            continue
        op, text = match["op"], match["value"].strip()
        if definition.data_type in NUMERIC:
            try:
                number = float(text.replace(",", "."))
            except ValueError:
                number = None
            if op not in (">=", "<=") or number is None:
                errors.append(FieldError("spec", f"«{definition.name}»: укажите число и условие не меньше / не больше."))
                continue
            result.append(SpecFilter(definition.code, definition.name, op, number))
        elif definition.data_type == ValueDataType.BOOLEAN:
            flag = text.lower() in ("true", "1", "да", "yes")
            if op != "=" or text.lower() not in ("true", "false", "1", "0", "да", "нет", "yes", "no"):
                errors.append(FieldError("spec", f"«{definition.name}»: ожидается «да» или «нет»."))
                continue
            result.append(SpecFilter(definition.code, definition.name, "=", flag))
        else:
            result.append(SpecFilter(definition.code, definition.name, "~", text.lower()))
    if errors:
        raise ApiValidationError(errors)
    return result


def spec_matches(entry: Entry, spec: SpecFilter, confirmed_only: bool) -> bool | None:
    """True/False — значение подходит или нет; None — данных нет (или они не подтверждены)."""
    value = entry.specs.get(spec.code)
    if value is None or (confirmed_only and not value.is_confirmed):
        return None
    if spec.op in (">=", "<="):
        if value.value_numeric is None:
            return None
        low = float(value.value_numeric)
        high = float(value.value_numeric_max) if value.value_numeric_max is not None else low
        # Диапазон подходит, если достигает порога: «до 10 ч» проходит фильтр «не меньше 8 ч».
        return high >= spec.value if spec.op == ">=" else low <= spec.value
    if spec.op == "=":
        return None if value.value_bool is None else value.value_bool == spec.value
    return None if not value.value_text else str(spec.value) in value.value_text.lower()


def _is_type(entry: Entry, type_id: int, hierarchy: Hierarchy) -> bool:
    current = entry.product.solution_type_id
    return current == type_id or (current is not None and hierarchy.types[current].parent_id == type_id)


def predicates(filters: CatalogFilters, hierarchy: Hierarchy) -> dict[str, Callable[[Entry], bool]]:
    """Условия фильтра по ключам фасетов: счётчик фасета считается без его собственного условия."""
    p: dict[str, Callable[[Entry], bool]] = {}
    if filters.q:
        words = filters.q.lower().split()
        p["q"] = lambda e: all(w in e.haystack for w in words)
    if filters.manufacturer_id is not None:
        p["manufacturer"] = lambda e: e.product.manufacturer_id == filters.manufacturer_id
    if filters.industry_id is not None:
        industry = filters.industry_id
        if filters.other_in_industry:
            own = hierarchy.industry_facilities(industry)
            p["industry"] = lambda e: industry in e.case_industries and not (e.facilities & own)
        else:
            p["industry"] = lambda e: industry in e.industries
    if filters.facility_type_id is not None:
        p["facility"] = lambda e: filters.facility_type_id in e.facilities
    if filters.process_id is not None:
        p["process"] = lambda e: filters.process_id in e.processes
    if filters.solution_type_id is not None:
        p["solution_type"] = lambda e: _is_type(e, filters.solution_type_id, hierarchy)
    if filters.product_classes:
        p["product_class"] = lambda e: e.product.product_class in filters.product_classes
    if filters.readiness_statuses:
        p["readiness_status"] = lambda e: e.product.readiness_status in filters.readiness_statuses
    if filters.countries:
        p["country"] = lambda e: (e.product.country_of_origin or "") in filters.countries
    if filters.acquisition_models:
        p["acquisition_model"] = lambda e: bool(set(e.summary.acquisition_models) & set(filters.acquisition_models))
    if filters.price_max is not None:
        p["price"] = lambda e: e.summary.price_from is not None and e.summary.price_from <= filters.price_max
    if filters.has_image:
        p["has_image"] = lambda e: e.summary.image_url is not None
    if filters.has_cases:
        p["has_cases"] = lambda e: e.has_cases
    if filters.min_completeness is not None:
        p["completeness"] = lambda e: e.summary.completeness_percent >= filters.min_completeness
    if filters.published is not None:
        p["published"] = lambda e: e.product.is_published == filters.published
    for spec in filters.specs:
        def check(e: Entry, spec: SpecFilter = spec) -> bool:
            result = spec_matches(e, spec, filters.confirmed_only)
            return filters.with_unknown if result is None else result

        # Код и условие: для температуры бывают две границы одновременно.
        p[f"spec:{spec.code}{spec.op}"] = check
    return p


def apply(entries: Sequence[Entry], preds: dict[str, Callable[[Entry], bool]], *, skip: str | None = None) -> list[Entry]:
    active = [check for key, check in preds.items() if key != skip]
    return [e for e in entries if all(check(e) for check in active)]


def unknown_specs(entry: Entry, filters: CatalogFilters) -> list[str]:
    """Характеристики фильтра, по которым у товара нет данных, — показываются как «требует проверки»."""
    return [s.name for s in filters.specs if spec_matches(entry, s, filters.confirmed_only) is None]


def sort_entries(entries: list[Entry], sort: Sort) -> list[Entry]:
    big = float("inf")
    keys: dict[str, Callable[[Entry], tuple]] = {
        "name": lambda e: (e.product.name.casefold(),),
        "price": lambda e: (e.summary.price_from is None, e.summary.price_from or 0, e.product.name.casefold()),
        "price_desc": lambda e: (e.summary.price_from is None, -(e.summary.price_from or 0), e.product.name.casefold()),
        "payload": lambda e: (e.summary.payload_kg is None, -(e.summary.payload_kg or 0), e.product.name.casefold()),
        "completeness": lambda e: (-e.summary.completeness_percent, e.product.name.casefold()),
        "updated": lambda e: (-e.product.updated_at.timestamp(), big),
    }
    return sorted(entries, key=keys[sort])


# ---------- фасеты ----------


def _count(entries: Sequence[Entry], value: Callable[[Entry], Sequence[str]]) -> Counter[str]:
    counter: Counter[str] = Counter()
    for entry in entries:
        counter.update(set(value(entry)))
    return counter


def facets(entries: Sequence[Entry], preds: dict[str, Callable[[Entry], bool]], hierarchy: Hierarchy) -> dict:
    def options(key: str, value: Callable[[Entry], Sequence[str]], label: Callable[[str], str], group=None) -> list[FacetValue]:
        counts = _count(apply(entries, preds, skip=key), value)
        items = [FacetValue(value=v, label=label(v), count=c, group=group(v) if group else None) for v, c in counts.items()]
        return sorted(items, key=lambda f: (-f.count, f.label))

    def type_label(value: str) -> str:
        return hierarchy.types[int(value)].name

    def type_group(value: str) -> str | None:
        node = hierarchy.types[int(value)]
        return hierarchy.types[node.parent_id].name if node.parent_id else node.name

    return {
        "solution_types": options(
            "solution_type",
            lambda e: [str(e.product.solution_type_id)] if e.product.solution_type_id else [],
            type_label,
            type_group,
        ),
        "product_classes": options(
            "product_class", lambda e: [e.product.product_class], lambda v: labels.PRODUCT_CLASS.get(v, v)
        ),
        "readiness_statuses": options(
            "readiness_status",
            lambda e: [e.product.readiness_status] if e.product.readiness_status else [],
            lambda v: labels.READINESS_STATUS.get(v, v),
        ),
        "countries": options(
            "country", lambda e: [e.product.country_of_origin] if e.product.country_of_origin else [], lambda v: v
        ),
        "acquisition_models": options(
            "acquisition_model", lambda e: list(e.summary.acquisition_models), lambda v: labels.ACQUISITION_MODEL.get(v, v)
        ),
        "with_image": len([e for e in apply(entries, preds, skip="has_image") if e.summary.image_url]),
        "with_cases": len([e for e in apply(entries, preds, skip="has_cases") if e.has_cases]),
    }


# ---------- дерево ----------


def _type_nodes(entries: Sequence[Entry], hierarchy: Hierarchy, params: dict, key: str) -> list[TreeNode]:
    counts = Counter(e.product.solution_type_id for e in entries if e.product.solution_type_id)
    nodes = [
        TreeNode(
            key=f"{key}:t{type_id}",
            kind="solution_type",
            name=hierarchy.types[type_id].name,
            count=count,
            params={**params, "solution_type_id": type_id},
        )
        for type_id, count in counts.items()
    ]
    return sorted(nodes, key=lambda n: (-n.count, n.name))


def build_tree(entries: Sequence[Entry], hierarchy: Hierarchy) -> list[TreeNode]:
    """Дерево каталога со счётчиками товаров на каждом уровне."""
    result: list[TreeNode] = []
    for industry in hierarchy.industries:
        members = [e for e in entries if industry.id in e.industries]
        facilities = [f for f in hierarchy.facilities if f.industry_id == industry.id]
        if not members and not facilities:
            continue
        base = {"industry_id": industry.id}
        key = f"i{industry.id}"
        children: list[TreeNode] = []
        for facility in facilities:
            in_facility = [e for e in members if facility.id in e.facilities]
            f_params = {**base, "facility_type_id": facility.id}
            processes = []
            for process in facility.processes:
                in_process = [e for e in in_facility if process.id in e.processes]
                p_params = {**f_params, "process_id": process.id}
                processes.append(
                    TreeNode(
                        key=f"{key}:p{process.id}",
                        kind="process",
                        name=process.name,
                        count=len(in_process),
                        params=p_params,
                        children=_type_nodes(in_process, hierarchy, p_params, f"{key}:p{process.id}"),
                    )
                )
            children.append(
                TreeNode(key=f"{key}:f{facility.id}", kind="facility", name=facility.name, count=len(in_facility),
                         params=f_params, children=processes)
            )
        own = {f.id for f in facilities}
        other = [e for e in members if industry.id in e.case_industries and not (e.facilities & own)]
        if facilities and other:
            o_params = {**base, "other_in_industry": True}
            children.append(
                TreeNode(key=f"{key}:o", kind="other", name="Другие решения отрасли", count=len(other), params=o_params,
                         children=_type_nodes(other, hierarchy, o_params, f"{key}:o"))
            )
        if not facilities:
            children = _type_nodes(members, hierarchy, base, key)
        result.append(
            TreeNode(key=key, kind="industry", name=industry.name, count=len(members), params=base, children=children)
        )
    # Отрасли с описанными объектами (склад, аэропорт, больница) — первыми, остальные — по числу решений.
    return sorted(result, key=lambda n: (not any(c.kind == "facility" for c in n.children), -n.count, n.name))
