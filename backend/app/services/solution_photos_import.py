"""Фотографии эталонных решений из документа «Примеры решений по типам объектов» (разбор — solution_examples).

Фото, загруженное в карточку вручную, импорт не заменяет. Повторный импорт того же файла пропускается.
"""

import hashlib
import posixpath
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DatasetVersion, DataSource, ProductImage
from app.models.enums import DatasetKind
from app.services.product_images import ImageError, decode_upload, emf_bitmap, remove_files, write_files
from app.services.solution_examples import (
    ExampleSolution,
    ExamplesDocumentError,
    PARSER_VERSION,
    document_source,
    find_or_create_product,
    parse_examples_docx,
)


@dataclass
class PhotoImportStats:
    status: str = "imported"
    dataset_version_id: int | None = None
    photos: int = 0
    attached: int = 0
    products_created: int = 0
    skipped: int = 0
    warnings: list[str] = field(default_factory=list)
    # Файлы на диске: новые (удалить при откате транзакции) и заменённые (удалить после коммита).
    written: list[uuid.UUID] = field(default_factory=list)
    replaced: list[uuid.UUID] = field(default_factory=list)


def media_image(solution: ExampleSolution):
    """Изображение из файла документа: растр извлекается даже из EMF, в который Word упаковал фото."""
    if solution.media and solution.media.lower().endswith(".emf"):
        return emf_bitmap(solution.data)
    return decode_upload(solution.data)


async def _attach_photos(
    session: AsyncSession, solutions: list[ExampleSolution], document: DataSource, stats: PhotoImportStats
) -> None:
    for solution in solutions:
        if not solution.media:
            continue
        product, created = await find_or_create_product(session, solution, document)
        if product is None:
            stats.warnings.append(f"«{solution.model}»: товара нет в каталоге — фото пропущено.")
            stats.skipped += 1
            continue
        stats.products_created += created
        await session.refresh(product, ["image", "sources"])
        current = product.image
        if current is not None and current.source_id != document.id:
            stats.warnings.append(f"«{product.name}»: фото уже загружено вручную — оставлено без изменений.")
            stats.skipped += 1
            continue
        try:
            image = media_image(solution)
        except ImageError as exc:
            stats.warnings.append(f"«{solution.model}»: {exc}")
            stats.skipped += 1
            continue

        image_id = uuid.uuid4()
        width, height, size = write_files(image, image_id)
        stats.written.append(image_id)
        if current is not None:
            # Удаление старой записи раньше вставки новой: у товара одна фотография (уникальный product_id).
            stats.replaced.append(current.id)
            await session.delete(current)
            await session.flush()
        session.add(
            ProductImage(
                id=image_id,
                product_id=product.id,
                original_name=posixpath.basename(solution.media),
                width=width,
                height=height,
                size_bytes=size,
                source_id=document.id,
            )
        )
        if document not in product.sources:
            product.sources.append(document)
        stats.attached += 1


async def import_solution_photos(session: AsyncSession, content: bytes, file_name: str) -> PhotoImportStats:
    """Привязывает фотографии документа к карточкам. Файлы пишутся сразу, коммит — на стороне вызывающего кода."""
    stats = PhotoImportStats()
    checksum = hashlib.sha256(content).hexdigest()
    existing = await session.scalar(
        select(DatasetVersion).where(
            DatasetVersion.kind == DatasetKind.SOLUTION_PHOTOS, DatasetVersion.checksum_sha256 == checksum,
            DatasetVersion.stats["parser_version"].as_string() == PARSER_VERSION,
        )
    )
    if existing:
        stats.status = "skipped"
        stats.dataset_version_id = existing.id
        return stats

    document = await document_source(session)
    solutions, warnings = parse_examples_docx(content)
    if not solutions:
        raise ExamplesDocumentError("Решения не распознаны: " + "; ".join(warnings))
    stats.photos = sum(1 for s in solutions if s.media)
    stats.warnings.extend(warnings)
    try:
        await _attach_photos(session, solutions, document, stats)
    except BaseException:
        remove_files(*stats.written)
        raise

    await session.execute(
        update(DatasetVersion).where(DatasetVersion.kind == DatasetKind.SOLUTION_PHOTOS).values(is_current=False)
    )
    version = DatasetVersion(
        kind=DatasetKind.SOLUTION_PHOTOS,
        label=file_name.rsplit(".", 1)[0],
        file_name=file_name,
        checksum_sha256=checksum,
        source_id=document.id,
        row_count=stats.photos,
        stats={"parser_version": PARSER_VERSION, "photos": stats.photos, "attached": stats.attached, "products_created": stats.products_created},
        is_current=True,
    )
    session.add(version)
    await session.flush()
    stats.dataset_version_id = version.id
    return stats
