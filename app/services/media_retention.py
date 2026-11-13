"""生成結果圖（media/results）的列表、刪除與自動保留期清理。"""

import asyncio
import logging
import os
import time
from datetime import datetime, timezone

from app.core import db
from app.services import media

logger = logging.getLogger(__name__)

RETENTION_DAYS = int(os.environ.get("MEDIA_RESULTS_RETENTION_DAYS", "45"))
# 使用者上傳的參考圖用完即刪；未送出就離開的，最多保留這麼久
UPLOAD_TTL_SECONDS = 2 * 3600
CLEANUP_INTERVAL_SECONDS = 30 * 60
_PREFIX = f"{media.MEDIA_URL_PREFIX}/results/"


def _url(name: str) -> str:
    return _PREFIX + name


def list_files() -> list[dict]:
    """results 資料夾內的檔案，新到舊。"""
    folder = media.MEDIA_DIR / "results"
    if not folder.is_dir():
        return []
    out = []
    for p in folder.iterdir():
        if not p.is_file() or media.local_path(_url(p.name)) is None:
            continue
        st = p.stat()
        out.append({"name": p.name, "url": _url(p.name), "size": st.st_size, "mtime": st.st_mtime})
    out.sort(key=lambda f: f["mtime"], reverse=True)
    return out


async def task_info(urls: list[str]) -> dict[str, dict]:
    """找出引用這些圖片的任務（使用者、卡片、建立時間）。"""
    if not urls:
        return {}
    rows = await db.fetch_all(
        """SELECT t.id, t.card_title, t.provider, t.created_at, t.user_id,
                  COALESCE(NULLIF(u.name, ''), u.username, t.user_id) AS user_name, r->>'url' AS url
        FROM tasks t
        CROSS JOIN LATERAL jsonb_array_elements(t.results) r
        LEFT JOIN users u ON u.id = t.user_id
        WHERE jsonb_typeof(t.results) = 'array' AND r->>'url' = ANY($1::text[])""",
        urls,
    )
    return {r["url"]: r for r in rows}


async def delete_files(names: list[str]) -> int:
    """刪除檔案並從任務結果中移除對應網址；回傳實際刪除數。"""
    urls = [_url(n) for n in dict.fromkeys(names) if media.local_path(_url(n)) is not None]
    deleted = [u for u in urls if media.delete_local(u)]
    if urls:
        # 檔案已不存在的網址也一併從任務結果移除，避免歷史頁顯示破圖
        await db.execute(
            """UPDATE tasks SET results = COALESCE((
                SELECT jsonb_agg(r) FROM jsonb_array_elements(results) r
                WHERE NOT (r->>'url' = ANY($1::text[]))), '[]'::jsonb)
            WHERE jsonb_typeof(results) = 'array' AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(results) r WHERE r->>'url' = ANY($1::text[]))""",
            urls,
        )
    return len(deleted)


def expires_at(mtime: float) -> datetime:
    return datetime.fromtimestamp(mtime + RETENTION_DAYS * 86400, tz=timezone.utc)


async def cleanup_expired(now: float | None = None) -> int:
    cutoff = (now or time.time()) - RETENTION_DAYS * 86400
    expired = [f["name"] for f in list_files() if f["mtime"] < cutoff]
    if not expired:
        return 0
    n = await delete_files(expired)
    logger.info("清理超過 %d 天的生成圖片：%d 個", RETENTION_DAYS, n)
    return n


def cleanup_uploads(now: float | None = None) -> int:
    folder = media.MEDIA_DIR / "uploads"
    if not folder.is_dir():
        return 0
    cutoff = (now or time.time()) - UPLOAD_TTL_SECONDS
    n = 0
    for p in folder.iterdir():
        if p.is_file() and p.stat().st_mtime < cutoff:
            p.unlink(missing_ok=True)
            n += 1
    if n:
        logger.info("清理未使用的上傳參考圖：%d 個", n)
    return n


async def run_forever() -> None:
    while True:
        try:
            cleanup_uploads()
            await cleanup_expired()
        except Exception:
            logger.exception("生成圖片清理失敗")
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
