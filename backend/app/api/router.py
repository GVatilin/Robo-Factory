from fastapi import APIRouter

from app.api.routes import auth, catalog, manufacturers, product_images, products, reference, users
from app.api.routes import economics
from app.api.routes import projects
from app.api.routes import project_selection
from app.api.routes import simulation
from app.api.routes import catalog_documents
from app.api.routes import catalog_updates

# Корневой роутер версии API /api/v1. Новые модули подключаются здесь: api_router.include_router(<module>.router).
api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(reference.router)
api_router.include_router(catalog.router)
api_router.include_router(manufacturers.router)
api_router.include_router(products.router)
api_router.include_router(product_images.router)
api_router.include_router(economics.router)
api_router.include_router(projects.router)
api_router.include_router(project_selection.router)
api_router.include_router(simulation.router)
api_router.include_router(catalog_documents.router)
api_router.include_router(catalog_updates.router)
