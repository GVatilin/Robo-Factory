from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

from app.models import Product, ProductApplication, ProductSpecValue, SolutionType, SpecDefinition
from app.models.enums import ProductClass, SpecGroup, ValueDataType
from app.schemas.catalog import CompareCell, CompareRow
from app.services.catalog_query import (
    CatalogFilters,
    Hierarchy,
    apply,
    build_tree,
    make_entry,
    parse_spec_filters,
    predicates,
    unknown_specs,
)
from app.services.comparison import finalize

import pytest

from app.api.errors import ApiValidationError

AMR = SolutionType(id=11, code="amr", name="AMR", parent_id=1)
CLEANER = SolutionType(id=12, code="cleaning_robot", name="Робот-уборщик", parent_id=1)
DRONE = SolutionType(id=30, code="uas", name="БАС", parent_id=None)
MOBILE = SolutionType(id=1, code="mobile_robots", name="Мобильные роботы", parent_id=None)
PAYLOAD = SpecDefinition(id=1, code="payload_kg", name="Грузоподъёмность", group=SpecGroup.TECHNICAL, unit="кг",
                         data_type=ValueDataType.NUMBER, is_mandatory=True, is_filterable=True)
RUNTIME = SpecDefinition(id=2, code="runtime_h", name="Автономность", group=SpecGroup.TECHNICAL, unit="ч",
                         data_type=ValueDataType.RANGE, is_mandatory=True, is_filterable=True)
NAV = SpecDefinition(id=3, code="navigation_type", name="Тип навигации", group=SpecGroup.TECHNICAL, unit=None,
                     data_type=ValueDataType.STRING, is_mandatory=True, is_filterable=True)
LIFT = SpecDefinition(id=4, code="elevator_integration", name="Лифты", group=SpecGroup.INFRASTRUCTURE, unit=None,
                      data_type=ValueDataType.BOOLEAN, is_mandatory=False, is_filterable=True)
DEFINITIONS = [PAYLOAD, RUNTIME, NAV, LIFT]


def hierarchy() -> Hierarchy:
    processes = [SimpleNamespace(id=100, name="Приёмка"), SimpleNamespace(id=101, name="Уборка")]
    warehouse = SimpleNamespace(id=10, name="Склад", industry_id=1, processes=processes)
    return Hierarchy(
        industries=[SimpleNamespace(id=1, name="Логистика"), SimpleNamespace(id=2, name="ТЭК")],
        facilities=[warehouse],
        types={t.id: t for t in (AMR, CLEANER, DRONE, MOBILE)},
        process_types={100: {AMR.id}, 101: {CLEANER.id}},
        process_facility={100: 10, 101: 10},
        facility_industry={10: 1},
    )


def product(pid: int, kind: SolutionType, specs=(), industries=(), processes=()) -> Product:
    values = []
    for definition, number, upper, text in specs:
        values.append(ProductSpecValue(definition=definition, spec_definition_id=definition.id,
                                       value_numeric=Decimal(str(number)) if number is not None else None,
                                       value_numeric_max=Decimal(str(upper)) if upper is not None else None,
                                       value_text=text, value_bool=None, is_confirmed=True))
    return Product(
        id=pid, name=f"Товар {pid}", product_class=ProductClass.BRS, is_published=True, solution_type=kind,
        solution_type_id=kind.id, manufacturer=None, spec_values=values, offers=[], image=None,
        processes=[SimpleNamespace(id=p) for p in processes],
        applications=[ProductApplication(industry_id=i, case_description="кейс") for i in industries],
        updated_at=datetime.now(UTC),
    )


def entries():
    h = hierarchy()
    items = [
        product(1, AMR, specs=[(PAYLOAD, 1500, None, None), (RUNTIME, 6, 10, None), (NAV, None, None, "QR и SLAM")]),
        product(2, AMR, specs=[(PAYLOAD, 300, None, None)], processes=[101]),  # процесс указан в карточке
        product(3, CLEANER, industries=[1]),
        product(4, DRONE, industries=[1, 2]),
    ]
    return [make_entry(p, h, [PAYLOAD, RUNTIME, NAV]) for p in items], h


