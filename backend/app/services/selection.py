"""Объяснимый подбор и расчёт парка. Единицы процесса и ТТХ должны совпадать."""
import math
from app.schemas.selection import SelectionInput
from app.services.equipment import equipment_plan

VERSION = "selection-1.1"
# Процесс → объём в сутки, единица, требуемая масса груза. Не суммируем разные операции.
DRIVERS = {
    ("warehouse", "inbound"): ("inbound_pallets_per_day", "паллет/ч", "pallet_weight_kg"),
    ("warehouse", "outbound"): ("outbound_pallets_per_day", "паллет/ч", "pallet_weight_kg"),
    ("warehouse", "internal_transport"): ("inbound_pallets_per_day", "паллет/ч", "pallet_weight_kg"),
    ("warehouse", "picking"): ("picking_lines_per_day", "строк/ч", "unit_weight_kg"),
    ("warehouse", "sorting"): ("picking_units_per_day", "отправлений/ч", "unit_weight_kg"),
    ("warehouse", "cleaning"): ("active_area_m2", "м²/ч", None),
    ("airport", "baggage"): ("baggage_units_per_day", "отправлений/ч", "baggage_unit_weight_kg"),
    ("airport", "terminal_logistics"): ("internal_cart_trips_per_day", "рейсов/ч", None),
    ("airport", "cleaning"): ("robotic_cleaning_area_m2", "м²/ч", None),
    ("airport", "catering"): ("catering_meals_per_day", "порций/ч", None),
    ("airport", "waste"): ("waste_containers_per_day", "контейнеров/ч", None),
    ("airport", "ramp_transport"): (None, "операций/ч", None),
    ("medical", "cleaning"): ("total_area_m2", "м²/ч", None),
    ("medical", "linen"): ("dirty_linen_kg_per_day", "кг/ч", "linen_container_weight_kg"),
    ("medical", "food"): ("meal_portions_per_day", "порций/ч", "food_cart_weight_kg"),
    ("medical", "medicines"): ("medicine_requests_per_day", "заявок/ч", None),
    ("medical", "lab_samples"): ("lab_samples_per_day", "образцов/ч", None),
    ("medical", "waste"): ("waste_class_a_kg_per_day", "кг/ч", None),
}
FORMULA = "N = ceil((объём/сутки ÷ часы/сутки × пик) × (1 + резерв/100) ÷ (производительность × загрузка × доступность))"


def number(params, key):
    v = params.get(key)
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def demand_context(facility, process, parameters, options: SelectionInput):
    driver, unit, mass = DRIVERS.get((facility, process), (None, "операций/ч", None))
    daily = options.daily_demand if options.daily_demand is not None else number(parameters, driver)
    if facility == "airport" and process == "ramp_transport" and options.daily_demand is None:
        flights, operations = number(parameters, "daily_flights"), number(parameters, "ground_ops_per_flight")
        daily = flights * operations if flights is not None and operations is not None else None
    hours = options.hours_per_day
    if hours is None:
        hours = number(parameters, "operating_hours_per_day")
        shifts, duration = number(parameters, "shifts_per_day"), number(parameters, "shift_duration_h")
        if hours is None and shifts and duration:
            hours = shifts * duration
    peak = options.peak_factor if options.peak_factor is not None else number(parameters, "peak_load_factor")
    notes = [f"Загрузка {options.utilization:g}, доступность {options.availability:g} и резерв {options.reserve_percent:g}% — редактируемые допущения команды.",
             "Количество относится только к выбранному процессу; дополнительные процессы отдельно не суммируются."]
    if driver is None:
        notes.append("Определите состав одной операции и производительность робота для неё; площадь или запас мест не равны суточному потоку.")
    if facility == "airport" and process == "ramp_transport":
        notes.append("Объём — число рейсов × операции обслуживания на рейс. Уточните долю операций, доступных конкретному роботу.")
    if facility == "medical":
        notes.append("Санитарные требования, разделение чистых и грязных потоков и время доставки требуют отдельной проверки.")
        if process == "linen": notes.append("Рассчитан только поток грязного белья; доставку чистого белья оцените отдельно.")
        if process == "waste": notes.append("Рассчитаны только отходы класса А. Работа с другими классами требует отдельного подбора.")
        if process == "medicines": notes.append("Рассчитаны заявки на медикаменты; рейсы с расходниками отдельно не учтены.")
    if process == "cleaning":
        notes.append("Площадь трактуется как один полный цикл уборки в сутки; при иной частоте измените объём.")
    if facility == "warehouse" and process == "internal_transport":
        notes.append("Объём транспортировки принят равным приёмке: один рейс на паллету. Уточните фактическое число перемещений.")
    if peak is None:
        peak = 1
        notes.append("Пиковый коэффициент отсутствует: принят 1. Уточните пиковую нагрузку.")
    missing = []
    if daily is None or daily <= 0: missing.append("Укажите положительный суточный объём операций.")
    if hours is None or not 0 < hours <= 24: missing.append("Укажите продолжительность работы от 0 до 24 часов в сутки.")
    if not 1 <= peak <= 10: missing.append("Пиковый коэффициент должен быть от 1 до 10.")
    if any(v is not None for v in (options.daily_demand, options.hours_per_day, options.peak_factor)):
        notes.append("Режим или нагрузка изменены вручную: " + options.demand_reason)
    return {"daily_demand": daily, "hours_per_day": hours, "peak_factor": peak, "unit": unit,
            "driver": driver, "mass_parameter": mass, "missing": missing, "assumptions": notes}


