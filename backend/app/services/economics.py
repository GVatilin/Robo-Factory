"""Предварительная оценка в постоянных рублях; входные допущения возвращаются со снимком расчёта."""
from app.schemas.economics import EconomicsInput, EconomicsResponse, EconomicsResult, YearCashflow
from app.services.equipment import equipment_plan

MODEL_VERSION = "economics-1.1"
FORMULAS = {
    "CAPEX": "Количество × цена оборудования (покупка) + зарядные станции + рабочие посты + ПО + прочая инфраструктура + интеграция + обучение + резерв. Резерв = сумма перечисленных статей × процент / 100.",
    "OPEX": "Оставшиеся затраты базового процесса + операторы + количество × обслуживание + лицензии + электроэнергия + прочие расходы + 12 × количество × ставка RaaS (для услуги).",
    "Электроэнергия": "Количество × средняя мощность, кВт × часы в сутки × дни в году × тариф, ₽/кВт·ч.",
    "Годовой эффект": "OPEX базового процесса − OPEX сценария + дополнительный годовой эффект.",
    "TCO": "CAPEX + горизонт × годовой OPEX + замены оборудования внутри горизонта. Выгоды не вычитаются из TCO.",
    "Простая окупаемость": "CAPEX / положительный годовой эффект. При CAPEX = 0 или эффекте ≤ 0 показатель не рассчитывается; замены в простую окупаемость не входят.",
    "ROI": "(Горизонт × годовой эффект − CAPEX − замены) / CAPEX × 100%. Это чистая доходность за весь горизонт. При CAPEX = 0 показатель не определён.",
    "Замены": "При покупке оборудование заменяется по первоначальной цене в начале года после окончания срока службы. В последний момент горизонта замены нет. При RaaS замены включены в ставку.",
}


def calculate(data: EconomicsInput) -> EconomicsResponse:
    baseline = data.baseline_annual_labor + data.baseline_annual_other
    results = []
    for s in data.scenarios:
        auxiliary = equipment_plan(s.quantity, s.equipment) if s.equipment else None
        equipment = s.quantity * (s.equipment_price or 0) if s.mode == "purchase" else 0
        capex_parts = {"Оборудование": equipment, "ПО": s.software, "Инфраструктура": s.infrastructure,
                       "Интеграция": s.integration, "Обучение": s.training}
        if auxiliary:
            capex_parts.update({item["name"]: item["cost"] for item in auxiliary["items"]})
        capex_parts["Резерв"] = sum(capex_parts.values()) * s.reserve_percent / 100
        capex = sum(capex_parts.values())
        opex_parts = {
            "Оставшиеся расходы на персонал": data.baseline_annual_labor * (1 - s.labor_saving_percent / 100),
            "Оставшиеся расходы процесса": data.baseline_annual_other * (1 - s.other_saving_percent / 100),
            "Операторы роботов": s.annual_operators,
            "Обслуживание": s.quantity * s.annual_service_per_robot,
            "Лицензии": s.annual_licenses,
            "Электроэнергия": s.quantity * s.power_kw * data.hours_per_day * data.days_per_year * data.electricity_price,
            "Прочие расходы": s.annual_other,
            "RaaS": 12 * s.quantity * (s.monthly_fee or 0) if s.mode == "raas" else 0,
        }
        opex = sum(opex_parts.values())
        effect = baseline - opex + s.annual_additional_benefit
        years = [YearCashflow(year=0, opex=0, replacement=0, cashflow=round(-capex, 2), cumulative=round(-capex, 2))]
        cumulative, replacements = -capex, 0
        for year in range(1, data.horizon_years + 1):
            replacement = equipment if s.mode == "purchase" and s.service_life_years and year > 1 and (year - 1) % s.service_life_years == 0 else 0
            replacements += replacement
            cumulative += effect - replacement
            years.append(YearCashflow(year=year, opex=round(opex, 2), replacement=round(replacement, 2),
                                      cashflow=round(effect - replacement, 2), cumulative=round(cumulative, 2)))
        results.append(EconomicsResult(
            equipment=auxiliary, name=s.name, mode=s.mode, capex=round(capex, 2), annual_opex=round(opex, 2), annual_effect=round(effect, 2),
            tco=round(capex + data.horizon_years * opex + replacements, 2), net_effect=round(cumulative, 2),
            simple_payback_years=round(capex / effect, 4) if capex > 0 and effect > 0 else None,
            roi_percent=round(100 * cumulative / capex, 2) if capex > 0 else None,
            capex_breakdown={k: round(v, 2) for k, v in capex_parts.items()},
            opex_breakdown={k: round(v, 2) for k, v in opex_parts.items()}, years=years,
        ))
    return EconomicsResponse(
        model_version=MODEL_VERSION, inputs=data, baseline_annual_opex=round(baseline, 2),
        baseline_tco=round(baseline * data.horizon_years, 2), results=results, formulas=FORMULAS,
        assumptions=[
            "Расчёт в постоянных рублях: без инфляции, дисконтирования, налоговых вычетов, кредита и остаточной стоимости. Все суммы вводятся на одной базе НДС.",
            "Число роботов и доли сокращения затрат задаёт пользователь; достижимость производительности этот расчёт не проверяет.",
            "Нулевые дополнительные затраты — явное допущение, которое нужно заменить оценкой. Цены каталога не включают все расходы на внедрение.",
            "Для RaaS в обслуживание, лицензии и прочие статьи вводятся только расходы сверх ежемесячной ставки; первоначальные статьи оплачиваются отдельно.",
            "Без указанного срока службы замены оборудования не учитываются. Срок службы применяется только к покупке оборудования, прочие начальные статьи при замене не повторяются.",
            "Доли экономии относятся к выбранному процессу; затраты на операторов роботов добавляются сверх оставшихся расходов на персонал.",
            "При наличии плана оборудования зарядки и рабочие посты оплачиваются разово при покупке и RaaS. Нулевая цена требует уточнения. Замены этих позиций и их сервис не рассчитаны автоматически: включите оценку в прочие расходы либо обоснуйте срок службы не короче горизонта.",
        ],
    )
