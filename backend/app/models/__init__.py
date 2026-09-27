"""Все модели импортируются здесь, чтобы Alembic видел полную схему в Base.metadata."""

from app.models.audit import AuditLog
from app.models.catalog import (
    Manufacturer,
    Product,
    ProductApplication,
    ProductImage,
    ProductOffer,
    ProductSpecValue,
    SolutionType,
    SpecDefinition,
    process_solution_types,
    product_processes,
    product_sources,
)
from app.models.project import (
    CalculationOverride,
    CalculationRun,
    Project,
    ProjectFile,
    Scenario,
    ScenarioItem,
)
from app.models.reference import FacilityType, Industry, Normative, ParameterDefinition, Process
from app.models.sources import DatasetVersion, DataSource
from app.models.user import User

__all__ = [
    "AuditLog",
    "CalculationOverride",
    "CalculationRun",
    "DataSource",
    "DatasetVersion",
    "FacilityType",
    "Industry",
    "Manufacturer",
    "Normative",
    "ParameterDefinition",
    "Process",
    "Product",
    "ProductApplication",
    "ProductImage",
    "ProductOffer",
    "ProductSpecValue",
    "Project",
    "ProjectFile",
    "Scenario",
    "ScenarioItem",
    "SolutionType",
    "SpecDefinition",
    "User",
    "process_solution_types",
    "product_processes",
    "product_sources",
]
