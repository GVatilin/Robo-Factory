from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.economics import EconomicsInput, EconomicsResponse
from app.services.economics import calculate
from app.services.economics_reports import sensitivity, workbook_report

router = APIRouter(prefix="/economics", tags=["Экономическая оценка"])


@router.post("/calculate", response_model=EconomicsResponse, summary="CAPEX, OPEX, TCO, окупаемость и ROI")
async def calculate_economics(data: EconomicsInput) -> EconomicsResponse:
    """Расчёт доступен гостям. Возвращает снимок входов, формулы и годовые потоки без сохранения проекта."""
    return calculate(data)


class SensitivityInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    inputs: EconomicsInput
    spread_percent: float = Field(default=20, gt=0, le=50)


@router.post("/sensitivity")
def analyze_sensitivity(data: SensitivityInput):
    return sensitivity(data.inputs, data.spread_percent)


@router.post("/export.xlsx")
def export_economics(data: SensitivityInput):
    result = calculate(data.inputs).model_dump(mode="json")
    return Response(workbook_report(result, sensitivity(data.inputs, data.spread_percent)),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="robot-economics.xlsx"'})
