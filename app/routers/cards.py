"""使用者視角的卡片 API + 管理員 CRUD + 預覽圖上傳 + 排序。"""

import secrets
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.core import auth, db
from app.schemas import CardCreate, CardReorderRequest, CardUpdate

router = APIRouter()


# 預覽圖儲存位置：優先放到 Zeabur 持久化卷的 /card/covers/，否則用 ./covers/
COVER_BASE_DIR = Path("/card/covers") if Path("/card").exists() else Path("./covers")
COVER_BASE_DIR.mkdir(parents=True, exist_ok=True)
COVER_URL_PREFIX = "/covers"  # 由 main.py mount StaticFiles
ALLOWED_IMG_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_COVER_BYTES = 5 * 1024 * 1024  # 5 MB


def _row_to_dict(row: dict) -> dict:
    """DB row → 前端 camelCase 格式。"""
    return {
        "id": row["id"],
        "cardType": row.get("card_type") or "webapp",
        "webappId": row["webapp_id"],
        "workflowId": row.get("workflow_id") or "",
        "title": row["title"],
        "description": row["description"] or "",
        "llmNote": row.get("llm_note") or "",
        "icon": row["icon"],
        "color": row["color"],
        "coverUrl": row.get("cover_url") or "",
        "tags": row.get("tags") or [],
        "editableFields": row.get("editable_fields") or [],
        "instanceType": row.get("instance_type") or "default",
        "maxDurationSeconds": row.get("max_duration_seconds") or 0,
        "sortOrder": row.get("sort_order"),
        "createdAt": row["created_at"].isoformat() if row.get("created_at") else "",
    }


_CARD_COLUMNS = (
    "id, card_type, webapp_id, workflow_id, title, description, llm_note, icon, color, "
    "cover_url, tags, editable_fields, instance_type, max_duration_seconds, sort_order, created_at"
)


def _normalize_tags(tags: list[str]) -> list[str]:
    """去前後空白、去空字串、去重（保留順序）、最多 10 個、每個最多 30 字"""
    seen: set[str] = set()
    out: list[str] = []
    for t in tags or []:
        t = (t or "").strip()[:30]
        if not t or t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= 10:
            break
    return out


@router.get("/api/cards")
async def list_cards(_user: str = Depends(auth.require_user)):
    rows = await db.fetch_all(
        f"""
        SELECT {_CARD_COLUMNS}
        FROM cards
        WHERE enabled = TRUE
        ORDER BY sort_order, created_at
        """
    )
    return {"cards": [_row_to_dict(r) for r in rows]}


@router.post("/api/admin/cards")
async def admin_add_card(req: CardCreate, _: str = Depends(auth.require_admin)):
    if req.cardType not in {"webapp", "workflow"}:
        raise HTTPException(status_code=400, detail="cardType 必須為 webapp 或 workflow")
    if req.cardType == "webapp" and not req.webappId.strip():
        raise HTTPException(status_code=400, detail="webapp 卡片需要 webappId")
    if req.cardType == "workflow" and not req.workflowId.strip():
        raise HTTPException(status_code=400, detail="workflow 卡片需要 workflowId")

    card_id = secrets.token_hex(8)
    now = datetime.now(timezone.utc)
    next_sort = await db.fetch_val("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM cards")

    editable = [{"nodeId": e.nodeId, "fieldName": e.fieldName} for e in (req.editableFields or [])]

    instance = req.instanceType if req.instanceType in {"default", "plus"} else "default"
    max_dur = max(0, int(req.maxDurationSeconds or 0))
    tags = _normalize_tags(req.tags or [])

    row = await db.fetch_one(
        f"""
        INSERT INTO cards (
            id, card_type, webapp_id, workflow_id, title, description, llm_note, icon,
            color, cover_url, tags, editable_fields, instance_type, max_duration_seconds,
            sort_order, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
        RETURNING {_CARD_COLUMNS}
        """,
        card_id,
        req.cardType,
        req.webappId.strip(),
        req.workflowId.strip(),
        (req.title.strip() or f"應用 {req.webappId or req.workflowId}"),
        req.description.strip(),
        req.llmNote.strip(),
        req.icon,
        req.color,
        req.coverUrl.strip(),
        tags,
        editable,
        instance,
        max_dur,
        next_sort,
        now,
    )
    return _row_to_dict(row)


