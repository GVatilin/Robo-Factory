from typing import Annotated, Literal
import re

from fastapi import APIRouter, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import distinct, func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession, OptionalUser, require_any
from app.api.errors import ApiValidationError, FieldError
from app.core.permissions import (
    Permission,
    can_manage_manufacturer,
    can_manage_product,
    has_permission,
    sees_unpublished,
)
from app.models import Manufacturer, Product, SolutionType, User
from app.schemas.common import Page
from app.schemas.manufacturers import ManufacturerIn, ManufacturerOut, ManufacturerSummary
from app.services.catalog_scope import russian_country, russian_product, require_russian
from app.services import audit
from app.services.manufacturer_logos import LOGO_DIR, logo_url
from app.services.catalog_view import mandatory_specs, product_summary
from app.services.products import PRODUCT_SUMMARY_OPTIONS
from app.utils.text import like_pattern

router = APIRouter(prefix="/manufacturers", tags=["Каталог: производители"])

_published = func.count(distinct(Product.id)).filter(Product.is_published.is_(True), russian_country(Product.country_of_origin))
_pending = func.count(distinct(Product.id)).filter(Product.is_published.is_(False), russian_country(Product.country_of_origin))
_type_names = func.array_agg(distinct(SolutionType.name)).filter(Product.is_published.is_(True), russian_country(Product.country_of_origin))


def _stats_query():
    return (
        select(Manufacturer, _published.label("published"), _pending.label("pending"), _type_names.label("types"))
        .outerjoin(Product, Product.manufacturer_id == Manufacturer.id)
        .outerjoin(SolutionType, SolutionType.id == Product.solution_type_id)
        .where(russian_country(Manufacturer.country))
        .group_by(Manufacturer.id)
    )


def _summary(manufacturer: Manufacturer, published: int, pending: int, types: list[str] | None, user: User | None) -> dict:
    own = sees_unpublished(user, manufacturer.id)
    return {
        "id": manufacturer.id,
        "name": manufacturer.name,
        "country": manufacturer.country,
        "region": manufacturer.region,
        "website": manufacturer.website,
        "description": manufacturer.description,
        "logo_url": logo_url(manufacturer),
        "logo_source_url": (manufacturer.logo_metadata or {}).get("source_url"),
        "logo_original_url": (manufacturer.logo_metadata or {}).get("original_url"),
        "logo_retrieved_at": (manufacturer.logo_metadata or {}).get("retrieved_at"),
        "logo_note": (manufacturer.logo_metadata or {}).get("note"),
        "product_count": published + pending if own else published,
        "pending_count": pending if own else 0,
        "solution_types": sorted(t for t in (types or []) if t),
        "updated_at": manufacturer.updated_at,
    }


async def _name_taken(db: DbSession, name: str, exclude_id: int | None = None) -> bool:
    stmt = select(Manufacturer.id).where(func.lower(Manufacturer.name) == name.lower())
    if exclude_id is not None:
        stmt = stmt.where(Manufacturer.id != exclude_id)
    return await db.scalar(stmt) is not None


_NAME_TAKEN = FieldError("name", "Производитель с таким названием уже есть в каталоге.")


@router.get("/logos/{filename}", summary="Логотип производителя")
async def company_logo(filename: str):
    if not re.fullmatch(r"[0-9a-f]{64}\.webp", filename):
        raise HTTPException(404, "Логотип не найден.")
    path = LOGO_DIR / filename
    if not path.is_file():
        raise HTTPException(404, "Логотип не найден.")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})


@router.get("", response_model=Page[ManufacturerSummary], summary="Производители")
async def list_manufacturers(
    db: DbSession,
    user: OptionalUser,
    q: Annotated[str | None, Query(description="Поиск по названию и региону")] = None,
    sort: Literal["name", "products", "updated"] = "name",
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ManufacturerSummary]:
    stmt = _stats_query()
    if q:
        pattern = like_pattern(q)
        stmt = stmt.where(Manufacturer.name.ilike(pattern) | Manufacturer.region.ilike(pattern))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {
        "name": (Manufacturer.name,),
        "products": (_published.desc(), Manufacturer.name),
        "updated": (Manufacturer.updated_at.desc(), Manufacturer.name),
    }[sort]
    rows = (await db.execute(stmt.order_by(*order).limit(limit).offset(offset))).all()
    items = [ManufacturerSummary(**_summary(m, published, pending, types, user)) for m, published, pending, types in rows]
    return Page(items=items, total=total, limit=limit, offset=offset)


