"""Сборка ответов API каталога из моделей: вычисляемые поля карточек (цена от, ключевые ТТХ, полнота)."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import Permission, can_manage_product, has_permission
from app.models import Product, ProductImage, SolutionType, SpecDefinition, User
from app.schemas.common import Ref
from app.schemas.products import (
    ApplicationOut,
    Completeness,
    Dimensions,
    ImageOut,
    OfferOut,
    ProcessOut,
    ProductOut,
    ProductSummary,
    SolutionTypeRef,
    SourceOut,
    SpecValueOut,
)
from app.services.completeness import evaluate, not_applicable


async def mandatory_specs(session: AsyncSession) -> list[SpecDefinition]:
    return list(
        (
            await session.scalars(
                select(SpecDefinition).where(SpecDefinition.is_mandatory.is_(True)).order_by(SpecDefinition.sort_order)
            )
        ).all()
    )


def solution_type_ref(node: SolutionType | None) -> SolutionTypeRef | None:
    if node is None:
        return None
    category = SolutionTypeRef(id=node.parent.id, code=node.parent.code, name=node.parent.name) if node.parent else None
    return SolutionTypeRef(id=node.id, code=node.code, name=node.name, category=category)


def image_url(image: ProductImage, *, thumb: bool = False) -> str:
    return f"/api/v1/product-images/{image.id}{'/thumb' if thumb else ''}"


def _summary_fields(product: Product, mandatory: Sequence[SpecDefinition]) -> dict:
    numeric = {v.definition.code: v.value_numeric for v in product.spec_values}

    def spec(code: str) -> float | None:
        value = numeric.get(code)
        return float(value) if value is not None else None

    prices = [o.equipment_price for o in product.offers if o.equipment_price is not None]
    fees = [o.monthly_fee for o in product.offers if o.monthly_fee is not None]
    filled, total, _ = evaluate(product, mandatory)
    return {
        "id": product.id,
        "name": product.name,
        "image_url": image_url(product.image, thumb=True) if product.image else None,
        "image_is_illustration": bool(product.image and product.image.is_illustration),
        "image_caption": product.image.caption if product.image else None,
        "image_source_url": product.image.source.url if product.image and product.image.source else None,
        "manufacturer": Ref.model_validate(product.manufacturer) if product.manufacturer else None,
        "solution_type": solution_type_ref(product.solution_type),
        "product_class": product.product_class,
        "readiness_status": product.readiness_status,
        "purpose": product.purpose,
        "country_of_origin": product.country_of_origin,
        "is_published": product.is_published,
        "price_from": float(min(prices)) if prices else None,
        "monthly_fee_from": float(min(fees)) if fees else None,
        "acquisition_models": sorted({o.acquisition_model for o in product.offers}),
        "dimensions": Dimensions(length_mm=spec("length_mm"), width_mm=spec("width_mm"), height_mm=spec("height_mm")),
        "payload_kg": spec("payload_kg"),
        "max_speed_mps": spec("max_speed_mps"),
        "completeness_percent": round(filled * 100 / total) if total else 100,
        "updated_at": product.updated_at,
    }


def product_summary(product: Product, mandatory: Sequence[SpecDefinition]) -> ProductSummary:
    """Продукт должен быть загружен с PRODUCT_SUMMARY_OPTIONS."""
    return ProductSummary(**_summary_fields(product, mandatory))


def product_detail(product: Product, mandatory: Sequence[SpecDefinition], user: User | None) -> ProductOut:
    """Продукт должен быть загружен с PRODUCT_DETAIL_OPTIONS."""
    filled, total, missing = evaluate(product, mandatory)
    specs = sorted(product.spec_values, key=lambda v: (v.definition.sort_order, v.definition.id))
    return ProductOut(
        **_summary_fields(product, mandatory),
        external_id=product.external_id,
        research_checked_at=(product.source_payload or {}).get('catalog_research', {}).get('checked_at'),
        research_note=(product.source_payload or {}).get('catalog_research', {}).get('note'),
        field_sources={key: SourceOut.model_validate(source)
                       for key, evidence in (product.source_payload or {}).get('field_evidence', {}).items()
                       for source in product.sources if source.id == evidence.get('source_id')},
        description=product.description,
        region=product.region,
        trl=product.trl,
        market_potential=float(product.market_potential) if product.market_potential is not None else None,
        limitations=product.limitations,
        service_life_years=float(product.service_life_years) if product.service_life_years is not None else None,
        last_verified_at=product.last_verified_at,
        created_at=product.created_at,
        specs=[
            SpecValueOut(
                code=v.definition.code,
                name=v.definition.name,
                group=v.definition.group,
                data_type=v.definition.data_type,
                unit=v.unit or v.definition.unit,
                is_mandatory=v.definition.is_mandatory,
                value=float(v.value_numeric) if v.value_numeric is not None else None,
                value_max=float(v.value_numeric_max) if v.value_numeric_max is not None else None,
                text=v.value_text,
                flag=v.value_bool,
                is_confirmed=v.is_confirmed,
                is_assumption=v.is_assumption,
                note=v.note,
                source=SourceOut.model_validate(v.source) if v.source else None,
                retrieved_at=v.retrieved_at,
            )
            for v in specs
        ],
        offers=[OfferOut.model_validate(o) for o in product.offers],
        applications=[ApplicationOut.model_validate(a) for a in product.applications],
        processes=[
            ProcessOut.model_validate(p)
            for p in sorted(product.processes, key=lambda p: (p.facility_type.sort_order, p.sort_order))
        ],
        sources=[SourceOut.model_validate(s) for s in product.sources],
        completeness=Completeness(
            not_applicable=not_applicable(product, mandatory),
            percent=round(filled * 100 / total) if total else 100, filled=filled, total=total, missing=missing
        ),
        image=(
            ImageOut(
                url=image_url(product.image),
                thumb_url=image_url(product.image, thumb=True),
                width=product.image.width,
                height=product.image.height,
                source=SourceOut.model_validate(product.image.source) if product.image.source else None,
                uploaded_at=product.image.created_at,
                is_illustration=product.image.is_illustration,
                caption=product.image.caption,
                attribution=product.image.source.notes if product.image.source else None,
            )
            if product.image
            else None
        ),
        can_edit=can_manage_product(user, product.manufacturer_id),
        can_publish=user is not None and has_permission(user.role, Permission.PRODUCTS_PUBLISH),
    )
