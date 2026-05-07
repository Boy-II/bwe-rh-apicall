"""使用者視角的卡片 API（Phase 4 才拔掉 webappId 給普通用戶）。"""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core import auth, db
from app.schemas import CardCreate, CardUpdate

router = APIRouter()


def _row_to_dict(row: dict) -> dict:
    """DB row → 前端 camelCase 格式。"""
    return {
        "id": row["id"],
        "webappId": row["webapp_id"],
        "title": row["title"],
        "description": row["description"] or "",
        "icon": row["icon"],
        "color": row["color"],
        "createdAt": row["created_at"].isoformat() if row.get("created_at") else "",
    }


@router.get("/api/cards")
async def list_cards(_user: str = Depends(auth.require_user)):
    rows = await db.fetch_all(
        """
        SELECT id, webapp_id, title, description, icon, color, sort_order, created_at
        FROM cards
        WHERE enabled = TRUE
        ORDER BY sort_order, created_at
        """
    )
    return {"cards": [_row_to_dict(r) for r in rows]}


@router.post("/api/admin/cards")
async def admin_add_card(req: CardCreate, _: str = Depends(auth.require_admin)):
    card_id = secrets.token_hex(8)
    now = datetime.now(timezone.utc)
    next_sort = await db.fetch_val("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM cards")

    row = await db.fetch_one(
        """
        INSERT INTO cards (id, webapp_id, title, description, icon, color, sort_order, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        RETURNING id, webapp_id, title, description, icon, color, sort_order, created_at
        """,
        card_id,
        req.webappId.strip(),
        (req.title.strip() or f"應用 {req.webappId}"),
        req.description.strip(),
        req.icon,
        req.color,
        next_sort,
        now,
    )
    return _row_to_dict(row)


@router.put("/api/admin/cards/{card_id}")
async def admin_update_card(
    card_id: str, req: CardUpdate, _: str = Depends(auth.require_admin)
):
    now = datetime.now(timezone.utc)
    row = await db.fetch_one(
        """
        UPDATE cards
        SET title = $2, description = $3, icon = $4, color = $5, updated_at = $6
        WHERE id = $1
        RETURNING id, webapp_id, title, description, icon, color, sort_order, created_at
        """,
        card_id,
        req.title.strip(),
        req.description.strip(),
        req.icon,
        req.color,
        now,
    )
    if not row:
        raise HTTPException(status_code=404, detail="卡片不存在")
    return _row_to_dict(row)


@router.delete("/api/admin/cards/{card_id}")
async def admin_delete_card(card_id: str, _: str = Depends(auth.require_admin)):
    result = await db.execute("DELETE FROM cards WHERE id = $1", card_id)
    # asyncpg execute 回傳 'DELETE 0' 或 'DELETE 1'
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="卡片不存在")
    return {"success": True}
