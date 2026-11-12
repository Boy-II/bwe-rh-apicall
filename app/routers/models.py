"""生圖 API：以 image_models 清單的 modelKey 為準（取代模型卡片）。"""

import io
import json
import secrets
import warnings

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

from app.core import auth, db
from app.core.rate_limit import rate_limit
from app.services import image_registry, media, model_api, model_catalog

router = APIRouter()

_MIME = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}


class ModelSubmit(BaseModel):
    modelKey: str
    payload: dict = Field(default_factory=dict)
    templateId: str | None = None


async def enabled_model(key: str) -> dict:
    model = await image_registry.get(key)
    if not model or not model["enabled"]:
        raise HTTPException(status_code=404, detail="模型不存在或已停用")
    return model


def public_model(model: dict) -> dict:
    return {k: model[k] for k in ("key", "displayName", "mode", "provider", "profile", "params")}


@router.get("/api/image-models")
async def list_image_models(_user: str = Depends(auth.require_user)):
    return [public_model(m) for m in await image_registry.list()]


@router.get("/api/models/{key}")
async def get_schema(key: str, _user: str = Depends(auth.require_user)):
    return public_model(await enabled_model(key))


@router.post("/api/models/upload", dependencies=[Depends(rate_limit("upload", 20, 60))])
async def upload_image(
    modelKey: str = Form(...),
    fieldKey: str = Form(...),
    file: UploadFile = File(...),
    _user: str = Depends(auth.require_user),
):
    model = await enabled_model(modelKey)
    param = next(
        (p for p in model["params"] if p["fieldKey"] == fieldKey and p["type"] == "IMAGE"),
        None,
    )
    if not param:
        raise HTTPException(status_code=400, detail="此模型不支援這個圖片欄位")
    limit = int(param.get("maxSize", 10)) * 1024 * 1024
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(status_code=413, detail=f"圖片超過 {limit // 1024 // 1024} MB 上限")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                fmt = image.format
                if image.width * image.height > 40_000_000:
                    raise ValueError()
                image.verify()
        accepted = json.loads(param.get("accept", '["PNG","JPG"]'))
        allowed = {str(x).upper().replace("JPG", "JPEG") for x in accepted}
        if fmt not in allowed:
            raise ValueError()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombWarning,
        Image.DecompressionBombError,
    ):
        raise HTTPException(
            status_code=400, detail="圖片損壞、尺寸過大或格式不受此模型支援"
        ) from None
    ext = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}[fmt]
    return {"url": media.save_bytes("uploads", content, ext)}


async def resolve_rh_images(payload: dict, model: dict) -> dict:
    """本地 media URL 上傳 RunningHub 換成 RH URL；https:// 原樣保留。"""
    out = dict(payload)
    for p in model["params"]:
        if p["type"] != "IMAGE" or p["fieldKey"] not in out:
            continue
        value = out[p["fieldKey"]]
        values = value if isinstance(value, list) else [value]
        converted = []
        for v in values:
            path = media.local_path(v)
            if path is None:
                converted.append(v)
                continue
            try:
                content = media.read_sync_local(v)
            except media.MediaError:
                raise HTTPException(status_code=400, detail="參考圖已不存在，請重新上傳") from None
            ext = path.suffix.lstrip(".")
            converted.append(await model_api.upload(path.name, content, _MIME.get(ext, "image/png")))
        out[p["fieldKey"]] = converted if isinstance(value, list) else converted[0]
    return out


@router.post("/api/models/submit", dependencies=[Depends(rate_limit("submit", 30, 3600))])
async def submit_model(req: ModelSubmit, user_id: str = Depends(auth.require_user)):
    model = await enabled_model(req.modelKey)
    try:
        payload = model_catalog.validate_payload(model, req.payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    local_id = secrets.token_hex(8)
    inputs = [
        {"nodeId": model["key"], "fieldName": k, "fieldValue": v} for k, v in payload.items()
    ]
    raw = {"templateId": req.templateId} if req.templateId else {}
    # 先建本地紀錄：上游任務絕不能沒有歸屬
    await db.execute(
        """INSERT INTO tasks(id,user_id,card_id,card_title,card_type,webapp_id,rh_task_id,status,node_input,model_key,provider,raw_response)
        VALUES($1,$2,NULL,$3,'model','','','SUBMITTING',$4,$5,'runninghub',$6)""",
        local_id,
        user_id,
        model["displayName"],
        inputs,
        model["key"],
        raw,
    )
    try:
        rh_payload = await resolve_rh_images(payload, model)
        data = await model_api.submit(model["upstream"], rh_payload)
    except HTTPException as e:
        await db.execute(
            "UPDATE tasks SET status='FAILED',error_message=$2,completed_at=NOW() WHERE id=$1",
            local_id,
            # 400/422 是明確拒絕；其他失敗結果不明
            e.detail
            if e.status_code in (400, 422)
            else "提交未完成，結果不明時請查看 RunningHub 紀錄",
        )
        raise
    await db.execute(
        "UPDATE tasks SET rh_task_id=$2,status='QUEUED',raw_response=$3 WHERE id=$1",
        local_id,
        data["taskId"],
        {**data, **raw},
    )
    return data


@router.get("/api/models/tasks/{task_id}/results/{index}")
async def download_result(task_id: str, index: int, user_id: str = Depends(auth.require_user)):
    row = await db.fetch_one(
        "SELECT results FROM tasks WHERE rh_task_id=$1 AND user_id=$2", task_id, user_id
    )
    results = (row or {}).get("results") or []
    if not row or not 0 <= index < len(results) or not results[index].get("url"):
        raise HTTPException(status_code=404, detail="結果不存在")
    try:
        content = await media.read(results[index]["url"])
        ext = media.image_ext(content)
    except media.MediaError:
        raise HTTPException(status_code=502, detail="結果圖片已無法取得") from None
    return Response(
        content,
        media_type=_MIME[ext],
        headers={"Content-Disposition": f'attachment; filename="bwe-{task_id}-{index}.{ext}"'},
    )
