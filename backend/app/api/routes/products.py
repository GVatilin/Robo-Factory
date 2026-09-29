import uuid
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from app.api.deps import CatalogEditor, DbSession, OptionalUser, require_any
from app.api.errors import ApiValidationError, FieldError
from app.core.config import settings
from app.core.permissions import Permission, can_manage_product, has_permission, sees_unpublished
from app.models import Product, ProductImage, SpecDefinition, User
from app.models.enums import AcquisitionModel, ProductClass, ReadinessStatus
from app.schemas.catalog import CatalogFacets, CatalogItem, CatalogPage
from app.schemas.products import ProductIn, ProductOut, PublicationIn
from app.services import audit
from app.services.catalog_query import (
    CatalogFilters,
    Sort,
    apply,
    load_entries,
    load_hierarchy,
    parse_spec_filters,
    predicates,
    sort_entries,
    unknown_specs,
)
from app.services.catalog_query import facets as build_facets
from app.services.catalog_view import mandatory_specs, product_detail
from app.services.product_images import ImageError, decode_upload, remove_files, write_files
from app.services.products import SCALAR_FIELDS, load_product, resolve_source, save_product

router = APIRouter(prefix="/products", tags=["Каталог: товары"])

_FORBIDDEN_OWN = "Вендор может добавлять и изменять товары только своего производителя."


