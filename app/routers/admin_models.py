"""管理員：生圖模型清單 CRUD 與 OpenAI 格式圖片路由設定。"""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core import auth, config, db
from app.services import image_registry, llm, runninghub

router = APIRouter()

_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
_TYPES = {"STRING", "LIST", "INT", "FLOAT", "BOOLEAN", "IMAGE"}


class ModelBody(BaseModel):
    key: str
    displayName: str
    mode: str
    provider: str
    upstream: str
    profile: str = "generic"
    params: list[dict] = Field(default_factory=list)
    enabled: bool = True
    sortOrder: int = 0


class ModelPatch(BaseModel):
    displayName: str | None = None
    mode: str | None = None
    provider: str | None = None
    upstream: str | None = None
    profile: str | None = None
    params: list[dict] | None = None
    enabled: bool | None = None
    sortOrder: int | None = None


class RouteBody(BaseModel):
    baseUrl: str
    apiKey: str = ""


def validate_model_def(m: dict) -> None:
    if not _KEY_RE.match(m["key"]):
        raise ValueError("key 只能用小寫英數與連字號（2–64 字）")
    if not m["displayName"].strip():
        raise ValueError("請填顯示名稱")
    if m["mode"] not in ("text-to-image", "image-to-image"):
        raise ValueError("模式必須是 text-to-image 或 image-to-image")
    if m["provider"] not in ("runninghub", "openai"):
        raise ValueError("路由必須是 runninghub 或 openai")
    if not m["upstream"].strip():
        raise ValueError("請填上游模型 ID／endpoint")
    keys = set()
    for p in m["params"]:
        if not isinstance(p, dict) or not isinstance(p.get("fieldKey"), str) or p.get("type") not in _TYPES:
            raise ValueError("params 每項需有 fieldKey 與合法 type（STRING/LIST/INT/FLOAT/BOOLEAN/IMAGE）")
        if p["type"] == "LIST" and not isinstance(p.get("options"), list):
            raise ValueError(f"{p['fieldKey']}：LIST 欄位需有 options 陣列")
        keys.add(p["fieldKey"])
    if "prompt" not in keys:
        raise ValueError("params 必須包含 prompt 欄位")
    has_image = any(p["type"] == "IMAGE" for p in m["params"])
    if m["mode"] == "image-to-image" and not has_image:
        raise ValueError("圖生圖模型至少需要一個圖片（IMAGE）欄位")


async def _save(m: dict, insert: bool) -> None:
    sql = (
        """INSERT INTO image_models(key,display_name,mode,provider,upstream,profile,params,enabled,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)"""
        if insert
        else """UPDATE image_models SET display_name=$2,mode=$3,provider=$4,upstream=$5,profile=$6,
        params=$7,enabled=$8,sort_order=$9,updated_at=NOW() WHERE key=$1"""
    )
    await db.execute(
        sql, m["key"], m["displayName"].strip(), m["mode"], m["provider"], m["upstream"].strip(),
        m["profile"], m["params"], m["enabled"], m["sortOrder"],
    )


@router.get("/api/admin/image-models")
async def list_models(_: str = Depends(auth.require_admin)):
    return await image_registry.list(enabled_only=False)


@router.post("/api/admin/image-models")
async def create_model(body: ModelBody, _: str = Depends(auth.require_admin)):
    m = body.model_dump()
    try:
        validate_model_def(m)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    if await image_registry.get(m["key"]):
        raise HTTPException(status_code=409, detail="key 已存在")
    await _save(m, insert=True)
    return await image_registry.get(m["key"])


@router.patch("/api/admin/image-models/{key}")
async def update_model(key: str, body: ModelPatch, _: str = Depends(auth.require_admin)):
    current = await image_registry.get(key)
    if not current:
        raise HTTPException(status_code=404, detail="模型不存在")
    m = {**current, **body.model_dump(exclude_none=True)}
    try:
        validate_model_def(m)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    await _save(m, insert=False)
    return await image_registry.get(key)


@router.delete("/api/admin/image-models/{key}")
async def delete_model(key: str, _: str = Depends(auth.require_admin)):
    await db.execute("DELETE FROM image_models WHERE key=$1", key)
    return {"success": True}


async def _upsert(key: str, value: str) -> None:
    await db.execute(
        """INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()""",
        key,
        value,
    )
    config.set_db_setting(key, value)


@router.get("/api/admin/openai-route")
async def get_route(_: str = Depends(auth.require_admin)):
    return {
        "baseUrl": config.get_openai_image_base_url(),
        "hasApiKey": bool(config.get_openai_image_api_key()),
    }


@router.post("/api/admin/openai-route")
async def save_route(body: RouteBody, _: str = Depends(auth.require_admin)):
    await _upsert("openai_image_base_url", body.baseUrl.strip().rstrip("/"))
    if body.apiKey.strip():
        await _upsert("openai_image_api_key", body.apiKey.strip())
    return {"success": True}


@router.post("/api/admin/openai-route/models")
async def route_models(_: str = Depends(auth.require_admin)):
    base = config.get_openai_image_base_url()
    if not base:
        raise HTTPException(status_code=400, detail="請先設定 Base URL")
    models = await llm.fetch_models(runninghub.client(), base, config.get_openai_image_api_key())
    return {"models": models}
