"""Сравнение решений по группам характеристик п. 3.3.7 ТЗ и дополнительным показателям платформы.

Группы: идентификация, технические характеристики, инфраструктура, экономика, применимость, качество данных,
дополнительные показатели. Для числовых строк известно направление («больше — лучше» или «меньше — лучше»):
лучшее значение отмечается, если данных хватает хотя бы у двух решений и единицы совпадают.
Дополнительные показатели считаются по формулам, которые показаны в подсказке строки.
"""

from collections.abc import Callable, Sequence

from app.core import labels
from app.models import Product, ProductOffer, ProductSpecValue, SpecDefinition
from app.models.enums import AcquisitionModel, SpecGroup, ValueDataType
from app.schemas.catalog import CompareCell, CompareGroup, CompareRow
from app.services.catalog_query import Entry, Hierarchy

MAX_COMPARE = 6
HORIZON_YEARS = 5

# Направление сравнения характеристик справочника; без записи — нейтрально (габариты, навигация...).
BETTER: dict[str, str] = {
    "payload_kg": "higher", "max_speed_mps": "higher", "throughput": "higher", "runtime_h": "higher",
    "charge_time_h": "lower", "positioning_accuracy_mm": "lower", "lift_height_mm": "higher",
    "cleaning_width_mm": "higher", "tank_volume_l": "higher", "battery_capacity_kwh": "higher",
    "range_km": "higher", "noise_dba": "lower", "min_aisle_width_mm": "lower",
}

NUMERIC = {ValueDataType.NUMBER, ValueDataType.INTEGER, ValueDataType.RANGE}


def _num(value) -> float | None:
    return float(value) if value is not None else None


def _sort_key(cell: CompareCell, better: str) -> float | None:
    if cell.value is None:
        return None
    return cell.value_max if better == "higher" and cell.value_max is not None else cell.value


def finalize(row: CompareRow) -> CompareRow:
    signatures = {(c.value, c.value_max, c.text, tuple(c.items or ()), c.flag, c.unit) for c in row.cells}
    row.differs = len(signatures) > 1
    if row.better:
        present = [(i, _sort_key(c, row.better)) for i, c in enumerate(row.cells)]
        present = [(i, k) for i, k in present if k is not None]
        units = {row.cells[i].unit for i, _ in present}
        if len(present) >= 2 and len(units) <= 1 and len({k for _, k in present}) > 1:
            target = max(k for _, k in present) if row.better == "higher" else min(k for _, k in present)
            row.best = [i for i, k in present if k == target]
    return row


def _row(key: str, label: str, kind: str, cells: list[CompareCell], **extra) -> CompareRow:
    return finalize(CompareRow(key=key, label=label, kind=kind, cells=cells, **extra))


def _text(values: Sequence[str | None]) -> list[CompareCell]:
    return [CompareCell(text=v) if v else CompareCell() for v in values]


def spec_cell(value: ProductSpecValue | None) -> CompareCell:
    if value is None:
        return CompareCell()
    return CompareCell(
        value=_num(value.value_numeric),
        value_max=_num(value.value_numeric_max),
        text=value.value_text,
        flag=value.value_bool,
        unit=value.unit or value.definition.unit,
        confirmed=value.is_confirmed,
        note=value.note or (value.source.title if value.source else None),
    )


def main_offer(product: Product) -> ProductOffer | None:
    """Основное предложение покупки: отмеченное основным или самое дешёвое с ценой оборудования."""
    priced = [o for o in product.offers if o.equipment_price is not None and o.acquisition_model == AcquisitionModel.PURCHASE]
    priced = priced or [o for o in product.offers if o.equipment_price is not None]
    if not priced:
        return None
    return next((o for o in priced if o.is_default), min(priced, key=lambda o: o.equipment_price))


def _spec_value(entry: Entry, code: str, *, upper: bool = False) -> float | None:
    value = entry.specs.get(code)
    if value is None or value.value_numeric is None:
        return None
    if upper and value.value_numeric_max is not None:
        return float(value.value_numeric_max)
    return float(value.value_numeric)


def spec_rows(entries: Sequence[Entry], definitions: Sequence[SpecDefinition], group: SpecGroup) -> list[CompareRow]:
    rows = []
    for definition in definitions:
        if definition.group != group:
            continue
        cells = [spec_cell(e.specs.get(definition.code)) for e in entries]
        has_data = any(c.value is not None or c.text or c.flag is not None for c in cells)
        if not has_data and not definition.is_mandatory:
            continue
        kind = "number" if definition.data_type in NUMERIC else "bool" if definition.data_type == ValueDataType.BOOLEAN else "text"
        rows.append(
            _row(
                f"spec:{definition.code}", definition.name, kind, cells,
                unit=definition.unit, better=BETTER.get(definition.code), mandatory=definition.is_mandatory,
            )
        )
    return rows


