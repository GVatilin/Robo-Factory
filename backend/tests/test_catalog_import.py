from decimal import Decimal
from pathlib import Path

import pytest

from app.models.enums import ProductClass
from app.services.catalog_import import CatalogFormatError, parse_catalog_csv, parse_price
from app.services.taxonomy import resolve_category, resolve_type

DATASETS = Path(__file__).resolve().parents[2] / "datasets"
CATALOG = DATASETS / "catalog_export_v4.csv"

HEADER = "id;Название;тип;статус;компания;описание;Тип;Подтип;Сценарий;Кейсы;УГТ;Рын Потенциал;Регион;Отрасль;Цена изделия"


def test_parse_price():
    assert parse_price("2 700 000,00") == Decimal("2700000.00")
    assert parse_price("1 500 000,50") == Decimal("1500000.50")
    assert parse_price("") is None
    assert parse_price("0,00") is None


def test_rows_with_same_id_are_grouped_and_prices_become_offers():
    rows = [
        HEADER,
        "a1;Модель А;brs;operation;АО Тест;Описание;Мобильные роботы;AMR;Сортировка;;8;4.00;Москва;Торговля и услуги;2 000 000,00",
        "a1;Модель А;brs;operation;АО Тест;Описание;Мобильные роботы;AMR;Производство;Кейс;8;4.00;Москва;Промышленность;2 500 000,00",
        "b2;Модель Б;bas;piloting;ООО Б;;;;;;7;3.00;Москва;ТЭК;1 000 000,00",
    ]
    records, warnings = parse_catalog_csv("\n".join(rows).encode("utf-8-sig"))
    assert warnings == []
    assert [r.external_id for r in records] == ["a1", "b2"]
    first = records[0]
    assert len(first.applications) == 2
    assert [p for p, _ in first.prices] == [Decimal("2000000.00"), Decimal("2500000.00")]
    assert records[1].product_class == ProductClass.BAS


def test_missing_columns_raise_friendly_error():
    with pytest.raises(CatalogFormatError, match="обязательных колонок"):
        parse_catalog_csv("id;Название\n1;Робот".encode())


def test_taxonomy_normalizes_spelling_variants():
    assert resolve_type("Робот уборщик") == ("cleaning_robot", "Робот-уборщик")
    assert resolve_type("Робот-штабелёр") == ("stacker_robot", "Робот-штабелер")
    assert resolve_type("") is None
    assert resolve_category("", ProductClass.BAS)[0] == "uas"
    assert resolve_category("ПО БРС", ProductClass.SOFTWARE)[0] == "software"


@pytest.mark.skipif(not CATALOG.exists(), reason="датасет организатора не положен в datasets/")
def test_organizer_catalog_parses():
    records, _ = parse_catalog_csv(CATALOG.read_bytes())
    assert len(records) == 187
    assert sum(len(r.rows) for r in records) == 223
