"""The active catalog contains Russian manufacturers and Russian products only.

Country is recorded data, not proof inferred from a Russian distributor or URL.
Historical foreign records remain available to saved project references in the DB.
"""
from sqlalchemy import and_, func

from app.api.errors import ApiValidationError, FieldError
from app.models import Manufacturer, Product

RUSSIAN_COUNTRIES = ("россия", "рф", "российская федерация", "russia", "russian federation", "ru", "rus")


def is_russian(country: str | None) -> bool:
    return (country or "").strip().lower() in RUSSIAN_COUNTRIES


def russian_country(column):
    return func.lower(func.trim(func.coalesce(column, ""))).in_(RUSSIAN_COUNTRIES)


def russian_product():
    return and_(russian_country(Product.country_of_origin), Product.manufacturer.has(russian_country(Manufacturer.country)))


def eligible(product: Product) -> bool:
    return bool(product.manufacturer and is_russian(product.manufacturer.country) and is_russian(product.country_of_origin))


def require_russian(country: str | None, field: str = "country") -> None:
    if not is_russian(country):
        raise ApiValidationError([FieldError(field, "В каталог принимаются только российские производители и роботы. Укажите страну происхождения по источнику; неизвестную страну нельзя считать Россией.")])
