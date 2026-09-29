"""Administrator preview/apply actions for organizer CSV and reviewed evidence."""
from dataclasses import asdict
from datetime import date
import hashlib
from pathlib import Path
import re

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, text

from app.api.deps import AdminUser, DbSession
from app.core.config import settings
from app.models import DataSource
from app.services import audit
from app.services.catalog_import import CatalogFormatError, import_catalog
from app.services.catalog_updates import update_catalog

router = APIRouter(prefix="/catalog/updates", tags=["Каталог: обновление администратором"])


class ApplyRequest(BaseModel):
    checksum: str


@router.get("/preview")
async def preview(db: DbSession, user: AdminUser):
    try:
        return await update_catalog(db, apply=False)
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/apply")
async def apply(data: ApplyRequest, db: DbSession, user: AdminUser):
    try:
        return await update_catalog(db, apply=True, expected_checksum=data.checksum, user=user)
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/organizer")
async def organizer(db: DbSession, user: AdminUser, file: UploadFile = File(...),
                    apply: bool = Form(False), checksum: str | None = Form(None)):
    if Path(file.filename or "").suffix.lower() != ".csv":
        raise HTTPException(422, "Выберите CSV-таблицу решений организатора.")
    content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "Таблица слишком большая.")
    digest = hashlib.sha256(content).hexdigest()
    if apply and checksum != digest:
        raise HTTPException(409, "Файл изменился. Выполните предварительный просмотр ещё раз.")
    filename = Path((file.filename or "catalog.csv").replace("\\", "/")).name[:250]
    try:
        await db.execute(text("SELECT pg_advisory_xact_lock(7340033)"))
        stats = await import_catalog(db, content, filename, user.id)
        if apply:
            source = await db.scalar(select(DataSource).where(DataSource.code == f"catalog_import:{digest[:16]}"))
            if source:
                source.url = f"/api/v1/catalog/updates/documents/{digest}.csv"
                source.retrieved_at = date.today()
            directory = settings.upload_dir / "catalog-imports"
            directory.mkdir(parents=True, exist_ok=True)
            (directory / f"{digest}.csv").write_bytes(content)
            audit.record(db, user, "catalog", digest, "csv_import", stats.as_dict())
            await db.commit()
        else:
            await db.rollback()
        return {**asdict(stats), "applied": apply, "checksum": digest}
    except (CatalogFormatError, UnicodeError, ValueError) as exc:
        await db.rollback()
        raise HTTPException(422, str(exc)) from exc


@router.get("/documents/{filename}")
async def document(filename: str):
    if not re.fullmatch(r"[0-9a-f]{64}\.csv", filename):
        raise HTTPException(404, "Документ не найден.")
    path = settings.upload_dir / "catalog-imports" / filename
    if not path.is_file():
        raise HTTPException(404, "Документ не найден.")
    return FileResponse(path, media_type="text/csv", filename="catalog.csv")
