from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import install_error_handlers
from app.api.router import api_router
from app.api.routes import health
from app.core.config import settings
from app.db.session import engine

DESCRIPTION = """
API платформы подбора роботизированных решений с расчётом экономического эффекта
и визуализацией работы роботов на объекте.

Роли: гость (без токена), пользователь, вендор, администратор — матрица прав в `GET /api/v1/auth/roles`.
Для запросов от имени пользователя нажмите **Authorize** и войдите по e-mail и паролю.
Ошибки проверки данных возвращаются с кодом 422 в формате `{"detail": "...", "errors": [{"field", "message"}]}`.
"""


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    yield
    await engine.dispose()


app = FastAPI(
    title=f"{settings.app_name} API",
    version=settings.app_version,
    description=DESCRIPTION,
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

install_error_handlers(app)

app.include_router(health.router, prefix="/api")
app.include_router(api_router, prefix="/api/v1")
