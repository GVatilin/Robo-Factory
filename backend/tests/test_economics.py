import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.routes.economics import router
from app.schemas.economics import EconomicsInput
from app.services.economics import calculate


def inputs(**scenario):
    return EconomicsInput.model_validate({
        "baseline_annual_labor": 10000, "baseline_annual_other": 2000, "electricity_price": .1,
        "scenarios": [{"name": "Робот", "quantity": 2, "equipment_price": 1000, "software": 200,
                       "infrastructure": 100, "integration": 100, "training": 100, "reserve_percent": 10,
                       "labor_saving_percent": 50, "other_saving_percent": 25, "annual_service_per_robot": 100,
                       "annual_licenses": 100, "annual_other": 100, "annual_operators": 500,
                       "power_kw": .5, "annual_additional_benefit": 100, "service_life_years": 2, **scenario}],
    })


def test_purchase_costs_cashflow_and_replacements():
    response = calculate(inputs())
    r = response.results[0]
    assert response.baseline_tco == 60000
    assert (r.capex, r.annual_opex, r.annual_effect, r.tco) == (2750, 7600, 4500, 44750)
    assert [y.replacement for y in r.years] == [0, 0, 0, 2000, 0, 2000]
    assert r.net_effect == 15750 and r.roi_percent == 572.73
    assert r.simple_payback_years == .6111
    assert r.net_effect == sum(y.cashflow for y in r.years) == r.years[-1].cumulative
    assert sum(r.capex_breakdown.values()) == r.capex
    assert sum(r.opex_breakdown.values()) == r.annual_opex


def test_raas_has_rent_no_equipment_purchase_or_replacement():
    r = calculate(inputs(mode="raas", monthly_fee=100, annual_service_per_robot=0)).results[0]
    assert (r.capex, r.annual_opex, r.annual_effect) == (550, 9800, 2300)
    assert r.opex_breakdown["RaaS"] == 2400
    assert all(y.replacement == 0 for y in r.years)


def test_lifetime_equal_to_horizon_needs_no_replacement():
    r = calculate(inputs(service_life_years=5)).results[0]
    assert all(y.replacement == 0 for y in r.years)


def test_zero_investment_and_negative_effect_are_explicit():
    r = calculate(inputs(equipment_price=0, software=0, infrastructure=0, integration=0, training=0)).results[0]
    assert r.roi_percent is None and r.simple_payback_years is None
    r = calculate(inputs(annual_other=100000)).results[0]
    assert r.annual_effect < 0 and r.roi_percent < 0 and r.simple_payback_years is None


@pytest.mark.parametrize("patch", [{"equipment_price": None}, {"mode": "raas"}, {"quantity": 0},
                                  {"quantity": 1.5}, {"labor_saving_percent": 101}, {"power_kw": float("nan")},
                                  {"equipment_price": float("inf")}, {"service_life_years": 0}])
def test_invalid_assumptions_are_rejected(patch):
    with pytest.raises(ValidationError):
        inputs(**patch)


def test_guest_api_returns_snapshot_and_rejects_bad_inputs():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    request = inputs().model_dump()
    response = client.post("/economics/calculate", json=request)
    assert response.status_code == 200
    assert response.json()["inputs"] == request
    assert response.json()["formulas"] and response.json()["assumptions"]
    request["horizon_years"] = 0
    assert client.post("/economics/calculate", json=request).status_code == 422
