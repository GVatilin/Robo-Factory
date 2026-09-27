from pydantic import BaseModel, ConfigDict


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class Option(BaseModel):
    """Значение перечисления с русским названием."""

    value: str
    label: str


class Ref(Schema):
    """Краткая ссылка на запись справочника."""

    id: int
    name: str


def clean_text(value: str | None) -> str | None:
    """Обрезает пробелы; пустая строка — отсутствие значения."""
    if value is None:
        return None
    value = " ".join(value.split()) if "\n" not in value else value.strip()
    return value or None
