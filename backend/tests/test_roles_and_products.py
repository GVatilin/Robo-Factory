from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.api.errors import _message
from app.core.permissions import GUEST_ROLE, Permission, can_manage_manufacturer, can_manage_product, has_permission
from app.models import SpecDefinition
from app.models.enums import SpecGroup, UserRole, ValueDataType
from app.schemas.products import SpecValueIn
from app.services.completeness import checklist
from app.services.products import normalize_specs


def user(role: UserRole, manufacturer_id: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(role=role, manufacturer_id=manufacturer_id)


@pytest.mark.parametrize(
    ("role", "allowed"),
    [
        (GUEST_ROLE, {Permission.CATALOG_READ}),
        (UserRole.USER, {Permission.CATALOG_READ, Permission.PROJECTS_MANAGE}),
        (UserRole.VENDOR, {Permission.CATALOG_READ, Permission.PROJECTS_MANAGE,
                           Permission.PRODUCTS_MANAGE_OWN, Permission.MANUFACTURERS_MANAGE_OWN}),
        (UserRole.ADMIN, set(Permission) - {Permission.PRODUCTS_MANAGE_OWN, Permission.MANUFACTURERS_MANAGE_OWN}),
    ],
)
def test_role_matrix(role, allowed):
    assert {p for p in Permission if has_permission(role, p)} == allowed


def test_none_role_is_guest():
    assert has_permission(None, Permission.CATALOG_READ)
    assert not has_permission(None, Permission.PROJECTS_MANAGE)


def test_vendor_manages_only_own_manufacturer():
    vendor = user(UserRole.VENDOR, manufacturer_id=7)
    assert can_manage_product(vendor, 7) and can_manage_manufacturer(vendor, 7)
    assert not can_manage_product(vendor, 8) and not can_manage_manufacturer(vendor, 8)
    assert not can_manage_product(user(UserRole.VENDOR), None)
    assert can_manage_product(user(UserRole.ADMIN), 8)
    assert not can_manage_product(user(UserRole.USER), 8)
    assert not can_manage_product(None, 8)


def definitions() -> dict[str, SpecDefinition]:
    rows = [
        (1, "payload_kg", ValueDataType.NUMBER, "кг"),
        (2, "runtime_h", ValueDataType.RANGE, "ч"),
        (3, "operating_temp_c", ValueDataType.RANGE, "°C"),
        (4, "navigation_type", ValueDataType.STRING, None),
        (5, "elevator_integration", ValueDataType.BOOLEAN, None),
        (6, "robots_count", ValueDataType.INTEGER, "шт."),
    ]
    return {
        code: SpecDefinition(id=i, code=code, name=code, group=SpecGroup.TECHNICAL, data_type=t, unit=unit)
        for i, code, t, unit in rows
    }


def test_specs_are_normalized_by_data_type():
    values, errors = normalize_specs(
        [
            SpecValueIn(code="payload_kg", value=Decimal("1500"), unit="кг", is_confirmed=True),
            SpecValueIn(code="runtime_h", value=Decimal("8"), value_max=Decimal("8")),
            SpecValueIn(code="operating_temp_c", value=Decimal("-20"), value_max=Decimal("45")),
            SpecValueIn(code="navigation_type", text="SLAM"),
            SpecValueIn(code="elevator_integration", flag=False),
        ],
        definitions(),
    )
    assert errors == []
    assert values[1]["value_numeric"] == Decimal("1500") and values[1]["unit"] is None
    assert values[1]["is_confirmed"] is True
    assert values[2]["value_numeric_max"] is None  # диапазон 8–8 хранится как одно значение
    assert values[3]["value_numeric"] == Decimal("-20")
    assert values[4]["value_text"] == "SLAM"
    assert values[5]["value_bool"] is False


def test_empty_specs_are_skipped():
    values, errors = normalize_specs(
        [SpecValueIn(code="payload_kg"), SpecValueIn(code="navigation_type"), SpecValueIn(code="elevator_integration")],
        definitions(),
    )
    assert values == {} and errors == []


def test_spec_errors_point_to_fields():
    _, errors = normalize_specs(
        [
            SpecValueIn(code="payload_kg", value=Decimal("-1")),
            SpecValueIn(code="payload_kg", value=Decimal("1"), value_max=Decimal("2")),
            SpecValueIn(code="runtime_h", value=Decimal("10"), value_max=Decimal("8")),
            SpecValueIn(code="robots_count", value=Decimal("2.5")),
            SpecValueIn(code="unknown", value=Decimal("1")),
        ],
        definitions(),
    )
    assert [e.field for e in errors] == [
        "specs.payload_kg.value",
        "specs.payload_kg.value_max",
        "specs.runtime_h.value_max",
        "specs.robots_count.value",
        "specs.unknown",
    ]


def test_checklist_puts_mandatory_specs_between_identification_and_economics():
    specs = [SpecDefinition(id=1, code="payload_kg", name="Грузоподъёмность", group=SpecGroup.TECHNICAL)]
    keys = [item.key for item in checklist(specs)]
    assert keys.index("field:readiness_status") < keys.index("spec:payload_kg") < keys.index("field:price")


def test_validation_messages_are_russian():
    assert _message({"type": "missing"}) == "Обязательное поле"
    assert _message({"type": "string_type", "input": None}) == "Обязательное поле"
    assert _message({"type": "less_than_equal", "ctx": {"le": 9}}) == "Значение должно быть не больше 9"
    assert _message({"type": "value_error", "msg": "Value error, Укажите ссылку"}) == "Укажите ссылку"
    assert "e-mail" in _message({"type": "value_error", "msg": "value is not a valid email address: no @"})
    assert _message({"type": "something_new"}) == "Некорректное значение"
