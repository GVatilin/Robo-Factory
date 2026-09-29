from datetime import date
from fastapi import APIRouter, Response, Query
from sqlalchemy import select, or_
from sqlalchemy.orm import selectinload
from app.api.deps import DbSession
from app.models import Normative
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.economics import EconomicsInput, EconomicsResponse
from app.services.economics import calculate
from app.services.economics_reports import sensitivity, workbook_report

router = APIRouter(prefix="/economics", tags=["Экономическая оценка"])


@router.get("/defaults")
async def economics_defaults(db: DbSession, facility_type_id: int | None = Query(default=None, gt=0)):
    from app.services.economics_defaults import default_profile
    refs = (await db.scalars(select(Normative).options(selectinload(Normative.source)).where(
        Normative.is_active.is_(True),
        or_(Normative.valid_from.is_(None), Normative.valid_from <= date.today()),
        or_(Normative.facility_type_id.is_(None), Normative.facility_type_id == facility_type_id),
    ).order_by(Normative.facility_type_id.nullsfirst(), Normative.id))).all()
    return default_profile([{"code": r.code, "value": float(r.value), "source":
        f"Справочник: {r.name} ({r.code}), значение {r.value} {r.unit or ''}. "
        f"{'Допущение' if r.is_assumption else 'Норматив'}. "
        f"Источник: {r.source.title if r.source else 'не указан'}; {r.source.url or '' if r.source else ''}. "
        f"Обновлено: {r.updated_at.isoformat()}. {r.description or ''}"} for r in refs])


@router.post("/calculate", response_model=EconomicsResponse, summary="CAPEX, OPEX, TCO, окупаемость и ROI")
async def calculate_economics(data: EconomicsInput) -> EconomicsResponse:
    """Расчёт доступен гостям. Возвращает снимок входов, формулы и годовые потоки без сохранения проекта."""
    return calculate(data)


class SensitivityInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    inputs: EconomicsInput
    spread_percent: float = Field(default=20, gt=0, le=50)


class PdfAdvice(BaseModel):
    recommendation: str = Field(max_length=10000)
    alternatives: list[str] = Field(default_factory=list, max_length=12)
    risks: list[str] = Field(default_factory=list, max_length=20)
    missing_data: list[str] = Field(default_factory=list, max_length=20)
    model: str = Field(default="", max_length=100)


class PdfInput(SensitivityInput):
    title: str = Field(default="Экономика роботизации", max_length=300)
    recommendation: PdfAdvice | None = None


@router.post("/export.pdf")
def export_pdf(data: PdfInput):
    from app.services.economics_pdf import pdf_report
    result = calculate(data.inputs).model_dump(mode="json")
    content = pdf_report(result, sensitivity(data.inputs, data.spread_percent), title=data.title,
                         recommendation=data.recommendation.model_dump() if data.recommendation else None)
    return Response(content, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="robo-factory-economics.pdf"'})


@router.post("/sensitivity")
def analyze_sensitivity(data: SensitivityInput):
    return sensitivity(data.inputs, data.spread_percent)


@router.post("/export.xlsx")
def export_economics(data: SensitivityInput):
    result = calculate(data.inputs).model_dump(mode="json")
    return Response(workbook_report(result, sensitivity(data.inputs, data.spread_percent)),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="robot-economics.xlsx"'})
