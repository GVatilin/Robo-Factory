import io
from collections import Counter
from pathlib import Path

import openpyxl
import pytest

from app.services.facility_parameters_import import FacilityWorkbookError, parse_facility_workbook

DATASETS = Path(__file__).resolve().parents[2] / "datasets"
WORKBOOK = next(iter(sorted(DATASETS.glob("Датасеты*.xlsx"))), None)


def _workbook_bytes(sheets: dict[str, list[tuple]]) -> bytes:
    workbook = openpyxl.Workbook()
    workbook.remove(workbook.active)
    for title, rows in sheets.items():
        sheet = workbook.create_sheet(title)
        sheet.append(("Заголовок",))
        sheet.append(("Параметр", "Ед. изм.", "Базовое значение", "min", "max", "Примечание"))
        for row in rows:
            sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_missing_sheets_raise_friendly_error():
    with pytest.raises(FacilityWorkbookError, match="нет листов"):
        parse_facility_workbook(_workbook_bytes({"Склад": []}))


def test_types_sections_and_unknown_parameters():
    content = _workbook_bytes({
        "Склад": [
            ("▌ ОБЩИЕ ПАРАМЕТРЫ ОБЪЕКТА",),
            ("Общая площадь склада", "м²", 20000, 10000, 100000, "Примечание"),
            ("Количество этажей (мезонинов)", "шт.", 1, 1, 3, None),
            ("Наличие WMS", "-", "Да ", "Да", "Да", None),
            ("Средние габариты паллеты (Д×Ш×В)", "мм", "1200×800×1600", "-", "-", None),
            ("Новый параметр", "шт.", 1, None, None, None),
        ],
        "Аэропорт": [],
        "Медучреждение": [],
    })
    items, warnings = parse_facility_workbook(content)
    by_code = {i["code"]: i for i in items if i["facility_type"] == "warehouse"}
    assert by_code["total_area_m2"]["data_type"] == "number"
    assert by_code["total_area_m2"]["section"] == "Общие параметры объекта"
    assert by_code["floors_count"]["data_type"] == "integer"
    assert by_code["has_wms"]["default_value"] is True
    assert by_code["pallet_dimensions_mm"]["data_type"] == "dimensions"
    assert any("Новый параметр" in w for w in warnings)
    # Параметры, добавленные командой для аэропорта, есть всегда.
    assert {i["code"] for i in items if i["facility_type"] == "airport"} >= {"operating_hours_per_day", "avg_route_length_m"}


@pytest.mark.skipif(WORKBOOK is None, reason="датасет организатора не положен в datasets/")
def test_organizer_workbook_parses_completely():
    items, warnings = parse_facility_workbook(WORKBOOK.read_bytes())
    assert warnings == []
    assert Counter(i["facility_type"] for i in items) == {"medical": 57, "warehouse": 42, "airport": 42}
