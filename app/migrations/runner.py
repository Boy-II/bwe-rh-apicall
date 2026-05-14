"""Schema migration runner。

執行方式：
    1. 自動：lifespan 啟動時呼叫 `apply_migrations()`
    2. 手動 CLI：`python -m app.migrations.runner`

語意：
    - `_migrations` 表記錄已執行檔名 + checksum
    - 掃描 `app/migrations/*.sql` 依檔名排序
    - 未執行的依序套用，每個檔案在 transaction 中執行
"""

import asyncio
import hashlib
import logging
import sys
from pathlib import Path

from app.core import db

logger = logging.getLogger(__name__)


MIGRATIONS_DIR = Path(__file__).parent


async def _ensure_migrations_table() -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS _migrations (
            filename   TEXT PRIMARY KEY,
            checksum   TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def _checksum(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


async def apply_migrations() -> list[str]:
    """執行所有未套用的 .sql migration，回傳剛執行的檔名清單。"""
    await _ensure_migrations_table()

    applied: set[str] = set(
        r["filename"]
        for r in await db.fetch_all("SELECT filename FROM _migrations")
    )

    sql_files = sorted(p for p in MIGRATIONS_DIR.glob("*.sql"))
    newly_applied: list[str] = []

    for path in sql_files:
        if path.name in applied:
            continue
        content = path.read_text(encoding="utf-8")
        async with db.pool().acquire() as conn:
            async with conn.transaction():
                await conn.execute(content)
                await conn.execute(
                    "INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)",
                    path.name,
                    _checksum(content),
                )
        newly_applied.append(path.name)
        logger.info("套用 %s", path.name)

    return newly_applied


async def _cli() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
    logger.info("連線資料庫...")
    await db.init_pool()
    try:
        result = await apply_migrations()
        if result:
            logger.info("完成，套用 %d 個檔案：%s", len(result), result)
        else:
            logger.info("無新檔案需套用")
        return 0
    finally:
        await db.close_pool()


if __name__ == "__main__":
    sys.exit(asyncio.run(_cli()))
