"""Загрузка датасетов организатора в БД Robo-Factory.

Что загружается (по порядку, в одной транзакции):
  1. каталог решений        — catalog_export*.csv          (самая свежая версия по имени файла);
  2. параметры объектов     — *.xlsx с листами «Склад», «Аэропорт», «Медучреждение»;
  3. эталонные ТТХ решений  — reference_specs.json;
  4. фото и ТТХ решений     — Примеры_решений*.docx (привязываются к карточкам по модели из подписи);
  5. демо-проекты           — по одному на тип объекта, на базовых значениях параметров.

Повторный запуск безопасен: файл с той же контрольной суммой пропускается, изменённый — обновляет данные.
Базовые справочники (типы объектов, ТТХ, нормативы) должны быть созданы заранее — это делает backend при старте.

Запуск в Docker (рекомендуется):
    docker compose exec backend python /datasets/load_datasets.py

Запуск с хоста (нужны зависимости backend и доступ к БД):
    set DATABASE_URL=postgresql+asyncpg://robo:robo@localhost:5433/robofactory
    python datasets/load_datasets.py
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def add_backend_to_path() -> None:
    candidates = [os.environ.get("BACKEND_DIR"), HERE.parent / "backend", "/app"]
    for candidate in candidates:
        if candidate and (Path(candidate) / "app" / "__init__.py").exists():
            sys.path.insert(0, str(Path(candidate)))
            return
    sys.exit("Не найден код backend. Укажите путь в переменной BACKEND_DIR.")


def latest(directory: Path, pattern: str) -> Path | None:
    files = sorted(directory.glob(pattern))
    return files[-1] if files else None


def find_facility_workbook(directory: Path) -> Path | None:
    import openpyxl

    for path in sorted(directory.glob("*.xlsx")):
        if path.name.startswith("~$"):
            continue
        workbook = openpyxl.load_workbook(path, read_only=True)
        sheets = set(workbook.sheetnames)
        workbook.close()
        if {"Склад", "Аэропорт", "Медучреждение"} <= sheets:
            return path
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Загрузка датасетов организатора в БД Robo-Factory")
    parser.add_argument("--dir", type=Path, default=HERE, help="Папка с датасетами (по умолчанию — папка скрипта)")
    parser.add_argument("--catalog", type=Path, help="CSV каталога решений (catalog_export_*.csv)")
    parser.add_argument("--facilities", type=Path, help="Excel с параметрами объектов")
    parser.add_argument("--reference", type=Path, help="JSON с эталонными ТТХ")
    parser.add_argument("--photos", type=Path, help="Документ «Примеры решений по типам объектов» (.docx)")
    return parser.parse_args()


def report(title: str, lines: list[str], warnings: list[str] | None = None) -> None:
    print(f"\n■ {title}")
    for line in lines:
        print(f"  {line}")
    for warning in warnings or []:
        print(f"  ! {warning}")


async def load(args: argparse.Namespace) -> int:
    from sqlalchemy import func, select

    from app.db.session import SessionLocal, engine
    from app.models import FacilityType
    from app.services.catalog_import import CatalogFormatError, import_catalog
    from app.services.demo_projects import ensure_demo_projects
    from app.services.facility_parameters_import import FacilityWorkbookError, import_facility_parameters
    from app.services.product_images import remove_files
    from app.services.reference_specs_import import ReferenceSpecsError, import_reference_specs
    from app.services.example_specs_import import import_example_specs
    from app.services.solution_examples import ExamplesDocumentError
    from app.services.solution_photos_import import import_solution_photos

    catalog = args.catalog or latest(args.dir, "catalog_export*.csv")
    facilities = args.facilities or find_facility_workbook(args.dir)
    reference = args.reference or (args.dir / "reference_specs.json")
    examples = args.photos or latest(args.dir, "Примеры_решений*.docx")
    photos = None

    try:
        async with SessionLocal() as session:
            if not await session.scalar(select(func.count(FacilityType.id))):
                print("В БД нет базовых справочников. Запустите backend (docker compose up) и повторите.")
                return 1

            if catalog and catalog.exists():
                stats = await import_catalog(session, catalog.read_bytes(), catalog.name)
                report(f"Каталог решений: {catalog.name}", [
                    f"статус: {stats.status}",
                    f"продуктов создано {stats.products_created}, обновлено {stats.products_updated}",
                    f"применений {stats.applications}, предложений {stats.offers}",
                ], stats.warnings)
            else:
                report("Каталог решений", ["файл catalog_export*.csv не найден — шаг пропущен"])

            if facilities and facilities.exists():
                params = await import_facility_parameters(session, facilities.read_bytes(), facilities.name)
                by_facility = ", ".join(f"{k}={v}" for k, v in params.by_facility.items()) or "—"
                report(f"Параметры объектов: {facilities.name}", [
                    f"статус: {params.status}",
                    f"создано {params.created}, обновлено {params.updated} ({by_facility})",
                ], params.warnings)
            else:
                report("Параметры объектов", ["Excel с листами «Склад», «Аэропорт», «Медучреждение» не найден — шаг пропущен"])

            if reference.exists():
                ref = await import_reference_specs(session, reference.read_bytes(), reference.name)
                report(f"Эталонные ТТХ: {reference.name}", [
                    f"статус: {ref.status}",
                    f"продуктов найдено в каталоге {ref.products_matched}, добавлено {ref.products_created}",
                    f"значений ТТХ создано {ref.specs_created}, обновлено {ref.specs_updated}",
                ], ref.warnings)
            else:
                report("Эталонные ТТХ", [f"файл {reference.name} не найден — шаг пропущен"])

            if examples and examples.exists():
                photos = await import_solution_photos(session, examples.read_bytes(), examples.name)
                report(f"Фотографии решений: {examples.name}", [
                    f"статус: {photos.status}",
                    f"фото в документе {photos.photos}, привязано к карточкам {photos.attached}, пропущено {photos.skipped}",
                    f"карточек добавлено {photos.products_created}",
                ], photos.warnings)
                specs = await import_example_specs(session, examples.read_bytes(), examples.name)
                report(f"ТТХ эталонных решений: {examples.name}", [
                    f"статус: {specs.status}",
                    f"решений {specs.solutions}, значений создано {specs.specs_created}, обновлено {specs.specs_updated}",
                    f"оставлено значений из карточек {specs.specs_kept}, уточнено типов решений {specs.types_refined}",
                ], specs.warnings)
            else:
                report("Фото и ТТХ эталонных решений", ["файл Примеры_решений*.docx не найден — шаг пропущен"])

            created = await ensure_demo_projects(session)
            report("Демо-проекты", [f"создано {created}"])

            await session.commit()
    except BaseException as exc:
        # Транзакция откатилась: новые файлы фотографий больше ни на что не ссылаются.
        if photos:
            remove_files(*photos.written)
        if isinstance(exc, (CatalogFormatError, FacilityWorkbookError, ReferenceSpecsError, ExamplesDocumentError)):
            print(f"\nОшибка в данных, изменения не сохранены: {exc}")
            return 2
        raise
    finally:
        await engine.dispose()

    if photos:
        remove_files(*photos.replaced)

    print("\nГотово: датасеты загружены.")
    return 0


if __name__ == "__main__":
    add_backend_to_path()
    sys.exit(asyncio.run(load(parse_args())))
