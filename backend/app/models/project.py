"""Проекты пользователей, сценарии, состав оборудования и воспроизводимые запуски расчётов."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, str_enum
from app.models.enums import (
    CalculationStatus,
    CalculationType,
    ProjectFileKind,
    ProjectStatus,
    ScenarioKind,
)

if TYPE_CHECKING:
    from app.models.catalog import Product, ProductOffer
    from app.models.reference import FacilityType
    from app.models.user import User


class Project(Base):
    """Проект оценки роботизации конкретного объекта.

    Демо-проекты (is_demo) не имеют владельца и доступны гостям только для чтения;
    пользователь копирует демо-проект к себе (п. 2.1.1, 3.1.2 ТЗ).
    """

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    facility_type_id: Mapped[int] = mapped_column(ForeignKey("facility_types.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ProjectStatus] = mapped_column(str_enum(ProjectStatus), default=ProjectStatus.DRAFT)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    # Значения параметров объекта: {код параметра: значение}. Схема — parameter_definitions.
    parameters: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Происхождение значений: {код параметра: default | manual | file}.
    parameter_origins: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Демо-проект, из которого создана копия.
    copied_from_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped["User | None"] = relationship(back_populates="projects")
    facility_type: Mapped["FacilityType"] = relationship()
    scenarios: Mapped[list["Scenario"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True, order_by="Scenario.sort_order"
    )
    files: Mapped[list["ProjectFile"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    calculation_runs: Mapped[list["CalculationRun"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )


class ProjectFile(Base):
    """Загруженный файл проекта. Удаляется вместе с проектом (п. 4.4.6 ТЗ)."""

    __tablename__ = "project_files"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[ProjectFileKind] = mapped_column(str_enum(ProjectFileKind))
    original_name: Mapped[str] = mapped_column(String(300))
    stored_path: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[str | None] = mapped_column(String(200))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped[Project] = relationship(back_populates="files")


class Scenario(Base):
    """Сценарий проекта: базовый (без роботизации), покупка, RaaS и т. д. (п. 3.5.5 ТЗ)."""

    __tablename__ = "scenarios"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[ScenarioKind] = mapped_column(str_enum(ScenarioKind))
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Экономические допущения сценария (горизонт, ставка, условия RaaS, финансирование) — what-if.
    assumptions: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped[Project] = relationship(back_populates="scenarios")
    items: Mapped[list["ScenarioItem"]] = relationship(
        back_populates="scenario", cascade="all, delete-orphan", passive_deletes=True
    )
    overrides: Mapped[list["CalculationOverride"]] = relationship(
        back_populates="scenario", cascade="all, delete-orphan", passive_deletes=True
    )


class ScenarioItem(Base):
    """Позиция состава оборудования сценария."""

    __tablename__ = "scenario_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    scenario_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"), index=True)
    # RESTRICT: продукт, используемый в проектах, снимается с публикации, а не удаляется.
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    offer_id: Mapped[int | None] = mapped_column(ForeignKey("product_offers.id", ondelete="SET NULL"))
    process_id: Mapped[int | None] = mapped_column(ForeignKey("processes.id", ondelete="SET NULL"))
    quantity_calculated: Mapped[int | None] = mapped_column(Integer)
    quantity_manual: Mapped[int | None] = mapped_column(Integer)
    # Решение добавлено вручную вне автоматической подборки — показывается предупреждение (п. 3.4.4 ТЗ).
    is_manual_selection: Mapped[bool] = mapped_column(Boolean, default=False)
    warning: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    scenario: Mapped[Scenario] = relationship(back_populates="items")
    product: Mapped["Product"] = relationship()
    offer: Mapped["ProductOffer | None"] = relationship()


class CalculationRun(Base):
    """Запуск расчёта (подбор, экономика, имитация) со снимком входных данных.

    Хранит версию расчётной модели и версию набора данных — расчёт можно воспроизвести (п. 3.1.5 ТЗ).
    """

    __tablename__ = "calculation_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    scenario_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("scenarios.id", ondelete="SET NULL"))
    calc_type: Mapped[CalculationType] = mapped_column(str_enum(CalculationType))
    status: Mapped[CalculationStatus] = mapped_column(
        str_enum(CalculationStatus), default=CalculationStatus.PENDING
    )
    model_version: Mapped[str] = mapped_column(String(32))
    catalog_dataset_version_id: Mapped[int | None] = mapped_column(
        ForeignKey("dataset_versions.id", ondelete="SET NULL")
    )
    inputs_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    normatives_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    results: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    project: Mapped[Project] = relationship(back_populates="calculation_runs")


class CalculationOverride(Base):
    """Ручная корректировка автоматически рассчитанного значения с фиксацией изменения (п. 3.5.4 ТЗ)."""

    __tablename__ = "calculation_overrides"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    scenario_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(200))  # например, "items.<id>.quantity" или "capex.integration"
    calculated_value: Mapped[Any | None] = mapped_column(JSONB)
    manual_value: Mapped[Any | None] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    scenario: Mapped[Scenario] = relationship(back_populates="overrides")
