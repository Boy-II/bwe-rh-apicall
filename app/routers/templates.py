"""提示詞範本庫：瀏覽、搜尋、收藏。"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.core import auth, db
from app.core.rate_limit import rate_limit
from app.services import prompt_tools

router = APIRouter()

_SUMMARY_COLS = "t.id, t.title, t.category_id, t.tags, t.mode, t.thumb_url, t.image_url, t.created_by"
_DETAIL_COLS = _SUMMARY_COLS + ", t.prompt_en, t.prompt_zh, t.suggested_model"


async def is_admin(request: Request) -> bool:
    return await auth.is_admin_token_valid(request.headers.get("X-Admin-Token", ""))


def can_edit(row: dict, user_id: str, admin: bool) -> bool:
    return admin or (row.get("created_by") is not None and row["created_by"] == user_id)


def summary(row: dict, user_id: str, admin: bool) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "categoryId": row["category_id"],
        "tags": row["tags"] or [],
        "mode": row["mode"],
        "thumbUrl": row["thumb_url"],
        "imageUrl": row["image_url"],
        "favorited": bool(row.get("favorited")),
        "canEdit": can_edit(row, user_id, admin),
    }


def detail(row: dict, user_id: str, admin: bool) -> dict:
    return {
        **summary(row, user_id, admin),
        "promptEn": row["prompt_en"],
        "promptZh": row["prompt_zh"],
        "suggestedModel": row["suggested_model"],
        "createdBy": row["created_by"],
    }


def escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def fetch_detail(template_id: str, user_id: str) -> dict | None:
    return await db.fetch_one(
        f"""SELECT {_DETAIL_COLS},
        EXISTS(SELECT 1 FROM template_favorites f WHERE f.template_id=t.id AND f.user_id=$2) AS favorited
        FROM templates t WHERE t.id=$1""",
        template_id,
        user_id,
    )


@router.get("/api/template-categories")
async def list_categories(_user: str = Depends(auth.require_user)):
    rows = await db.fetch_all(
        """SELECT c.id, c.name, COUNT(t.id) AS count FROM template_categories c
        LEFT JOIN templates t ON t.category_id = c.id
        GROUP BY c.id ORDER BY c.sort_order, c.id"""
    )
    return [{"id": r["id"], "name": r["name"], "count": r["count"]} for r in rows]


@router.get("/api/template-tags")
async def list_tags(category: str = "", _user: str = Depends(auth.require_user)):
    rows = await db.fetch_all(
        """SELECT tag, COUNT(*) AS count FROM templates, unnest(tags) AS tag
        WHERE ($1 = '' OR category_id = $1)
        GROUP BY tag ORDER BY count DESC, tag LIMIT 40""",
        category,
    )
    return [{"tag": r["tag"], "count": r["count"]} for r in rows]


@router.get("/api/templates")
async def list_templates(
    request: Request,
    category: str = "",
    tag: str = "",
    mode: str = "",
    q: str = "",
    favorites: bool = False,
    offset: int = Query(0, ge=0),
    limit: int = Query(40, ge=1, le=100),
    user_id: str = Depends(auth.require_user),
):
    where, args = [], [user_id]

    def arg(v):
        args.append(v)
        return f"${len(args)}"

    if category:
        where.append(f"t.category_id = {arg(category)}")
    if tag:
        where.append(f"{arg(tag)} = ANY(t.tags)")
    if mode:
        where.append(f"t.mode = {arg(mode)}")
    if q.strip():
        p = arg("%" + escape_like(q.strip()) + "%")
        where.append(
            f"""(t.title ILIKE {p} ESCAPE '\\' OR t.prompt_en ILIKE {p} ESCAPE '\\'
            OR t.prompt_zh ILIKE {p} ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM unnest(t.tags) x WHERE x ILIKE {p} ESCAPE '\\'))"""
        )
    if favorites:
        where.append("EXISTS(SELECT 1 FROM template_favorites f WHERE f.template_id=t.id AND f.user_id=$1)")
    # $1（user_id）一律出現，讓 COUNT 與列表共用同一組參數
    clause = "WHERE " + " AND ".join(["$1::text IS NOT NULL", *where])
    total = await db.fetch_val(f"SELECT COUNT(*) FROM templates t {clause}", *args)
    rows = await db.fetch_all(
        f"""SELECT {_SUMMARY_COLS},
        EXISTS(SELECT 1 FROM template_favorites f WHERE f.template_id=t.id AND f.user_id=$1) AS favorited
        FROM templates t {clause}
        ORDER BY t.created_at DESC, t.id LIMIT {arg(limit)} OFFSET {arg(offset)}""",
        *args,
    )
    admin = await is_admin(request)
    next_offset = offset + len(rows)
    return {
        "items": [summary(r, user_id, admin) for r in rows],
        "total": total,
        "nextOffset": next_offset if next_offset < total else None,
    }


@router.get("/api/templates/{template_id}")
async def get_template(template_id: str, request: Request, user_id: str = Depends(auth.require_user)):
    row = await fetch_detail(template_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="範本不存在")
    return detail(row, user_id, await is_admin(request))


async def _sync_favorite_count(template_id: str) -> None:
    await db.execute(
        """UPDATE templates SET favorite_count =
        (SELECT COUNT(*) FROM template_favorites WHERE template_id=$1) WHERE id=$1""",
        template_id,
    )


@router.put("/api/templates/{template_id}/favorite")
async def add_favorite(template_id: str, user_id: str = Depends(auth.require_user)):
    if not await db.fetch_val("SELECT 1 FROM templates WHERE id=$1", template_id):
        raise HTTPException(status_code=404, detail="範本不存在")
    await db.execute(
        "INSERT INTO template_favorites(user_id, template_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        user_id,
        template_id,
    )
    await _sync_favorite_count(template_id)
    return {"favorited": True}


@router.delete("/api/templates/{template_id}/favorite")
async def remove_favorite(template_id: str, user_id: str = Depends(auth.require_user)):
    await db.execute(
        "DELETE FROM template_favorites WHERE user_id=$1 AND template_id=$2", user_id, template_id
    )
    await _sync_favorite_count(template_id)
    return {"favorited": False}


class FillBody(BaseModel):
    lang: Literal["en", "zh"]


@router.post(
    "/api/templates/{template_id}/fill-language",
    dependencies=[Depends(rate_limit("prompt", 30, 60))],
)
async def fill_language(template_id: str, body: FillBody, _user: str = Depends(auth.require_user)):
    """補上缺少的語言版本；只寫入空欄位，絕不覆蓋既有內容。"""
    row = await db.fetch_one("SELECT prompt_en, prompt_zh FROM templates WHERE id=$1", template_id)
    if not row:
        raise HTTPException(status_code=404, detail="範本不存在")
    col = "prompt_en" if body.lang == "en" else "prompt_zh"
    other = row["prompt_zh"] if body.lang == "en" else row["prompt_en"]
    if row[col]:
        return {"text": row[col], "generated": False}
    if not other:
        raise HTTPException(status_code=400, detail="範本沒有可翻譯的提示詞")
    text = await prompt_tools.translate(other, body.lang)
    updated = await db.execute(
        f"UPDATE templates SET {col}=$2, updated_at=NOW() WHERE id=$1 AND {col}=''",
        template_id,
        text,
    )
    if updated == "UPDATE 0":
        return {"text": await db.fetch_val(f"SELECT {col} FROM templates WHERE id=$1", template_id), "generated": False}
    return {"text": text, "generated": True}
