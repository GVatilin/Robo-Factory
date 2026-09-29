from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.selection import SelectionInput
from app.services.selection import calculate_fleet_size, demand_context, rank_candidate


def spec(
    code: str,
    value: float | None = None,
    *,
    value_max: float | None = None,
    flag: bool | None = None,
    unit: str | None = None,
    confirmed: bool = True,
):
    return SimpleNamespace(
        definition=SimpleNamespace(code=code, name=code, unit=unit),
        value_numeric=Decimal(str(value)) if value is not None else None,
        value_numeric_max=Decimal(str(value_max)) if value_max is not None else None,
        value_text=None,
        value_bool=flag,
        unit=unit,
        source_id=1,
        retrieved_at=None,
        is_confirmed=confirmed,
        is_assumption=False,
    )


def entry(*values, completeness=100, limitations=None):
    return SimpleNamespace(
        product=SimpleNamespace(
            id=7,
            name="Тестовый AMR",
            limitations=limitations,
            updated_at=datetime(2026, 9, 29, tzinfo=UTC),
        ),
        summary=SimpleNamespace(image_url=None, completeness_percent=completeness),
        specs={value.definition.code: value for value in values},
    )


def warehouse_context(options=None):
    options = options or SelectionInput(process_id=1)
    parameters = {
        "inbound_pallets_per_day": 1000,
        "shifts_per_day": 2,
        "shift_duration_h": 5,
        "peak_load_factor": 1.2,
        "pallet_weight_kg": 200,
        "main_aisle_width_m": 2,
    }
    return parameters, options, demand_context("warehouse", "inbound", parameters, options)


def test_default_normatives_and_fleet_formula_are_explicit_and_conservative():
    options = SelectionInput(process_id=1)
    assert (options.utilization, options.availability, options.reserve_percent) == (0.8, 0.9, 15)
    quantity, calculation = calculate_fleet_size(1000, 10, 1.2, 50, 0.8, 0.9, 15)
    assert quantity == 4
    assert calculation == {
        "peak_hourly_demand": 120.0,
        "reserve_multiplier": 1.15,
        "required_rate_with_reserve": 138.0,
        "nominal_throughput": 50,
        "utilization": 0.8,
        "availability": 0.9,
        "effective_throughput": 36.0,
        "unrounded_quantity": pytest.approx(3.833333, abs=1e-6),
        "quantity": 4,
    }
    with pytest.raises(ValidationError, match="Обоснуйте изменение"):
        SelectionInput(process_id=1, availability=.8)
    assert SelectionInput(process_id=1, availability=.8, demand_reason="SLA поставщика").availability == .8
    with pytest.raises(ValueError, match="допустимые границы"):
        calculate_fleet_size(1000, 0, 1.2, 50, 0.8, 0.9, 15)


def test_context_parses_medical_24_7_and_does_not_invent_internal_flow():
    medical = demand_context(
        "medical",
        "food",
        {"meal_portions_per_day": 600, "inpatient_schedule": "Круглосуточно (24/7)"},
        SelectionInput(process_id=1),
    )
    assert medical["hours_per_day"] == 24
    assert medical["sources"]["hours_per_day"] == "inpatient_schedule"
    assert medical["peak_hourly_demand"] == 25

    internal = demand_context(
        "warehouse",
        "internal_transport",
        {"inbound_pallets_per_day": 1000, "outbound_pallets_per_day": 900, "shifts_per_day": 2, "shift_duration_h": 8},
        SelectionInput(process_id=1),
    )
    assert internal["daily_demand"] is None
    assert any("суточный объём" in message for message in internal["missing"])
    assert any("нельзя надёжно вывести" in message for message in internal["assumptions"])


def test_fully_verified_candidate_is_suitable_and_score_is_reproducible():
    parameters, options, context = warehouse_context()
    candidate = rank_candidate(
        entry(
            spec("payload_kg", 500, unit="кг"),
            spec("min_aisle_width_mm", 1200, unit="мм"),
            spec("throughput", 50, value_max=60, unit="паллет/ч"),
        ),
        "warehouse",
        "inbound",
        parameters,
        options,
        context,
    )
    assert candidate["status"] == "suitable"
    assert candidate["quantity"] == 4
    assert candidate["throughput"] == 50  # lower end of the published range
    assert candidate["score"] == 100
    assert sum(candidate["score_factors"].values()) == candidate["score"]
    assert {check["status"] for check in candidate["checks"]} == {"passed"}
    assert candidate["missing"] == []
    assert candidate["risks"]  # survey risks do not masquerade as missing catalogue data


def test_hard_constraint_excludes_and_zeroes_score_through_visible_gate():
    parameters, options, context = warehouse_context()
    candidate = rank_candidate(
        entry(
            spec("payload_kg", 100, unit="кг"),
            spec("min_aisle_width_mm", 1200, unit="мм"),
            spec("throughput", 50, unit="паллет/ч"),
        ),
        "warehouse",
        "inbound",
        parameters,
        options,
        context,
    )
    assert candidate["status"] == "excluded"
    assert candidate["quantity"] is None
    assert candidate["calculation"] is None
    assert candidate["score"] == 0
    assert candidate["score_factors"]["Блокирующее ограничение"] < 0
    assert sum(candidate["score_factors"].values()) == 0
    assert any(check["code"] == "payload_kg" and check["status"] == "failed" for check in candidate["checks"])


def test_missing_or_unconfirmed_decisive_data_requires_review():
    parameters, options, context = warehouse_context()
    no_rate = rank_candidate(
        entry(spec("payload_kg", 500, unit="кг"), spec("min_aisle_width_mm", 1200, unit="мм")),
        "warehouse",
        "inbound",
        parameters,
        options,
        context,
    )
    assert no_rate["status"] == "needs_review"
    assert no_rate["quantity"] is None
    assert any("производительности" in message.casefold() for message in no_rate["missing"])

    unconfirmed = rank_candidate(
        entry(
            spec("payload_kg", 500, unit="кг", confirmed=False),
            spec("min_aisle_width_mm", 1200, unit="мм"),
            spec("throughput", 50, unit="паллет/ч"),
        ),
        "warehouse",
        "inbound",
        parameters,
        options,
        context,
    )
    assert unconfirmed["status"] == "needs_review"
    assert unconfirmed["score"] < 100
    assert any("не подтверждено" in message for message in unconfirmed["missing"])
