"""Locally stored, reviewed company logos with original source attribution."""
from datetime import date
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Manufacturer
from app.services import audit

LOGO_DIR = settings.upload_dir / "manufacturer-logos"


def logo_url(manufacturer: Manufacturer | None) -> str | None:
    digest = (manufacturer.logo_metadata or {}).get("sha256", "") if manufacturer else ""
    return f"/api/v1/manufacturers/logos/{digest}.webp" if re.fullmatch(r"[0-9a-f]{64}", digest) else None


async def import_logos(session: AsyncSession, package_dir: Path) -> dict:
    manifest = json.loads((package_dir / "manifest.json").read_text(encoding="utf-8"))
    await session.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
    companies = {m.name: m for m in (await session.scalars(select(Manufacturer).with_for_update())).all()}
    report = {"updated": 0, "unchanged": 0, "without_logo": 0, "skipped": []}
    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    for item in manifest["companies"]:
        company = companies.get(item["name"])
        logo = item.get("logo")
        if company is None:
            report["skipped"].append(item["name"])
            continue
        if not logo:
            report["without_logo"] += 1
            continue
        if not logo.get("approved") or (company.logo_metadata or {}).get("uploaded_by_id"):
            report["skipped"].append(item["name"])
            continue
        digest = logo["sha256"]
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Invalid image hash")
        data = (package_dir / "assets" / f"{digest}.webp").read_bytes()
        if (len(data) > 2_000_000 or hashlib.sha256(data).hexdigest() != digest
                or data[:4] != b"RIFF" or data[8:12] != b"WEBP"):
            raise ValueError("Logo integrity check failed")
        for key in ("source_url", "original_url"):
            url = urlsplit(logo[key])
            if url.scheme not in {"https", "http"} or not url.hostname or url.username:
                raise ValueError("Invalid logo source URL")
        if date.fromisoformat(logo["retrieved_at"]) > date.today():
            raise ValueError("Future retrieval date")
        destination = LOGO_DIR / f"{digest}.webp"
        if not destination.is_file():
            destination.write_bytes(data)
        if company.logo_metadata == logo:
            report["unchanged"] += 1
            continue
        company.logo_metadata = logo
        report["updated"] += 1
    if report["updated"]:
        audit.record(session, None, "manufacturer", "logos", "import", report)
    await session.commit()
    return report
