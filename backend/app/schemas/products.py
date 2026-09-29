from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.models.enums import AcquisitionModel, ProductClass, ReadinessStatus, SourceType, SpecGroup, ValueDataType
from app.schemas.common import Ref, Schema, clean_text

Money = Annotated[Decimal, Field(ge=0, max_digits=16, decimal_places=2)]


# ---------- входные данные ----------


class SpecValueIn(BaseModel):
    """Значение ТТХ. Какое из полей заполнять, зависит от типа характеристики (data_type справочника)."""

    code: str = Field(examples=["payload_kg"])
    value: Decimal | None = Field(default=None, description="Число или нижняя граница диапазона")
    value_max: Decimal | None = Field(default=None, description="Верхняя граница диапазона")
    text: str | None = Field(default=None, max_length=2000)
    flag: bool | None = Field(default=None, description="Для характеристик «да / нет»")
    unit: str | None = Field(default=None, max_length=50, description="Если отличается от единицы справочника")
    is_confirmed: bool = Field(default=False, description="Значение подтверждено источником")
    is_assumption: bool = Field(default=False, description="Значение — допущение, а не данные производителя")
    note: str | None = Field(default=None, max_length=1000)

    strip_text = field_validator("text", "unit", "note", mode="before")(clean_text)


class OfferIn(BaseModel):
    """Коммерческое предложение. Без id создаётся новое, с id — обновляется существующее."""

    id: int | None = None
    label: str | None = Field(default=None, max_length=300, description="По умолчанию — по модели приобретения")
    acquisition_model: AcquisitionModel = AcquisitionModel.PURCHASE
    is_default: bool = False
    price_includes_vat: bool = True
    equipment_price: Money | None = None
    software_price: Money | None = None
    implementation_price: Money | None = None
    annual_service_cost: Money | None = None
    monthly_fee: Money | None = Field(default=None, description="Для лизинга и RaaS, ₽/мес.")
    min_contract_months: int | None = Field(default=None, ge=1, le=240)
    included_services: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)

    strip_text = field_validator("label", "included_services", "notes", mode="before")(clean_text)


class ApplicationIn(BaseModel):
    """Применение в отрасли и реализованный кейс."""

    id: int | None = None
    industry_id: int | None = None
    scenario: str | None = Field(default=None, max_length=500, examples=["Внутрискладская логистика"])
    case_description: str | None = Field(default=None, max_length=5000)

    strip_text = field_validator("scenario", "case_description", mode="before")(clean_text)


class SourceIn(BaseModel):
    """Источник данных карточки (п. 3.3.4 ТЗ). Без названия и ссылки источником считается ручной ввод."""

    source_type: SourceType = SourceType.MANUFACTURER
    title: str | None = Field(default=None, max_length=500, examples=["Технический паспорт Ronavi H1500"])
    url: str | None = Field(default=None, max_length=1000)
    retrieved_at: date | None = Field(default=None, description="Дата получения данных; по умолчанию сегодня")

    strip_text = field_validator("title", "url", mode="before")(clean_text)

    @field_validator("url")
    @classmethod
    def check_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if " " in value or "." not in value:
            raise ValueError("Укажите ссылку, например https://example.ru/robot.pdf")
        return value if value.startswith(("http://", "https://")) else f"https://{value}"


class ProductIn(BaseModel):
    name: str = Field(min_length=2, max_length=300, examples=["Ronavi H1500"])
    manufacturer_id: int = Field(description="Каждый товар принадлежит производителю")
    solution_type_id: int
    product_class: ProductClass = ProductClass.BRS
    purpose: str | None = Field(default=None, max_length=2000)
    description: str | None = Field(default=None, max_length=10000)
    country_of_origin: str | None = Field(default=None, max_length=100)
    region: str | None = Field(default=None, max_length=200)
    readiness_status: ReadinessStatus | None = None
    trl: int | None = Field(default=None, ge=1, le=9, description="Уровень готовности технологии (УГТ)")
    limitations: str | None = Field(default=None, max_length=5000)
    service_life_years: Decimal | None = Field(default=None, ge=0, le=50, max_digits=5, decimal_places=1)
    is_published: bool | None = Field(default=None, description="Меняет только администратор")
    process_ids: list[int] = []
    specs: list[SpecValueIn] = []
    offers: list[OfferIn] = []
    applications: list[ApplicationIn] = []
    source: SourceIn | None = None

    strip_text = field_validator(
        "name", "purpose", "description", "country_of_origin", "region", "limitations", mode="before"
    )(clean_text)


