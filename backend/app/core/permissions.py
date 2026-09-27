"""Ролевая модель (п. 3.1.1, 4.4.1 ТЗ).

Роль задаёт набор прав. Права вида «*_own» действуют только в пределах производителя,
к которому привязан вендор; принадлежность проверяют функции can_manage_* ниже.
Гость — запрос без токена: роль не хранится в БД, но участвует в матрице прав.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

from app.models.enums import UserRole

if TYPE_CHECKING:
    from app.models import User

GUEST_ROLE = "guest"


class Permission(StrEnum):
    CATALOG_READ = "catalog:read"
    # Создание, копирование и удаление собственных проектов (появятся на следующих этапах).
    PROJECTS_MANAGE = "projects:manage"
    PRODUCTS_MANAGE = "products:manage"
    PRODUCTS_MANAGE_OWN = "products:manage_own"
    PRODUCTS_PUBLISH = "products:publish"
    MANUFACTURERS_CREATE = "manufacturers:create"
    MANUFACTURERS_MANAGE = "manufacturers:manage"
    MANUFACTURERS_MANAGE_OWN = "manufacturers:manage_own"
    USERS_MANAGE = "users:manage"


@dataclass(frozen=True)
class RoleInfo:
    code: str
    name: str
    description: str
    permissions: frozenset[Permission]


_GUEST = frozenset({Permission.CATALOG_READ})
_USER = _GUEST | {Permission.PROJECTS_MANAGE}

ROLES: dict[str, RoleInfo] = {
    GUEST_ROLE: RoleInfo(
        GUEST_ROLE, "Гость",
        "Просматривает каталог и производителей, выполняет демонстрационные расчёты без сохранения данных.",
        _GUEST,
    ),
    UserRole.USER: RoleInfo(
        UserRole.USER, "Пользователь",
        "Всё, что доступно гостю, а также собственные проекты с параметрами объекта и сценариями.",
        _USER,
    ),
    UserRole.VENDOR: RoleInfo(
        UserRole.VENDOR, "Вендор",
        "Представитель производителя: ведёт карточку своей компании и добавляет её товары. "
        "Новые и изменённые товары публикуются после проверки администратором.",
        _USER | {Permission.PRODUCTS_MANAGE_OWN, Permission.MANUFACTURERS_MANAGE_OWN},
    ),
    UserRole.ADMIN: RoleInfo(
        UserRole.ADMIN, "Администратор",
        "Управляет каталогом, производителями, публикацией товаров и ролями пользователей.",
        _USER | {
            Permission.PRODUCTS_MANAGE,
            Permission.PRODUCTS_PUBLISH,
            Permission.MANUFACTURERS_CREATE,
            Permission.MANUFACTURERS_MANAGE,
            Permission.USERS_MANAGE,
        },
    ),
}


def permissions_for(role: str | None) -> frozenset[Permission]:
    return ROLES[role or GUEST_ROLE].permissions


def has_permission(role: str | None, permission: Permission) -> bool:
    return permission in permissions_for(role)


def can_manage_manufacturer(user: "User | None", manufacturer_id: int | None) -> bool:
    if user is None:
        return False
    if has_permission(user.role, Permission.MANUFACTURERS_MANAGE):
        return True
    return (
        has_permission(user.role, Permission.MANUFACTURERS_MANAGE_OWN)
        and manufacturer_id is not None
        and user.manufacturer_id == manufacturer_id
    )


def can_manage_product(user: "User | None", manufacturer_id: int | None) -> bool:
    if user is None:
        return False
    if has_permission(user.role, Permission.PRODUCTS_MANAGE):
        return True
    return (
        has_permission(user.role, Permission.PRODUCTS_MANAGE_OWN)
        and manufacturer_id is not None
        and user.manufacturer_id == manufacturer_id
    )


def sees_unpublished(user: "User | None", manufacturer_id: int | None) -> bool:
    """Неопубликованные товары видят администратор и вендор-владелец."""
    return can_manage_product(user, manufacturer_id)
