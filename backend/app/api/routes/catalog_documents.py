"""Public evidence files; only curated catalog documents can be served."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.config import settings

router = APIRouter(prefix="/catalog-documents", tags=["catalog"])
DOCUMENTS = {
    "organizer-catalog.pdf": "application/pdf",
    "solution-examples.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "catalog-export.csv": "text/csv",
}


@router.get("/{document_name}")
def document(document_name: str):
    if document_name not in DOCUMENTS:
        raise HTTPException(404, "Документ не найден")
    path = settings.upload_dir / "catalog-documents" / document_name
    if not path.is_file():
        raise HTTPException(404, "Документ ещё не загружен")
    return FileResponse(path, media_type=DOCUMENTS[document_name], filename=document_name,
                        content_disposition_type="inline" if document_name.endswith(".pdf") else "attachment")
