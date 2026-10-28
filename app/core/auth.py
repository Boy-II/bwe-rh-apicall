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
    # 每次請求刷新 TTL，讓持續使用中的 admin session 不會過期
    await redis_client.client().expire(
        f"{ADMIN_TOKEN_PREFIX}{token}", ADMIN_TOKEN_TTL_SECONDS
    )
    return token


# ===== User JWT =====


def create_user_token(user_id: str, session_version: int = 0) -> str:
    payload = {
        "user_id": user_id,
        "session_version": session_version,
        "exp": datetime.now(timezone.utc) + timedelta(days=_JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, config.get_jwt_secret(), algorithm=_JWT_ALGORITHM)


def decode_user_token(token: str) -> str:
    try:
        payload = jwt.decode(
            token, config.get_jwt_secret(), algorithms=[_JWT_ALGORITHM]
        )
        return payload["user_id"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已過期，請重新登入")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="需要登入")


async def allowed_divisions() -> list[str]:
    row = await db.fetch_one("SELECT value FROM settings WHERE key='allowed_divisions'")
    if row is None:
        return ["健康事業處"]
    value = row["value"]
    return (
        value
        if isinstance(value, list) and all(isinstance(v, str) for v in value)
        else []
    )


async def user_accessible(user: dict | None) -> bool:
    return bool(
        user
        and user.get("auth_source") == "bwhr"
        and user.get("source_status") == "ACTIVE"
        and user.get("status") == "approved"
        and user.get("division") in await allowed_divisions()
    )


async def authenticated_user(request: Request) -> dict:
    token = request.headers.get("X-User-Token", "")
    if not token:
        raise HTTPException(status_code=401, detail="需要登入")
    user_id = decode_user_token(token)
    if user_id == ADMIN_USER_ID:
        return {
            "id": user_id,
            "username": "admin",
            "name": "管理員",
            "email": "",
            "division": "",
        }
    user = await db.fetch_one("SELECT * FROM users WHERE id=$1", user_id)
    payload = jwt.decode(token, config.get_jwt_secret(), algorithms=[_JWT_ALGORITHM])
    if (
        not await user_accessible(user)
        or payload.get("session_version", -1) != user["session_version"]
    ):
        raise HTTPException(
            status_code=401, detail="帳號權限已變更，請重新登入或聯絡管理員"
        )
    return user


async def require_user(request: Request) -> str:
    return (await authenticated_user(request))["id"]


async def optional_user(request: Request) -> Optional[str]:
    try:
        return await require_user(request)
    except HTTPException:
        return None
