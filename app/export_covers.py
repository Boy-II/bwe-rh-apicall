"""Export currently assigned local covers into assets included by Docker COPY app/."""

import asyncio
import json

from app.core import db
from app.core.paths import COVERS_DIR, COVER_PRESETS_DIR
from app.services.cover_presets import export_presets


async def main():
    await db.init_pool()
    try:
        rows = await db.fetch_all(
            "SELECT id,cover_url FROM cards WHERE cover_url<>'' ORDER BY id"
        )
        print(
            json.dumps(
                export_presets(rows, COVERS_DIR, COVER_PRESETS_DIR), ensure_ascii=False
            )
        )
    finally:
        await db.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
