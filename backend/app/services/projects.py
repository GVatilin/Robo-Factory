import math
import csv
import io
import zipfile
from xml.etree.ElementTree import ParseError
from openpyxl.utils.exceptions import InvalidFileException
from typing import Any, Sequence

from app.api.errors import ApiValidationError, FieldError
from app.models import ParameterDefinition


def parse_parameter_file(content: bytes, suffix: str, definitions: Sequence[ParameterDefinition]) -> dict[str, Any]:
    """Шаблон code,value[,name,unit]. Пустая ячейка очищает значение; отсутствующая строка оставляет его."""
    try:
        if suffix == ".csv":
            text = content.decode("utf-8-sig")
            rows = list(csv.reader(io.StringIO(text), delimiter=";" if ";" in text.splitlines()[0] else ","))
        elif suffix == ".xlsx":
            import openpyxl
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if sum(i.file_size for i in archive.infolist()) > 20_000_000:
                    raise ValueError("Слишком большой распакованный Excel-файл.")
            workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=False, keep_links=False)
            try:
                sheet = workbook.active
                if sheet.max_row and sheet.max_row > 301 or sheet.max_column and sheet.max_column > 10:
                    raise ValueError("В шаблоне допускается до 300 параметров и 10 колонок.")
                rows = []
                for row in sheet.iter_rows(max_row=302, max_col=10):
                    if any(cell.data_type == "f" for cell in row):
                        raise ValueError("Замените формулы Excel их значениями.")
                    rows.append([cell.value for cell in row])
                while rows and all(value is None for value in rows[-1]):
                    rows.pop()
            finally:
                workbook.close()
        else:
            raise ValueError("Поддерживаются CSV UTF-8 и XLSX.")
        if not rows or [str(v or "").strip().lower() for v in rows[0][:2]] != ["code", "value"]:
            raise ValueError("Первые колонки должны называться code и value. Скачайте шаблон проекта.")
        if len(rows) > 301:
            raise ValueError("В файле допускается до 300 параметров.")
        by_code = {d.code: d for d in definitions}
        result = {}
        for row in rows[1:]:
            if not row or all(v in (None, "") for v in row):
                continue
            code = str(row[0] or "").strip()
            if len(row) < 2 or code not in by_code or code in result:
                raise ValueError(f"Неизвестный, повторный или незаполненный код параметра: {code}.")
            value = row[1]
            if isinstance(value, str):
                value = value.strip()
                if value.startswith("'") and value[1:2] in ("=", "+", "-", "@"):
                    value = value[1:]
            if value not in (None, ""):
                d = by_code[code]
                if d.data_type in ("number", "integer") and isinstance(value, str):
                    try:
                        value = float(value.replace(" ", "").replace("\u00a0", "").replace(",", "."))
                    except ValueError:
                        raise ValueError(f"Параметр {code}: введите число.")
                elif d.data_type == "boolean" and isinstance(value, str):
                    flags = {"true": True, "false": False, "да": True, "нет": False, "1": True, "0": False}
                    if value.lower() not in flags:
                        raise ValueError(f"Параметр {code}: укажите да или нет.")
                    value = flags[value.lower()]
            result[code] = value
        validate_parameters(result, definitions)
        return result
    except (ValueError, IndexError, UnicodeError, csv.Error, zipfile.BadZipFile, KeyError, ParseError, InvalidFileException) as exc:
        raise ApiValidationError([FieldError("file", str(exc))]) from exc


def parameter_template(parameters: dict[str, Any], definitions: Sequence[ParameterDefinition]) -> str:
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["code", "value", "name", "unit"])
    for d in definitions:
        value = parameters.get(d.code, "")
        if isinstance(value, bool):
            value = "да" if value else "нет"
        cells = [d.code, value, d.name, d.unit or ""]
        writer.writerow(["'" + c if isinstance(c, str) and c.startswith(("=", "+", "-", "@")) else c for c in cells])
    return "\ufeff" + output.getvalue()


def validate_parameters(values: dict[str, Any], definitions: Sequence[ParameterDefinition]) -> dict[str, Any]:
    """Черновики допускают незаполненные поля; введённые значения строго проверяются."""
    by_code = {d.code: d for d in definitions}
    errors: list[FieldError] = []
    result: dict[str, Any] = {}
    for code, value in values.items():
        d = by_code.get(code)
        error = None
        if d is None:
            errors.append(FieldError(f"parameters.{code}", "Неизвестный параметр для этого типа объекта."))
            continue
        if value is None or value == "":
            continue
        if d.data_type in ("number", "integer"):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or abs(value) > 1e15 or not math.isfinite(value):
                error = "Введите конечное число."
            elif d.data_type == "integer" and value != int(value):
                error = "Введите целое число."
            elif d.min_value is not None and value < float(d.min_value):
                error = f"Минимальное значение: {d.min_value}."
            elif d.max_value is not None and value > float(d.max_value):
                error = f"Максимальное значение: {d.max_value}."
        elif d.data_type == "boolean":
            if not isinstance(value, bool):
                error = "Выберите да или нет."
        elif d.data_type == "enum":
            if value not in (d.allowed_values or []):
                error = "Выберите значение из списка."
        elif not isinstance(value, str) or len(value) > 2000:
            error = "Введите текст не длиннее 2000 символов."
        elif isinstance(value, str):
            value = value.strip()
            if not value:
                continue
        if error:
            errors.append(FieldError(f"parameters.{code}", error))
        else:
            result[code] = value
    if errors:
        raise ApiValidationError(errors)
    return result


def missing_required(values: dict[str, Any], definitions: Sequence[ParameterDefinition]) -> list[str]:
    return [d.code for d in definitions if d.is_required and (d.code not in values or values[d.code] in (None, ""))]
