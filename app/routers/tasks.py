"""任務歷史端點：使用者自己的歷史 + 管理員月度用量。"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core import auth, config, db

router = APIRouter()


class MarkTimeoutRequest(BaseModel):
    rhTaskId: str


@router.post("/api/users/me/tasks/mark-timeout")
async def mark_my_task_timeout(
    req: MarkTimeoutRequest, user_id: str = Depends(auth.require_user)
):
    """前端本地輪詢逾時時呼叫（不是 RH 1006，是 BWE 自己 10 分鐘上限）。
    把任務狀態從 QUEUED 改為 TIMEOUT；若 RH 後續真的完成，下一次 query 仍可覆寫為 SUCCESS。
    """
    result = await db.execute(
        """
        UPDATE tasks
        SET status = 'TIMEOUT',
            error_message = '本地輪詢逾時（BWE 10 分鐘上限），任務可能仍在 RH 執行',
            completed_at = NOW()
        WHERE rh_task_id = $1 AND user_id = $2 AND status = 'QUEUED'
        """,
        req.rhTaskId,
        user_id,
    )
    return {"success": True, "updated": result != "UPDATE 0"}


@router.get("/api/users/me/tasks")
async def my_tasks(
    user_id: str = Depends(auth.require_user),
    limit: int = Query(50, ge=1, le=200),
    days: int = Query(30, ge=1, le=365),
):
    """個人歷史。預設 50 筆 / 30 天內。admin 也記錄／可看自己的歷史（user_id = __admin__）。"""
    rows = await db.fetch_all(
        f"""
        SELECT id, card_id, card_title, card_type, webapp_id, workflow_id, rh_task_id, status,
               cost_time, consume_coins, consume_money, third_party_consume_money,
               results, error_message, node_input, created_at, completed_at
        FROM tasks
        WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '{int(days)} days'
        ORDER BY created_at DESC
        LIMIT $2
        """,
        user_id,
        limit,
    )
    return {
        "costCurrency": config.get_cost_currency(),
        "tasks": [
            {
                "id": r["id"],
                "cardId": r["card_id"],
                "cardTitle": r["card_title"],
                "cardType": r["card_type"] or "webapp",
                "webappId": r["webapp_id"],
                "workflowId": r["workflow_id"] or "",
                "rhTaskId": r["rh_task_id"],
                "status": r["status"],
                "costTime": r["cost_time"],
                "consumeCoins": r["consume_coins"],
                "consumeMoney": float(r["consume_money"]) if r["consume_money"] is not None else None,
                "thirdPartyConsumeMoney": float(r["third_party_consume_money"]) if r["third_party_consume_money"] is not None else None,
                "results": r["results"] or [],
                "errorMessage": r["error_message"],
                "nodeInput": r["node_input"] or [],
                "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
                "completedAt": r["completed_at"].isoformat() if r["completed_at"] else None,
            }
            for r in rows
        ],
    }


@router.get("/api/admin/users/{user_id}/usage")
async def user_usage(user_id: str, _: str = Depends(auth.require_admin)):
    """管理員：該用戶本月（截至目前）任務數 + 累計時長 + GPU coin + 真實金額。"""
    user = await db.fetch_one("SELECT id FROM users WHERE id = $1", user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用戶不存在")

    row = await db.fetch_one(
        """
        SELECT
            COUNT(*)                                                                   AS total,
            COUNT(*) FILTER (WHERE status = 'SUCCESS')                                 AS success,
            COUNT(*) FILTER (WHERE status IN ('FAILED','TIMEOUT'))                     AS failed,
            COALESCE(SUM(cost_time)                 FILTER (WHERE status='SUCCESS'),0) AS total_time,
            COALESCE(SUM(consume_coins)             FILTER (WHERE status='SUCCESS'),0) AS total_coins,
            COALESCE(SUM(consume_money)             FILTER (WHERE status='SUCCESS'),0) AS total_money,
            COALESCE(SUM(third_party_consume_money) FILTER (WHERE status='SUCCESS'),0) AS total_third_money
        FROM tasks
        WHERE user_id = $1
          AND created_at >= date_trunc('month', NOW())
        """,
        user_id,
    )
    return {
        "monthTotal": row["total"] or 0,
        "monthSuccess": row["success"] or 0,
        "monthFailed": row["failed"] or 0,
        "monthCostTime": float(row["total_time"] or 0.0),
        "monthCoins": int(row["total_coins"] or 0),
        "monthMoney": float(row["total_money"] or 0.0),
        "monthThirdPartyMoney": float(row["total_third_money"] or 0.0),
        "costCurrency": config.get_cost_currency(),
    }
