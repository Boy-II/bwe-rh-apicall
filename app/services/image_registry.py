"""生圖模型清單（image_models 表）：生成頁下拉選單與 API 路由的唯一來源。"""

import json
import re
from pathlib import Path

from app.core import db

_CATALOG_PATH = Path(__file__).parents[1] / "data/image_models.json"
_OMNIROUTE_PATH = Path(__file__).parents[1] / "data/omniroute_models.json"

# 只保留這些 RunningHub 模型（不含 Midjourney、Seedream）
KEEP_KEYS = [
    ("gemini-pro-text", "Gemini Pro"),
    ("gemini-pro-image", "Gemini Pro"),
    ("gemini-flash-text", "Gemini Flash"),
    ("gemini-flash-image", "Gemini Flash"),
    ("gpt-image-2-text", "GPT Image 2"),
    ("gpt-image-2-image", "GPT Image 2"),
]

MODEL_LABELS = ("Gemini", "GPT", "Grok", "ComfyUI")
_FAMILY_RULES = [
    ("ComfyUI", re.compile(r"comfy", re.I)),
    ("Grok", re.compile(r"grok", re.I)),
    ("Gemini", re.compile(r"gemini|nano[\s-]?banana", re.I)),
    ("GPT", re.compile(r"gpt|chatgpt|openai|dall", re.I)),
]


def model_family(text: str) -> str:
    """把模型 key／上游 ID／顯示名稱或提示詞內文歸類成短標籤；判斷不出來回空字串。"""
    for label, rule in _FAMILY_RULES:
        if rule.search(text or ""):
            return label
    return ""


_COLUMNS = "key, display_name, mode, provider, upstream, profile, params, enabled, sort_order"


def to_dict(row: dict) -> dict:
    return {
        "key": row["key"],
        "displayName": row["display_name"],
        "mode": row["mode"],
        "provider": row["provider"],
        "upstream": row["upstream"],
        "profile": row["profile"],
        "params": row["params"] or [],
        "enabled": row["enabled"],
        "sortOrder": row["sort_order"],
    }


async def seed_image_models() -> None:
    catalog = {m["key"]: m for m in json.loads(_CATALOG_PATH.read_text())["models"]}
    for order, (key, display_name) in enumerate(KEEP_KEYS):
        m = catalog[key]
        await db.execute(
            """INSERT INTO image_models(key, display_name, mode, provider, upstream, profile, params, sort_order)
            VALUES($1,$2,$3,'runninghub',$4,$5,$6,$7) ON CONFLICT(key) DO NOTHING""",
            key,
            display_name,
            m["mode"],
            m["endpoint"],
            m["profile"],
            m["params"],
            order,
        )
    # OmniRoute 預設模型：先停用，管理員設定好路由後再啟用；已存在則不覆寫
    for m in json.loads(_OMNIROUTE_PATH.read_text())["models"]:
        await db.execute(
            """INSERT INTO image_models(key, display_name, mode, provider, upstream, profile, params, enabled, sort_order)
            VALUES($1,$2,$3,'openai',$4,$5,$6,FALSE,$7) ON CONFLICT(key) DO NOTHING""",
            m["key"],
            m["displayName"],
            m["mode"],
            m["upstream"],
            m["profile"],
            m["params"],
            m["sortOrder"],
        )


async def get(key: str) -> dict | None:
    row = await db.fetch_one(f"SELECT {_COLUMNS} FROM image_models WHERE key=$1", key)
    return to_dict(row) if row else None


async def list(enabled_only: bool = True) -> list[dict]:  # noqa: A001 - 介面名稱沿用計畫
    where = "WHERE enabled" if enabled_only else ""
    rows = await db.fetch_all(
        f"SELECT {_COLUMNS} FROM image_models {where} ORDER BY sort_order, key"
    )
    return [to_dict(r) for r in rows]
