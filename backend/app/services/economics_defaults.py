"""Explicit illustrative inputs, not manufacturer quotes or official norms."""
from math import isfinite
from app.seed.reference_data import NORMATIVES

PROFILE = "illustrative-economics-2026-09-29-v4"
SOURCE = "Допущение команды для демонстрационного расчёта; заменить данными объекта и коммерческими предложениями."
COMMON = {"horizon_years": 5, "baseline_annual_labor": 6249600,
          "baseline_annual_other": 300000, "hours_per_day": 8, "days_per_year": 250, "electricity_price": 9, "daily_volume": 1000}
SCENARIO = {"quantity": 1, "equipment_price": 3000000, "monthly_fee": 100000,
    "software": 200000, "infrastructure": 300000, "integration": 300000,
    "commissioning": 100000, "training": 50000, "reserve_percent": 10,
    "annual_service_per_robot": 150000, "annual_licenses": 60000,
    "annual_connectivity": 24000, "annual_consumables": 30000, "annual_repairs": 60000,
    "annual_other": 0, "annual_operators": 600000, "power_kw": 1,
    "labor_saving_percent": 0, "other_saving_percent": 0,
    "annual_additional_benefit": 0, "service_life_years": 7,
    "component_replacement_cost": 150000, "component_replacement_interval": 4}


def default_profile(normatives=None):
    common, scenario = dict(COMMON), dict(SCENARIO)
    fields = {**{f"common.{k}": SOURCE for k in common}, **{f"scenario.{k}": SOURCE for k in scenario}}
    refs = {r[0]: {"value": r[3], "source": f"Базовый справочник: {r[1]} ({r[0]}). Источник: {r[5]}. {r[7]}"} for r in NORMATIVES}
    notes = []
    # Records arrive global first, then object-specific; reject unusable values explicitly.
    bounds = {"electricity_price": (0, 1e12), "capex_contingency": (0, 1), "battery_replacement_years": (1, 100), "payroll_tax_coef": (1, 10)}
    for ref in normatives or []:
        code = ref["code"]
        if code not in bounds:
            continue
        value = float(ref["value"])
        low, high = bounds[code]
        if not isfinite(value) or not low <= value <= high or (code == "battery_replacement_years" and not value.is_integer()):
            notes.append(f"Норматив {code} вне допустимого диапазона; использовано базовое значение справочника.")
            continue
        refs[code] = ref
    for code, target, key, scale in [("electricity_price", common, "electricity_price", 1), ("capex_contingency", scenario, "reserve_percent", 100), ("battery_replacement_years", scenario, "component_replacement_interval", 1)]:
        target[key] = float(refs[code]["value"]) * scale
        fields[f"{'common' if target is common else 'scenario'}.{key}"] = refs[code]["source"]
    payroll = float(refs["payroll_tax_coef"]["value"])
    common["baseline_annual_labor"] = round(5 * 80000 * 12 * payroll, 2)
    fields["common.baseline_annual_labor"] = f"Пример: 5 сотрудников × 80 000 ₽/мес × 12 × {payroll:g}. " + refs["payroll_tax_coef"]["source"]
    return {"profile": PROFILE, "common": common, "scenario": scenario, "source": SOURCE, "field_sources": {k: v[:2000] for k, v in fields.items()},
        "notes": notes + [
            "Объём примера: 1000 единиц выбранного процесса в сутки. В проекте приоритет у нагрузки из подбора. Объём одинаков для сравниваемых вариантов; пиковый коэффициент не увеличивает годовой объём.",
            f"ФОТ примера: 5 сотрудников × 80 000 ₽/мес × 12 × {payroll:g} = {common['baseline_annual_labor']:g} ₽/год. Численность и зарплата — пример, коэффициент начислений — из справочника.",
            "Известные цены и срок службы каталога, количество из подбора и режим объекта имеют приоритет над примером.",
            "Цена 3 млн ₽ и RaaS 100 тыс. ₽/мес — условные значения для проверки модели, не предложения поставщика.",
            "Расходы ПО, инфраструктуры, интеграции, пусконаладки, обучения и эксплуатации заданы на весь парк; сервис — на одного робота.",
            f"Замена компонентов: условно 150 тыс. ₽ на весь парк раз в {scenario['component_replacement_interval']:g} лет, при покупке. Период — из справочника; стоимость — пример. При совпадении с полной заменой отдельная замена компонентов не добавляется.",
            "Экономия ФОТ и прочих расходов по умолчанию равна 0%. Укажите подтверждённую долю экономии именно выбранного процесса. Роботизация сама по себе не доказывает сокращение расходов.",
            f"Резерв CAPEX {scenario['reserve_percent']:g}% и тариф {common['electricity_price']:g} ₽/кВт·ч — из справочника с источниками. Средняя мощность 1 кВт — допущение команды, не ёмкость батареи и не мощность зарядки.",
            "Дополнительная выручка и прочие расходы по умолчанию равны нулю; пользователь обязан уточнить применимость этих допущений.",
        ]}
