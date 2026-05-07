"""RunningHub + AI chat 代理端點，全部需 user token。"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core import auth, config
from app.core.rate_limit import rate_limit
from app.schemas import (
    AIChatRequest,
    NodeInfoRequest,
    SubmitTaskRequest,
    TaskQueryRequest,
)
from app.services import llm, runninghub

router = APIRouter()


# ===== RunningHub =====


@router.post("/api/proxy/getNodeInfo")
async def get_node_info(req: NodeInfoRequest, _user: str = Depends(auth.require_user)):
    return await runninghub.get_node_info(req.webappId)


@router.post(
    "/api/proxy/submitTask",
    dependencies=[Depends(rate_limit("submit", limit=30, window_seconds=3600))],
)
async def submit_task(req: SubmitTaskRequest, _user: str = Depends(auth.require_user)):
    return await runninghub.post_with_apikey(
        "/task/openapi/ai-app/run",
        {"webappId": req.webappId, "nodeInfoList": req.nodeInfoList},
    )


@router.post("/api/proxy/queryTaskOutputs")
async def query_task_outputs(req: TaskQueryRequest, _user: str = Depends(auth.require_user)):
    return await runninghub.post_with_bearer("/openapi/v2/query", {"taskId": req.taskId})


@router.post(
    "/api/proxy/uploadFile",
    dependencies=[Depends(rate_limit("upload", limit=20, window_seconds=60))],
)
async def upload_file(
    file: UploadFile = File(...),
    _user: str = Depends(auth.require_user),
):
    content = await file.read()
    return await runninghub.upload_binary(
        file.filename or "upload.bin",
        content,
        file.content_type or "application/octet-stream",
    )


@router.post("/api/proxy/getAccountStatus")
async def get_account_status(_user: str = Depends(auth.require_user)):
    return await runninghub.post_with_apikey("/api/user/getAccountStatus", {})


# ===== AI 聊天 =====


@router.post(
    "/api/proxy/chat",
    dependencies=[Depends(rate_limit("chat", limit=10, window_seconds=60))],
)
async def proxy_chat(req: AIChatRequest, _user: str = Depends(auth.require_user)):
    text = await llm.chat(
        runninghub.client(),
        message=req.message,
        history=req.history,
        context=req.context,
        image=req.image,
    )
    return {"text": text}


# ===== 設定狀態（不需 auth）=====


@router.get("/api/config/status")
async def get_config_status():
    key = config.RUNNINGHUB_API_KEY
    return {
        "hasApiKey": bool(key) and key != "YOUR_API_KEY_HERE",
        "baseUrl": config.RUNNINGHUB_BASE_URL,
        "pollingInterval": config.POLLING_INTERVAL,
        "maxPollingRetries": config.MAX_POLLING_RETRIES,
    }
