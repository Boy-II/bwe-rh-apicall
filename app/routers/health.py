"""健康檢查端點：GET /api/health"""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core import db, redis_client

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/api/health")
async def health_check():
    checks: dict[str, str] = {}

    try:
        await db.fetch_val("SELECT 1")
        checks["db"] = "ok"
    except Exception as e:
        logger.error("Health check DB failed: %s", e)
        checks["db"] = "error"

    try:
        await redis_client.client().ping()
        checks["redis"] = "ok"
    except Exception as e:
        logger.error("Health check Redis failed: %s", e)
        checks["redis"] = "error"

    ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        content={"status": "ok" if ok else "degraded", "checks": checks},
        status_code=200 if ok else 503,
    )
