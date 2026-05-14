"""RunningHub API 代理：三種 auth 模式 + 暫時性錯誤重試。"""

import asyncio
import logging

import httpx
from fastapi import HTTPException

from app.core import config

logger = logging.getLogger(__name__)

# 共享 client：lifespan 啟停管理
_client: httpx.AsyncClient | None = None

# 單次請求 timeout：connect 慢就快點放棄；read 給 45s 但靠 retry 兜底。
# 上層 llm.py 的呼叫會帶自己的 timeout=，不受這裡影響。
_DEFAULT_TIMEOUT = httpx.Timeout(
    connect=10.0, read=config.RH_TIMEOUT_READ, write=20.0, pool=10.0
)

# RH 偶發連線錯誤（請求未送達）— 任何端點都可安全重試
_CONNECT_ERRORS: tuple = (
    httpx.ConnectTimeout,
    httpx.ConnectError,
    httpx.PoolTimeout,
)

# 讀取錯誤（請求可能已送達）— 只有冪等端點可安全重試
_READ_ERRORS: tuple = _CONNECT_ERRORS + (
    httpx.ReadTimeout,
    httpx.ReadError,
    httpx.RemoteProtocolError,
)


def init_client() -> None:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT)


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


async def _send_with_retry(
    send,
    *,
    idempotent: bool,
    max_attempts: int = 3,
) -> httpx.Response:
    """執行 httpx 呼叫並在暫時性錯誤上重試。

    idempotent=True  → 連線錯誤 + read timeout 都重試（query / list / get 類）
    idempotent=False → 只重試「請求未送達」的 connect 錯誤（submit / upload 類，
                      避免重複建立任務或扣費）
    backoff: 1s, 2s（最多 3 次嘗試 → 兩次重試）
    """
    retry_on = _READ_ERRORS if idempotent else _CONNECT_ERRORS
    last_exc: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return await send()
        except retry_on as e:
            last_exc = e
            if attempt + 1 >= max_attempts:
                break
            delay = 2 ** attempt
            logger.warning(
                "retry %d/%d after %s (sleep %ds)",
                attempt + 1, max_attempts, type(e).__name__, delay,
            )
            await asyncio.sleep(delay)
    assert last_exc is not None
    raise last_exc


def _raise_upstream(e: Exception) -> None:
    """把 httpx 例外轉成對應的 HTTPException 給前端。"""
    if isinstance(e, httpx.TimeoutException):
        raise HTTPException(status_code=504, detail="上游 API 請求逾時")
    logger.warning("upstream request failed: %s", e)
    raise HTTPException(status_code=502, detail="上游 API 請求失敗")


# ===== 三種 auth 模式 =====


async def get_node_info(webapp_id: str) -> dict:
    """GET /api/webapp/apiCallDemo（query apiKey）— 冪等讀。"""
    url = f"{_base_url()}/api/webapp/apiCallDemo"
    try:
        resp = await _send_with_retry(
            lambda: client().get(url, params={"apiKey": _api_key(), "webappId": webapp_id}),
            idempotent=True,
        )
        return resp.json()
    except Exception as e:
        _raise_upstream(e)


async def post_with_apikey(endpoint: str, body: dict, *, idempotent: bool = False) -> dict:
    """POST /task/openapi/* 等（body 注入 apiKey）。

    idempotent 預設 False：submit / mutate 端點不應在 read timeout 後重試
    （避免重複建任務 / 重複扣費）。read 端點呼叫端請明確傳 idempotent=True。
    """
    url = f"{_base_url()}{endpoint}"
    payload = {**body, "apiKey": _api_key()}
    try:
        resp = await _send_with_retry(
            lambda: client().post(url, json=payload),
            idempotent=idempotent,
        )
        return resp.json()
    except Exception as e:
        _raise_upstream(e)


async def post_with_bearer(endpoint: str, body: dict, *, idempotent: bool = False) -> dict:
    """POST /openapi/v2/*（Authorization: Bearer）。idempotent 同 post_with_apikey。"""
    url = f"{_base_url()}{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {_api_key()}",
    }
    try:
        resp = await _send_with_retry(
            lambda: client().post(url, json=body, headers=headers),
            idempotent=idempotent,
        )
        return resp.json()
    except Exception as e:
        _raise_upstream(e)


async def post_workflow(body: dict, instance_type: str = "default") -> dict:
    """workflow 提交：POST /task/openapi/create。提交端點，不重試 read timeout。

    instance_type:
      - "default" → 24G（不傳 instanceType）
      - "plus"    → 48G（body 加 instanceType: "plus"）
    """
    url = f"{_base_url()}/task/openapi/create"
    payload = {**body, "apiKey": _api_key()}
    if instance_type == "plus":
        payload["instanceType"] = "plus"
    try:
        resp = await _send_with_retry(
            lambda: client().post(url, json=payload),
            idempotent=False,
        )
        return resp.json()
    except Exception as e:
        _raise_upstream(e)


async def post_with_bearer_and_apikey(endpoint: str, body: dict | None = None, *, idempotent: bool = False) -> dict:
    """POST /uc/openapi/*（body 帶 apikey + Authorization: Bearer）。"""
    url = f"{_base_url()}{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {_api_key()}",
    }
    payload = {**(body or {}), "apikey": _api_key()}
    try:
        resp = await _send_with_retry(
            lambda: client().post(url, json=payload, headers=headers),
            idempotent=idempotent,
        )
        return resp.json()
    except Exception as e:
        _raise_upstream(e)


async def cancel_task(task_id: str) -> dict:
    """POST /task/openapi/cancel（body apiKey + Authorization: Bearer）。"""
    url = f"{_base_url()}/task/openapi/cancel"
    payload = {"apiKey": _api_key(), "taskId": task_id}
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {_api_key()}",
    }
    try:
        resp = await _send_with_retry(
            lambda: client().post(url, json=payload, headers=headers),
            idempotent=False,
        )
        return resp.json()
    except Exception as e:
        _raise_upstream(e)


async def upload_binary(filename: str, content: bytes, content_type: str) -> dict:
    """POST /openapi/v2/media/upload/binary（multipart + Bearer）— 只在連線錯誤時重試。"""
    url = f"{_base_url()}/openapi/v2/media/upload/binary"
    try:
        resp = await _send_with_retry(
            lambda: client().post(
                url,
                headers={"Authorization": f"Bearer {_api_key()}"},
                files={"file": (filename, content, content_type or "application/octet-stream")},
            ),
            idempotent=False,
        )
        return resp.json()
    except Exception as e:
        _raise_upstream(e)
