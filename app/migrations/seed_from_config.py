"""一次性匯入：將舊版 config.json 的 cards / users / AI 設定 / jwtSecret 寫入 PG。

行為：
    - 若 cards / users 表已有資料 → 跳過匯入（避免重複套用）
    - 設定（ai_*, jwt_secret）只在 settings 表沒有對應 key 時才寫
    - 完成後將 config.json 改名為 config.json.migrated.bak

可手動執行：`python -m app.migrations.seed_from_config`
"""

import asyncio
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.core import db

logger = logging.getLogger(__name__)


def _resolve_config_path() -> Path:
    """跟舊 server.py 一樣：優先 /card/config.json，否則 ./config.json。"""
    persistent = Path("/card/config.json")
    local = Path(__file__).resolve().parents[2] / "config.json"
    return persistent if persistent.parent.exists() else local


def _parse_iso(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return datetime.now(timezone.utc)


async def _import_cards(cards: list[dict]) -> int:
    if not cards:
        return 0
    existing = await db.fetch_val("SELECT COUNT(*) FROM cards")
    if existing > 0:
        logger.info("cards 表已有 %d 筆，跳過匯入", existing)
        return 0

    rows = []
    for idx, c in enumerate(cards):
        rows.append(
            (
                c.get("id") or "",
                c.get("webappId") or "",
                c.get("title") or "",
                c.get("description") or "",
                c.get("icon") or "🎨",
                c.get("color") or "#6C5CE7",
                idx,  # sort_order：依原始順序
                _parse_iso(c.get("createdAt", "")),
            )
        )

    await db.execute_many(
        """
        INSERT INTO cards (id, webapp_id, title, description, icon, color, sort_order, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        """,
        rows,
    )
    logger.info("匯入 %d 張卡片", len(rows))
    return len(rows)


async def _import_users(users: list[dict]) -> int:
    if not users:
        return 0
    existing = await db.fetch_val("SELECT COUNT(*) FROM users")
    if existing > 0:
        logger.info("users 表已有 %d 筆，跳過匯入", existing)
        return 0

    rows = []
    for u in users:
        rows.append(
            (
                u.get("id") or "",
                (u.get("username") or "").strip().lower(),
                u.get("passwordHash") or "",
                u.get("status") or "pending",
                "user",
                _parse_iso(u.get("createdAt", "")),
            )
        )
    await db.execute_many(
        """
        INSERT INTO users (id, username, password_hash, status, role, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT (username) DO NOTHING
        """,
        rows,
    )
    logger.info("匯入 %d 個用戶", len(rows))
    return len(rows)


async def _import_settings(cfg: dict) -> int:
    """只匯 AI 設定 + jwtSecret，env 沒設且 settings 表沒有 key 時才寫。"""
    pairs: list[tuple[str, str]] = []
    if cfg.get("aiBaseUrl"):
        pairs.append(("ai_base_url", cfg["aiBaseUrl"]))
    if cfg.get("aiApiKey"):
        pairs.append(("ai_api_key", cfg["aiApiKey"]))
    if cfg.get("aiModel"):
        pairs.append(("ai_model", cfg["aiModel"]))
    if cfg.get("jwtSecret"):
        pairs.append(("jwt_secret", cfg["jwtSecret"]))

    if not pairs:
        return 0

    inserted = 0
    for key, value in pairs:
        # 直接傳 Python 值，由 JSONB codec 自動 encode（避免雙重 json.dumps）
        result = await db.execute(
            """
            INSERT INTO settings (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key) DO NOTHING
            """,
            key,
            value,
        )
        if "INSERT 0 1" in result:
            inserted += 1
    logger.info("寫入 %d 筆 settings（已存在的 key 保持不動）", inserted)
    return inserted


async def run_seed() -> bool:
    """執行匯入；若 config.json 不存在則跳過。回傳是否實際做了匯入。"""
    config_path = _resolve_config_path()
    if not config_path.exists():
        logger.info("找不到 %s，跳過匯入（DB 為主）", config_path.name)
        return False

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        logger.warning("config.json 解析失敗：%s", e)
        return False

    cards_count = await _import_cards(cfg.get("cards", []))
    users_count = await _import_users(cfg.get("users", []))
    settings_count = await _import_settings(cfg)

    did_anything = cards_count + users_count + settings_count > 0

    if did_anything:
        backup = config_path.with_suffix(config_path.suffix + ".migrated.bak")
        try:
            config_path.rename(backup)
            logger.info("已將 %s 改名為 %s", config_path.name, backup.name)
        except Exception as e:
            logger.warning("改名 %s 失敗（可手動處理）：%s", config_path.name, e)

    return did_anything


async def _cli() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
    logger.info("連線資料庫...")
    await db.init_pool()
    try:
        await run_seed()
        return 0
    finally:
        await db.close_pool()


if __name__ == "__main__":
    sys.exit(asyncio.run(_cli()))
