"""Полнота карточки продукта по обязательным характеристикам п. 3.3.7 ТЗ.

Чек-лист отдаётся интерфейсу (GET /reference/product-checklist): форма показывает полноту до сохранения
по тем же ключам. Ключ «spec:<код>» — обязательная ТТХ справочника, «field:<имя>» — поле карточки.
Наименование, производитель и тип решения обязательны при сохранении, поэтому в чек-лист не входят.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from app.models import Product, SpecDefinition


@dataclass(frozen=True)
class ChecklistItem:
    key: str
    label: str
    group: str
    excluded_product_classes: tuple[str, ...] = ()
    excluded_solution_types: tuple[str, ...] = ()


# Applicability of the checklist, not manufacturer specifications. Unknown values
# remain missing; only characteristics with no meaning for this product type are excluded.
_SOFTWARE_PHYSICAL = {
    'payload_kg', 'length_mm', 'width_mm', 'height_mm', 'weight_kg', 'max_speed_mps',
    'runtime_h', 'positioning_accuracy_mm', 'navigation_type', 'operating_temp_c',
    'min_aisle_width_mm', 'floor_requirements', 'charging_infrastructure',
}
_GROUND_ONLY = {'min_aisle_width_mm', 'floor_requirements'}
_WATER_TYPES = ('marine_robots', 'tnpa', 'bespilotnyy_kater', 'bezekipazhnyy_kater',
                'bespilotnyy_katamaran', 'bespilotnyy_servisnyy_katamaran',
                'modulnaya_nadvodnaya_mnogofunktsionalnaya_platforma',
                'modulnaya_navodnaya_mnogofunktsionalnaya_platforma')


def applicable(item: ChecklistItem, product: Product) -> bool:
    return (str(product.product_class) not in item.excluded_product_classes
            and (not product.solution_type or product.solution_type.code not in item.excluded_solution_types))


def not_applicable(product: Product, mandatory_specs: Sequence[SpecDefinition]) -> list[str]:
    return [item.label for item in checklist(mandatory_specs) if not applicable(item, product)]


_FIELD_CHECKS: list[tuple[ChecklistItem, Callable[[Product], bool]]] = [
    (ChecklistItem("field:purpose", "Назначение", "identification"), lambda p: bool(p.purpose)),
    (ChecklistItem("field:country_of_origin", "Страна происхождения", "identification"),
     lambda p: bool(p.country_of_origin)),
    (ChecklistItem("field:readiness_status", "Статус доступности", "identification"),
     lambda p: p.readiness_status is not None),
    (ChecklistItem("field:price", "Ориентировочная стоимость", "economics"),
     lambda p: any(o.equipment_price is not None or o.monthly_fee is not None for o in p.offers)),
    (ChecklistItem("field:service_cost", "Стоимость обслуживания", "economics"),
     lambda p: any(o.annual_service_cost is not None for o in p.offers)),
    (ChecklistItem("field:software_cost", "Стоимость ПО", "economics"),
     lambda p: any(o.software_price is not None for o in p.offers)),
    (ChecklistItem("field:implementation_cost", "Стоимость внедрения", "economics"),
     lambda p: any(o.implementation_price is not None for o in p.offers)),
    (ChecklistItem("field:service_life_years", "Срок службы", "economics"),
     lambda p: p.service_life_years is not None),
    (ChecklistItem("field:processes", "Поддерживаемые процессы", "applicability"),
     lambda p: bool(p.processes) or any(a.scenario for a in p.applications)),
    (ChecklistItem("field:limitations", "Ограничения применения", "applicability"), lambda p: bool(p.limitations)),
]

_IDENTIFICATION = [item for item, _ in _FIELD_CHECKS if item.group == "identification"]
_OTHER = [item for item, _ in _FIELD_CHECKS if item.group != "identification"]


def checklist(mandatory_specs: Sequence[SpecDefinition]) -> list[ChecklistItem]:
    specs = [ChecklistItem(f"spec:{d.code}", d.name, str(d.group),
             tuple(c for c, excluded in [('software', _SOFTWARE_PHYSICAL), ('bas', _GROUND_ONLY)] if d.code in excluded),
             _WATER_TYPES if d.code in _GROUND_ONLY else ()) for d in mandatory_specs]
    return [*_IDENTIFICATION, *specs, *_OTHER]


def evaluate(product: Product, mandatory_specs: Sequence[SpecDefinition]) -> tuple[int, int, list[str]]:
    """Возвращает (заполнено, всего, названия незаполненных) в порядке чек-листа."""
    filled_specs = {
        v.spec_definition_id
        for v in product.spec_values
        if v.value_numeric is not None or v.value_text or v.value_bool is not None
    }
    checks = {item.key: check for item, check in _FIELD_CHECKS}
    missing: list[str] = []
    items = [item for item in checklist(mandatory_specs) if applicable(item, product)]
    by_code = {d.code: d for d in mandatory_specs}
    for item in items:
        kind, _, name = item.key.partition(":")
        ok = by_code[name].id in filled_specs if kind == "spec" else checks[item.key](product)
        if not ok:
            missing.append(item.label)
    return len(items) - len(missing), len(items), missing
