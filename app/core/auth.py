"""驗證機制：admin token（Redis）+ user JWT（PyJWT）。"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import HTTPException, Request

from app.core import config, db
from app.core import redis_client

_JWT_ALGORITHM = "HS256"
_JWT_EXPIRY_DAYS = 30

ADMIN_TOKEN_TTL_SECONDS = 24 * 60 * 60  # 24h
ADMIN_TOKEN_PREFIX = "admin:token:"

# 特殊使用者 ID：透過 admin 帳號登入時的 user JWT 識別碼
ADMIN_USER_ID = "__admin__"


# ===== Admin token（Redis）=====


async def issue_admin_token() -> str:
    token = secrets.token_hex(32)
    await redis_client.client().set(
        f"{ADMIN_TOKEN_PREFIX}{token}", "1", ex=ADMIN_TOKEN_TTL_SECONDS
    )
    return token


async def revoke_admin_token(token: str) -> None:
    if not token:
        return
    await redis_client.client().delete(f"{ADMIN_TOKEN_PREFIX}{token}")


async def is_admin_token_valid(token: str) -> bool:
    if not token:
        return False
    return bool(await redis_client.client().exists(f"{ADMIN_TOKEN_PREFIX}{token}"))


async def require_admin(request: Request) -> str:
    token = request.headers.get("X-Admin-Token", "")
    if not await is_admin_token_valid(token):
        raise HTTPException(status_code=401, detail="需要管理員權限")
    return token


# ===== User JWT =====


def create_user_token(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=_JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, config.get_jwt_secret(), algorithm=_JWT_ALGORITHM)


def decode_user_token(token: str) -> str:
    try:
        payload = jwt.decode(token, config.get_jwt_secret(), algorithms=[_JWT_ALGORITHM])
        return payload["user_id"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已過期，請重新登入")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="需要登入")


async def require_user(request: Request) -> str:
    """驗證 X-User-Token，回傳 user_id（admin 走捷徑時為 ADMIN_USER_ID）。"""
    token = request.headers.get("X-User-Token", "")
    if not token:
        raise HTTPException(status_code=401, detail="需要登入")
    user_id = decode_user_token(token)
    if user_id == ADMIN_USER_ID:
        return user_id
    user = await db.fetch_one(
        "SELECT id, status FROM users WHERE id = $1", user_id
    )
    if not user or user["status"] != "approved":
        raise HTTPException(status_code=401, detail="帳號狀態異常，請重新登入")
    return user_id


async def optional_user(request: Request) -> Optional[str]:
    """軟驗證：有 token 且有效則回 user_id，否則 None（不丟錯）。"""
    token = request.headers.get("X-User-Token", "")
    if not token:
        return None
    try:
        user_id = decode_user_token(token)
    except HTTPException:
        return None
    if user_id == ADMIN_USER_ID:
        return user_id
    user = await db.fetch_one(
        "SELECT id, status FROM users WHERE id = $1", user_id
    )
    if not user or user["status"] != "approved":
        return None
    return user_id
