"""Справочники: отрасль → тип объекта → процесс, параметры объектов и расчётные нормативы.

Все справочники расширяемы данными, без изменения кода ядра (п. 3.2.6, 4.2.6 ТЗ).
"""

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, str_enum
from app.models.enums import ValueDataType

if TYPE_CHECKING:
    from app.models.catalog import SolutionType
    from app.models.sources import DataSource


class Industry(Base):
    __tablename__ = "industries"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    facility_types: Mapped[list["FacilityType"]] = relationship(back_populates="industry")


class FacilityType(Base):
    """Тип объекта: склад, аэропорт, медицинское учреждение и т. д."""

    __tablename__ = "facility_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    industry_id: Mapped[int] = mapped_column(ForeignKey("industries.id", ondelete="RESTRICT"), index=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(64))
    # Шаблон 2D/3D-схемы объекта для визуализации.
    layout_template: Mapped[str | None] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    industry: Mapped[Industry] = relationship(back_populates="facility_types")
    processes: Mapped[list["Process"]] = relationship(
        back_populates="facility_type", order_by="Process.sort_order", cascade="all, delete-orphan"
    )
    parameter_definitions: Mapped[list["ParameterDefinition"]] = relationship(
        back_populates="facility_type", order_by="ParameterDefinition.sort_order", cascade="all, delete-orphan"
    )


class Process(Base):
    """Процесс на объекте, который можно роботизировать (приёмка, отбор, доставка питания...)."""

    __tablename__ = "processes"
    __table_args__ = (UniqueConstraint("facility_type_id", "code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    facility_type_id: Mapped[int] = mapped_column(ForeignKey("facility_types.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    # Коды параметров объекта, определяющих объём операций процесса (для расчёта потребности).
    driver_parameters: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    facility_type: Mapped[FacilityType] = relationship(back_populates="processes")
    solution_types: Mapped[list["SolutionType"]] = relationship(
        secondary="process_solution_types", back_populates="processes"
    )


class ParameterDefinition(Base):
    """Описание входного параметра объекта: единицы, тип, диапазон, значение по умолчанию и источник."""

    __tablename__ = "parameter_definitions"
    __table_args__ = (UniqueConstraint("facility_type_id", "code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    facility_type_id: Mapped[int] = mapped_column(ForeignKey("facility_types.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(300))
    section: Mapped[str | None] = mapped_column(String(200))
    unit: Mapped[str | None] = mapped_column(String(50))
    data_type: Mapped[ValueDataType] = mapped_column(str_enum(ValueDataType))
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    default_value: Mapped[Any | None] = mapped_column(JSONB)
    min_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    max_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    allowed_values: Mapped[list[Any] | None] = mapped_column(JSONB)
    hint: Mapped[str | None] = mapped_column(Text)
    example: Mapped[str | None] = mapped_column(String(200))
    source_id: Mapped[int | None] = mapped_column(ForeignKey("data_sources.id", ondelete="SET NULL"))
    source_note: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    facility_type: Mapped[FacilityType] = relationship(back_populates="parameter_definitions")
    source: Mapped["DataSource | None"] = relationship()


class Normative(Base):
    """Расчётный норматив/коэффициент. Недокументированные коэффициенты запрещены (п. 3.5.1 ТЗ),
    поэтому каждый норматив хранит описание и источник."""

    __tablename__ = "normatives"
    __table_args__ = (UniqueConstraint("code", "facility_type_id", postgresql_nulls_not_distinct=True),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(64))
    value: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    unit: Mapped[str | None] = mapped_column(String(50))
    # NULL — норматив действует для всех типов объектов.
    facility_type_id: Mapped[int | None] = mapped_column(ForeignKey("facility_types.id", ondelete="CASCADE"))
    description: Mapped[str | None] = mapped_column(Text)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("data_sources.id", ondelete="SET NULL"))
    is_assumption: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    valid_from: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    facility_type: Mapped[FacilityType | None] = relationship()
    source: Mapped["DataSource | None"] = relationship()
