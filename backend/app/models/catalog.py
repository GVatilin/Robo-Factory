"""Каталог роботизированных решений.

Иерархия п. 3.3.1 ТЗ: отрасль → тип объекта → процесс → тип решения → конкретный продукт.
Процесс и тип решения связаны многие-ко-многим (process_solution_types): один тип решения
(например, AMR) применим во многих процессах разных объектов.

Характеристики продуктов хранятся в виде «определение + значение» (spec_definitions / product_spec_values):
новые ТТХ добавляются данными, а каждое значение несёт источник, дату и признак подтверждённости (п. 3.3.4 ТЗ).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, str_enum
from app.models.enums import AcquisitionModel, ProductClass, ReadinessStatus, SpecGroup, ValueDataType

if TYPE_CHECKING:
    from app.models.reference import Industry, Process
    from app.models.sources import DataSource, DatasetVersion
    from app.models.user import User


process_solution_types = Table(
    "process_solution_types",
    Base.metadata,
    Column("process_id", ForeignKey("processes.id", ondelete="CASCADE"), primary_key=True),
    Column("solution_type_id", ForeignKey("solution_types.id", ondelete="CASCADE"), primary_key=True),
)

product_processes = Table(
    "product_processes",
    Base.metadata,
    Column("product_id", ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
    Column("process_id", ForeignKey("processes.id", ondelete="CASCADE"), primary_key=True),
)

product_sources = Table(
    "product_sources",
    Base.metadata,
    Column("product_id", ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
    Column("source_id", ForeignKey("data_sources.id", ondelete="CASCADE"), primary_key=True),
)


class SolutionType(Base):
    """Тип роботизированного решения. Двухуровневое дерево: категория (Мобильные роботы) → тип (AMR)."""

    __tablename__ = "solution_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("solution_types.id", ondelete="SET NULL"), index=True)
    code: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    parent: Mapped["SolutionType | None"] = relationship(remote_side="SolutionType.id", back_populates="children")
    children: Mapped[list["SolutionType"]] = relationship(back_populates="parent")
    processes: Mapped[list["Process"]] = relationship(
        secondary=process_solution_types, back_populates="solution_types"
    )


class Manufacturer(Base):
    __tablename__ = "manufacturers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300), unique=True)
    country: Mapped[str | None] = mapped_column(String(100))
    region: Mapped[str | None] = mapped_column(String(200))
    website: Mapped[str | None] = mapped_column(String(500))
    contact_email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    products: Mapped[list["Product"]] = relationship(back_populates="manufacturer")


class Product(Base):
    """Конкретный продукт (модель робота / системы)."""

    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Идентификатор строки в каталоге организатора (catalog_export). NULL — добавлен вручную.
    external_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(300), index=True)
    manufacturer_id: Mapped[int | None] = mapped_column(
        ForeignKey("manufacturers.id", ondelete="SET NULL"), index=True
    )
    solution_type_id: Mapped[int | None] = mapped_column(
        ForeignKey("solution_types.id", ondelete="SET NULL"), index=True
    )
    product_class: Mapped[ProductClass] = mapped_column(str_enum(ProductClass), index=True)
    purpose: Mapped[str | None] = mapped_column(Text)  # назначение
    description: Mapped[str | None] = mapped_column(Text)
    country_of_origin: Mapped[str | None] = mapped_column(String(100))
    readiness_status: Mapped[ReadinessStatus | None] = mapped_column(str_enum(ReadinessStatus), index=True)
    trl: Mapped[int | None] = mapped_column(SmallInteger)  # уровень готовности технологии (УГТ)
    market_potential: Mapped[Decimal | None] = mapped_column(Numeric(3, 1))
    region: Mapped[str | None] = mapped_column(String(200))
    limitations: Mapped[str | None] = mapped_column(Text)
    service_life_years: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    is_published: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    last_verified_at: Mapped[date | None] = mapped_column(Date)
    dataset_version_id: Mapped[int | None] = mapped_column(ForeignKey("dataset_versions.id", ondelete="SET NULL"))
    # Исходные строки импорта — для трассировки происхождения данных.
    source_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    manufacturer: Mapped[Manufacturer | None] = relationship(back_populates="products")
    solution_type: Mapped[SolutionType | None] = relationship()
    dataset_version: Mapped["DatasetVersion | None"] = relationship()
    applications: Mapped[list["ProductApplication"]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )
    offers: Mapped[list["ProductOffer"]] = relationship(
        back_populates="product", cascade="all, delete-orphan", order_by="ProductOffer.id"
    )
    spec_values: Mapped[list["ProductSpecValue"]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )
    processes: Mapped[list["Process"]] = relationship(secondary=product_processes)
    sources: Mapped[list["DataSource"]] = relationship(secondary=product_sources)
    image: Mapped["ProductImage | None"] = relationship(
        back_populates="product", cascade="all, delete-orphan", passive_deletes=True
    )


class ProductImage(Base):
    """Фотография товара. Одна на товар; файлы лежат в UPLOAD_DIR/products/<id>.webp и <id>_thumb.webp.

    Идентификатор файла меняется при каждой замене, поэтому ссылка на изображение кэшируется навсегда.
    """

    __tablename__ = "product_images"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), unique=True)
    original_name: Mapped[str | None] = mapped_column(String(300))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    size_bytes: Mapped[int] = mapped_column(Integer)
    # An illustrative image depicts a similar class of equipment, not this exact model.
    is_illustration: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    caption: Mapped[str | None] = mapped_column(String(500))
    # Откуда фото: документ организатора, сайт производителя, загрузка вендора или администратора.
    source_id: Mapped[int | None] = mapped_column(ForeignKey("data_sources.id", ondelete="SET NULL"))
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    product: Mapped[Product] = relationship(back_populates="image")
    source: Mapped["DataSource | None"] = relationship()
    uploaded_by: Mapped["User | None"] = relationship()


class ProductApplication(Base):
    """Сценарий применения продукта в отрасли и реализованные кейсы.

    В каталоге организатора один продукт встречается в нескольких строках с разными
    отраслями и сценариями — каждая такая строка становится отдельным применением.
    """

    __tablename__ = "product_applications"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    industry_id: Mapped[int | None] = mapped_column(ForeignKey("industries.id", ondelete="SET NULL"), index=True)
    process_id: Mapped[int | None] = mapped_column(ForeignKey("processes.id", ondelete="SET NULL"))
    scenario: Mapped[str | None] = mapped_column(String(500))
    case_description: Mapped[str | None] = mapped_column(Text)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("data_sources.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    product: Mapped[Product] = relationship(back_populates="applications")
    industry: Mapped["Industry | None"] = relationship()


class ProductOffer(Base):
    """Коммерческое предложение: цена и модель приобретения.

    Дубли позиций в файле цен трактуются как альтернативные предложения (п. 6 дополнений к ТЗ);
    одно из них помечается как основное (is_default).
    """

    __tablename__ = "product_offers"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(300))
    acquisition_model: Mapped[AcquisitionModel] = mapped_column(
        str_enum(AcquisitionModel), default=AcquisitionModel.PURCHASE
    )
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    currency: Mapped[str] = mapped_column(String(3), default="RUB")
    price_includes_vat: Mapped[bool] = mapped_column(Boolean, default=True)
    equipment_price: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    software_price: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    implementation_price: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    annual_service_cost: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    # Для аренды / RaaS.
    monthly_fee: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    min_contract_months: Mapped[int | None] = mapped_column(Integer)
    # Прочие условия (выкуп, продление, плата за использование) — структура уточняется на этапе экономики.
    terms: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    included_services: Mapped[str | None] = mapped_column(Text)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("data_sources.id", ondelete="SET NULL"))
    valid_from: Mapped[date | None] = mapped_column(Date)
    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    product: Mapped[Product] = relationship(back_populates="offers")
    source: Mapped["DataSource | None"] = relationship()


class SpecDefinition(Base):
    """Определение технической/инфраструктурной характеристики (ТТХ)."""

    __tablename__ = "spec_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(300))
    group: Mapped[SpecGroup] = mapped_column(str_enum(SpecGroup))
    unit: Mapped[str | None] = mapped_column(String(50))
    data_type: Mapped[ValueDataType] = mapped_column(str_enum(ValueDataType))
    # Обязательные ТТХ из п. 3.3.7 ТЗ — по ним считается полнота карточки.
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=False)
    is_filterable: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProductSpecValue(Base):
    """Значение ТТХ продукта с происхождением: источник, дата получения, подтверждённость."""

    __tablename__ = "product_spec_values"
    __table_args__ = (UniqueConstraint("product_id", "spec_definition_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    spec_definition_id: Mapped[int] = mapped_column(
        ForeignKey("spec_definitions.id", ondelete="CASCADE"), index=True
    )
    value_numeric: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    # Верхняя граница для диапазонов (например, 80–100 паллет/ч, −40…+50 °C).
    value_numeric_max: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    value_text: Mapped[str | None] = mapped_column(Text)
    value_bool: Mapped[bool | None] = mapped_column(Boolean)
    # Единица значения, если отличается от единицы определения (например, производительность).
    unit: Mapped[str | None] = mapped_column(String(50))
    source_id: Mapped[int | None] = mapped_column(ForeignKey("data_sources.id", ondelete="SET NULL"))
    retrieved_at: Mapped[date | None] = mapped_column(Date)
    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    # Значение — допущение команды, а не данные производителя (п. 4 дополнений к ТЗ).
    is_assumption: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    product: Mapped[Product] = relationship(back_populates="spec_values")
    definition: Mapped[SpecDefinition] = relationship()
    source: Mapped["DataSource | None"] = relationship()
