"""管理員視角的用戶管理 API。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core import auth, db

router = APIRouter()


class UserNoteRequest(BaseModel):
    note: str = Field(default="", max_length=500)


@router.get("/api/admin/users")
async def list_users(_: str = Depends(auth.require_admin)):
    rows = await db.fetch_all(
        """
        SELECT id, username, status, note, created_at
        FROM users
        ORDER BY status, created_at DESC
        """
    )
    return {
        "users": [
            {
                "id": r["id"],
                "username": r["username"],
                "status": r["status"],
                "note": r["note"] or "",
                "createdAt": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.put("/api/admin/users/{user_id}/note")
async def update_user_note(
    user_id: str,
    req: UserNoteRequest,
    _: str = Depends(auth.require_admin),
):
    result = await db.execute(
        "UPDATE users SET note = $2, updated_at = NOW() WHERE id = $1",
        user_id,
        req.note.strip(),
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="用戶不存在")
    return {"success": True}


@router.post("/api/admin/users/{user_id}/approve")
async def approve_user(user_id: str, _: str = Depends(auth.require_admin)):
    result = await db.execute(
        "UPDATE users SET status = 'approved', updated_at = NOW() WHERE id = $1",
        user_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="用戶不存在")
    return {"success": True}


@router.post("/api/admin/users/{user_id}/reject")
async def reject_user(user_id: str, _: str = Depends(auth.require_admin)):
    result = await db.execute(
        "UPDATE users SET status = 'rejected', updated_at = NOW() WHERE id = $1",
        user_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="用戶不存在")
    return {"success": True}


@router.delete("/api/admin/users/{user_id}")
async def delete_user(user_id: str, _: str = Depends(auth.require_admin)):
    result = await db.execute("DELETE FROM users WHERE id = $1", user_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="用戶不存在")
    return {"success": True}