async def _get_visible(db: DbSession, product_id: int, user: User | None) -> Product:
    product = await load_product(db, product_id)
    if product is None or (not product.is_published and not sees_unpublished(user, product.manufacturer_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Товар не найден или ещё не опубликован.")
    return product


@router.get("", response_model=CatalogPage, summary="Каталог решений: поиск, фильтры, сортировка")
async def list_products(
    db: DbSession,
    user: OptionalUser,
    q: Annotated[str | None, Query(description="Поиск по названию, производителю, типу и описанию")] = None,
    manufacturer_id: int | None = None,
    industry_id: Annotated[int | None, Query(description="Узел иерархии: отрасль")] = None,
    facility_type_id: Annotated[int | None, Query(description="Узел иерархии: тип объекта")] = None,
    process_id: Annotated[int | None, Query(description="Узел иерархии: процесс")] = None,
    other_in_industry: Annotated[bool, Query(description="Решения отрасли вне её описанных объектов")] = False,
    solution_type_id: Annotated[int | None, Query(description="Тип решения или категория")] = None,
    product_class: Annotated[list[ProductClass] | None, Query()] = None,
    readiness_status: Annotated[list[ReadinessStatus] | None, Query()] = None,
    country: Annotated[list[str] | None, Query(description="Страна происхождения")] = None,
    acquisition_model: Annotated[list[AcquisitionModel] | None, Query()] = None,
    price_max: Annotated[float | None, Query(ge=0, description="Стоимость оборудования не выше, ₽")] = None,
    has_image: bool = False,
    has_cases: Annotated[bool, Query(description="Есть реализованные кейсы")] = False,
    min_completeness: Annotated[int | None, Query(ge=0, le=100, description="Полнота карточки не ниже, %")] = None,
    spec: Annotated[
        list[str] | None,
        Query(description="Фильтры ТТХ: payload_kg>=500, width_mm<=900, navigation_type~slam, elevator_integration=true"),
    ] = None,
    with_unknown: Annotated[bool, Query(description="Оставлять товары без данных по фильтру ТТХ")] = False,
    confirmed_only: Annotated[bool, Query(description="Фильтр ТТХ только по подтверждённым значениям")] = False,
    published: Annotated[bool | None, Query(description="Только для тех, кто видит неопубликованные")] = None,
    sort: Sort = "name",
    facets: Annotated[bool, Query(description="Добавить счётчики фасетов")] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> CatalogPage:
    """Фильтры сгруппированы по таблице п. 3.3.7 ТЗ. По ТТХ без данных товар исключается, а с `with_unknown`
    остаётся и получает список `unknown` — решение требует проверки (п. 3.4.3 ТЗ)."""
    hierarchy = await load_hierarchy(db)
    mandatory = await mandatory_specs(db)
    definitions = (await db.scalars(select(SpecDefinition))).all()
    filters = CatalogFilters(
        q=(q or "").strip() or None, manufacturer_id=manufacturer_id, industry_id=industry_id,
        facility_type_id=facility_type_id, process_id=process_id, other_in_industry=other_in_industry,
        solution_type_id=solution_type_id, product_classes=list(product_class or []),
        readiness_statuses=list(readiness_status or []), countries=list(country or []),
        acquisition_models=list(acquisition_model or []), price_max=price_max, has_image=has_image,
        has_cases=has_cases, min_completeness=min_completeness, specs=parse_spec_filters(spec or [], definitions),
        with_unknown=with_unknown, confirmed_only=confirmed_only, published=published,
    )
    entries = await load_entries(db, user, hierarchy, mandatory)
    checks = predicates(filters, hierarchy)
    matched = sort_entries(apply(entries, checks), sort)
    page = matched[offset : offset + limit]
    return CatalogPage(
        items=[CatalogItem(**e.summary.model_dump(), unknown=unknown_specs(e, filters)) for e in page],
        total=len(matched),
        limit=limit,
        offset=offset,
        facets=CatalogFacets(**build_facets(entries, checks, hierarchy)) if facets else None,
    )


@router.get("/{product_id}", response_model=ProductOut, summary="Карточка товара")
async def get_product(product_id: int, db: DbSession, user: OptionalUser) -> ProductOut:
    product = await _get_visible(db, product_id, user)
    return product_detail(product, await mandatory_specs(db), user)


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED, summary="Добавить товар")
async def create_product(data: ProductIn, db: DbSession, user: CatalogEditor) -> ProductOut:
    """Администратор добавляет товар любому производителю и сразу публикует его.
    Товар вендора создаётся неопубликованным и появляется в каталоге после проверки администратором."""
    if not can_manage_product(user, data.manufacturer_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, _FORBIDDEN_OWN)
    publisher = has_permission(user.role, Permission.PRODUCTS_PUBLISH)
    is_published = (data.is_published if data.is_published is not None else True) if publisher else False
    product = await save_product(db, data, user, is_published=is_published)
    audit.record(db, user, "product", product.id, "create", {"name": product.name, "is_published": is_published})
    await db.commit()
    return await get_product(product.id, db, user)


@router.put("/{product_id}", response_model=ProductOut, summary="Изменить товар")
async def update_product(product_id: int, data: ProductIn, db: DbSession, user: CatalogEditor) -> ProductOut:
    """Карточка заменяется целиком. Предложения и кейсы с id обновляются, без id — создаются, отсутствующие — удаляются.
    Изменения вендора снимают товар с публикации до повторной проверки."""
    product = await _get_visible(db, product_id, user)
    if not can_manage_product(user, product.manufacturer_id) or not can_manage_product(user, data.manufacturer_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, _FORBIDDEN_OWN)
    if has_permission(user.role, Permission.PRODUCTS_PUBLISH):
        is_published = data.is_published if data.is_published is not None else product.is_published
    else:
        is_published = False
    before = {key: str(getattr(product, key)) for key in SCALAR_FIELDS}
    await save_product(db, data, user, product=product, is_published=is_published)
    changed = [key for key in SCALAR_FIELDS if str(getattr(product, key)) != before[key]]
    audit.record(db, user, "product", product.id, "update", {"fields": changed, "is_published": is_published})
    await db.commit()
    return await get_product(product.id, db, user)


@router.patch("/{product_id}/publication", response_model=ProductOut, summary="Опубликовать или снять с публикации")
async def set_publication(
    product_id: int,
    data: PublicationIn,
    db: DbSession,
    user: Annotated[User, require_any(Permission.PRODUCTS_PUBLISH)],
) -> ProductOut:
    """Проверка карточки вендора администратором: публикация делает товар видимым всем и доступным для подбора."""
    product = await _get_visible(db, product_id, user)
    product.is_published = data.is_published
    audit.record(db, user, "product", product.id, "publish" if data.is_published else "unpublish", {})
    await db.commit()
    return await get_product(product.id, db, user)


async def _editable(db: DbSession, product_id: int, user: User) -> Product:
    product = await _get_visible(db, product_id, user)
    if not can_manage_product(user, product.manufacturer_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, _FORBIDDEN_OWN)
    return product


def _store_upload(content: bytes, image_id: uuid.UUID) -> tuple[int, int, int]:
    return write_files(decode_upload(content), image_id)


@router.put("/{product_id}/image", response_model=ProductOut, summary="Загрузить фотографию товара")
async def upload_image(
    product_id: int,
    db: DbSession,
    user: CatalogEditor,
    file: Annotated[UploadFile, File(description="JPEG, PNG или WebP, до 10 МБ")],
) -> ProductOut:
    """Заменяет фотографию товара. Файл перекодируется в WebP без EXIF, большие снимки уменьшаются до 1600 px,
    рядом сохраняется превью. Фото от вендора снимает товар с публикации до проверки, как и другие изменения."""
    product = await _editable(db, product_id, user)
    content = await file.read(settings.max_image_mb * 1024 * 1024 + 1)
    image_id = uuid.uuid4()
    try:
        width, height, size = await run_in_threadpool(_store_upload, content, image_id)
    except ImageError as exc:
        raise ApiValidationError([FieldError("file", str(exc))]) from exc

    previous = product.image.id if product.image else None
    try:
        if product.image is not None:
            # Старая запись удаляется до вставки новой: у товара одна фотография.
            await db.delete(product.image)
            await db.flush()
        source = await resolve_source(db, None, user, product.manufacturer)
        db.add(
            ProductImage(
                id=image_id,
                product_id=product.id,
                original_name=(file.filename or "")[:300] or None,
                width=width,
                height=height,
                size_bytes=size,
                source_id=source.id,
                uploaded_by_id=user.id,
            )
        )
        if source not in product.sources:
            product.sources.append(source)
        payload = dict(product.source_payload or {})
        payload.pop("manual_image_deleted", None)
        product.source_payload = payload
        if not has_permission(user.role, Permission.PRODUCTS_PUBLISH):
            product.is_published = False
        audit.record(db, user, "product", product.id, "image_upload", {"image_id": str(image_id), "file": file.filename})
        await db.commit()
    except BaseException:
        remove_files(image_id)
        raise
    if previous:
        remove_files(previous)
    return await get_product(product.id, db, user)


@router.delete("/{product_id}/image", response_model=ProductOut, summary="Удалить фотографию товара")
async def delete_image(product_id: int, db: DbSession, user: CatalogEditor) -> ProductOut:
    product = await _editable(db, product_id, user)
    if product.image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "У товара нет фотографии.")
    image_id = product.image.id
    await db.delete(product.image)
    product.source_payload = {**(product.source_payload or {}), "manual_image_deleted": True}
    if not has_permission(user.role, Permission.PRODUCTS_PUBLISH):
        product.is_published = False
    audit.record(db, user, "product", product.id, "image_delete", {"image_id": str(image_id)})
    await db.commit()
    remove_files(image_id)
    return await get_product(product.id, db, user)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить товар")
async def delete_product(product_id: int, db: DbSession, user: CatalogEditor) -> Response:
    """Вместе с товаром удаляются его характеристики, предложения и файлы фотографии."""
    product = await _editable(db, product_id, user)
    image_id = product.image.id if product.image else None
    audit.record(db, user, "product", product.id, "delete", {"name": product.name})
    await db.delete(product)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Товар используется в сценариях проектов. Снимите его с публикации вместо удаления.",
        ) from exc
    if image_id:
        remove_files(image_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
