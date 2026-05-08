"""管理員專用：RunningHub 帳號餘額 + 探索應用清單。"""

import re

from fastapi import APIRouter, Depends

from app.core import auth
from app.schemas import AppListRequest
from app.services import runninghub

router = APIRouter()

_WEBAPP_ID_RE = re.compile(r"/run/ai-app/(\d+)")


@router.post("/api/admin/account-status")
async def admin_account_status(_: str = Depends(auth.require_admin)):
    """查詢平台 RunningHub 帳號餘額／金幣／執行中任務數。

    body: {apikey} + header Authorization: Bearer ...
    回傳: {code, msg, data: {remainCoins, currentTaskCounts, remainMoney, currency, apiType}}
    """
    return await runninghub.post_with_bearer_and_apikey("/uc/openapi/accountStatus")


@router.post("/api/admin/aiapp-list")
async def admin_aiapp_list(req: AppListRequest, _: str = Depends(auth.require_admin)):
    """探索 RunningHub AI 應用清單（推薦/最熱/最新）。

    回應將從 `invokeExample` 解析出 `webappId`，並裁掉前端不需要的長字串。
    """
    body: dict = {
        "current": max(1, req.page),
        "size": min(max(1, req.size), 50),
        "sort": req.sort,
    }
    if req.sort == "HOTTEST" and req.days:
        body["days"] = req.days

    resp = await runninghub.post_with_bearer("/openapi/v2/aiapp/list", body)
    if resp.get("code") != 0:
        return resp

    data = resp.get("data") or {}
    raw_items = data.get("list") or data.get("records") or []

    items = []
    for it in raw_items:
        invoke = it.get("invokeExample") or ""
        m = _WEBAPP_ID_RE.search(invoke)
        items.append(
            {
                "webappId": m.group(1) if m else "",
                "title": it.get("title") or "",
                "description": it.get("description") or "",
                "cover": it.get("cover") or "",
            }
        )

    return {
        "code": 0,
        "data": {
            "items": items,
            "page": data.get("current") or req.page,
            "size": data.get("size") or req.size,
            "total": data.get("total") or len(items),
        },
    }
