from fastapi import APIRouter

# Корневой роутер версии API /api/v1. Модули роутов (каталог, проекты, расчёты и т. д.)
# подключаются здесь на следующих этапах: api_router.include_router(<module>.router).
api_router = APIRouter()