async def _detail(db: DbSession, manufacturer_id: int, user: User | None) -> ManufacturerOut:
    # populate_existing: после изменения карточки в той же сессии нужны свежие значения (updated_at).
    stmt = _stats_query().where(Manufacturer.id == manufacturer_id).execution_options(populate_existing=True)
    row = (await db.execute(stmt)).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Производитель не найден.")
    manufacturer, published, pending, types = row
    stmt = select(Product).where(Product.manufacturer_id == manufacturer.id, russian_product())
    if not sees_unpublished(user, manufacturer.id):
        stmt = stmt.where(Product.is_published.is_(True))
    products = (
        await db.scalars(stmt.options(*PRODUCT_SUMMARY_OPTIONS).order_by(Product.is_published, Product.name))
    ).all()
    mandatory = await mandatory_specs(db)
    return ManufacturerOut(
        **_summary(manufacturer, published, pending, types, user),
        contact_email=manufacturer.contact_email,
        phone=manufacturer.phone,
        created_at=manufacturer.created_at,
        can_edit=can_manage_manufacturer(user, manufacturer.id),
        can_add_products=can_manage_product(user, manufacturer.id),
        can_delete=user is not None and has_permission(user.role, Permission.MANUFACTURERS_MANAGE),
        products=[product_summary(p, mandatory) for p in products],
    )


@router.get("/{manufacturer_id}", response_model=ManufacturerOut, summary="Производитель и все его решения")
async def get_manufacturer(manufacturer_id: int, db: DbSession, user: OptionalUser) -> ManufacturerOut:
    return await _detail(db, manufacturer_id, user)


@router.post(
    "",
    response_model=ManufacturerOut,
    status_code=status.HTTP_201_CREATED,
    summary="Добавить производителя",
)
async def create_manufacturer(
    data: ManufacturerIn,
    db: DbSession,
    user: Annotated[User, require_any(Permission.MANUFACTURERS_CREATE)],
) -> ManufacturerOut:
    require_russian(data.country)
    if await _name_taken(db, data.name):
        raise ApiValidationError([_NAME_TAKEN])
    manufacturer = Manufacturer(**data.model_dump())
    db.add(manufacturer)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise ApiValidationError([_NAME_TAKEN]) from exc
    audit.record(db, user, "manufacturer", manufacturer.id, "create", {"name": manufacturer.name})
    await db.commit()
    return await _detail(db, manufacturer.id, user)


@router.put("/{manufacturer_id}", response_model=ManufacturerOut, summary="Изменить производителя")
async def update_manufacturer(
    manufacturer_id: int, data: ManufacturerIn, db: DbSession, user: CurrentUser
) -> ManufacturerOut:
    """Администратор меняет любого производителя, вендор — только своего."""
    manufacturer = await db.get(Manufacturer, manufacturer_id)
    if manufacturer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Производитель не найден.")
    if not can_manage_manufacturer(user, manufacturer.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Изменять карточку может администратор или вендор этой компании.")
    require_russian(data.country)
    if await _name_taken(db, data.name, exclude_id=manufacturer.id):
        raise ApiValidationError([_NAME_TAKEN])
    values = data.model_dump()
    changed = [key for key, value in values.items() if getattr(manufacturer, key) != value]
    for key, value in values.items():
        setattr(manufacturer, key, value)
    audit.record(db, user, "manufacturer", manufacturer.id, "update", {"fields": changed})
    await db.commit()
    return await _detail(db, manufacturer.id, user)


@router.delete("/{manufacturer_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить производителя")
async def delete_manufacturer(
    manufacturer_id: int,
    db: DbSession,
    user: Annotated[User, require_any(Permission.MANUFACTURERS_MANAGE)],
) -> Response:
    """Удаляется только производитель без товаров: каждый товар каталога привязан к производителю."""
    manufacturer = await db.get(Manufacturer, manufacturer_id)
    if manufacturer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Производитель не найден.")
    products = await db.scalar(select(func.count(Product.id)).where(Product.manufacturer_id == manufacturer.id)) or 0
    if products:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"У производителя {products} товар(ов). Удалите их или перенесите к другому производителю.",
        )
    audit.record(db, user, "manufacturer", manufacturer.id, "delete", {"name": manufacturer.name})
    await db.delete(manufacturer)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
