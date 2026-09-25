"""Идемпотентное заполнение базовых справочников при старте backend.

Здесь только данные, которые являются частью кода платформы: источники, таксономия типов решений,
типы объектов и процессы, справочник ТТХ, нормативы и демо-учётки.
Датасеты организатора (каталог, параметры объектов, эталонные ТТХ) загружает скрипт datasets/load_datasets.py.

Запуск: `python -m app.seed`. Повторный запуск не создаёт дублей.
"""

import logging
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import (
    DataSource,
    FacilityType,
    Industry,
    Normative,
    Process,
    Product,
    SolutionType,
    SpecDefinition,
    User,
)
from app.models.enums import UserRole
from app.seed import reference_data as ref
from app.services.taxonomy import CATEGORIES, TYPES

log = logging.getLogger("seed")


async def seed_sources(session: AsyncSession) -> dict[str, DataSource]:
    existing = {s.code: s for s in (await session.scalars(select(DataSource).where(DataSource.code.is_not(None)))).all()}
    for code, (title, source_type, url, publisher, retrieved_at, notes) in ref.SOURCES.items():
        if code not in existing:
            existing[code] = DataSource(
                code=code, title=title, source_type=source_type, url=url, publisher=publisher,
                retrieved_at=retrieved_at, notes=notes,
            )
            session.add(existing[code])
    await session.flush()
    return existing


async def seed_taxonomy(session: AsyncSession) -> dict[str, SolutionType]:
    nodes = {n.code: n for n in (await session.scalars(select(SolutionType))).all()}
    for order, (code, name, description) in enumerate(CATEGORIES):
        if code not in nodes:
            nodes[code] = SolutionType(code=code, name=name, description=description, sort_order=order * 10)
            session.add(nodes[code])
    await session.flush()
    for order, (code, name, parent_code, description) in enumerate(TYPES):
        if code not in nodes:
            nodes[code] = SolutionType(
                code=code, name=name, description=description, parent_id=nodes[parent_code].id, sort_order=order * 10
            )
            session.add(nodes[code])
    await session.flush()
    return nodes


async def seed_facilities(session: AsyncSession, types: dict[str, SolutionType]) -> None:
    industries = {i.code: i for i in (await session.scalars(select(Industry))).all()}
    for order, (code, name, description) in enumerate(ref.INDUSTRIES):
        if code not in industries:
            industries[code] = Industry(code=code, name=name, description=description, sort_order=order * 10)
            session.add(industries[code])
    await session.flush()

    facilities = {f.code: f for f in (await session.scalars(select(FacilityType))).all()}
    for order, (code, industry, name, description, icon, layout) in enumerate(ref.FACILITY_TYPES):
        if code not in facilities:
            facilities[code] = FacilityType(
                code=code, industry_id=industries[industry].id, name=name, description=description,
                icon=icon, layout_template=layout, sort_order=order * 10,
            )
            session.add(facilities[code])
    await session.flush()

    existing = {(p.facility_type_id, p.code) for p in (await session.scalars(select(Process))).all()}
    for order, (facility_code, code, name, type_codes, drivers) in enumerate(ref.PROCESSES):
        facility = facilities[facility_code]
        if (facility.id, code) in existing:
            continue
        session.add(
            Process(
                facility_type_id=facility.id, code=code, name=name, driver_parameters=drivers,
                solution_types=[types[t] for t in type_codes], sort_order=order * 10,
            )
        )
    await session.flush()


async def seed_spec_definitions(session: AsyncSession) -> None:
    existing = {s.code for s in (await session.scalars(select(SpecDefinition))).all()}
    for order, (code, name, group, unit, data_type, mandatory, filterable) in enumerate(ref.SPEC_DEFINITIONS):
        if code not in existing:
            session.add(
                SpecDefinition(
                    code=code, name=name, group=group, unit=unit, data_type=data_type,
                    is_mandatory=mandatory, is_filterable=filterable, sort_order=order * 10,
                )
            )
    await session.flush()


async def seed_normatives(session: AsyncSession, sources: dict[str, DataSource]) -> None:
    existing = {n.code for n in (await session.scalars(select(Normative).where(Normative.facility_type_id.is_(None)))).all()}
    for code, name, category, value, unit, source, is_assumption, description in ref.NORMATIVES:
        if code not in existing:
            session.add(
                Normative(
                    code=code, name=name, category=category, value=Decimal(str(value)), unit=unit,
                    source_id=sources[source].id, is_assumption=is_assumption, description=description,
                )
            )
    await session.flush()


async def seed_users(session: AsyncSession) -> None:
    for email, password, role, name in (
        (settings.demo_admin_email, settings.demo_admin_password, UserRole.ADMIN, "Администратор (демо)"),
        (settings.demo_user_email, settings.demo_user_password, UserRole.USER, "Пользователь (демо)"),
    ):
        if await session.scalar(select(User.id).where(User.email == email.lower())) is None:
            session.add(User(email=email.lower(), password_hash=hash_password(password), role=role, full_name=name))
    await session.flush()


async def run_seed() -> None:
    async with SessionLocal() as session:
        sources = await seed_sources(session)
        types = await seed_taxonomy(session)
        await seed_facilities(session, types)
        await seed_spec_definitions(session)
        await seed_normatives(session, sources)
        await seed_users(session)
        await session.commit()

        products = await session.scalar(select(func.count(Product.id))) or 0
        log.info("Базовые справочники готовы. Продуктов в каталоге: %s", products)
        if products == 0:
            log.info("Каталог пуст: загрузите датасеты командой `python /datasets/load_datasets.py`")
