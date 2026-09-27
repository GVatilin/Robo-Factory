from fastapi import APIRouter

from app.api.routes import auth, catalog, manufacturers, product_images, products, reference, users

# Корневой роутер версии API /api/v1. Новые модули подключаются здесь: api_router.include_router(<module>.router).
api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(reference.router)
api_router.include_router(catalog.router)
api_router.include_router(manufacturers.router)
api_router.include_router(products.router)
api_router.include_router(product_images.router)
