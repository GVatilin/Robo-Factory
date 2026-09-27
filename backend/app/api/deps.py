import uuid
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import Permission, has_permission
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User
from app.models.enums import UserRole

DbSession = Annotated[AsyncSession, Depends(get_db)]

# auto_error=False: публичные роуты доступны гостю без токена.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_optional_user(db: DbSession, token: Annotated[str | None, Depends(oauth2_scheme)]) -> User | None:
    """Текущий пользователь или None для гостя. Недействительный токен тоже означает гостя."""
    if not token:
        return None
    try:
        user_id = uuid.UUID(decode_access_token(token)["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
    user = await db.get(User, user_id)
    return user if user is not None and user.is_active else None


OptionalUser = Annotated[User | None, Depends(get_optional_user)]


async def get_current_user(user: OptionalUser) -> User:
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Войдите в систему, чтобы выполнить это действие. Если вы уже входили, сессия могла истечь.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_any(*permissions: Permission):
    """Зависимость: у пользователя есть хотя бы одно из прав."""

    async def checker(user: CurrentUser) -> User:
        if not any(has_permission(user.role, p) for p in permissions):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав для этого действия.")
        if user.role == UserRole.VENDOR and user.manufacturer_id is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Учётная запись вендора не привязана к производителю. Обратитесь к администратору платформы.",
            )
        return user

    return Depends(checker)


AdminUser = Annotated[User, require_any(Permission.USERS_MANAGE)]
# Администратор или вендор с привязанным производителем.
CatalogEditor = Annotated[User, require_any(Permission.PRODUCTS_MANAGE, Permission.PRODUCTS_MANAGE_OWN)]
