"""管理員視角的用戶管理 API。"""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core import auth, db

router = APIRouter()


class UserNoteRequest(BaseModel):
    note: str = Field(default="", max_length=500)


class DivisionRequest(BaseModel):
    allowedDivisions: list[str] = Field(max_length=200)


@router.get("/api/admin/access")
async def get_access(_: str = Depends(auth.require_admin)):
    rows = await db.fetch_all(
        "SELECT DISTINCT division FROM users WHERE auth_source='bwhr' AND division<>'' ORDER BY division"
    )
    sync = await db.fetch_one(
        "SELECT value,updated_at FROM settings WHERE key='bwhr_sync'"
    )
    return {
        "divisions": [r["division"] for r in rows],
        "allowedDivisions": await auth.allowed_divisions(),
        "lastSync": sync["updated_at"].isoformat() if sync else None,
        "syncSummary": (
            json.loads(sync["value"]) if sync and isinstance(sync["value"], str)
            else sync["value"] if sync else None
        ),
    }


@router.put("/api/admin/access")
async def save_access(req: DivisionRequest, _: str = Depends(auth.require_admin)):
    divisions = list(
        dict.fromkeys(x.strip() for x in req.allowedDivisions if x.strip())
    )
    if any(len(x) > 200 for x in divisions):
        raise HTTPException(status_code=400, detail="區處名稱過長")
    await db.execute(
        "INSERT INTO settings(key,value,updated_at) VALUES ('allowed_divisions',$1,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",
        json.dumps(divisions, ensure_ascii=False),
    )
    return {"success": True}


@router.get("/api/admin/users")
async def list_users(_: str = Depends(auth.require_admin)):
    rows = await db.fetch_all(
        """
        SELECT id, username, status, note, created_at, name, email, division, department, unit, auth_source, source_status
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
                "name": r["name"],
                "email": r["email"],
                "division": r["division"],
                "department": r["department"],
                "unit": r["unit"],
                "authSource": r["auth_source"],
                "sourceStatus": r["source_status"],
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
    # Keep the external identity and denial across subsequent syncs; deleting it
    # would recreate session_version=0 and potentially revive an old JWT.
    updated = await db.execute(
        "UPDATE users SET status='rejected',session_version=session_version+1,updated_at=NOW() WHERE id=$1 AND auth_source='bwhr'",
        user_id,
    )
    if updated != "UPDATE 0":
        return {"success": True}
    result = await db.execute("DELETE FROM users WHERE id = $1", user_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="用戶不存在")
    return {"success": True}