def build_groups(entries: Sequence[Entry], definitions: Sequence[SpecDefinition], hierarchy: Hierarchy) -> list[CompareGroup]:
    products = [e.product for e in entries]
    offers = [main_offer(p) for p in products]

    def money(getter: Callable[[ProductOffer], object]) -> list[CompareCell]:
        return [CompareCell(value=_num(getter(o)), unit="₽") if o and getter(o) is not None else CompareCell() for o in offers]

    rentals = [
        min((float(o.monthly_fee) for o in p.offers if o.monthly_fee is not None), default=None) for p in products
    ]
    process_names = {proc.id: proc.name for f in hierarchy.facilities for proc in f.processes}
    facility_names = {f.id: f.name for f in hierarchy.facilities}

    identification = CompareGroup(
        key="identification",
        title="Идентификация",
        rows=[
            _row("manufacturer", "Производитель", "text", _text([p.manufacturer.name if p.manufacturer else None for p in products]), mandatory=True),
            _row("name", "Наименование", "text", _text([p.name for p in products]), mandatory=True),
            _row(
                "solution_type", "Тип решения", "text",
                _text([
                    " · ".join(filter(None, [p.solution_type.parent.name if p.solution_type and p.solution_type.parent else None,
                                             p.solution_type.name if p.solution_type else None])) or None
                    for p in products
                ]),
                mandatory=True,
            ),
            _row("purpose", "Назначение", "text", _text([p.purpose for p in products]), mandatory=True),
            _row("country", "Страна происхождения", "text", _text([p.country_of_origin for p in products]), mandatory=True),
            _row(
                "readiness", "Статус доступности", "text",
                _text([labels.READINESS_STATUS.get(p.readiness_status) if p.readiness_status else None for p in products]),
                mandatory=True,
            ),
            _row("class", "Класс изделия", "text", _text([labels.PRODUCT_CLASS.get(p.product_class) for p in products])),
            _row("trl", "Уровень готовности технологии (УГТ)", "number",
                 [CompareCell(value=p.trl) if p.trl else CompareCell() for p in products], better="higher"),
        ],
    )

    economics = CompareGroup(
        key="economics",
        title="Экономика",
        description="Основное предложение покупки; для аренды — минимальный ежемесячный платёж.",
        rows=[
            _row("equipment_price", "Стоимость оборудования", "money", money(lambda o: o.equipment_price), better="lower", mandatory=True),
            _row("software_price", "Программное обеспечение", "money", money(lambda o: o.software_price), better="lower", mandatory=True),
            _row("implementation_price", "Внедрение и интеграция", "money", money(lambda o: o.implementation_price), better="lower", mandatory=True),
            _row("annual_service_cost", "Обслуживание в год", "money", money(lambda o: o.annual_service_cost), unit="₽/год", better="lower", mandatory=True),
            _row("monthly_fee", "Аренда или RaaS в месяц", "money",
                 [CompareCell(value=r, unit="₽") if r is not None else CompareCell() for r in rentals], unit="₽/мес", better="lower"),
            _row("acquisition_models", "Модели приобретения", "list",
                 [CompareCell(items=[labels.ACQUISITION_MODEL[m] for m in sorted({o.acquisition_model for o in p.offers})] or None) for p in products],
                 mandatory=True),
            _row("service_life", "Срок службы", "number",
                 [CompareCell(value=_num(p.service_life_years)) for p in products], unit="лет", better="higher", mandatory=True),
            _row("vat", "Цены с НДС", "bool", [CompareCell(flag=o.price_includes_vat) if o else CompareCell() for o in offers]),
        ],
    )

    applicability = CompareGroup(
        key="applicability",
        title="Применимость",
        rows=[
            _row(
                "facilities", "Типы объектов", "list",
                [CompareCell(items=[facility_names[f] for f in sorted(e.facilities)] or None) for e in entries],
                mandatory=True,
            ),
            _row(
                "processes", "Поддерживаемые процессы", "list",
                [
                    CompareCell(
                        items=sorted(process_names[p] for p in e.processes) or None,
                        note="Указаны в карточке" if e.product.processes else "Определены по типу решения",
                    )
                    for e in entries
                ],
                mandatory=True,
            ),
            _row("limitations", "Ограничения", "text", _text([p.limitations for p in products]), mandatory=True),
            _row("cases", "Реализованные кейсы", "number",
                 [CompareCell(value=sum(1 for a in p.applications if a.case_description)) for p in products],
                 better="higher", mandatory=True),
            _row("industries", "Отрасли применения", "list",
                 [CompareCell(items=sorted({a.industry.name for a in p.applications if a.industry}) or None) for p in products]),
        ],
    )

    def confirmed_share(entry: Entry) -> float | None:
        values = list(entry.specs.values())
        return round(100 * sum(v.is_confirmed for v in values) / len(values)) if values else None

    quality = CompareGroup(
        key="quality",
        title="Качество данных",
        rows=[
            _row("sources", "Источники", "list", [CompareCell(items=[s.title for s in p.sources] or None) for p in products], mandatory=True),
            _row("verified", "Дата актуализации", "date",
                 [CompareCell(text=(p.last_verified_at or p.updated_at.date()).isoformat()) for p in products], mandatory=True),
            _row("completeness", "Полнота карточки", "percent",
                 [CompareCell(value=e.summary.completeness_percent) for e in entries], unit="%", better="higher", mandatory=True),
            _row("confirmed", "Подтверждённые значения ТТХ", "percent",
                 [CompareCell(value=confirmed_share(e)) for e in entries], unit="%", better="higher", mandatory=True),
            _row("photo", "Фотография", "bool", [CompareCell(flag=p.image is not None) for p in products]),
            _row("origin", "Происхождение карточки", "text",
                 _text(["Каталог организатора" if p.external_id else "Добавлена в платформе" for p in products])),
        ],
    )

    derived = CompareGroup(
        key="derived",
        title="Дополнительные показатели",
        description="Рассчитаны платформой из характеристик и цен карточек. Формула — в подсказке строки.",
        rows=_derived_rows(entries, offers),
    )

    return [
        identification,
        CompareGroup(key="technical", title="Технические характеристики", rows=spec_rows(entries, definitions, SpecGroup.TECHNICAL)),
        CompareGroup(key="infrastructure", title="Инфраструктура", rows=spec_rows(entries, definitions, SpecGroup.INFRASTRUCTURE)),
        economics,
        applicability,
        quality,
        derived,
    ]


