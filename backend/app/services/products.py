"""Ручное добавление и редактирование товаров каталога (п. 3.3.5 ТЗ).

Карточка сохраняется целиком: поля продукта, ТТХ, коммерческие предложения, применения и процессы.
Происхождение данных (п. 3.3.4 ТЗ): изменённые значения ТТХ и цены получают источник из формы
и дату получения. Без источника в форме используется ручной ввод администратора или данные вендора.
Права на производителя проверяет роут; здесь — проверка ссылок и значений.
"""

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.errors import ApiValidationError, FieldError
from app.models import (
    DataSource,
    Industry,
    Manufacturer,
    Process,
    Product,
    ProductApplication,
    ProductImage,
    ProductOffer,
    ProductSpecValue,
    SolutionType,
    SpecDefinition,
    User,
)
from app.models.enums import AcquisitionModel, SourceType, UserRole, ValueDataType
from app.schemas.products import OfferIn, ProductIn, SourceIn, SpecValueIn

PRODUCT_DETAIL_OPTIONS = (
    selectinload(Product.manufacturer),
    selectinload(Product.solution_type).selectinload(SolutionType.parent),
    selectinload(Product.spec_values).selectinload(ProductSpecValue.definition),
    selectinload(Product.spec_values).selectinload(ProductSpecValue.source),
    selectinload(Product.offers).selectinload(ProductOffer.source),
    selectinload(Product.applications).selectinload(ProductApplication.industry),
    selectinload(Product.processes).selectinload(Process.facility_type),
    selectinload(Product.sources),
    selectinload(Product.image).selectinload(ProductImage.source),
)

# Достаточно для карточки в списке: ключевые ТТХ, цена и полнота.
PRODUCT_SUMMARY_OPTIONS = (
    selectinload(Product.manufacturer),
    selectinload(Product.solution_type).selectinload(SolutionType.parent),
    selectinload(Product.spec_values).selectinload(ProductSpecValue.definition),
    selectinload(Product.offers),
    selectinload(Product.processes),
    selectinload(Product.image),
)

SCALAR_FIELDS = (
    "name", "product_class", "purpose", "description", "country_of_origin", "region",
    "readiness_status", "trl", "limitations", "service_life_years",
)
_VALUE_KEYS = ("value_numeric", "value_numeric_max", "value_text", "value_bool", "unit")
_PRICE_KEYS = (
    "equipment_price", "software_price", "implementation_price", "annual_service_cost", "monthly_fee",
    "min_contract_months",
)
_NUMERIC_TYPES = {ValueDataType.NUMBER, ValueDataType.INTEGER, ValueDataType.RANGE}
# Numeric(18, 4): не более 14 знаков в целой части.
_NUMERIC_LIMIT = Decimal("1e14")
# Источники, данные которых считаются подтверждёнными; ручной ввод и допущения — нет.
_CONFIRMING_SOURCES = {
    SourceType.ORGANIZER, SourceType.MANUFACTURER, SourceType.INTEGRATOR, SourceType.PUBLIC_SPEC,
    SourceType.MARKETPLACE, SourceType.CASE_STUDY, SourceType.REGULATION,
}
_DEFAULT_OFFER_LABEL = {
    AcquisitionModel.PURCHASE: "Покупка",
    AcquisitionModel.LEASE: "Лизинг",
    AcquisitionModel.RAAS: "Роботы как услуга",
}


async def load_product(session: AsyncSession, product_id: int) -> Product | None:
    """Продукт со всеми связями. populate_existing — свежие значения после коммита (updated_at и т. п.)."""
    return await session.scalar(
        select(Product)
        .where(Product.id == product_id)
        .options(*PRODUCT_DETAIL_OPTIONS)
        .execution_options(populate_existing=True)
    )


