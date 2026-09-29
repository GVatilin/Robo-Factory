"""Explicit illustrative inputs, not manufacturer quotes or official norms."""
PROFILE = "illustrative-economics-2026-09-29"
SOURCE = "Допущение команды для демонстрационного расчёта; заменить данными объекта и коммерческими предложениями."
COMMON = {"horizon_years": 5, "baseline_annual_labor": 6240000,
          "baseline_annual_other": 300000, "hours_per_day": 8, "days_per_year": 250, "electricity_price": 8}
SCENARIO = {"quantity": 1, "equipment_price": 3000000, "monthly_fee": 100000,
    "software": 200000, "infrastructure": 300000, "integration": 300000,
    "commissioning": 100000, "training": 50000, "reserve_percent": 10,
    "annual_service_per_robot": 150000, "annual_licenses": 60000,
    "annual_connectivity": 24000, "annual_consumables": 30000, "annual_repairs": 60000,
    "annual_other": 0, "annual_operators": 600000, "power_kw": 1,
    "labor_saving_percent": 50, "other_saving_percent": 10,
    "annual_additional_benefit": 0, "service_life_years": 7,
    "component_replacement_cost": 150000, "component_replacement_interval": 3}


def default_profile():
    return {"profile": PROFILE, "common": COMMON, "scenario": SCENARIO, "source": SOURCE,
        "notes": [
            "ФОТ примера: 5 сотрудников × 80 000 ₽/мес × 12 × 1,3 = 6 240 000 ₽/год. Это пример, не норматив страховых взносов.",
            "Известные цены и срок службы каталога, количество из подбора и режим объекта имеют приоритет над примером.",
            "Цена 3 млн ₽ и RaaS 100 тыс. ₽/мес — условные значения для проверки модели, не предложения поставщика.",
            "Расходы ПО, инфраструктуры, интеграции, пусконаладки, обучения и эксплуатации заданы на весь парк; сервис — на одного робота.",
            "Замена компонентов: условно 150 тыс. ₽ на весь парк раз в 3 года, при покупке. При совпадении с полной заменой оборудования отдельная замена компонентов не добавляется.",
            "Резерв CAPEX 10%, сокращение ФОТ 50%, прочих затрат 10%, мощность 1 кВт и тариф 8 ₽/кВт·ч — редактируемые допущения команды.",
            "Дополнительная выручка и прочие расходы по умолчанию равны нулю; пользователь обязан уточнить применимость этих допущений.",
        ]}