def ids(result) -> list[int]:
    return [e.product.id for e in result]


def test_membership_by_type_or_explicit_processes():
    items, _ = entries()
    by_id = {e.product.id: e for e in items}
    assert by_id[1].processes == {100} and by_id[1].industries == {1}
    assert by_id[2].processes == {101}  # явная привязка важнее типа решения
    assert by_id[4].processes == frozenset() and by_id[4].industries == {1, 2}


def test_tree_counts_and_other_solutions_of_industry():
    items, h = entries()
    tree = build_tree(items, h)
    logistics, tek = tree
    assert (logistics.name, logistics.count) == ("Логистика", 4)
    warehouse, other = logistics.children
    assert (warehouse.kind, warehouse.count) == ("facility", 3)
    assert [(p.name, p.count) for p in warehouse.children] == [("Приёмка", 1), ("Уборка", 2)]
    assert [(t.name, t.count, t.params) for t in warehouse.children[1].children] == [
        ("AMR", 1, {"industry_id": 1, "facility_type_id": 10, "process_id": 101, "solution_type_id": 11}),
        ("Робот-уборщик", 1, {"industry_id": 1, "facility_type_id": 10, "process_id": 101, "solution_type_id": 12}),
    ]
    assert (other.kind, other.count, other.params) == ("other", 1, {"industry_id": 1, "other_in_industry": True})
    # Отрасль без описанных объектов раскрывается сразу по типам решений.
    assert [(c.kind, c.name) for c in tek.children] == [("solution_type", "БАС")]


def test_hierarchy_filters_match_tree_nodes():
    items, h = entries()
    check = lambda **kw: ids(apply(items, predicates(CatalogFilters(**kw), h)))  # noqa: E731
    assert check(process_id=101) == [2, 3]
    assert check(industry_id=1, other_in_industry=True) == [4]
    assert check(solution_type_id=MOBILE.id) == [1, 2, 3]  # категория включает свои типы
    assert check(q="товар 3") == [3]


def test_spec_filters_use_range_bounds_and_unknown_values():
    items, h = entries()
    specs = parse_spec_filters(["payload_kg>=1000", "runtime_h>=8"], DEFINITIONS)
    filters = CatalogFilters(specs=specs)
    assert ids(apply(items, predicates(filters, h))) == [1]  # «6–10 ч» проходит «не меньше 8 ч»
    filters = CatalogFilters(specs=parse_spec_filters(["payload_kg>=1000"], DEFINITIONS), with_unknown=True)
    result = apply(items, predicates(filters, h))
    assert ids(result) == [1, 3, 4]
    assert unknown_specs(result[1], filters) == ["Грузоподъёмность"]
    filters = CatalogFilters(specs=parse_spec_filters(["navigation_type~slam"], DEFINITIONS))
    assert ids(apply(items, predicates(filters, h))) == [1]


def test_invalid_spec_filters_are_reported():
    with pytest.raises(ApiValidationError) as error:
        parse_spec_filters(["payload_kg~abc", "unknown>=1", "elevator_integration=maybe"], DEFINITIONS)
    assert [e.field for e in error.value.errors] == ["spec", "spec", "spec"]


def test_comparison_marks_best_only_for_comparable_values():
    row = finalize(CompareRow(key="r", label="r", kind="number", better="higher", cells=[
        CompareCell(value=6, value_max=10, unit="ч"), CompareCell(value=8, unit="ч"), CompareCell(),
    ]))
    assert row.best == [0] and row.differs
    mixed = finalize(CompareRow(key="t", label="t", kind="number", better="higher", cells=[
        CompareCell(value=80, unit="паллет/ч"), CompareCell(value=1000, unit="м²/ч"),
    ]))
    assert mixed.best == []
    same = finalize(CompareRow(key="s", label="s", kind="number", better="lower", cells=[
        CompareCell(value=5, unit="кг"), CompareCell(value=5, unit="кг"),
    ]))
    assert same.best == [] and not same.differs
