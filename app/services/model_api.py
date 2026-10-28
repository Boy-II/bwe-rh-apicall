"""Standard model API; deliberately separate from legacy workflow uploads."""

import asyncio
import logging

import httpx
from fastapi import HTTPException

from app.core import config
from app.services import runninghub

logger = logging.getLogger(__name__)

async def _post(path: str, *, payload=None, files=None, idempotent=False) -> dict:
    if not config.RUNNINGHUB_API_KEY:
        raise HTTPException(status_code=503, detail="尚未設定 RunningHub API Key")
    for attempt in range(3):
        try:
            response = await runninghub.client().post(
                config.RUNNINGHUB_MODEL_BASE_URL + "/" + path,
                json=payload,
                files=files,
                headers={"Authorization": "Bearer " + config.RUNNINGHUB_API_KEY},
            )
        except httpx.RequestError as e:
            if idempotent and attempt < 2:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            raise HTTPException(
                status_code=504 if isinstance(e, httpx.TimeoutException) else 502,
                detail="模型 API 連線失敗；提交結果不明時請先查看 RunningHub 任務紀錄，勿重複送出",
            ) from None
        if (
            idempotent
            and (response.status_code == 429 or response.status_code >= 500)
            and attempt < 2
        ):
            await asyncio.sleep(0.5 * (attempt + 1))
            continue
        try:
            data = response.json()
        except ValueError:
            raise HTTPException(
                status_code=502, detail="模型 API 回應格式錯誤"
            ) from None
        # v2 rejects with HTTP 200 + errorCode/errorMessage and an empty taskId;
        # such a request created no task, so surface the upstream reason.
        if isinstance(data, dict) and data.get("errorCode") not in (None, "", "0", 0):
            logger.warning(
                "RunningHub %s rejected: errorCode=%s errorMessage=%s",
                path,
                data.get("errorCode"),
                data.get("errorMessage"),
            )
            raise HTTPException(
                status_code=422,
                detail=f"RunningHub 拒絕請求（{data.get('errorCode')}）：{data.get('errorMessage') or '未提供原因'}",
            )
        if (
            not response.is_success
            or not isinstance(data, dict)
            or data.get("code", 0) not in (0, None)
        ):
            raise HTTPException(
                status_code=502,
                detail="模型 API 拒絕請求，請檢查帳戶額度、模型參數或 RunningHub 任務紀錄",
            )
        return data.get("data") if isinstance(data.get("data"), dict) else data
    raise HTTPException(status_code=502, detail="模型 API 暫時無法使用")


async def submit(endpoint: str, payload: dict) -> dict:
    # Never retry an ambiguous submission: it may already have charged the user.
    data = await _post(endpoint, payload=payload)
    task_id = data.get("taskId") or data.get("task_id")
    if not task_id:
        raise HTTPException(
            status_code=502, detail="模型回應缺少 taskId；請先查看 RunningHub 紀錄"
        )
    return {**data, "taskId": str(task_id)}


async def query(task_id: str) -> dict:
    return await _post("query", payload={"taskId": task_id}, idempotent=True)


async def upload(filename: str, content: bytes, mime: str) -> str:
    data = await _post("media/upload/binary", files={"file": (filename, content, mime)})
    url = data.get("download_url")
    if not isinstance(url, str) or not url.startswith("https://"):
        raise HTTPException(status_code=502, detail="上傳回應缺少有效 download_url")
    return url
