"""使用者 / 管理員認證端點。"""

import secrets
from fastapi import APIRouter, HTTPException, Request

from app.core import auth, config, db, security
from app.schemas import AdminLoginRequest, UserLoginRequest, UserRegisterRequest

router = APIRouter()

_DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.4N3F/G4DqxuP0D4VTsS00.6SwD7xS8K"


# ===== 使用者 =====


def _profile(user: dict) -> dict:
    return {
        "username": user["username"],
        "name": user.get("name", ""),
        "email": user.get("email", ""),
        "division": user.get("division", ""),
    }


@router.post("/api/auth/register")
async def user_register(req: UserRegisterRequest):
    raise HTTPException(
        status_code=403, detail="請使用 BWHR 員工編號與密碼登入；首次設定密碼請至 BWHR"
    )


@router.post("/api/auth/login")
async def user_login(req: UserLoginRequest, request: Request):
    from app.core.rate_limit import check_rate_limit
    import asyncio
    import hashlib

    username = req.username.strip()
    # Hash identifiers so rate-limit keys do not expose employee IDs.
    identifier = hashlib.sha256(username.encode()).hexdigest()
    await check_rate_limit(identifier, "login-account", 10, 900)
    await check_rate_limit(
        request.client.host if request.client else "unknown", "login-ip", 200, 900
    )
    if (
        username == "admin"
        and config.ADMIN_PASSWORD
        and secrets.compare_digest(
            req.password.encode(), config.ADMIN_PASSWORD.encode()
        )
    ):
        return {
            "token": auth.create_user_token(auth.ADMIN_USER_ID),
            "username": "admin",
            "name": "管理員",
            "email": "",
            "division": "",
            "adminToken": await auth.issue_admin_token(),
        }
    user = await db.fetch_one(
        "SELECT * FROM users WHERE username=$1 AND auth_source='bwhr'", username
    ) or await db.fetch_one(
        # Legacy accounts created before BWHR sync keep their local passwords.
        "SELECT * FROM users WHERE username=$1 AND auth_source='local'", username
    )
    # A real fixed-cost dummy bcrypt check prevents a fast missing-account path.
    hashed = user["password_hash"] if user and user["password_hash"] else _DUMMY_HASH
    valid = await asyncio.to_thread(security.verify_password, req.password, hashed)
    if not user or not user["password_hash"] or not valid:
        raise HTTPException(
            status_code=401, detail="員工編號或密碼錯誤；尚未設定密碼請至 BWHR"
        )
    if not await auth.user_accessible(user):
        raise HTTPException(
            status_code=403, detail="帳號停用、遭拒絕或所屬區處尚未開放，請聯絡管理員"
        )
    return {
        "token": auth.create_user_token(user["id"], user["session_version"]),
        **_profile(user),
    }


@router.post("/api/auth/logout")
async def user_logout():
    """JWT stateless，client 自行清除 token 即可。"""
    return {"success": True}


@router.get("/api/auth/verify")
async def user_verify(request: Request):
    try:
        user = await auth.authenticated_user(request)
    except HTTPException:
        return {"valid": False}
    return {"valid": True, **_profile(user)}


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
