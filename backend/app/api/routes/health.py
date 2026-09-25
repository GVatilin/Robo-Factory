from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import DbSession
from app.core.config import settings

router = APIRouter(tags=["Служебное"])


@router.get("/health", summary="Проверка состояния сервиса и БД")
async def health(db: DbSession) -> dict[str, str | None]:
    try:
        await db.execute(text("SELECT 1"))
        revision = await db.scalar(text("SELECT version_num FROM alembic_version LIMIT 1"))
        database = "ok"
    except SQLAlchemyError:
        revision, database = None, "unavailable"
    return {
        "status": "ok" if database == "ok" else "degraded",
        "database": database,
        "migration": revision,
        "version": settings.app_version,
        "calc_model_version": settings.calc_model_version,
    }
