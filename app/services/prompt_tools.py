"""提示詞工具：翻譯、優化、分類建議（皆透過 llm.complete）。"""

import json
import re
from typing import Literal

from app.services import llm
from app.services.prompt_profiles import BASE_PROMPT, PROFILES

_WRAPPED_RE = re.compile(r"```[\w-]*[ \t]*\n(.*)\n```", re.S)
_PROMPT_OPEN_RE = re.compile(r"^(`{3,})prompt[ \t]*$", re.M)
_HEADING_RE = re.compile(r"^\s*#{1,6}\s+\S", re.M)
_FENCED_RE = re.compile(r"^```[\w-]*[ \t]*\n(.*?)\n```[ \t]*$", re.M | re.S)
MODES = ("t2i", "i2i", "edit")


def unwrap_fence(text: str) -> str:
    """整段回應被單一 ``` 包住時取內容；提示詞內部本來就有的程式碼區塊保持原樣。"""
    text = (text or "").strip()
    m = _WRAPPED_RE.fullmatch(text)
    return (m.group(1) if m else text).strip()


def prompt_block(text: str) -> str:
    """取出 ```prompt 區塊；區塊內本身含 ``` 程式碼區塊時不會被提早截斷。

    外層用 4 個以上反引號時找同長度的結尾；用 3 個時取最後一個 ``` 結尾行，
    因為內層程式碼區塊的 ``` 會出現在真正結尾之前。
    """
    text = text or ""
    m = _PROMPT_OPEN_RE.search(text)
    if not m:
        return unwrap_fence(text)
    fence = m.group(1)
    body = text[m.end() + 1 :]
    closes = list(re.finditer(rf"^{fence}(?!`)[ \t]*$", body, re.M))
    if not closes:
        return body.strip()
    end = closes[0] if len(fence) > 3 else closes[-1]
    return body[: end.start()].strip()


def _is_json(text: str) -> bool:
    try:
        json.loads(text)
        return True
    except ValueError:
        return False


def _json_parts(text: str) -> int:
    """整段是 JSON 算 1；否則計算內容為合法 JSON 的 ``` 區塊數。"""
    text = (text or "").strip()
    if text[:1] in "{[" and _is_json(text):
        return 1
    return sum(1 for b in _FENCED_RE.findall(text) if b.strip()[:1] in "{[" and _is_json(b))


def structure_issues(original: str, result: str) -> list[str]:
    """比對優化前後的結構：段落標題變少、JSON 失效都視為問題。"""
    issues = []
    before, after = len(_HEADING_RE.findall(original)), len(_HEADING_RE.findall(result))
    if after < before:
        issues.append(f"原提示詞有 {before} 個段落標題（# 開頭），結果只剩 {after} 個，有段落被刪除")
    if _json_parts(result) < _json_parts(original):
        issues.append("原提示詞中的 JSON 在結果中不完整或已不是合法 JSON")
    return issues


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
        + "\n\n" + OPTIMIZE_TASK
    )
    user = f"原提示詞：\n{prompt}\n\n優化需求：\n{request}"
    result = prompt_block(await llm.complete(system, user))
    issues = structure_issues(prompt, result)
    if not issues:
        return result
    # 結構被破壞時帶著具體問題重試一次，取問題較少的版本
    retry_user = (
        user
        + "\n\n你上一次的輸出有以下問題，請以原提示詞全文為基礎重新輸出完整內容：\n- "
        + "\n- ".join(issues)
        + f"\n\n上一次的輸出：\n{result}"
    )
    retried = prompt_block(await llm.complete(system, retry_user))
    return retried if len(structure_issues(prompt, retried)) <= len(issues) else result


OPTIMIZE_TASK = """本次任務：依使用者的優化需求修改提示詞，輸出修改後的「完整全文」。
- 原提示詞的全部內容都要保留並輸出，包含所有段落、標題（例如 ## Notes、## Reference Image、## 提示詞）、說明文字、清單、換行與 Markdown 格式。本任務中這些段落都屬於提示詞內容，不可當成解說而移除。
- 只修改與優化需求相關的部分；與需求無關的句子、段落、數值保持原樣，不要刪除、摘要、合併或重新排版。
- 原提示詞是 JSON（或含有 JSON 區塊）時，輸出仍須是合法 JSON：保持相同的鍵名、巢狀結構、陣列與順序，只改需要變更的值；不要把 JSON 改寫成自然語言，也不要增減鍵，除非需求明確要求。
- 只有在優化需求明確要求時，才刪除段落、翻譯、改格式或改結構。
- 只輸出一個提示詞區塊，外層一律用四個反引號包住：````prompt 開頭、```` 結尾，以免與內容裡的 ``` 程式碼區塊衝突。"""


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
