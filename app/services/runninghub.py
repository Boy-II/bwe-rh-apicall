"""RunningHub API 代理：三種 auth 模式封裝。"""

import httpx
from fastapi import HTTPException

from app.core import config

# 共享 client：lifespan 啟停管理
_client: httpx.AsyncClient | None = None


def init_client() -> None:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=60.0)


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def client() -> httpx.AsyncClient:
    if _client is None:
        raise RuntimeError("httpx client 尚未初始化")
    return _client


def _api_key() -> str:
    return config.RUNNINGHUB_API_KEY


def _base_url() -> str:
    return config.RUNNINGHUB_BASE_URL


# ===== 三種 auth 模式 =====


async def get_node_info(webapp_id: str) -> dict:
    """GET /api/webapp/apiCallDemo（query apiKey）"""
    url = f"{_base_url()}/api/webapp/apiCallDemo"
    try:
        resp = await client().get(url, params={"apiKey": _api_key(), "webappId": webapp_id})
        return resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="RunningHub API 請求逾時")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"請求失敗: {e}")


async def post_with_apikey(endpoint: str, body: dict) -> dict:
    """POST /task/openapi/*（body 注入 apiKey）"""
    url = f"{_base_url()}{endpoint}"
    try:
        resp = await client().post(url, json={**body, "apiKey": _api_key()})
        return resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="RunningHub API 請求逾時")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"請求失敗: {e}")


async def post_with_bearer(endpoint: str, body: dict) -> dict:
    """POST /openapi/v2/*（Authorization: Bearer）"""
    url = f"{_base_url()}{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {_api_key()}",
    }
    try:
        resp = await client().post(url, json=body, headers=headers)
        return resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="RunningHub API 請求逾時")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"請求失敗: {e}")


async def upload_binary(filename: str, content: bytes, content_type: str) -> dict:
    """POST /openapi/v2/media/upload/binary（multipart + Bearer）"""
    url = f"{_base_url()}/openapi/v2/media/upload/binary"
    try:
        resp = await client().post(
            url,
            headers={"Authorization": f"Bearer {_api_key()}"},
            files={"file": (filename, content, content_type or "application/octet-stream")},
        )
        return resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"上傳失敗: {e}")
