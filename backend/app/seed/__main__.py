import asyncio
import logging

from app.seed.runner import run_seed

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")
    asyncio.run(run_seed())
