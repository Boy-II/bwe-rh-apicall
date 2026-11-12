"""提示詞工具：翻譯、優化、分類建議（皆透過 llm.complete）。"""

import json
import re
from typing import Literal

from app.services import llm
from app.services.prompt_profiles import BASE_PROMPT, PROFILES

_WRAPPED_RE = re.compile(r"```[\w-]*[ \t]*\n(.*)\n```", re.S)
_PROMPT_BLOCK_RE = re.compile(r"```prompt[ \t]*\n(.*?)\n```", re.S)
MODES = ("t2i", "i2i", "edit")


def unwrap_fence(text: str) -> str:
    """整段回應被單一 ``` 包住時取內容；提示詞內部本來就有的程式碼區塊保持原樣。"""
    text = (text or "").strip()
    m = _WRAPPED_RE.fullmatch(text)
    return (m.group(1) if m else text).strip()


def prompt_block(text: str) -> str:
    m = _PROMPT_BLOCK_RE.search(text or "")
    return m.group(1).strip() if m else unwrap_fence(text)


async def translate(text: str, target: Literal["en", "zh"]) -> str:
    lang = "英文" if target == "en" else "繁體中文（台灣用語）"
    system = (
        f"你是圖片生成提示詞翻譯員。把使用者提供的提示詞翻譯成{lang}，保持原意、結構與細節，"
        "不增刪內容。引號內、要出現在圖片中的文字（標語、品牌、包裝文字）保留原文不翻譯。"
        "只輸出翻譯後的提示詞本文，不要解說。"
    )
    return unwrap_fence(await llm.complete(system, text))


async def optimize(prompt: str, request: str, profile: str) -> str:
    rules = PROFILES.get(profile, PROFILES["generic"])
    system = (
        BASE_PROMPT
        + "\n\n目前提示詞模型規則：\n"
        + rules
        + "\n\n本次任務：依使用者的優化需求改寫提示詞，只輸出一個 ```prompt 區塊。"
    )
    user = f"原提示詞：\n{prompt}\n\n優化需求：\n{request}"
    return prompt_block(await llm.complete(system, user))


def _parse_json(text: str) -> dict:
    text = unwrap_fence(text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise
        data = json.loads(text[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("not an object")
    return data


async def suggest_meta(prompt: str, categories: list[dict], hint_title: str = "") -> dict:
    cats = "\n".join(f"- {c['id']}：{c['name']}" for c in categories)
    system = (
        "你替圖片生成提示詞建立範本資料。只回傳 JSON 物件，欄位："
        '{"title": 繁體中文標題（20 字內）, "categoryId": 下列分類 id 之一, '
        '"tags": 繁體中文標籤陣列（最多 6 個）, "mode": "t2i"|"i2i"|"edit"}。'
        "mode：純文字生成用 t2i；需要使用者提供照片並轉換風格或內容用 i2i；"
        "在原圖上局部修改（換衣、改表情、換姿勢、換背景）用 edit。\n分類：\n" + cats
    )
    user = (f"原標題參考：{hint_title}\n\n" if hint_title else "") + f"提示詞：\n{prompt[:6000]}"
    data = None
    for _ in range(2):
        try:
            data = _parse_json(await llm.complete(system, user, json_mode=True))
            break
        except (ValueError, json.JSONDecodeError):
            continue
    if data is None:
        raise ValueError("AI 回傳格式錯誤")
    ids = {c["id"] for c in categories}
    tags = [str(t).strip() for t in (data.get("tags") or []) if str(t).strip()][:6]
    mode = data.get("mode") if data.get("mode") in MODES else "t2i"
    return {
        "title": str(data.get("title") or hint_title or "未命名範本").strip()[:20],
        "categoryId": data.get("categoryId") if data.get("categoryId") in ids else "creative",
        "tags": tags,
        "mode": mode,
    }
