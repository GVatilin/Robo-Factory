import math
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.economics import EconomicsInput
from app.schemas.equipment import EquipmentInput


class RateOverride(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    value: float = Field(gt=0, le=1e8)
    reason: str = Field(min_length=3, max_length=1000)


class SelectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)
    process_id: int = Field(gt=0)
    utilization: float = Field(default=.8, gt=0, le=1)
    availability: float = Field(default=.9, gt=0, le=1)
    reserve_percent: float = Field(default=15, ge=0, le=100)
    daily_demand: float | None = Field(default=None, gt=0, le=1e9)
    hours_per_day: float | None = Field(default=None, gt=0, le=24)
    peak_factor: float | None = Field(default=None, ge=1, le=10)
    demand_reason: str = Field(default="", max_length=1000)
    throughput_overrides: dict[int, RateOverride] = Field(default_factory=dict, max_length=20)
    equipment: EquipmentInput = Field(default_factory=EquipmentInput)

    @model_validator(mode="after")
    def override_reason(self):
        changed_normative = not (
            math.isclose(self.utilization, .8)
            and math.isclose(self.availability, .9)
            and math.isclose(self.reserve_percent, 15)
        )
        changed_workload = any(v is not None for v in (self.daily_demand, self.hours_per_day, self.peak_factor))
        if (changed_normative or changed_workload) and len(self.demand_reason) < 3:
            raise ValueError("Обоснуйте изменение нагрузки, режима или коэффициентов (не менее 3 символов).")
        return self


class ScenarioBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    product_id: int = Field(gt=0)
    quantity_reason: str = Field(default="", max_length=1000)


class SelectionDefaultsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selection: SelectionInput
    product_ids: list[int] = Field(default_factory=list, max_length=6)


class SaveProjectEconomics(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_updated_at: datetime
    selection: SelectionInput
    inputs: EconomicsInput
    bindings: list[ScenarioBinding] = Field(min_length=1, max_length=12)
    accept_assumptions: bool = False
