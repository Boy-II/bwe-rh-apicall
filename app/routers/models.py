import io
import secrets
import warnings

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

from app.core import auth, db
from app.core.rate_limit import rate_limit
from app.services import model_api, model_catalog

router = APIRouter()


class ModelSubmit(BaseModel):
    cardId: str
    payload: dict = Field(default_factory=dict)


async def model_card(card_id: str) -> tuple[dict, dict]:
    row = await db.fetch_one(
        "SELECT * FROM cards WHERE id=$1 AND enabled=TRUE AND card_type='model'",
        card_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="模型卡片不存在或已停用")
    try:
        model = model_catalog.get_model(row["model_key"])
    except ValueError:
        raise HTTPException(status_code=400, detail="模型設定無效") from None
    return row, model


@router.get("/api/models/{key}")
async def get_schema(key: str, _user: str = Depends(auth.require_user)):
    try:
        return model_catalog.get_model(key)
    except ValueError:
        raise HTTPException(status_code=404, detail="模型不存在") from None


@router.post("/api/models/upload", dependencies=[Depends(rate_limit("upload", 20, 60))])
async def upload_image(
    cardId: str = Form(...),
    fieldKey: str = Form(...),
    file: UploadFile = File(...),
    _user: str = Depends(auth.require_user),
):
    _, model = await model_card(cardId)
    param = next(
        (
            p
            for p in model["params"]
            if p["fieldKey"] == fieldKey and p["type"] == "IMAGE"
        ),
        None,
    )
    if not param:
        raise HTTPException(status_code=400, detail="此模型不支援這個圖片欄位")
    limit = int(param.get("maxSize", 10)) * 1024 * 1024
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise HTTPException(
            status_code=413, detail=f"圖片超過 {limit // 1024 // 1024} MB 上限"
        )
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                fmt = image.format
                if image.width * image.height > 40_000_000:
                    raise ValueError()
                image.verify()
        accepted = __import__("json").loads(param.get("accept", '["PNG","JPG"]'))
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
    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[fmt]
    return {"url": await model_api.upload("upload." + fmt.lower(), content, mime)}


@router.post(
    "/api/models/submit", dependencies=[Depends(rate_limit("submit", 30, 3600))]
)
async def submit_model(req: ModelSubmit, user_id: str = Depends(auth.require_user)):
    card, model = await model_card(req.cardId)
    try:
        payload = model_catalog.validate_payload(model, req.payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    # Create local ownership record first; an upstream task must never be untracked.
    local_id = secrets.token_hex(8)
    inputs = [
        {"nodeId": model["key"], "fieldName": k, "fieldValue": v}
        for k, v in payload.items()
    ]
    await db.execute(
        """INSERT INTO tasks(id,user_id,card_id,card_title,card_type,webapp_id,rh_task_id,status,node_input,model_key)
        VALUES($1,$2,$3,$4,'model','','','SUBMITTING',$5,$6)""",
        local_id,
        user_id,
        card["id"],
        card["title"],
        inputs,
        model["key"],
    )
    try:
        data = await model_api.submit(model["endpoint"], payload)
    except HTTPException:
        await db.execute(
            "UPDATE tasks SET status='FAILED',error_message='提交未完成，結果不明時請查看 RunningHub 紀錄',completed_at=NOW() WHERE id=$1",
            local_id,
        )
        raise
    await db.execute(
        "UPDATE tasks SET rh_task_id=$2,status='QUEUED',raw_response=$3 WHERE id=$1",
        local_id,
        data["taskId"],
        data,
    )
    return data
