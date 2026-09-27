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
    (ChecklistItem("field:service_life_years", "Срок службы", "economics"),
     lambda p: p.service_life_years is not None),
    (ChecklistItem("field:processes", "Поддерживаемые процессы", "applicability"), lambda p: bool(p.processes)),
    (ChecklistItem("field:limitations", "Ограничения применения", "applicability"), lambda p: bool(p.limitations)),
]

_IDENTIFICATION = [item for item, _ in _FIELD_CHECKS if item.group == "identification"]
_OTHER = [item for item, _ in _FIELD_CHECKS if item.group != "identification"]


def checklist(mandatory_specs: Sequence[SpecDefinition]) -> list[ChecklistItem]:
    specs = [ChecklistItem(f"spec:{d.code}", d.name, str(d.group)) for d in mandatory_specs]
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
    items = checklist(mandatory_specs)
    by_code = {d.code: d for d in mandatory_specs}
    for item in items:
        kind, _, name = item.key.partition(":")
        ok = by_code[name].id in filled_specs if kind == "spec" else checks[item.key](product)
        if not ok:
            missing.append(item.label)
    return len(items) - len(missing), len(items), missing
