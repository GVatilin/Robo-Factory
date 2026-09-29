"""Explicit demo assumptions for missing workload and cycle capacity; never catalog facts."""
from app.schemas.selection import SelectionInput, RateOverride


def fill_workload(options: SelectionInput, context: dict) -> SelectionInput:
    result = options.model_copy(deep=True)
    notes = []
    if not context.get("hours_per_day"):
        result.hours_per_day = 8
        notes.append("режим 8 ч/сутки")
    if not context.get("daily_demand"):
        result.daily_demand = 1000 if context["unit"] == "м²/ч" else 80
        notes.append(f"нагрузка {result.daily_demand:g} единиц/сутки ({context['unit'].replace('/ч', '')})")
    if notes:
        result.demand_reason = ("Демонстрационные допущения команды: " + "; ".join(notes) + ". Уточнить на объекте. " + result.demand_reason)[:1000]
    if not result.equipment.charger_price:
        result.equipment.charger_price = 100000
    if not result.equipment.station_price:
        result.equipment.station_price = 150000
    result.equipment.override_reason = ("Пример команды: зарядка 100 000 ₽, пост 150 000 ₽ при неизвестной цене; не предложение поставщика. " + result.equipment.override_reason)[:1000]
    return result


def capacity_example(unit: str) -> RateOverride:
    if unit == "м²/ч":
        value = 2160
        reason = "Пример команды: полоса 0,6 м × скорость 1 м/с × 3600 = 2160 м²/ч до коэффициентов загрузки и доступности. Не характеристика модели; проверить замерами."
    else:
        batch = 10 if unit == "кг/ч" else 1
        value = round(3600 / (2 * 50 / 1 + 30) * batch, 4)
        reason = f"Пример команды: маршрут 50 м в одну сторону, возврат 50 м, скорость 1 м/с, обработка 30 с, за цикл {batch} единиц ({unit.replace('/ч', '')}). Производительность = 3600 / (2 × 50 / 1 + 30) × {batch} = {value:g} {unit}. Не паспортная характеристика; заменить замерами."
    return RateOverride(value=value, reason=reason)