class PublicationIn(BaseModel):
    is_published: bool


# ---------- ответы ----------


class SolutionTypeRef(Schema):
    id: int
    code: str
    name: str
    category: "SolutionTypeRef | None" = None


class SourceOut(Schema):
    id: int
    title: str
    source_type: SourceType
    url: str | None
    publisher: str | None
    retrieved_at: date | None


class SpecValueOut(BaseModel):
    code: str
    name: str
    group: SpecGroup
    data_type: ValueDataType
    unit: str | None
    is_mandatory: bool
    value: float | None
    value_max: float | None
    text: str | None
    flag: bool | None
    is_confirmed: bool
    is_assumption: bool
    note: str | None
    source: SourceOut | None
    retrieved_at: date | None


class OfferOut(Schema):
    id: int
    label: str
    acquisition_model: AcquisitionModel
    is_default: bool
    currency: str
    price_includes_vat: bool
    vat_status: str | None = None
    minimum_quantity: int = 1
    estimation_eligible: bool = True
    equipment_price: float | None
    software_price: float | None
    implementation_price: float | None
    annual_service_cost: float | None
    monthly_fee: float | None
    min_contract_months: int | None
    included_services: str | None
    is_confirmed: bool
    notes: str | None
    source: SourceOut | None


class ApplicationOut(Schema):
    id: int
    industry: Ref | None
    scenario: str | None
    case_description: str | None


class FacilityRef(Schema):
    id: int
    code: str
    name: str


class ProcessOut(Schema):
    id: int
    code: str
    name: str
    facility_type: FacilityRef


class Completeness(BaseModel):
    """Полнота карточки по обязательным характеристикам п. 3.3.7 ТЗ."""

    not_applicable: list[str] = []
    percent: int
    filled: int
    total: int
    missing: list[str]


class Dimensions(BaseModel):
    length_mm: float | None
    width_mm: float | None
    height_mm: float | None


class ImageOut(BaseModel):
    """Фотография товара. Ссылки меняются при замене фото, поэтому кэшируются браузером навсегда."""

    url: str
    thumb_url: str
    width: int
    height: int
    source: SourceOut | None
    uploaded_at: datetime
    is_illustration: bool = False
    caption: str | None = None
    attribution: str | None = None
    original_url: str | None = None


class SpecificationAlternative(BaseModel):
    code: str
    source_url: str
    retrieved_at: date
    value: float | None = None
    value_max: float | None = None
    text: str | None = None
    unit: str | None = None
    note: str | None = None
    current_source_url: str | None = None


class ProductSummary(BaseModel):
    id: int
    name: str
    # Превью фотографии для карточки каталога.
    image_url: str | None
    image_is_illustration: bool = False
    image_caption: str | None = None
    image_source_url: str | None = None
    manufacturer: Ref | None
    manufacturer_logo_url: str | None = None
    solution_type: SolutionTypeRef | None
    product_class: ProductClass
    readiness_status: ReadinessStatus | None
    purpose: str | None
    country_of_origin: str | None
    is_published: bool
    price_from: float | None
    monthly_fee_from: float | None
    acquisition_models: list[AcquisitionModel]
    dimensions: Dimensions
    payload_kg: float | None
    max_speed_mps: float | None
    completeness_percent: int
    updated_at: datetime


class ProductOut(ProductSummary):
    field_sources: dict[str, SourceOut] = {}
    research_checked_at: date | None = None
    research_note: str | None = None
    reviewed_urls: list[str] = []
    specification_alternatives: list[SpecificationAlternative] = []
    external_id: str | None
    description: str | None
    region: str | None
    trl: int | None
    market_potential: float | None
    limitations: str | None
    service_life_years: float | None
    last_verified_at: date | None
    created_at: datetime
    specs: list[SpecValueOut]
    offers: list[OfferOut]
    applications: list[ApplicationOut]
    processes: list[ProcessOut]
    sources: list[SourceOut]
    completeness: Completeness
    image: ImageOut | None
    can_edit: bool
    can_publish: bool