def normalize_specs(
    items: list[SpecValueIn], definitions: dict[str, SpecDefinition]
) -> tuple[dict[int, dict[str, Any]], list[FieldError]]:
    """Проверяет значения ТТХ по типу характеристики. Пустые значения отбрасываются: ТТХ не заполнена.

    Возвращает {id определения: значения полей ProductSpecValue} и ошибки с путём specs.<код>.<поле>.
    """
    result: dict[int, dict[str, Any]] = {}
    errors: list[FieldError] = []
    for item in items:
        field = f"specs.{item.code}"
        definition = definitions.get(item.code)
        if definition is None:
            errors.append(FieldError(field, f"Неизвестная характеристика «{item.code}»"))
            continue
        if definition.id in result:
            errors.append(FieldError(field, "Характеристика указана дважды"))
            continue

        values: dict[str, Any] = dict.fromkeys(_VALUE_KEYS)
        data_type = definition.data_type
        if data_type in _NUMERIC_TYPES:
            low, high = item.value, item.value_max
            if low is None and high is None:
                continue
            if data_type != ValueDataType.RANGE and high is not None:
                errors.append(FieldError(f"{field}.value_max", "Для этой характеристики укажите одно значение"))
                continue
            if low is None:
                low, high = high, None
            if high is not None and high < low:
                errors.append(FieldError(f"{field}.value_max", "Верхняя граница меньше нижней"))
                continue
            bad = next(
                (
                    message
                    for check, message in (
                        (any(abs(v) >= _NUMERIC_LIMIT for v in (low, high) if v is not None), "Слишком большое число"),
                        # Отрицательные значения допустимы только для температуры.
                        (definition.unit != "°C" and low < 0, "Значение не может быть отрицательным"),
                        (data_type == ValueDataType.INTEGER and low != low.to_integral_value(), "Введите целое число"),
                    )
                    if check
                ),
                None,
            )
            if bad:
                errors.append(FieldError(f"{field}.value", bad))
                continue
            values["value_numeric"] = low
            values["value_numeric_max"] = high if high != low else None
        elif data_type == ValueDataType.BOOLEAN:
            if item.flag is None:
                continue
            values["value_bool"] = item.flag
        else:
            if not item.text:
                continue
            values["value_text"] = item.text

        values["unit"] = item.unit if item.unit and item.unit != definition.unit else None
        values.update(is_confirmed=item.is_confirmed, is_assumption=item.is_assumption, note=item.note)
        result[definition.id] = values
    return result, errors


async def resolve_source(
    session: AsyncSession, data: SourceIn | None, user: User, manufacturer: Manufacturer
) -> DataSource:
    """Источник из формы (поиск по ссылке или названию) либо источник ручного ввода по роли."""
    if data is not None and (data.title or data.url):
        stmt = (
            select(DataSource).where(DataSource.url == data.url)
            if data.url
            else select(DataSource).where(DataSource.title == data.title, DataSource.source_type == data.source_type)
        )
        source = await session.scalar(stmt.order_by(DataSource.id).limit(1))
        if source is None:
            source = DataSource(
                title=data.title or data.url,
                source_type=data.source_type,
                url=data.url,
                publisher=manufacturer.name if data.source_type == SourceType.MANUFACTURER else None,
                retrieved_at=data.retrieved_at or date.today(),
            )
            session.add(source)
            await session.flush()
        return source

    if user.role == UserRole.VENDOR:
        code = f"vendor_input:{manufacturer.id}"
        defaults = {
            "title": f"Данные производителя «{manufacturer.name}» из кабинета вендора",
            "source_type": SourceType.MANUFACTURER,
            "publisher": manufacturer.name,
        }
    else:
        code = "admin_input"
        defaults = {"title": "Ручной ввод администратора каталога", "source_type": SourceType.USER_INPUT}
    source = await session.scalar(select(DataSource).where(DataSource.code == code))
    if source is None:
        source = DataSource(code=code, **defaults)
        session.add(source)
        await session.flush()
    return source


async def _validate_references(
    session: AsyncSession, data: ProductIn, product: Product | None
) -> tuple[Manufacturer | None, SolutionType | None, list[Process], list[FieldError]]:
    errors: list[FieldError] = []
    manufacturer = await session.get(Manufacturer, data.manufacturer_id)
    if manufacturer is None:
        errors.append(FieldError("manufacturer_id", "Производитель не найден. Выберите его из списка."))
    solution_type = await session.get(SolutionType, data.solution_type_id)
    if solution_type is None:
        errors.append(FieldError("solution_type_id", "Тип решения не найден. Выберите его из списка."))

    processes: list[Process] = []
    if data.process_ids:
        processes = list((await session.scalars(select(Process).where(Process.id.in_(data.process_ids)))).all())
        unknown = set(data.process_ids) - {p.id for p in processes}
        if unknown:
            errors.append(FieldError("process_ids", "Часть выбранных процессов не найдена. Обновите страницу."))

    industry_ids = {a.industry_id for a in data.applications if a.industry_id is not None}
    known_industries = (
        set((await session.scalars(select(Industry.id).where(Industry.id.in_(industry_ids)))).all())
        if industry_ids
        else set()
    )
    own_offers = {o.id for o in product.offers} if product else set()
    own_applications = {a.id for a in product.applications} if product else set()
    for index, app in enumerate(data.applications):
        if app.industry_id is not None and app.industry_id not in known_industries:
            errors.append(FieldError(f"applications.{index}.industry_id", "Отрасль не найдена"))
        if app.id is not None and app.id not in own_applications:
            errors.append(FieldError(f"applications.{index}.id", "Кейс не относится к этому товару"))
    for index, offer in enumerate(data.offers):
        if offer.id is not None and offer.id not in own_offers:
            errors.append(FieldError(f"offers.{index}.id", "Предложение не относится к этому товару"))
    return manufacturer, solution_type, processes, errors