def _derived_rows(entries: Sequence[Entry], offers: Sequence[ProductOffer | None]) -> list[CompareRow]:
    def cells(compute: Callable[[Entry, ProductOffer | None], float | None], unit: str | None = None) -> list[CompareCell]:
        values = [compute(e, o) for e, o in zip(entries, offers, strict=True)]
        return [CompareCell(value=round(v, 2), unit=unit) if v is not None else CompareCell() for v in values]

    def price_per_kg(e: Entry, o: ProductOffer | None) -> float | None:
        payload = _spec_value(e, "payload_kg", upper=True)
        return float(o.equipment_price) / payload if o and payload else None

    def footprint(e: Entry, _: ProductOffer | None) -> float | None:
        length, width = _spec_value(e, "length_mm"), _spec_value(e, "width_mm")
        return length * width / 1_000_000 if length and width else None

    def speed_kmh(e: Entry, _: ProductOffer | None) -> float | None:
        speed = _spec_value(e, "max_speed_mps", upper=True)
        return speed * 3.6 if speed else None

    def availability(e: Entry, _: ProductOffer | None) -> float | None:
        runtime, charge = _spec_value(e, "runtime_h", upper=True), _spec_value(e, "charge_time_h")
        return 100 * runtime / (runtime + charge) if runtime and charge is not None else None

    def direct_costs(_: Entry, o: ProductOffer | None) -> float | None:
        if o is None or o.equipment_price is None:
            return None
        parts = [o.equipment_price, o.software_price, o.implementation_price]
        return float(sum(p for p in parts if p is not None)) + HORIZON_YEARS * float(o.annual_service_cost or 0)

    def service_share(_: Entry, o: ProductOffer | None) -> float | None:
        if o is None or not o.equipment_price or o.annual_service_cost is None:
            return None
        return 100 * float(o.annual_service_cost) / float(o.equipment_price)

    return [
        _row("price_per_kg", "Стоимость 1 кг грузоподъёмности", "money", cells(price_per_kg, "₽"), unit="₽/кг", better="lower",
             hint="Стоимость оборудования ÷ грузоподъёмность"),
        _row("footprint", "Площадь, занимаемая роботом", "number", cells(footprint, "м²"), unit="м²", better="lower",
             hint="Длина × ширина: чем меньше пятно, тем проще маневрировать в проходах"),
        _row("speed_kmh", "Максимальная скорость", "number", cells(speed_kmh, "км/ч"), unit="км/ч", better="higher",
             hint="Скорость в м/с × 3,6"),
        _row("availability", "Доля рабочего времени", "percent", cells(availability, "%"), unit="%", better="higher",
             hint="Время работы ÷ (время работы + время зарядки) × 100%"),
        _row("direct_costs", f"Прямые затраты за {HORIZON_YEARS} лет", "money", cells(direct_costs, "₽"), unit="₽", better="lower",
             hint=f"Оборудование + ПО + внедрение + {HORIZON_YEARS} × обслуживание в год. Без электроэнергии, персонала и "
                  "ремонта: ориентир для сравнения, полный TCO считает модуль экономики"),
        _row("service_share", "Обслуживание в год от цены", "percent", cells(service_share, "%"), unit="%", better="lower",
             hint="Обслуживание в год ÷ стоимость оборудования × 100%"),
    ]
