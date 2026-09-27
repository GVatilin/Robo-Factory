"""Ошибки валидации понятным языком (п. 4.5.4 ТЗ).

Ответ 422 для ошибок схемы и для проверок сервисов имеет один формат:
{"detail": "<общее сообщение>", "errors": [{"field": "specs.payload_kg.value", "message": "..."}]}.
Поле `field` — путь в теле запроса, по нему интерфейс подсвечивает поле формы.
"""

from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


@dataclass(frozen=True)
class FieldError:
    field: str
    message: str


class ApiValidationError(Exception):
    """Ошибка проверки данных в сервисе: ссылка на запись не найдена, значение вне допустимого и т. п."""

    def __init__(self, errors: list[FieldError], detail: str | None = None):
        super().__init__(detail or "Проверьте заполнение формы")
        self.errors = errors
        self.detail = detail


_MESSAGES: dict[str, str] = {
    "missing": "Обязательное поле",
    "string_too_short": "Минимум {min_length} симв.",
    "string_too_long": "Не более {max_length} симв.",
    "greater_than_equal": "Значение должно быть не меньше {ge}",
    "greater_than": "Значение должно быть больше {gt}",
    "less_than_equal": "Значение должно быть не больше {le}",
    "less_than": "Значение должно быть меньше {lt}",
    "int_parsing": "Введите целое число",
    "int_type": "Введите целое число",
    "int_from_float": "Введите целое число",
    "float_parsing": "Введите число, например 1500 или 1,5",
    "float_type": "Введите число",
    "decimal_parsing": "Введите число, например 1500 или 1,5",
    "decimal_type": "Введите число",
    "decimal_max_digits": "Слишком большое число",
    "decimal_max_places": "Слишком много знаков после запятой",
    "bool_parsing": "Ожидается «да» или «нет»",
    "bool_type": "Ожидается «да» или «нет»",
    "date_parsing": "Введите дату в формате ГГГГ-ММ-ДД",
    "date_from_datetime_parsing": "Введите дату в формате ГГГГ-ММ-ДД",
    "enum": "Выберите одно из значений: {expected}",
    "literal_error": "Выберите одно из значений: {expected}",
    "uuid_parsing": "Некорректный идентификатор",
    "list_type": "Ожидается список значений",
    "json_invalid": "Тело запроса не является корректным JSON",
    "string_type": "Ожидается текст",
}


def _field_path(loc: tuple[Any, ...]) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path")]
    return ".".join(parts) or "__root__"


def _message(error: dict[str, Any]) -> str:
    kind = error.get("type", "")
    if kind == "value_error":
        message = str(error.get("msg", ""))
        if message.startswith("value is not a valid email address"):
            return "Введите корректный e-mail, например name@company.ru"
        # Сообщения собственных валидаторов уже на русском; Pydantic добавляет префикс.
        return message.removeprefix("Value error, ")
    if kind == "string_too_short" and (error.get("ctx") or {}).get("min_length") == 1:
        return "Поле не должно быть пустым"
    if kind == "string_type" and error.get("input") is None:
        # Пустая строка после обрезки пробелов становится None.
        return _MESSAGES["missing"]
    template = _MESSAGES.get(kind)
    if template is None:
        return "Некорректное значение"
    try:
        return template.format(**(error.get("ctx") or {}))
    except (KeyError, IndexError):
        return template


def _response(errors: list[FieldError], detail: str | None) -> JSONResponse:
    if detail is None:
        detail = "Проверьте заполнение формы" if len(errors) != 1 else errors[0].message
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": detail, "errors": [{"field": e.field, "message": e.message} for e in errors]},
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def _request_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [FieldError(_field_path(tuple(e.get("loc", ()))), _message(e)) for e in exc.errors()]
        return _response(errors, None)

    @app.exception_handler(ApiValidationError)
    async def _service_validation(_: Request, exc: ApiValidationError) -> JSONResponse:
        return _response(exc.errors, exc.detail)
