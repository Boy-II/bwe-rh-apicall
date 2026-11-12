"""OpenAI 格式圖片路由（OmniRoute）：後端背景執行，結果轉存自有儲存。

OpenAI images API 是同步回應（可能數十秒到數分鐘），所以 submit 只建任務並排背景執行；
前端沿用既有輪詢（queryTaskOutputs 直接讀 DB）。
"""

import asyncio
import base64
import logging

import httpx
from fastapi import HTTPException

from app.core import config, db
from app.services import media

logger = logging.getLogger(__name__)

STALE_MINUTES = 15
TIMEOUT_SECONDS = 300
_transport: httpx.AsyncBaseTransport | None = None  # 測試注入
_background: set[asyncio.Task] = set()


def _image_fields(model: dict) -> list[str]:
    return [p["fieldKey"] for p in model["params"] if p["type"] == "IMAGE"]


def build_request(model: dict, payload: dict) -> dict:
    """schema 的 fieldKey 即 OpenAI 欄位名；IMAGE 欄位另以 multipart 傳送。"""
    images = set(_image_fields(model))
    body = {"model": model["upstream"], "prompt": payload["prompt"], "n": 1}
    body.update({k: v for k, v in payload.items() if k != "prompt" and k not in images})
    return body


def _error_text(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        msg = (data.get("error") or {}).get("message") or data.get("message")
    except Exception:
        msg = None
    return f"上游錯誤 HTTP {resp.status_code}：{msg or resp.text[:300]}"


async def _call(client: httpx.AsyncClient, model: dict, payload: dict) -> bytes:
    base = config.get_openai_image_base_url()
    headers = {"Authorization": f"Bearer {config.get_openai_image_api_key()}"}
    body = build_request(model, payload)
    if model["mode"] == "image-to-image":
        files = []
        for field in _image_fields(model):
            value = payload.get(field) or []
            for i, url in enumerate(value if isinstance(value, list) else [value]):
                content = await media.read(url, client)
                ext = media.image_ext(content)
                files.append(("image[]", (f"ref{i}.{ext}", content, f"image/{'jpeg' if ext == 'jpg' else ext}")))
        data = {k: str(v) for k, v in body.items()}
        resp = await client.post(f"{base}/v1/images/edits", data=data, files=files, headers=headers)
    else:
        resp = await client.post(f"{base}/v1/images/generations", json=body, headers=headers)
    if not resp.is_success:
        raise RuntimeError(_error_text(resp))
    try:
        item = resp.json()["data"][0]
    except Exception:
        raise RuntimeError("上游回應格式異常（缺少 data）") from None
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    if item.get("url"):
        return await media.read(item["url"], client)
    raise RuntimeError("上游回應沒有圖片")


async def run(task_id: str, model: dict, payload: dict) -> None:
    try:
        async with httpx.AsyncClient(
            timeout=TIMEOUT_SECONDS, transport=_transport, follow_redirects=True
        ) as client:
            content = await _call(client, model, payload)
        url = media.save_bytes("results", content, media.image_ext(content))
        await db.execute(
            """UPDATE tasks SET status='SUCCESS', results=$2, completed_at=NOW()
            WHERE id=$1 AND status='RUNNING'""",
            task_id,
            [{"url": url, "fileType": "image"}],
        )
    except Exception as e:  # 背景任務：任何錯誤都要落到 DB，不能讓任務卡住
        msg = str(e) if isinstance(e, (RuntimeError, media.MediaError)) else f"生成失敗：{e}"
        if isinstance(e, httpx.TimeoutException):
            msg = "上游生成逾時，請稍後再試"
        logger.warning("openai image task %s failed: %s", task_id, msg)
        await db.execute(
            """UPDATE tasks SET status='FAILED', error_message=$2, completed_at=NOW()
            WHERE id=$1 AND status='RUNNING'""",
            task_id,
            msg[:1000],
        )


async def submit(local_id: str, user_id: str, model: dict, payload: dict, inputs: list, raw: dict) -> dict:
    if not config.get_openai_image_base_url():
        raise HTTPException(status_code=503, detail="尚未設定 OpenAI 圖片路由")
    await db.execute(
        """INSERT INTO tasks(id,user_id,card_id,card_title,card_type,webapp_id,rh_task_id,status,node_input,model_key,provider,raw_response)
        VALUES($1,$2,NULL,$3,'model','',$1,'RUNNING',$4,$5,'openai',$6)""",
        local_id,
        user_id,
        model["displayName"],
        inputs,
        model["key"],
        raw,
    )
    task = asyncio.create_task(run(local_id, model, payload))
    _background.add(task)
    task.add_done_callback(_background.discard)
    return {"taskId": local_id}


async def drain() -> None:
    """等待目前所有背景任務（測試與關機用）。"""
    if _background:
        await asyncio.gather(*list(_background), return_exceptions=True)


async def query(task: dict) -> dict:
    status, error = task["status"], task.get("error_message")
    if status == "RUNNING":
        stale = await db.fetch_val(
            f"SELECT created_at < NOW() - INTERVAL '{STALE_MINUTES} minutes' FROM tasks WHERE id=$1",
            task["id"],
        )
        if stale:
            error = "服務重啟或逾時，請重新生成"
            await db.execute(
                "UPDATE tasks SET status='FAILED', error_message=$2, completed_at=NOW() WHERE id=$1 AND status='RUNNING'",
                task["id"],
                error,
            )
            status = "FAILED"
    results = [
        {"url": r["url"], "outputType": r.get("fileType") or "image"}
        for r in (task.get("results") or [])
        if r.get("url")
    ]
    return {"status": status, "results": results, "errorMessage": error}


async def cancel(task: dict) -> dict:
    await db.execute(
        """UPDATE tasks SET status='CANCELED', error_message='使用者取消', completed_at=NOW()
        WHERE id=$1 AND status='RUNNING'""",
        task["id"],
    )
    return {"code": 0, "msg": "success"}