def rank_candidate(entry, facility, process, params, options, context):
    reasons, missing, excluded = [], [], []
    specs = entry.specs
    def scalar(code, unit=None, upper=False):
        s = specs.get(code)
        if s is None or s.value_numeric is None: return None
        if unit is not None and (s.unit or s.definition.unit) != unit: return None
        if not s.is_confirmed: missing.append(f"Характеристика «{s.definition.name}» не подтверждена источником.")
        return float(s.value_numeric_max if upper and s.value_numeric_max is not None else s.value_numeric)
    def check(label, required, actual, predicate):
        if required is None or actual is None:
            missing.append(f"{label}: недостаточно данных для проверки.")
        elif predicate(required, actual): reasons.append(f"{label}: соответствует ({actual:g}; требование {required:g}).")
        else: excluded.append(f"{label}: не соответствует ({actual:g}; требование {required:g}).")
    if context["mass_parameter"]:
        check("Грузоподъёмность, кг", number(params, context["mass_parameter"]), scalar("payload_kg", "кг"), lambda required,actual:actual>=required)
    if facility == "warehouse":
        aisle = number(params, "rack_aisle_width_m")
        check("Минимальный проход, мм", aisle*1000 if aisle is not None else None, scalar("min_aisle_width_mm", "мм", True), lambda required,actual:actual<=required)
    if facility == "medical" and (number(params,"floors_count") or 1)>1:
        elevator=specs.get("elevator_integration")
        if elevator is None or elevator.value_bool is None: missing.append("Работу с лифтами необходимо подтвердить.")
        elif not elevator.value_bool: excluded.append("Нет интеграции с лифтами для многоэтажного объекта.")
        else: reasons.append("Интеграция с лифтами указана в карточке.")
    if facility == "airport":
        limit=number(params,"noise_limit_dba")
        if limit is not None: check("Уровень шума, дБА",limit,scalar("noise_dba","дБА",True),lambda req,actual:actual<=req)
        if process in ("ramp_transport","catering"):
            missing.append("Допуск к работе на перроне и требования безопасности нужно проверить отдельно.")
    missing.extend(["Покрытие пола, связь, зарядная инфраструктура и контекстные ограничения требуют проверки на объекте."])
    rate = scalar("throughput",context["unit"])
    override=options.throughput_overrides.get(entry.product.id)
    if override:
        rate=override.value
        missing.append(f"Производительность принята вручную: {override.reason}")
    if rate is None or rate<=0:
        rate=None
        missing.append(f"Нет производительности в {context['unit']}: укажите обоснованную оценку.")
    quantity=None
    if rate and not context["missing"]:
        quantity=math.ceil(context["daily_demand"] / context["hours_per_day"] * context["peak_factor"] *
                           (1+options.reserve_percent/100) / (rate*options.utilization*options.availability))
        if quantity>100000:
            quantity=None
            missing.append("Расчётный парк превышает 100 000 роботов: проверьте единицы и нагрузку.")
    if entry.product.limitations: missing.append("Ограничения карточки: " + entry.product.limitations)
    sources = {code: {"value": float(s.value_numeric) if s.value_numeric is not None else None,
                     "max": float(s.value_numeric_max) if s.value_numeric_max is not None else None,
                     "text": s.value_text, "bool": s.value_bool, "unit": s.unit or s.definition.unit,
                     "source_id": s.source_id, "confirmed": s.is_confirmed, "assumption": s.is_assumption,
                     "retrieved_at": s.retrieved_at.isoformat() if s.retrieved_at else None}
               for code, s in specs.items()}
    reasons.insert(0,"Тип решения связан с выбранным процессом в каталоге.")
    factors={"Совместимость с процессом":40,"Пройденные технические проверки":min(30,10*(len(reasons)-1)),
             "Возможность расчёта парка":20 if quantity is not None else 0,
             "Полнота карточки":round(entry.summary.completeness_percent/10,1)}
    equipment = options.equipment.model_copy(update={"peak_rate": (context["daily_demand"] / context["hours_per_day"] * context["peak_factor"]) if not context["missing"] else 0})
    return {"equipment": equipment_plan(quantity, equipment) if quantity else None,
            "product_id":entry.product.id,"name":entry.product.name,"image_url":entry.summary.image_url,
            "status":"excluded" if excluded else "needs_review" if missing or context["missing"] else "suitable",
            "reasons":reasons,"missing":missing,"excluded":excluded,"quantity":quantity,"throughput":rate,
            "unit":context["unit"],"score":0 if excluded else round(sum(factors.values()),1),"score_factors":factors,
            "specs_snapshot": sources, "catalog_updated_at": entry.product.updated_at.isoformat()}
