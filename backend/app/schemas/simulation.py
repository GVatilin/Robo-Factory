from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.selection import SelectionInput


class SimulationOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    route_m: float = Field(default=50, ge=0, le=100000)
    speed_mps: float = Field(default=1, gt=0, le=30)
    reason: str = Field(default="Типовой маршрут 50 м в одну сторону, скорость 1 м/с; уточнить на объекте.", min_length=3, max_length=1000)


class SimulationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_updated_at: datetime
    options: SimulationOptions = Field(default_factory=SimulationOptions)
    selection: SelectionInput | None = None
    product_id: int | None = Field(default=None, gt=0)
    economics_run_id: UUID | None = None
    scenario_index: int = Field(default=0, ge=0, le=11)
    save: bool = False

    @model_validator(mode="after")
    def source(self):
        if self.economics_run_id is not None:
            if self.selection is not None or self.product_id is not None:
                raise ValueError("Выберите один источник: сохранённый сценарий или текущий подбор.")
        elif self.selection is None or self.product_id is None:
            raise ValueError("Для имитации выберите решение из подбора или сохранённый сценарий.")
        return self
