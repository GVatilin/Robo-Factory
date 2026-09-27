import uuid

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from app.services.product_images import image_path

router = APIRouter(prefix="/product-images", tags=["Каталог: товары"])

# Идентификатор файла меняется при каждой замене фото: ответ можно кэшировать навсегда.
CACHE_FOREVER = {"Cache-Control": "public, max-age=31536000, immutable"}
WEBP = {200: {"content": {"image/webp": {}}, "description": "Изображение WebP"}}


def _file(image_id: uuid.UUID, *, thumb: bool) -> FileResponse:
    path = image_path(image_id, thumb=thumb)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Фотография не найдена.")
    return FileResponse(path, media_type="image/webp", headers=CACHE_FOREVER)


@router.get("/{image_id}", response_class=FileResponse, responses=WEBP, summary="Фотография товара")
async def image(image_id: uuid.UUID) -> FileResponse:
    """Ссылку отдаёт карточка товара с учётом прав: адрес содержит случайный идентификатор, его нельзя подобрать.
    Поэтому изображение открывается и в теге <img>, который не передаёт токен авторизации."""
    return _file(image_id, thumb=False)


@router.get("/{image_id}/thumb", response_class=FileResponse, responses=WEBP, summary="Превью фотографии")
async def thumbnail(image_id: uuid.UUID) -> FileResponse:
    return _file(image_id, thumb=True)
