from pydantic import BaseModel, ConfigDict, Field, model_validator


class EquipmentInput(BaseModel):
    """Explicit sizing assumptions; prices apply to the entire selected scenario."""
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    runtime_hours: float = Field(default=8, gt=0, le=168)
    charge_hours: float = Field(default=2, gt=0, le=48)
    charger_utilization: float = Field(default=.8, gt=0, le=1)
    operations_per_cycle: float = Field(default=1, gt=0, le=1e6)
    handling_seconds: float = Field(default=30, gt=0, le=3600)
    station_utilization: float = Field(default=.8, gt=0, le=1)
    peak_rate: float = Field(default=0, ge=0, le=1e10)
    charger_price: float = Field(default=0, ge=0, le=1e12)
    station_price: float = Field(default=0, ge=0, le=1e12)
    charger_count: int | None = Field(default=None, ge=1, le=100000)
    station_count: int | None = Field(default=None, ge=1, le=100000)
    override_reason: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def manual_reason(self):
        if (self.charger_count is not None or self.station_count is not None) and len(self.override_reason.strip()) < 3:
            raise ValueError("Обоснуйте ручное количество зарядок или рабочих постов.")
        return self

