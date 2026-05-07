"""使用者 / 管理員認證端點。"""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core import auth, config, db, security
from app.schemas import AdminLoginRequest, UserLoginRequest, UserRegisterRequest

router = APIRouter()


# ===== 使用者 =====


@router.post("/api/auth/register")
async def user_register(req: UserRegisterRequest):
    username = req.username.strip().lower()
    existing = await db.fetch_one("SELECT id FROM users WHERE username = $1", username)
    if existing:
        raise HTTPException(status_code=409, detail="帳號已存在")

    user_id = secrets.token_hex(8)
    await db.execute(
        """
        INSERT INTO users (id, username, password_hash, status, role, created_at, updated_at)
        VALUES ($1, $2, $3, 'pending', 'user', $4, $4)
        """,
        user_id,
        username,
        security.hash_password(req.password),
        datetime.now(timezone.utc),
    )
    return {"message": "帳號申請成功，請等待管理員審核"}


@router.post("/api/auth/login")
async def user_login(req: UserLoginRequest):
    """user 登入；admin/{ADMIN_PASSWORD} 同時取得 user JWT + adminToken。"""
    username = req.username.strip().lower()

    if username == "admin" and config.ADMIN_PASSWORD and req.password == config.ADMIN_PASSWORD:
        token = auth.create_user_token(auth.ADMIN_USER_ID)
        admin_token = await auth.issue_admin_token()
        return {"token": token, "username": "admin", "adminToken": admin_token}

    user = await db.fetch_one(
        "SELECT id, username, password_hash, status FROM users WHERE username = $1",
        username,
    )
    if not user or not security.verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")
    if user["status"] == "pending":
        raise HTTPException(status_code=403, detail="帳號尚待管理員審核")
    if user["status"] == "rejected":
        raise HTTPException(status_code=403, detail="帳號申請已被拒絕")

    token = auth.create_user_token(user["id"])
    return {"token": token, "username": user["username"]}


@router.post("/api/auth/logout")
async def user_logout():
    """JWT stateless，client 自行清除 token 即可。"""
    return {"success": True}


@router.get("/api/auth/verify")
async def user_verify(request: Request):
    token = request.headers.get("X-User-Token", "")
    if not token:
        return {"valid": False}
    try:
        user_id = auth.decode_user_token(token)
    except HTTPException:
        return {"valid": False}
    if user_id == auth.ADMIN_USER_ID:
        return {"valid": True, "username": "admin"}
    user = await db.fetch_one(
        "SELECT username, status FROM users WHERE id = $1", user_id
    )
    if not user or user["status"] != "approved":
        return {"valid": False}
    return {"valid": True, "username": user["username"]}


# ===== 管理員 =====


@router.post("/api/admin/login")
async def admin_login(req: AdminLoginRequest):
    if not config.ADMIN_PASSWORD or req.password != config.ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="密碼錯誤")
    token = await auth.issue_admin_token()
    return {"token": token}


@router.post("/api/admin/logout")
async def admin_logout(request: Request):
    token = request.headers.get("X-Admin-Token", "")
    await auth.revoke_admin_token(token)
    return {"success": True}


@router.get("/api/admin/verify")
async def admin_verify(request: Request):
    token = request.headers.get("X-Admin-Token", "")
    return {"valid": await auth.is_admin_token_valid(token)}
