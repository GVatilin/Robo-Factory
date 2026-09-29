"""Explainable product recommendation and fleet sizing.

The model deliberately separates three concerns:
1. catalogue applicability to a process;
2. hard feasibility checks and data gaps;
3. ranking among products that passed the hard gate.

No free-text product field is interpreted as a hard constraint. Such fields are
reported as risks for an on-site survey instead of producing false precision.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Callable

from app.schemas.selection import SelectionInput
from app.services.equipment import equipment_plan

VERSION = "selection-2.0"
FORMULA = (
    "N = ceil(((объём/сутки / часы/сутки) × пик × (1 + резерв/100)) / "
    "(производительность × загрузка × доступность))"
)

DEFAULT_UTILIZATION = 0.80
DEFAULT_AVAILABILITY = 0.90
DEFAULT_RESERVE_PERCENT = 15.0
MAX_FLEET_SIZE = 100_000

RANKING_WEIGHTS = {
    "Совместимость с процессом": 25.0,
    "Ключевые ограничения": 30.0,
    "Расчёт производительности и парка": 25.0,
    "Качество данных каталога": 20.0,
}


@dataclass(frozen=True)
class DemandRule:
    driver: str | None
    unit: str
    mass_parameter: str | None = None


# One process has one explicitly named workload. Different operations are never
# added together implicitly. A None driver means that the project dataset has no
# defensible flow for this process and the user must enter it with a reason.
DRIVERS: dict[tuple[str, str], DemandRule] = {
    ("warehouse", "inbound"): DemandRule("inbound_pallets_per_day", "паллет/ч", "pallet_weight_kg"),
    ("warehouse", "outbound"): DemandRule("outbound_pallets_per_day", "паллет/ч", "pallet_weight_kg"),
    ("warehouse", "internal_transport"): DemandRule("internal_moves_per_day", "рейсов/ч", "pallet_weight_kg"),
    ("warehouse", "picking"): DemandRule("picking_lines_per_day", "строк/ч", "unit_weight_kg"),
    ("warehouse", "sorting"): DemandRule("picking_units_per_day", "отправлений/ч", "unit_weight_kg"),
    ("warehouse", "cleaning"): DemandRule("active_area_m2", "м²/ч"),
    ("warehouse", "storage"): DemandRule(None, "операций/ч", "pallet_weight_kg"),
    ("warehouse", "inventory"): DemandRule(None, "позиций/ч"),
    ("airport", "baggage"): DemandRule("baggage_units_per_day", "отправлений/ч", "baggage_unit_weight_kg"),
    ("airport", "terminal_logistics"): DemandRule("internal_cart_trips_per_day", "рейсов/ч"),
    ("airport", "cleaning"): DemandRule("robotic_cleaning_area_m2", "м²/ч"),
    ("airport", "catering"): DemandRule("catering_meals_per_day", "порций/ч"),
    ("airport", "waste"): DemandRule("waste_containers_per_day", "контейнеров/ч"),
    ("airport", "ramp_transport"): DemandRule(None, "операций/ч"),
    ("airport", "security"): DemandRule(None, "м²/ч"),
    ("medical", "cleaning"): DemandRule("total_area_m2", "м²/ч"),
    ("medical", "linen"): DemandRule("dirty_linen_kg_per_day", "кг/ч", "linen_container_weight_kg"),
    ("medical", "food"): DemandRule("meal_portions_per_day", "порций/ч", "food_cart_weight_kg"),
    ("medical", "medicines"): DemandRule("medicine_requests_per_day", "заявок/ч"),
    ("medical", "lab_samples"): DemandRule("lab_samples_per_day", "образцов/ч"),
    ("medical", "waste"): DemandRule("waste_class_a_kg_per_day", "кг/ч"),
}

WAREHOUSE_AISLE_PARAMETER = {
    "inbound": "main_aisle_width_m",
    "outbound": "main_aisle_width_m",
    "internal_transport": "main_aisle_width_m",
    "cleaning": "main_aisle_width_m",
    "picking": "rack_aisle_width_m",
    "sorting": "rack_aisle_width_m",
    "storage": "rack_aisle_width_m",
    "inventory": "rack_aisle_width_m",
}

STATUS_ORDER = {"suitable": 0, "needs_review": 1, "excluded": 2}


def number(parameters: dict[str, Any], key: str | None) -> float | None:
    value = parameters.get(key) if key else None
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return float(value)
    return None


def _hours_from_schedule(value: Any) -> float | None:
    """Extract operating hours from common facility schedule strings.

    The organiser's medical dataset stores the operating mode as text (for
    example, ``24/7``), whereas the fleet formula requires hours per day.
    """
    if not isinstance(value, str):
        return None
    text = value.casefold().replace(" ", "")
    if "24/7" in text or "24×7" in text or "круглосут" in text:
        return 24.0
    interval = re.search(
        r"(?P<start>\d{1,2})(?::(?P<start_min>\d{2}))?[-–—](?P<end>\d{1,2})(?::(?P<end_min>\d{2}))?",
        text,
    )
    if interval:
        start = int(interval["start"]) + int(interval["start_min"] or 0) / 60
        end = int(interval["end"]) + int(interval["end_min"] or 0) / 60
        duration = (end - start) % 24
        return duration or 24.0
    hours = re.search(r"(?P<hours>\d+(?:[.,]\d+)?)\s*(?:ч|час)", value.casefold())
    if hours:
        result = float(hours["hours"].replace(",", "."))
        return result if 0 < result <= 24 else None
    return None


def _append_unique(items: list[str], message: str) -> None:
    if message not in items:
        items.append(message)


def demand_context(facility: str, process: str, parameters: dict[str, Any], options: SelectionInput) -> dict:
    rule = DRIVERS.get((facility, process), DemandRule(None, "операций/ч"))
    if facility == "medical":
        trip_driver = {"linen": "linen_trips_per_day", "food": "food_trips_per_day",
                       "medicines": "medicine_trips_per_day", "waste": "waste_trips_per_day"}.get(process)
        if trip_driver and number(parameters, trip_driver) is not None:
            rule = DemandRule(trip_driver, "рейсов/ч", rule.mass_parameter)
    daily_source = "manual" if options.daily_demand is not None else rule.driver
    daily = options.daily_demand if options.daily_demand is not None else number(parameters, rule.driver)

    if facility == "airport" and process == "ramp_transport" and options.daily_demand is None:
        flights = number(parameters, "daily_flights")
        operations = number(parameters, "ground_ops_per_flight")
        if flights is not None and operations is not None:
            daily = flights * operations
            daily_source = "daily_flights × ground_ops_per_flight"

    hours_source = "manual" if options.hours_per_day is not None else None
    hours = options.hours_per_day
    if hours is None:
        hours = number(parameters, "operating_hours_per_day")
        if hours is not None:
            hours_source = "operating_hours_per_day"
    if hours is None:
        shifts = number(parameters, "shifts_per_day")
        duration = number(parameters, "shift_duration_h")
        if shifts is not None and duration is not None:
            hours = shifts * duration
            hours_source = "shifts_per_day × shift_duration_h"
    if hours is None and facility == "medical":
        hours = _hours_from_schedule(parameters.get("inpatient_schedule"))
        if hours is not None:
            hours_source = "inpatient_schedule"

    peak_source = "manual" if options.peak_factor is not None else "peak_load_factor"
    peak = options.peak_factor if options.peak_factor is not None else number(parameters, "peak_load_factor")

    assumptions = [
        (
            f"Коэффициент загрузки {options.utilization:g}; базовое значение {DEFAULT_UTILIZATION:g} "
            "взято из набора организатора."
        ),
        (
            f"Техническая доступность {options.availability:g}; базовое значение {DEFAULT_AVAILABILITY:g} — "
            "документированное допущение команды."
        ),
        (
            f"Резерв парка {options.reserve_percent:g}%; базовое значение набора организатора — "
            f"{DEFAULT_RESERVE_PERCENT:g}%."
        ),
        "Парк рассчитывается только для выбранного процесса; объёмы разных операций не суммируются.",
    ]
    if rule.driver is None and not (facility == "airport" and process == "ramp_transport"):
        assumptions.append(
            "Для процесса нет однозначного драйвера в датасете: задайте суточный объём вручную и обоснуйте его."
        )
    if facility == "airport" and process == "ramp_transport":
        assumptions.append(
            "Объём = рейсы в сутки × наземные операции на рейс; уточните долю операций, доступных роботу."
        )
    if facility == "medical":
        assumptions.append(
            "Санитарные требования, разделение чистых и грязных потоков и время доставки проверяются отдельно."
        )
        if rule.unit == "рейсов/ч":
            assumptions.append("Нагрузка задана числом рейсов из параметров проекта. Производительность робота требуется в рейсах/ч; килограммы, порции и заявки автоматически не пересчитываются.")
        if process == "linen" and rule.unit != "рейсов/ч":
            assumptions.append("Учитывается только грязное бельё; доставку чистого белья рассчитывают отдельно.")
        if process == "waste" and rule.unit != "рейсов/ч":
            assumptions.append("Учитываются только отходы класса А; другие классы требуют отдельного подбора.")
        if process == "medicines" and rule.unit != "рейсов/ч":
            assumptions.append("Учитываются заявки на медикаменты; рейсы с расходниками рассчитывают отдельно.")
    if process == "cleaning":
        assumptions.append("Площадь считается одним полным циклом уборки в сутки.")
    if facility == "warehouse" and process == "internal_transport":
        assumptions.append(
            "Внутренний поток берётся из числа внутрискладских перемещений в сутки; один рейс — одно перемещение грузовой единицы."
        )

    if peak is None:
        peak = 1.0
        peak_source = "neutral_default"
        assumptions.append("Пиковый коэффициент отсутствует: принят нейтральный коэффициент 1.")

    missing: list[str] = []
    if daily is None or daily <= 0:
        missing.append("Укажите положительный суточный объём операций.")
    if hours is None or not 0 < hours <= 24:
        missing.append("Укажите продолжительность работы от 0 до 24 часов в сутки.")
    if not 1 <= peak <= 10:
        missing.append("Пиковый коэффициент должен быть от 1 до 10.")
    changed_workload = any(
        value is not None for value in (options.daily_demand, options.hours_per_day, options.peak_factor)
    )
    changed_normative = not (
        math.isclose(options.utilization, DEFAULT_UTILIZATION)
        and math.isclose(options.availability, DEFAULT_AVAILABILITY)
        and math.isclose(options.reserve_percent, DEFAULT_RESERVE_PERCENT)
    )
    if changed_workload or changed_normative:
        assumptions.append("Нагрузка, режим или коэффициенты изменены вручную: " + options.demand_reason)

    peak_rate = daily / hours * peak if daily is not None and hours and not missing else None
    return {
        "daily_demand": daily,
        "hours_per_day": hours,
        "peak_factor": peak,
        "peak_hourly_demand": peak_rate,
        "unit": rule.unit,
        "driver": rule.driver,
        "mass_parameter": rule.mass_parameter,
        "sources": {"daily_demand": daily_source, "hours_per_day": hours_source, "peak_factor": peak_source},
        "missing": missing,
        "assumptions": assumptions,
    }


def calculate_fleet_size(
    daily_demand: float,
    hours_per_day: float,
    peak_factor: float,
    throughput: float,
    utilization: float,
    availability: float,
    reserve_percent: float,
) -> tuple[int | None, dict[str, float | int | None]]:
    values = (daily_demand, hours_per_day, peak_factor, throughput, utilization, availability, reserve_percent)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("Параметры расчёта парка должны быть конечными числами.")
    if not (
        daily_demand > 0
        and hours_per_day > 0
        and peak_factor >= 1
        and throughput > 0
        and 0 < utilization <= 1
        and 0 < availability <= 1
        and reserve_percent >= 0
    ):
        raise ValueError("Параметры расчёта парка выходят за допустимые границы.")
    peak_hourly_demand = daily_demand / hours_per_day * peak_factor
    effective_throughput = throughput * utilization * availability
    required_with_reserve = peak_hourly_demand * (1 + reserve_percent / 100)
    unrounded = required_with_reserve / effective_throughput
    quantity = math.ceil(unrounded)
    if quantity > MAX_FLEET_SIZE:
        quantity = None
    return quantity, {
        "peak_hourly_demand": round(peak_hourly_demand, 6),
        "reserve_multiplier": round(1 + reserve_percent / 100, 6),
        "required_rate_with_reserve": round(required_with_reserve, 6),
        "nominal_throughput": throughput,
        "utilization": utilization,
        "availability": availability,
        "effective_throughput": round(effective_throughput, 6),
        "unrounded_quantity": round(unrounded, 6),
        "quantity": quantity,
    }


def _has_value(spec: Any) -> bool:
    return any(
        value is not None and value != ""
        for value in (spec.value_numeric, spec.value_numeric_max, spec.value_text, spec.value_bool)
    )


def _numeric_value(spec: Any, unit: str, *, upper: bool = False) -> tuple[float | None, str | None]:
    if spec is None or spec.value_numeric is None:
        return None, "характеристика отсутствует"
    actual_unit = spec.unit or spec.definition.unit
    if actual_unit != unit:
        return None, f"единица «{actual_unit or 'не указана'}» не совпадает с требуемой «{unit}»"
    raw = spec.value_numeric_max if upper and spec.value_numeric_max is not None else spec.value_numeric
    value = float(raw)
    if not math.isfinite(value):
        return None, "характеристика содержит некорректное число"
    return value, None


def _score_data_quality(entry: Any) -> float:
    completeness = max(0.0, min(1.0, entry.summary.completeness_percent / 100))
    filled = [spec for spec in entry.specs.values() if _has_value(spec)]
    confirmed_share = sum(bool(spec.is_confirmed) for spec in filled) / len(filled) if filled else 0.0
    # 70% of this factor is catalogue completeness, 30% is source confirmation.
    return RANKING_WEIGHTS["Качество данных каталога"] * (0.7 * completeness + 0.3 * confirmed_share)


def rank_candidate(
    entry: Any,
    facility: str,
    process: str,
    parameters: dict[str, Any],
    options: SelectionInput,
    context: dict[str, Any],
) -> dict[str, Any]:
    reasons = ["Тип решения связан с выбранным процессом в каталоге."]
    missing: list[str] = []
    excluded: list[str] = []
    risks = [
        "Покрытие пола, связь, зарядная инфраструктура, интеграции и сервис проверяются при обследовании объекта."
    ]
    checks: list[dict[str, Any]] = []
    specs = entry.specs

    def add_check(
        code: str,
        label: str,
        required: float | None,
        actual: float | None,
        unit: str | None,
        predicate: Callable[[float, float], bool],
        *,
        problem: str | None = None,
        confirmed: bool | None = None,
    ) -> None:
        if required is None:
            status = "unknown"
            message = f"{label}: в параметрах объекта нет требуемого значения."
        elif actual is None:
            status = "unknown"
            message = f"{label}: {problem or 'в карточке продукта недостаточно данных'}."
        elif predicate(required, actual):
            status = "passed"
            message = f"{label}: соответствует ({actual:g}{' ' + unit if unit else ''}; требование {required:g})."
        else:
            status = "failed"
            message = f"{label}: не соответствует ({actual:g}{' ' + unit if unit else ''}; требование {required:g})."
        checks.append(
            {
                "code": code,
                "label": label,
                "status": status,
                "required": required,
                "actual": actual,
                "unit": unit,
                "confirmed": confirmed,
                "message": message,
            }
        )
        if status == "passed":
            reasons.append(message)
            if confirmed is False:
                _append_unique(missing, f"{label}: значение продукта не подтверждено источником.")
        elif status == "failed":
            excluded.append(message)
        else:
            missing.append(message)

    if context["mass_parameter"]:
        payload = specs.get("payload_kg")
        actual, problem = _numeric_value(payload, "кг")
        add_check(
            "payload_kg",
            "Грузоподъёмность",
            number(parameters, context["mass_parameter"]),
            actual,
            "кг",
            lambda required, value: value >= required,
            problem=problem,
            confirmed=payload.is_confirmed if payload else None,
        )

    passage_parameter = None
    if facility == "warehouse":
        passage_parameter = WAREHOUSE_AISLE_PARAMETER.get(process)
    elif facility == "medical":
        passage_parameter = "corridor_width_m"
    if passage_parameter:
        aisle = specs.get("min_aisle_width_mm")
        actual, problem = _numeric_value(aisle, "мм", upper=True)
        available_width = number(parameters, passage_parameter)
        add_check(
            "min_aisle_width_mm",
            "Минимальная ширина прохода",
            available_width * 1000 if available_width is not None else None,
            actual,
            "мм",
            lambda required, value: value <= required,
            problem=problem,
            confirmed=aisle.is_confirmed if aisle else None,
        )

    if facility == "medical":
        floors = number(parameters, "floors_count")
        if floors is None:
            add_check("elevator_integration", "Работа между этажами", None, None, None, lambda _r, _a: False)
        elif floors > 1:
            elevator = specs.get("elevator_integration")
            actual = None if elevator is None or elevator.value_bool is None else float(elevator.value_bool)
            add_check(
                "elevator_integration",
                "Интеграция с лифтами",
                1.0,
                actual,
                None,
                lambda required, value: value == required,
                problem="в карточке продукта не указана работа с лифтами",
                confirmed=elevator.is_confirmed if elevator else None,
            )

    noise_parameter = (
        "noise_limit_dba" if facility == "airport" else "ward_noise_limit_dba" if facility == "medical" else None
    )
    noise_limit = number(parameters, noise_parameter)
    if noise_limit is not None:
        noise = specs.get("noise_dba")
        actual, problem = _numeric_value(noise, "дБА", upper=True)
        add_check(
            "noise_dba",
            "Уровень шума",
            noise_limit,
            actual,
            "дБА",
            lambda required, value: value <= required,
            problem=problem,
            confirmed=noise.is_confirmed if noise else None,
        )

    if facility == "airport" and process in {"ramp_transport", "catering"}:
        winter_temperature = number(parameters, "outdoor_min_temp_c")
        if winter_temperature is not None:
            temperature = specs.get("operating_temp_c")
            actual, problem = _numeric_value(temperature, "°C")
            add_check(
                "operating_temp_c",
                "Минимальная рабочая температура",
                winter_temperature,
                actual,
                "°C",
                lambda required, value: value <= required,
                problem=problem,
                confirmed=temperature.is_confirmed if temperature else None,
            )
        _append_unique(missing, "Допуск к работе на перроне и выполнение требований безопасности нужно подтвердить.")

    if facility == "medical":
        _append_unique(missing, "Совместимость с санитарной обработкой и режимами доступа нужно подтвердить.")

    throughput_spec = specs.get("throughput")
    rate, throughput_problem = _numeric_value(throughput_spec, context["unit"])
    throughput_source = "catalog"
    override = options.throughput_overrides.get(entry.product.id)
    if override:
        rate = override.value
        throughput_source = "manual_override"
        throughput_problem = None
        missing.append(f"Производительность принята вручную: {override.reason}")
    elif rate is not None and throughput_spec and not throughput_spec.is_confirmed:
        missing.append("Производительность продукта не подтверждена источником.")
    if rate is None or rate <= 0:
        rate = None
        detail = f" ({throughput_problem})" if throughput_problem else ""
        missing.append(f"Нет производительности в {context['unit']}{detail}: укажите обоснованную оценку.")

    quantity = None
    calculation = None
    if rate is not None and not context["missing"]:
        quantity, calculation = calculate_fleet_size(
            context["daily_demand"],
            context["hours_per_day"],
            context["peak_factor"],
            rate,
            options.utilization,
            options.availability,
            options.reserve_percent,
        )
        if quantity is None:
            missing.append(f"Расчётный парк превышает {MAX_FLEET_SIZE:,} роботов: проверьте единицы и нагрузку.")

    if entry.product.limitations:
        risks.append("Ограничения карточки продукта: " + entry.product.limitations)

    # A physically incompatible product is not a fleet recommendation. Keep its
    # passport throughput visible, but do not expose a misleading robot count.
    if excluded:
        quantity = None
        calculation = None

    passed_weight = sum(
        1.0
        if check["status"] == "passed" and check["confirmed"] is not False
        else 0.5
        if check["status"] == "passed"
        else 0.0
        for check in checks
    )
    constraint_score = (
        RANKING_WEIGHTS["Ключевые ограничения"] * passed_weight / len(checks)
        if checks
        else 0.0
    )
    capacity_score = 0.0
    if rate is not None:
        capacity_score += 15.0
    if quantity is not None:
        capacity_score += 10.0
    raw_factors = {
        "Совместимость с процессом": RANKING_WEIGHTS["Совместимость с процессом"],
        "Ключевые ограничения": constraint_score,
        "Расчёт производительности и парка": capacity_score,
        "Качество данных каталога": _score_data_quality(entry),
    }
    factors = {key: round(value, 1) for key, value in raw_factors.items()}
    if excluded:
        factors["Блокирующее ограничение"] = -round(sum(factors.values()), 1)
    score = round(sum(factors.values()), 1)

    status = "excluded" if excluded else "needs_review" if missing or context["missing"] else "suitable"
    decision = {
        "suitable": "Предварительно подходит по проверяемым критериям.",
        "needs_review": "Может подойти, но перед рекомендацией нужно закрыть пробелы в данных.",
        "excluded": "Не рекомендуется: нарушено хотя бы одно ключевое ограничение.",
    }[status]

    peak_rate = context["peak_hourly_demand"] or 0
    equipment = options.equipment.model_copy(update={"peak_rate": peak_rate})
    sources = {
        code: {
            "value": float(spec.value_numeric) if spec.value_numeric is not None else None,
            "max": float(spec.value_numeric_max) if spec.value_numeric_max is not None else None,
            "text": spec.value_text,
            "bool": spec.value_bool,
            "unit": spec.unit or spec.definition.unit,
            "source_id": spec.source_id,
            "confirmed": spec.is_confirmed,
            "assumption": spec.is_assumption,
            "retrieved_at": spec.retrieved_at.isoformat() if spec.retrieved_at else None,
        }
        for code, spec in specs.items()
    }
    return {
        "equipment": equipment_plan(quantity, equipment) if quantity is not None else None,
        "product_id": entry.product.id,
        "name": entry.product.name,
        "image_url": entry.summary.image_url,
        "status": status,
        "decision": decision,
        "reasons": reasons,
        "missing": missing,
        "excluded": excluded,
        "risks": risks,
        "checks": checks,
        "quantity": quantity,
        "throughput": rate,
        "throughput_source": throughput_source,
        "unit": context["unit"],
        "calculation": calculation,
        "score": score,
        "score_factors": factors,
        "specs_snapshot": sources,
        "catalog_updated_at": entry.product.updated_at.isoformat(),
    }
