from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic import HttpUrl
from app.models.enums import SourceType


class ParameterSourceInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=300)
    source_type: SourceType
    url: HttpUrl | None = None
    notes: str | None = Field(default=None, max_length=2000)


class ObjectTypeInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,63}$")
    name: str = Field(min_length=1, max_length=200)
    industry_id: int = Field(gt=0)
    description: str | None = Field(default=None, max_length=2000)


class ObjectParameterInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,99}$")
    name: str = Field(min_length=1, max_length=300)
    section: str = Field(default="Дополнительные параметры", min_length=1, max_length=200)
    data_type: Literal["number", "integer", "string", "boolean", "enum", "dimensions"]
    unit: str | None = Field(default=None, max_length=50)
    is_required: bool = False
    default_value: Any = None
    min_value: float | None = None
    max_value: float | None = None
    allowed_values: list[str] | None = Field(default=None, max_length=100)
    hint: str | None = Field(default=None, max_length=2000)
    source_id: int = Field(gt=0)
    source_note: str | None = Field(default=None, max_length=2000)
    sort_order: int = Field(default=1000, ge=0, le=100000)

    @model_validator(mode="after")
    def check_schema(self):
        if self.min_value is not None and self.max_value is not None and self.min_value > self.max_value:
            raise ValueError("Минимум не может превышать максимум.")
        if self.data_type == "enum" and (not self.allowed_values or any(not v or len(v)>200 for v in self.allowed_values)):
            raise ValueError("Для списка укажите непустые варианты до 200 символов.")
        if self.data_type != "enum" and self.allowed_values:
            raise ValueError("Варианты значений доступны только для типа enum.")
        if self.data_type not in ("number", "integer") and (self.min_value is not None or self.max_value is not None):
            raise ValueError("Диапазон доступен только для числовых параметров.")
        return self
