"""AI 助手聊天代理：OpenAI 相容格式優先，無設定時 fallback Gemini。"""

import httpx
from fastapi import HTTPException

from app.core import config


def _build_system_prompt(context: dict) -> str:
    cards = context.get("cards", []) or []
    current_card = context.get("currentCard")
    node_info_list = context.get("nodeInfoList") or []

    cards_text = (
        "\n".join(f"- {c.get('title', '')}（{c.get('description', '')}）" for c in cards)
        if cards
        else "（尚無可用應用）"
    )

    parts = [
        "你是 BWE-RH APICall 的 AI 助手，協助使用者選擇 AI 應用並撰寫提示詞。",
        f"可用應用：\n{cards_text}",
    ]

    if current_card:
        node_fields = "、".join(
            n.get("description", n.get("nodeId", ""))
            for n in node_info_list
            if n.get("fieldType") == "STRING"
        )
        parts.append(
            f"目前應用：{current_card.get('title', '')}，"
            f"可修改欄位：{node_fields or '（無文字欄位）'}"
        )

    parts.append("當建議提示詞時，用 ```prompt 區塊包裹，使用者可一鍵套用。")
    parts.append("請用繁體中文回答。")
    return "\n".join(parts)


async def chat(
    http_client: httpx.AsyncClient,
    message: str,
    history: list,
    context: dict,
    image: str,
) -> str:
    """回傳 AI 文字回應；錯誤時丟 HTTPException。"""
    ai_base = config.get_ai_base_url().rstrip("/")
    ai_key = config.get_ai_api_key()
    ai_model = config.get_ai_model()

    if ai_base and ai_key and ai_model:
        return await _chat_openai(http_client, message, history, context, image, ai_base, ai_key, ai_model)

    if config.GEMINI_API_KEY:
        return await _chat_gemini(http_client, message, history, context, image)

    raise HTTPException(status_code=503, detail="AI 助手未設定，請在管理介面配置 AI 設定")


async def _chat_openai(
    http_client: httpx.AsyncClient,
    message: str,
    history: list,
    context: dict,
    image: str,
    base: str,
    api_key: str,
    model: str,
) -> str:
    system_prompt = _build_system_prompt(context)
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for h in history:
        role = "user" if h.get("role") == "user" else "assistant"
        messages.append({"role": role, "content": h.get("text", "")})

    if image:
        user_content: list | str = [
            {"type": "text", "text": message},
            {"type": "image_url", "image_url": {"url": image}},
        ]
    else:
        user_content = message
    messages.append({"role": "user", "content": user_content})

    url = f"{base}/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": messages, "temperature": 0.7, "max_tokens": 2048}

    try:
        resp = await http_client.post(url, json=payload, headers=headers, timeout=60.0)
        data = resp.json()
        if not resp.is_success:
            err_msg = (
                data.get("error", {}).get("message")
                or data.get("message")
                or f"HTTP {resp.status_code}"
            )
            if image:
                err_msg += "（提示：請確認所選模型支援圖片輸入）"
            raise HTTPException(status_code=502, detail=err_msg)
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError):
            err_msg = data.get("error", {}).get("message", "AI 回應格式異常")
            raise HTTPException(status_code=502, detail=err_msg)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="AI API 請求逾時")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI 請求失敗: {e}")


async def _chat_gemini(
    http_client: httpx.AsyncClient,
    message: str,
    history: list,
    context: dict,
    image: str,
) -> str:
    system_prompt = _build_system_prompt(context)

    contents: list[dict] = []
    for h in history:
        role = "user" if h.get("role") == "user" else "model"
        contents.append({"role": role, "parts": [{"text": h.get("text", "")}]})

    user_parts: list[dict] = [{"text": message}]
    if image:
        try:
            header, b64data = image.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0]
        except Exception:
            mime_type, b64data = "image/jpeg", image
        user_parts.append({"inlineData": {"mimeType": mime_type, "data": b64data}})
    contents.append({"role": "user", "parts": user_parts})

    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
    }

    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash-preview-04-17:generateContent?key={config.GEMINI_API_KEY}"
    )
    try:
        resp = await http_client.post(url, json=payload, timeout=30.0)
        data = resp.json()
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            err_msg = data.get("error", {}).get("message", "Gemini 回應格式異常")
            raise HTTPException(status_code=502, detail=err_msg)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Gemini API 請求逾時")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini 請求失敗: {e}")


# ===== 模型清單拉取（用於 admin 「測試連線」）=====


async def fetch_models(http_client: httpx.AsyncClient, base_url: str, api_key: str) -> list[str]:
    base = base_url.rstrip("/")
    url = f"{base}/v1/models"
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        resp = await http_client.get(url, headers=headers, timeout=10.0)
        data = resp.json()
        models = [m["id"] for m in data.get("data", [])]
        return sorted(models)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="模型列表請求逾時")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"無法取得模型列表: {e}")
