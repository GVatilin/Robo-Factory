from decimal import Decimal

import pytest

from app.api.errors import ApiValidationError
from app.models import ParameterDefinition
from app.services.projects import missing_required, validate_parameters
from app.services.projects import parse_parameter_file, parameter_template


def defs():
    return [ParameterDefinition(code="count", name="Количество", data_type="integer", is_required=True, min_value=Decimal("1"), max_value=Decimal("10")),
            ParameterDefinition(code="size", name="Размер", data_type="number", min_value=Decimal("0")),
            ParameterDefinition(code="access", name="Доступ", data_type="boolean", is_required=True),
            ParameterDefinition(code="kind", name="Тип", data_type="enum", allowed_values=["a", "b"]),
            ParameterDefinition(code="note", name="Описание", data_type="string")]


def test_draft_missing_values_and_false_are_distinct():
    values=validate_parameters({"count":"", "access":False, "note":"  text  "},defs())
    assert values=={"access":False,"note":"text"}
    assert missing_required(values,defs())==["count"]


@pytest.mark.parametrize("values", [{"count":True},{"count":1.5},{"count":11},{"count":0},
                                   {"size":float("nan")},{"size":float("inf")},{"access":"true"},
                                   {"kind":"c"},{"other":1},{"note":{}},{"size":[]},{"size":"2"}])
def test_invalid_parameter_types_and_bounds(values):
    with pytest.raises(ApiValidationError):
        validate_parameters(values,defs())


def test_valid_zero_false_enumeration_and_boundaries():
    values={"count":10,"size":0,"access":False,"kind":"a"}
    assert validate_parameters(values,defs())==values
    assert missing_required(values,defs())==[]


def test_csv_template_roundtrip_and_decimal_comma():
    values={"count":3,"size":2.5,"access":False,"kind":"a","note":"=not_a_formula"}
    content=parameter_template(values,defs()).encode("utf-8")
    assert parse_parameter_file(content,".csv",defs())==values
    assert parse_parameter_file('code;value;unit\nsize;2,5;\naccess;да;\n'.encode(),".csv",defs())=={"size":2.5,"access":True}


@pytest.mark.parametrize("text", ["", "wrong;header\nx;1", "code;value\ncount;3",
                                   "code;value;unit\ncount;3;\ncount;4;",
                                   "code;value;unit\nsize;bad;", "code;value;unit\nunknown;1;"])
def test_csv_import_rejects_invalid_structure(text):
    with pytest.raises(ApiValidationError):
        parse_parameter_file(text.encode(),".csv",defs())


def test_xlsx_import_and_formula_rejection():
    from io import BytesIO
    from openpyxl import Workbook
    workbook=Workbook()
    workbook.active.append(["code","value","unit"])
    workbook.active.append(["count",3,None])
    workbook.active.append(["access",False,None])
    output=BytesIO();workbook.save(output)
    assert parse_parameter_file(output.getvalue(),".xlsx",defs())=={"count":3,"access":False}
    workbook.active['B2']='=1+2'
    output=BytesIO();workbook.save(output)
    with pytest.raises(ApiValidationError):
        parse_parameter_file(output.getvalue(),".xlsx",defs())
