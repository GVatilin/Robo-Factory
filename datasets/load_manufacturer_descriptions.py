"""Import reviewed short descriptions, preserving subsequent administrator edits."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, "/app")
from sqlalchemy import select, text
from app.db.session import SessionLocal
from app.models import Manufacturer
from app.services import audit
from app.services.catalog_scope import is_russian


async def main(path: Path):
    entries = json.loads(path.read_text("utf8"))["companies"]
    if len({e["name"] for e in entries}) != len(entries):
        raise ValueError("Duplicate company names")
    report = {"updated": 0, "unchanged": 0, "protected": [], "missing": []}
    async with SessionLocal() as session:
        await session.execute(text("SELECT pg_advisory_xact_lock(7340034)"))
        companies = {m.name: m for m in (await session.scalars(select(Manufacturer).with_for_update())).all()}
        for entry in entries:
            company = companies.get(entry["name"])
            if company is None or not is_russian(company.country):
                report["missing"].append(entry["name"])
                continue
            description = entry["description"].strip()
            if not 20 <= len(description) <= 1000:
                raise ValueError("Invalid description length: " + entry["name"])
            if company.description == description:
                report["unchanged"] += 1
            elif company.description != entry["expected_description"]:
                report["protected"].append(entry["name"])
            else:
                before = company.description
                company.description = description
                audit.record(session, None, "manufacturer", company.id, "update", {
                    "description": {"before": before, "after": description},
                    "source_urls": entry["source_urls"], "basis": entry["basis"],
                    "reviewed_at": entry["reviewed_at"], "import": "manufacturer_descriptions_v1"})
                report["updated"] += 1
        await session.commit()
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=Path(__file__).parent / "manufacturer_descriptions.json")
    asyncio.run(main(parser.parse_args().file))
