import math
from app.schemas.equipment import EquipmentInput


def equipment_plan(quantity: int, inputs: EquipmentInput) -> dict:
    chargers = max(1, math.ceil(quantity * inputs.charge_hours /
        (inputs.runtime_hours + inputs.charge_hours) / inputs.charger_utilization))
    stations = max(1, math.ceil(inputs.peak_rate / inputs.operations_per_cycle *
        inputs.handling_seconds / 3600 / inputs.station_utilization))
    items = [
        {"code": "charger", "name": "Зарядные станции", "calculated": chargers,
         "quantity": inputs.charger_count if inputs.charger_count is not None else chargers, "unit_price": inputs.charger_price},
        {"code": "station", "name": "Посты выполнения операций", "calculated": stations,
         "quantity": inputs.station_count if inputs.station_count is not None else stations, "unit_price": inputs.station_price},
    ]
    for item in items:
        item["cost"] = round(item["quantity"] * item["unit_price"], 2)
    return {"inputs": inputs.model_dump(), "items": items, "total_cost": sum(i["cost"] for i in items),
        "formulas": [
            "Зарядные станции = ceil(роботы × время зарядки / (автономность + зарядка) / допустимая загрузка станции), минимум 1.",
            "Рабочие посты = ceil(пиковый поток / единиц за цикл × время обработки / 3600 / допустимая загрузка поста), минимум 1."],
        "assumptions": [
            "Типовая модель мобильных роботов с общей зарядкой и постами обработки. Совместимость оборудования требует проверки.",
            "Расчёт зарядок предполагает распределённые циклы зарядки; очереди проверяются имитацией.",
            "Автономность 8 ч, зарядка 2 ч, обработка 30 с и загрузка станций 80% — начальные редактируемые допущения.",
            "Нулевая цена означает, что стоимость не оценена или оборудование уже имеется/включено в договор. Уточните перед принятием решения.",
            "Стоимость этих позиций добавляется к CAPEX покупки и RaaS отдельно. Не дублируйте её в статье инфраструктуры."]}
