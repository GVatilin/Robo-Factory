from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.equipment import EquipmentInput

Amount = Annotated[float, Field(ge=0, le=1e12)]
Percent = Annotated[float, Field(ge=0, le=100)]


class EconomicsScenario(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    name: str = Field(min_length=1, max_length=300)
    mode: Literal["purchase", "raas"] = "purchase"
    quantity: int = Field(ge=1, le=100000)
    equipment_price: Amount | None = None
    monthly_fee: Amount | None = None
    software: Amount = 0
    infrastructure: Amount = 0
    integration: Amount = 0
    training: Amount = 0
    reserve_percent: Percent = 0
    annual_service_per_robot: Amount = 0
    annual_licenses: Amount = 0
    annual_other: Amount = 0
    annual_operators: Amount = 0
    power_kw: float = Field(default=0, ge=0, le=100000)
    labor_saving_percent: Percent = 0
    other_saving_percent: Percent = 0
    annual_additional_benefit: Amount = 0
    service_life_years: int | None = Field(default=None, ge=1, le=100)
    equipment: EquipmentInput | None = None

    @model_validator(mode="after")
    def required_price(self):
        if self.mode == "purchase" and self.equipment_price is None:
            raise ValueError("Укажите цену оборудования для покупки.")
        if self.mode == "raas" and self.monthly_fee is None:
            raise ValueError("Укажите ежемесячную ставку RaaS.")
        return self


class EconomicsInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    horizon_years: int = Field(default=5, ge=5, le=30)
    baseline_annual_labor: Amount
    baseline_annual_other: Amount = 0
    hours_per_day: float = Field(default=8, gt=0, le=24)
    days_per_year: int = Field(default=250, ge=1, le=366)
    electricity_price: Amount = 0
    scenarios: list[EconomicsScenario] = Field(min_length=1, max_length=12)


class YearCashflow(BaseModel):
    year: int
    opex: float
    replacement: float
    cashflow: float
    cumulative: float


class EconomicsResult(BaseModel):
    name: str
    mode: str
    capex: float
    annual_opex: float
    annual_effect: float
    tco: float
    net_effect: float
    simple_payback_years: float | None
    roi_percent: float | None
    capex_breakdown: dict[str, float]
    opex_breakdown: dict[str, float]
    years: list[YearCashflow]
    equipment: dict | None = None


class EconomicsResponse(BaseModel):
    model_version: str
    inputs: EconomicsInput
    baseline_annual_opex: float
    baseline_tco: float
    results: list[EconomicsResult]
    formulas: dict[str, str]
    assumptions: list[str]
