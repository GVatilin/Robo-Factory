import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ProjectInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    facility_type_id: int = Field(gt=0)
    parameters: dict[str, Any] = Field(default_factory=dict, max_length=300)


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    parameters: dict[str, Any] = Field(max_length=300)
    updated_at: datetime  # защита от перезаписи изменений другой вкладки


class ProjectSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: str | None
    facility_type_id: int
    is_demo: bool
    created_at: datetime
    updated_at: datetime
    status: str = "draft"
    required_total: int = 0
    required_filled: int = 0
    calculated_scenarios: int = 0
    calculation_count: int = 0


class ProjectDetail(ProjectSummary):
    parameters: dict[str, Any]
    parameter_origins: dict[str, Any]
    scenarios: list[dict[str, Any]]
    missing_required: list[str]


class ParameterOut(BaseModel):
    code: str
    name: str
    section: str | None
    unit: str | None
    data_type: str
    is_required: bool
    default_value: Any
    min_value: float | None
    max_value: float | None
    allowed_values: list[Any] | None
    hint: str | None
    example: str | None
    source: str | None
    source_note: str | None
