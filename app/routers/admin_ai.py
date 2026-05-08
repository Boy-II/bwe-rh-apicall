"""管理員 AI 設定端點：GET/POST 設定、測試連線拉模型。"""

from fastapi import APIRouter, Depends

from app.core import auth, config, db
from app.schemas import AIConfigRequest, AIModelsRequest
from app.services import llm, runninghub

router = APIRouter()


@router.get("/api/admin/ai-config")
async def get_ai_config(_: str = Depends(auth.require_admin)):
    return {
        "aiBaseUrl": config.get_ai_base_url(),
        "aiModel": config.get_ai_model(),
        "hasApiKey": bool(config.get_ai_api_key()),
        "aiSystemPrompt": config.get_ai_system_prompt(),
        "costCurrency": config.get_cost_currency(),
    }


@router.post("/api/admin/ai-config")
async def save_ai_config(req: AIConfigRequest, _: str = Depends(auth.require_admin)):
    """儲存到 settings 表 + 更新 in-memory 快取。

    - aiBaseUrl/aiModel 一律覆寫
    - aiApiKey 留空表示「保留現有」
    - aiSystemPrompt: None=不更動；空字串=清除
    """
    base = req.aiBaseUrl.strip()
    model = req.aiModel.strip()
    new_key = req.aiApiKey.strip()

    await _upsert("ai_base_url", base)
    await _upsert("ai_model", model)
    if new_key:
        await _upsert("ai_api_key", new_key)
    if req.aiSystemPrompt is not None:
        await _upsert("ai_system_prompt", req.aiSystemPrompt.strip())
    if req.costCurrency is not None and req.costCurrency.strip():
        await _upsert("cost_currency", req.costCurrency.strip().upper())

    config.set_db_setting("ai_base_url", base)
    config.set_db_setting("ai_model", model)
    if new_key:
        config.set_db_setting("ai_api_key", new_key)
    if req.aiSystemPrompt is not None:
        config.set_db_setting("ai_system_prompt", req.aiSystemPrompt.strip())
    if req.costCurrency is not None and req.costCurrency.strip():
        config.set_db_setting("cost_currency", req.costCurrency.strip().upper())
    return {"success": True}


@router.post("/api/admin/ai-models")
async def fetch_ai_models(req: AIModelsRequest, _: str = Depends(auth.require_admin)):
    api_key = req.aiApiKey.strip() or config.get_ai_api_key()
    models = await llm.fetch_models(runninghub.client(), req.aiBaseUrl, api_key)
    return {"models": models}


# ===== helper =====


async def _upsert(key: str, value: str) -> None:
    # 直接傳 Python 值，由 JSONB codec 自動 encode
    await db.execute(
        """
        INSERT INTO settings (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
        """,
        key,
        value,
    )
