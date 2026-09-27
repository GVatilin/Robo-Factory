import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, DbSession
from app.api.errors import ApiValidationError, FieldError
from app.models import Manufacturer, User
from app.models.enums import UserRole
from app.schemas.common import Page
from app.schemas.users import UserOut, UserUpdateIn
from app.services import audit
from app.utils.text import like_pattern

router = APIRouter(prefix="/users", tags=["Пользователи"])


@router.get("", response_model=Page[UserOut], summary="Список пользователей")
async def list_users(
    db: DbSession,
    _: AdminUser,
    q: Annotated[str | None, Query(description="Поиск по e-mail, имени и организации")] = None,
    role: UserRole | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[UserOut]:
    stmt = select(User)
    if q:
        pattern = like_pattern(q)
        stmt = stmt.where(or_(User.email.ilike(pattern), User.full_name.ilike(pattern), User.organization.ilike(pattern)))
    if role:
        stmt = stmt.where(User.role == role)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    users = (
        await db.scalars(
            stmt.options(selectinload(User.manufacturer)).order_by(User.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    return Page(items=[UserOut.build(u) for u in users], total=total, limit=limit, offset=offset)


@router.patch("/{user_id}", response_model=UserOut, summary="Изменить роль, производителя или статус")
async def update_user(user_id: uuid.UUID, data: UserUpdateIn, db: DbSession, admin: AdminUser) -> UserOut:
    """Для роли «вендор» обязателен производитель. При другой роли привязка к производителю снимается."""
    target = await db.get(User, user_id, options=[selectinload(User.manufacturer)])
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пользователь не найден.")
    fields = data.model_fields_set
    role = data.role if "role" in fields and data.role is not None else target.role
    is_active = data.is_active if "is_active" in fields and data.is_active is not None else target.is_active
    if target.id == admin.id and (role != target.role or not is_active):
        raise ApiValidationError(
            [FieldError("role", "Нельзя менять собственную роль или блокировать себя. Попросите другого администратора.")]
        )

    manufacturer_id = data.manufacturer_id if "manufacturer_id" in fields else target.manufacturer_id
    if role == UserRole.VENDOR:
        if manufacturer_id is None:
            raise ApiValidationError([FieldError("manufacturer_id", "Для роли «вендор» выберите производителя.")])
        if await db.get(Manufacturer, manufacturer_id) is None:
            raise ApiValidationError([FieldError("manufacturer_id", "Производитель не найден.")])
    else:
        manufacturer_id = None

    before = {"role": target.role, "manufacturer_id": target.manufacturer_id, "is_active": target.is_active}
    target.role, target.manufacturer_id, target.is_active = role, manufacturer_id, is_active
    if "full_name" in fields:
        target.full_name = data.full_name
    after = {"role": role, "manufacturer_id": manufacturer_id, "is_active": is_active}
    audit.record(db, admin, "user", target.id, "update", {"before": before, "after": after})
    await db.commit()
    await db.refresh(target, ["manufacturer"])
    return UserOut.build(target)
