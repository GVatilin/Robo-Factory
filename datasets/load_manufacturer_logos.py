"""Import reviewed company logos using the backend's database connection.

Run inside the backend container: python /datasets/load_manufacturer_logos.py
Only changes logo metadata/assets; never creates or deletes companies/products.
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, "/app")

from app.db.session import SessionLocal
from app.services.manufacturer_logos import import_logos


async def main(package: Path):
    async with SessionLocal() as session:
        report = await import_logos(session, package)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=Path(__file__).parent / "manufacturer_logos")
    args = parser.parse_args()
    asyncio.run(main(args.package))