@router.put("/api/admin/cards/{card_id}")
async def admin_update_card(
    card_id: str, req: CardUpdate, _: str = Depends(auth.require_admin)
):
    now = datetime.now(timezone.utc)

    # 動態組欄位：editableFields / instanceType 為 None 表示不更動
    sets: list[str] = [
        "title = $2", "description = $3", "llm_note = $4",
        "icon = $5", "color = $6", "cover_url = $7", "updated_at = $8",
    ]
    args: list = [
        card_id,
        req.title.strip(),
        req.description.strip(),
        req.llmNote.strip(),
        req.icon,
        req.color,
        req.coverUrl.strip(),
        now,
    ]
    next_idx = 9
    if req.editableFields is not None:
        editable = [{"nodeId": e.nodeId, "fieldName": e.fieldName} for e in req.editableFields]
        sets.append(f"editable_fields = ${next_idx}")
        args.append(editable)
        next_idx += 1
    if req.instanceType is not None:
        instance = req.instanceType if req.instanceType in {"default", "plus"} else "default"
        sets.append(f"instance_type = ${next_idx}")
        args.append(instance)
        next_idx += 1
    if req.maxDurationSeconds is not None:
        sets.append(f"max_duration_seconds = ${next_idx}")
        args.append(max(0, int(req.maxDurationSeconds)))
        next_idx += 1
    if req.tags is not None:
        sets.append(f"tags = ${next_idx}")
        args.append(_normalize_tags(req.tags))
        next_idx += 1

    row = await db.fetch_one(
        f"""
        UPDATE cards
        SET {", ".join(sets)}
        WHERE id = $1
        RETURNING {_CARD_COLUMNS}
        """,
        *args,
    )

    if not row:
        raise HTTPException(status_code=404, detail="卡片不存在")
    return _row_to_dict(row)


@router.delete("/api/admin/cards/{card_id}")
async def admin_delete_card(card_id: str, _: str = Depends(auth.require_admin)):
    result = await db.execute("DELETE FROM cards WHERE id = $1", card_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="卡片不存在")
    return {"success": True}


@router.post("/api/admin/cards/reorder")
async def admin_reorder_cards(
    req: CardReorderRequest, _: str = Depends(auth.require_admin)
):
    """以新排序覆寫 sort_order：sort_order = ids 中的索引位置。"""
    if not req.ids:
        return {"success": True}
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            for index, card_id in enumerate(req.ids):
                await conn.execute(
                    "UPDATE cards SET sort_order = $2, updated_at = NOW() WHERE id = $1",
                    card_id,
                    index,
                )
    return {"success": True}


@router.post("/api/admin/cards/upload-cover")
async def admin_upload_cover(
    file: UploadFile = File(...),
    _: str = Depends(auth.require_admin),
):
    """上傳卡片預覽圖。回傳可直接放到 cover_url 的相對路徑。"""
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_IMG_TYPES:
        raise HTTPException(status_code=400, detail="僅支援 PNG / JPEG / WEBP / GIF 圖片")

    content = await file.read()
    if len(content) > MAX_COVER_BYTES:
        raise HTTPException(status_code=400, detail="圖片過大，請小於 5 MB")

    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}[content_type]
    filename = f"{secrets.token_hex(12)}{ext}"
    target = COVER_BASE_DIR / filename
    target.write_bytes(content)

    return {"coverUrl": f"{COVER_URL_PREFIX}/{filename}"}
