from fastapi import APIRouter

from app.schemas.economics import EconomicsInput, EconomicsResponse
from app.services.economics import calculate

router = APIRouter(prefix="/economics", tags=["Экономическая оценка"])


@router.post("/calculate", response_model=EconomicsResponse, summary="CAPEX, OPEX, TCO, окупаемость и ROI")
async def calculate_economics(data: EconomicsInput) -> EconomicsResponse:
    """Расчёт доступен гостям. Возвращает снимок входов, формулы и годовые потоки без сохранения проекта."""
    return calculate(data)
