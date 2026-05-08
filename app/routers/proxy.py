"""RunningHub + AI chat 代理端點，全部需 user token。"""

import json
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core import auth, config, db
from app.core.rate_limit import rate_limit
from app.schemas import (
    AIChatRequest,
    NodeInfoRequest,
    SubmitTaskRequest,
    SubmitWorkflowRequest,
    TaskQueryRequest,
    WorkflowFormatRequest,
)
from app.services import llm, runninghub

router = APIRouter()


# ===== RunningHub =====


@router.post("/api/proxy/getNodeInfo")
async def get_node_info(req: NodeInfoRequest, _user: str = Depends(auth.require_user)):
    return await runninghub.get_node_info(req.webappId)


def _parse_workflow_prompt(prompt_str: str) -> list[dict]:
    """ComfyUI workflow JSON → 扁平 nodeInfoList。
    跳過 wire 連線（list 值），只暴露字面值欄位給前端編輯。
    """
    try:
        prompt = json.loads(prompt_str) if isinstance(prompt_str, str) else prompt_str
    except Exception:
        return []

    out: list[dict] = []
    if not isinstance(prompt, dict):
        return out

    for node_id, node_def in prompt.items():
        if not isinstance(node_def, dict):
            continue
        inputs = node_def.get("inputs") or {}
        meta = node_def.get("_meta") or {}
        title = meta.get("title") or ""
        class_type = node_def.get("class_type") or ""

        for field_name, field_value in inputs.items():
            # 跳過 wire 連線（array reference 如 ["11", 0]）
            if isinstance(field_value, list):
                continue

            if isinstance(field_value, bool):
                field_type = "BOOLEAN"
            elif isinstance(field_value, int):
                field_type = "INT"
            elif isinstance(field_value, float):
                field_type = "FLOAT"
            else:
                field_type = "STRING"

            out.append(
                {
                    "nodeId": node_id,
                    "fieldName": field_name,
                    "fieldValue": field_value,
                    "fieldType": field_type,
                    "description": f"{title} · {field_name}" if title else field_name,
                    "descriptionEn": f"{class_type}.{field_name}" if class_type else field_name,
                }
            )
    return out


@router.post("/api/proxy/getWorkflowJson")
async def get_workflow_json(
    req: WorkflowFormatRequest, _user: str = Depends(auth.require_user)
):
    """取得 workflow 的可修改節點清單（給管理員設定 editable_fields，或使用者執行時查 default）。

    RH `/api/openapi/getJsonApiFormat` 回 `{code, data: {prompt: "<json string>"}}`
    我們把 prompt JSON 攤平成 nodeInfoList 形式，跟 webapp getNodeInfo 對齊。
    """
    resp = await runninghub.post_with_apikey(
        "/api/openapi/getJsonApiFormat",
        {"workflowId": req.workflowId},
    )
    if resp.get("code") != 0:
        return resp

    data = resp.get("data") or {}
    prompt_str = data.get("prompt") or ""
    node_info_list = _parse_workflow_prompt(prompt_str)
    return {"code": 0, "msg": "success", "data": {"nodeInfoList": node_info_list}}


@router.post(
    "/api/proxy/submitWorkflowTask",
    dependencies=[Depends(rate_limit("submit", limit=30, window_seconds=3600))],
)
async def submit_workflow_task(
    req: SubmitWorkflowRequest, user_id: str = Depends(auth.require_user)
):
    """提交 workflow 任務。
    端點依 instanceType 切換：
      - default(24G) → POST /proxy/<api_key>
      - plus(48G)    → POST /proxy-plus/<api_key>
    body: {workflowId, nodeInfoList, retainSeconds}
    """
    body = {
        "workflowId": req.workflowId,
        "nodeInfoList": req.nodeInfoList,
        "retainSeconds": req.retainSeconds,
    }
    resp = await runninghub.post_workflow(body, instance_type=req.instanceType or "default")

    # 成功才寫進 tasks 表
    if resp.get("code") == 0:
        data = resp.get("data") or {}
        rh_task_id = str(data.get("taskId") or "")
        if rh_task_id:
            try:
                await db.execute(
                    """
                    INSERT INTO tasks (
                        id, user_id, card_id, card_title, card_type,
                        webapp_id, workflow_id, rh_task_id, status,
                        node_input, created_at
                    )
                    VALUES ($1, $2, $3, $4, 'workflow', '', $5, $6, 'QUEUED', $7, $8)
                    """,
                    secrets.token_hex(8),
                    user_id,
                    req.cardId,
                    (req.cardTitle or "").strip(),
                    req.workflowId,
                    rh_task_id,
                    req.nodeInfoList,
                    datetime.now(timezone.utc),
                )
            except Exception as e:
                print(f"[tasks] workflow insert 失敗: {e}")
    return resp


