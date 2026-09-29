from datetime import date, datetime

from pydantic import EmailStr, Field, field_validator

from app.schemas.common import Schema, clean_text
from app.schemas.products import ProductSummary


class ManufacturerIn(Schema):
    name: str = Field(min_length=2, max_length=300, examples=["ООО «Ронави Роботикс»"])
    country: str | None = Field(default=None, max_length=100, examples=["Россия"])
    region: str | None = Field(default=None, max_length=200, examples=["Москва"])
    website: str | None = Field(default=None, max_length=500, examples=["https://ronavi-robotics.ru"])
    contact_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=50, examples=["+7 495 000-00-00"])
    description: str | None = Field(default=None, max_length=5000)

    strip_text = field_validator(
        "name", "country", "region", "website", "contact_email", "phone", "description", mode="before"
    )(clean_text)

    @field_validator("website")
    @classmethod
    def normalize_website(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if " " in value or "." not in value:
            raise ValueError("Укажите адрес сайта, например https://example.ru")
        return value if value.startswith(("http://", "https://")) else f"https://{value}"


class ManufacturerSummary(Schema):
    id: int
    name: str
    country: str | None
    region: str | None
    website: str | None
    logo_url: str | None = None
    logo_source_url: str | None = None
    logo_original_url: str | None = None
    logo_retrieved_at: date | None = None
    logo_note: str | None = None
    product_count: int
    # Товары на проверке — видны администратору и вендору-владельцу.
    pending_count: int = 0
    solution_types: list[str] = []
    updated_at: datetime


class ManufacturerOut(ManufacturerSummary):
    contact_email: str | None
    phone: str | None
    description: str | None
    created_at: datetime
    can_edit: bool = False
    can_add_products: bool = False
    can_delete: bool = False
    products: list[ProductSummary] = []
