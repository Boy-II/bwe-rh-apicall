"""AI 助手聊天代理：OpenAI 相容格式優先，無設定時 fallback Gemini。"""

import httpx
from fastapi import HTTPException

from app.core import config


_DEFAULT_BASE_PROMPT = "你是 BWE AI 應用平台的 AI 助手，協助使用者選擇 AI 應用並撰寫提示詞。"


def _build_system_prompt(context: dict) -> str:
    """組合 system prompt：admin 設定的全域 prompt 在前，卡片 context 接在後面。"""
    base_prompt = (config.get_ai_system_prompt() or "").strip() or _DEFAULT_BASE_PROMPT

    parts: list[str] = [base_prompt]

    cards = context.get("cards", []) or []
    if cards:
        # 只列標題給 AI；description 是 user-facing，LLM 不需要
        cards_text = "\n".join(f"- {c.get('title', '')}" for c in cards)
        parts.append(f"可用應用：\n{cards_text}")

    current_card = context.get("currentCard") or {
        "title": context.get("cardTitle", ""),
        "llmNote": context.get("cardLlmNote", ""),
    }
    title = (current_card or {}).get("title", "")
    if title:
        parts.append(f"## 目前應用：{title}")

        # llm_note 是管理員專為 LLM 寫的功能說明（user 看不到）
        llm_note = (current_card or {}).get("llmNote", "")
        if llm_note:
            parts.append(
                "### 應用功能說明（管理員專為 AI 助手撰寫，回答此應用相關問題時請優先參考此段）：\n"
                f"{llm_note}"
            )

        node_info_list = context.get("nodeInfoList") or []
        if node_info_list:
            field_lines: list[str] = []
            for n in node_info_list:
                label = n.get("description") or n.get("descriptionEn") or n.get("fieldName") or ""
                fname = n.get("fieldName", "")
                ftype = n.get("fieldType", "STRING")
                fval = n.get("fieldValue")
                fval_repr = "（空）" if fval in (None, "") else str(fval)
                if len(fval_repr) > 120:
                    fval_repr = fval_repr[:120] + "…"
                field_lines.append(
                    f"- 「{label}」（欄位名 {fname}，類型 {ftype}，目前值：{fval_repr}）"
                )
            parts.append("### 可修改欄位（含目前值）：\n" + "\n".join(field_lines))

    parts.append("當建議提示詞時，用 ```prompt 區塊包裹，使用者可一鍵套用。")
    parts.append(
        "請用繁體中文回答。當使用者詢問當前應用的欄位用途、預設值或建議設定時，"
        "請直接依「應用說明」與「可修改欄位」段落作答；若這兩段沒提到才回答你的一般推測。"
    )
    return "\n".join(parts)


async def chat(
    http_client: httpx.AsyncClient,
    message: str,
    history: list,
    context: dict,
    images: list[str] | None = None,
) -> str:
    """回傳 AI 文字回應；錯誤時丟 HTTPException。"""
    ai_base = config.get_ai_base_url().rstrip("/")
    ai_key = config.get_ai_api_key()
    ai_model = config.get_ai_model()
    imgs = images or []

    if ai_base and ai_key and ai_model:
        return await _chat_openai(http_client, message, history, context, imgs, ai_base, ai_key, ai_model)

    if config.GEMINI_API_KEY:
        return await _chat_gemini(http_client, message, history, context, imgs)

    raise HTTPException(status_code=503, detail="AI 助手未設定，請在管理介面配置 AI 設定")


async def _chat_openai(
    http_client: httpx.AsyncClient,
    message: str,
    history: list,
    context: dict,
    images: list[str],
    base: str,
    api_key: str,
    model: str,
) -> str:
    system_prompt = _build_system_prompt(context)
    messages: list[dict] = [{"role": "system", "content": system_prompt}]
    for h in history:
        role = "user" if h.get("role") == "user" else "assistant"
        messages.append({"role": role, "content": h.get("text", "")})

    if images:
        user_content: list | str = [{"type": "text", "text": message}]
        for img in images:
            user_content.append({"type": "image_url", "image_url": {"url": img}})
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
            if images:
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
    images: list[str],
) -> str:
    system_prompt = _build_system_prompt(context)

    contents: list[dict] = []
    for h in history:
        role = "user" if h.get("role") == "user" else "model"
        contents.append({"role": role, "parts": [{"text": h.get("text", "")}]})

    user_parts: list[dict] = [{"text": message}]
    for image in images or []:
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