@router.post(
    "/api/proxy/submitTask",
    dependencies=[Depends(rate_limit("submit", limit=30, window_seconds=3600))],
)
async def submit_task(req: SubmitTaskRequest, user_id: str = Depends(auth.require_user)):
    resp = await runninghub.post_with_apikey(
        "/task/openapi/ai-app/run",
        {"webappId": req.webappId, "nodeInfoList": req.nodeInfoList},
    )
    # 成功才記錄
    if resp.get("code") == 0:
        data = resp.get("data") or {}
        rh_task_id = str(data.get("taskId") or "")
        if rh_task_id:
            try:
                await db.execute(
                    """
                    INSERT INTO tasks (
                        id, user_id, card_id, card_title, webapp_id, rh_task_id,
                        status, node_input, created_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', $7, $8)
                    """,
                    secrets.token_hex(8),
                    user_id,
                    req.cardId,
                    (req.cardTitle or "").strip(),
                    req.webappId,
                    rh_task_id,
                    req.nodeInfoList,
                    datetime.now(timezone.utc),
                )
            except Exception as e:
                # 記錄失敗不阻擋使用者
                print(f"[tasks] insert 失敗: {e}")
    return resp


@router.post("/api/proxy/cancelTask")
async def cancel_task(req: TaskQueryRequest, user_id: str = Depends(auth.require_user)):
    """取消執行中任務（POST /task/openapi/cancel，body apiKey + Bearer）。"""
    url = f"{config.RUNNINGHUB_BASE_URL}/task/openapi/cancel"
    payload = {"apiKey": config.RUNNINGHUB_API_KEY, "taskId": req.taskId}
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.RUNNINGHUB_API_KEY}",
    }
    try:
        rh_resp = await runninghub.client().post(url, json=payload, headers=headers)
        resp = rh_resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"取消請求失敗：{e}")

    # 成功才標記 DB（用戶自己的任務）
    if resp.get("code") == 0:
        try:
            await db.execute(
                """
                UPDATE tasks
                SET status = 'CANCELED',
                    error_message = '使用者取消',
                    completed_at = NOW()
                WHERE rh_task_id = $1 AND user_id = $2 AND status IN ('QUEUED', 'RUNNING')
                """,
                req.taskId,
                user_id,
            )
        except Exception as e:
            print(f"[tasks] cancel update 失敗: {e}")

    return resp


@router.post("/api/proxy/queryTaskOutputs")
async def query_task_outputs(req: TaskQueryRequest, user_id: str = Depends(auth.require_user)):
    resp = await runninghub.post_with_bearer("/openapi/v2/query", {"taskId": req.taskId})

    # RH /v2/query 成功時是 flat shape（無 envelope）；錯誤時才有 {code: -1, msg: ...}
    is_error_envelope = isinstance(resp.get("code"), int) and resp.get("code") != 0
    if not is_error_envelope:
        data = resp.get("data") if isinstance(resp.get("data"), dict) else resp
        status = data.get("status") or data.get("taskStatus") or ""
        if status in {"SUCCESS", "FAILED", "TIMEOUT"}:
            usage = data.get("usage") or {}

            def _to_float(v):
                if v is None or v == "":
                    return None
                try:
                    return float(v)
                except (ValueError, TypeError):
                    return None

            def _to_int(v):
                if v is None or v == "":
                    return None
                try:
                    return int(float(v))
                except (ValueError, TypeError):
                    return None

            cost_val = _to_float(usage.get("taskCostTime") or data.get("taskCostTime"))
            consume_coins = _to_int(usage.get("consumeCoins"))
            consume_money = _to_float(usage.get("consumeMoney"))
            third_party_money = _to_float(usage.get("thirdPartyConsumeMoney"))

            results: list = []
            if isinstance(data.get("results"), list):
                results = [
                    {"url": r.get("url"), "fileType": r.get("outputType") or r.get("fileType") or ""}
                    for r in data["results"]
                ]
            elif data.get("fileUrl"):
                results = [{"url": data["fileUrl"], "fileType": data.get("fileType") or ""}]

            error_msg = None
            if status in {"FAILED", "TIMEOUT"}:
                err_code = data.get("errorCode") or ""
                err_text = data.get("errorMessage") or ""
                fr = data.get("failedReason")
                if not err_text and isinstance(fr, str):
                    err_text = fr
                if not err_text and isinstance(fr, dict) and fr:
                    err_text = str(fr)
                if not err_text:
                    err_text = "上游回報 " + status
                error_msg = f"[{err_code}] {err_text}" if err_code else err_text

            try:
                await db.execute(
                    """
                    UPDATE tasks
                    SET status = $2,
                        cost_time = $3,
                        consume_coins = $4,
                        consume_money = $5,
                        third_party_consume_money = $6,
                        results = $7::jsonb,
                        error_message = $8,
                        completed_at = NOW()
                    WHERE rh_task_id = $1 AND user_id = $9 AND completed_at IS NULL
                    """,
                    req.taskId,
                    status,
                    cost_val,
                    consume_coins,
                    consume_money,
                    third_party_money,
                    results,
                    error_msg,
                    user_id,
                )
            except Exception as e:
                print(f"[tasks] update 失敗: {e}")
    return resp


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
    # 合併 image / images：舊欄位若有值，補進 images 列表（最多 2 張）
    images = list(req.images or [])
    if req.image and req.image not in images:
        images.insert(0, req.image)
    images = images[:2]
    text = await llm.chat(
        runninghub.client(),
        message=req.message,
        history=req.history,
        context=req.context,
        images=images,
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
