"""管理端：已保存的生成圖片列表與刪除。"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core import auth
from app.services import media_retention

router = APIRouter()


@router.get("/api/admin/media/results")
async def list_results(
    offset: int = Query(0, ge=0),
    limit: int = Query(60, ge=1, le=200),
    _: str = Depends(auth.require_admin),
):
    files = media_retention.list_files()
    page = files[offset : offset + limit]
    info = await media_retention.task_info([f["url"] for f in page])
    items = []
    for f in page:
        t = info.get(f["url"])
        items.append({
            "name": f["name"],
            "url": f["url"],
            "size": f["size"],
            "savedAt": datetime.fromtimestamp(f["mtime"], tz=timezone.utc).isoformat(),
            "expiresAt": media_retention.expires_at(f["mtime"]).isoformat(),
            "task": {
                "id": t["id"],
                "cardTitle": t["card_title"],
                "provider": t["provider"],
                "userName": t["user_name"],
                "createdAt": t["created_at"].isoformat() if t["created_at"] else "",
            } if t else None,
        })
    next_offset = offset + len(page)
    return {
        "items": items,
        "total": len(files),
        "totalSize": sum(f["size"] for f in files),
        "retentionDays": media_retention.RETENTION_DAYS,
        "nextOffset": next_offset if next_offset < len(files) else None,
    }


class DeleteBody(BaseModel):
    names: list[str] = Field(min_length=1, max_length=500)


@router.post("/api/admin/media/results/delete")
async def delete_results(body: DeleteBody, _: str = Depends(auth.require_admin)):
    return {"success": True, "deleted": await media_retention.delete_files(body.names)}
