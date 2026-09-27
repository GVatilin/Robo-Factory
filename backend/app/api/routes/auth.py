from datetime import UTC, datetime
from functools import cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, DbSession
from app.api.errors import ApiValidationError, FieldError
from app.core.permissions import ROLES
from app.core.security import create_access_token, hash_password, verify_password
from app.models import User
from app.models.enums import UserRole
from app.schemas.users import RegisterIn, RoleOut, TokenOut, UserOut

router = APIRouter(prefix="/auth", tags=["Авторизация и роли"])

_EMAIL_TAKEN = FieldError("email", "Этот e-mail уже зарегистрирован. Войдите или укажите другой адрес.")


@cache
def _dummy_hash() -> str:
    """Хеш для проверки пароля несуществующего пользователя: время ответа не выдаёт, есть ли e-mail."""
    return hash_password("dummy-password-for-timing")


def _token(user: User) -> TokenOut:
    return TokenOut(access_token=create_access_token(str(user.id), user.role), user=UserOut.build(user))


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED, summary="Регистрация")
async def register(data: RegisterIn, db: DbSession) -> TokenOut:
    """Создаёт учётную запись с ролью «пользователь». Роли вендора и администратора назначает администратор."""
    if await db.scalar(select(User.id).where(User.email == data.email)):
        raise ApiValidationError([_EMAIL_TAKEN])
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        organization=data.organization,
        role=UserRole.USER,
        last_login_at=datetime.now(UTC),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as exc:
        raise ApiValidationError([_EMAIL_TAKEN]) from exc
    await db.refresh(user, ["manufacturer"])
    return _token(user)


@router.post("/login", response_model=TokenOut, summary="Вход по e-mail и паролю")
async def login(form: Annotated[OAuth2PasswordRequestForm, Depends()], db: DbSession) -> TokenOut:
    """Форма OAuth2: e-mail передаётся в поле `username`. Работает и кнопка Authorize в Swagger UI."""
    user = await db.scalar(
        select(User).options(selectinload(User.manufacturer)).where(User.email == form.username.strip().lower())
    )
    if user is None:
        verify_password(form.password, _dummy_hash())
    if user is None or not verify_password(form.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный e-mail или пароль.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Учётная запись заблокирована. Обратитесь к администратору.")
    user.last_login_at = datetime.now(UTC)
    await db.commit()
    return _token(user)


@router.get("/me", response_model=UserOut, summary="Текущий пользователь и его права")
async def me(user: CurrentUser, db: DbSession) -> UserOut:
    await db.refresh(user, ["manufacturer"])
    return UserOut.build(user)


@router.get("/roles", response_model=list[RoleOut], summary="Роли и права")
async def roles() -> list[RoleOut]:
    """Матрица прав всех ролей, включая гостя (запрос без токена)."""
    return [RoleOut(code=r.code, name=r.name, description=r.description, permissions=sorted(r.permissions))
            for r in ROLES.values()]
