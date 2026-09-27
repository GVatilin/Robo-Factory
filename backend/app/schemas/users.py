import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.permissions import Permission, permissions_for
from app.models import User
from app.models.enums import UserRole
from app.schemas.common import Ref, Schema, clean_text


class RoleOut(BaseModel):
    code: str
    name: str
    description: str
    permissions: list[Permission]


class UserOut(Schema):
    id: uuid.UUID
    email: str
    full_name: str | None
    organization: str | None
    role: UserRole
    is_active: bool
    manufacturer: Ref | None
    permissions: list[Permission]
    created_at: datetime
    last_login_at: datetime | None

    @classmethod
    def build(cls, user: User) -> "UserOut":
        return cls(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            organization=user.organization,
            role=user.role,
            is_active=user.is_active,
            manufacturer=Ref.model_validate(user.manufacturer) if user.manufacturer else None,
            permissions=sorted(permissions_for(user.role)),
            created_at=user.created_at,
            last_login_at=user.last_login_at,
        )


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128, description="Не короче 8 символов")
    full_name: str | None = Field(default=None, max_length=200, examples=["Иван Петров"])
    organization: str | None = Field(default=None, max_length=200, examples=["ООО «Логистика»"])

    strip_text = field_validator("full_name", "organization", mode="before")(clean_text)

    @field_validator("email")
    @classmethod
    def lower_email(cls, value: str) -> str:
        return value.lower()

    @field_validator("password")
    @classmethod
    def strong_enough(cls, value: str) -> str:
        if value.isdigit() or value.isalpha():
            raise ValueError("Пароль должен содержать и буквы, и цифры")
        return value


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserUpdateIn(BaseModel):
    """Изменение учётной записи администратором. Незаданные поля не меняются."""

    role: UserRole | None = None
    manufacturer_id: int | None = Field(default=None, description="Обязателен для роли «вендор»")
    is_active: bool | None = None
    full_name: str | None = Field(default=None, max_length=200)

    strip_text = field_validator("full_name", mode="before")(clean_text)