def _apply_offer(offer: ProductOffer, item: OfferIn, source: DataSource) -> None:
    price_changed = offer.id is None or any(getattr(offer, k) != getattr(item, k) for k in _PRICE_KEYS)
    for key in (*_PRICE_KEYS, "acquisition_model", "price_includes_vat", "included_services", "notes"):
        setattr(offer, key, getattr(item, key))
    offer.label = item.label or _DEFAULT_OFFER_LABEL[item.acquisition_model]
    offer.is_default = item.is_default
    if price_changed:
        offer.source = source
        offer.is_confirmed = source.source_type in _CONFIRMING_SOURCES


async def save_product(
    session: AsyncSession,
    data: ProductIn,
    user: User,
    *,
    product: Product | None = None,
    is_published: bool,
) -> Product:
    """Создаёт (product=None) или обновляет продукт. Продукт должен быть загружен с PRODUCT_DETAIL_OPTIONS."""
    manufacturer, solution_type, processes, errors = await _validate_references(session, data, product)
    definitions = {d.code: d for d in (await session.scalars(select(SpecDefinition))).all()}
    specs, spec_errors = normalize_specs(data.specs, definitions)
    errors.extend(spec_errors)
    if errors:
        raise ApiValidationError(errors)
    assert manufacturer is not None and solution_type is not None

    source = await resolve_source(session, data.source, user, manufacturer)
    retrieved_at = (data.source.retrieved_at if data.source else None) or date.today()

    if product is None:
        product = Product(spec_values=[], offers=[], applications=[], processes=[], sources=[])
        session.add(product)
    for key in SCALAR_FIELDS:
        setattr(product, key, getattr(data, key))
    product.manufacturer = manufacturer
    product.solution_type = solution_type
    product.processes = processes
    product.is_published = is_published
    product.last_verified_at = retrieved_at

    by_id = {d.id: d for d in definitions.values()}
    current = {v.spec_definition_id: v for v in product.spec_values}
    for definition_id, values in specs.items():
        spec = current.pop(definition_id, None)
        changed = spec is None or any(getattr(spec, k) != values[k] for k in _VALUE_KEYS)
        if spec is None:
            spec = ProductSpecValue(definition=by_id[definition_id])
            product.spec_values.append(spec)
        for key, value in values.items():
            setattr(spec, key, value)
        if changed:
            spec.source = source
            spec.retrieved_at = retrieved_at
    for spec in current.values():
        product.spec_values.remove(spec)

    offers = {o.id: o for o in product.offers}
    for item in data.offers:
        offer = offers.pop(item.id, None) if item.id is not None else None
        if offer is None:
            offer = ProductOffer()
            product.offers.append(offer)
        _apply_offer(offer, item, source)
    for offer in offers.values():
        product.offers.remove(offer)
    if product.offers and sum(o.is_default for o in product.offers) != 1:
        default = next((o for o in product.offers if o.is_default), product.offers[0])
        for offer in product.offers:
            offer.is_default = offer is default

    applications = {a.id: a for a in product.applications}
    industries = {i.id: i for i in (await session.scalars(select(Industry))).all()} if data.applications else {}
    for item in data.applications:
        if not (item.scenario or item.case_description or item.industry_id):
            continue
        application = applications.pop(item.id, None) if item.id is not None else None
        if application is None:
            application = ProductApplication(source_id=source.id)
            product.applications.append(application)
        application.industry = industries.get(item.industry_id) if item.industry_id else None
        application.scenario = item.scenario
        application.case_description = item.case_description
    for application in applications.values():
        product.applications.remove(application)

    if source not in product.sources:
        product.sources.append(source)
    await session.flush()
    return product
