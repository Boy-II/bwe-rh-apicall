"""提示詞範本庫：瀏覽、搜尋、收藏。"""

import re
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from app.core import auth, db
from app.core.rate_limit import rate_limit
from app.services import media, prompt_tools

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


# ===== 存回範本庫、編輯、刪除 =====

Mode = Literal["t2i", "i2i", "edit"]
_CAT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")


class SaveBody(BaseModel):
    taskId: str
    resultIndex: int = 0
    title: str = Field(min_length=1, max_length=60)
    categoryId: str | None = None
    tags: list[str] = Field(default_factory=list)
    mode: Mode = "t2i"
    promptEn: str = ""
    promptZh: str = ""


class PatchBody(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=60)
    categoryId: str | None = None
    tags: list[str] | None = None
    mode: Mode | None = None
    promptEn: str | None = None
    promptZh: str | None = None


def _clean_tags(tags: list[str]) -> list[str]:
    out = []
    for t in tags:
        t = str(t).strip()[:20]
        if t and t not in out:
            out.append(t)
    return out[:10]


async def _valid_category(category_id: str | None) -> str | None:
    if category_id and not await db.fetch_val("SELECT 1 FROM template_categories WHERE id=$1", category_id):
        raise HTTPException(status_code=400, detail="分類不存在")
    return category_id or None


async def _store_image(content: bytes) -> tuple[str, str]:
    try:
        ext = media.image_ext(content)
        url = media.save_bytes("templates", content, ext)
        return url, media.make_thumbnail(url)
    except media.MediaError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@router.post("/api/templates")
async def save_template(body: SaveBody, request: Request, user_id: str = Depends(auth.require_user)):
    task = await db.fetch_one(
        """SELECT id, status, results, model_key FROM tasks
        WHERE (rh_task_id=$1 OR id=$1) AND user_id=$2 AND card_type='model' LIMIT 1""",
        body.taskId,
        user_id,
    )
    if not task:
        raise HTTPException(status_code=404, detail="任務不存在")
    if task["status"] != "SUCCESS":
        raise HTTPException(status_code=400, detail="任務尚未成功完成")
    results = task["results"] or []
    if not 0 <= body.resultIndex < len(results):
        raise HTTPException(status_code=400, detail="結果索引不存在")
    if not body.promptEn.strip() and not body.promptZh.strip():
        raise HTTPException(status_code=400, detail="請提供提示詞")
    category = await _valid_category(body.categoryId)
    # 先取得圖片再寫 DB：失敗不留半筆範本
    try:
        content = await media.read(results[body.resultIndex]["url"])
    except media.MediaError:
        raise HTTPException(status_code=502, detail="結果圖片已無法取得，請重新生成後再存") from None
    image_url, thumb_url = await _store_image(content)
    template_id = secrets.token_hex(8)
    await db.execute(
        """INSERT INTO templates(id,title,category_id,tags,mode,prompt_en,prompt_zh,image_url,thumb_url,
        suggested_model,created_by,source_task_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)""",
        template_id,
        body.title.strip(),
        category,
        _clean_tags(body.tags),
        body.mode,
        body.promptEn.strip(),
        body.promptZh.strip(),
        image_url,
        thumb_url,
        task["model_key"] or "",
        user_id,
        task["id"],
    )
    return detail(await fetch_detail(template_id, user_id), user_id, await is_admin(request))


async def _editable(template_id: str, request: Request, user_id: str) -> bool:
    row = await db.fetch_one("SELECT created_by FROM templates WHERE id=$1", template_id)
    if not row:
        raise HTTPException(status_code=404, detail="範本不存在")
    admin = await is_admin(request)
    if not can_edit(row, user_id, admin):
        raise HTTPException(status_code=403, detail="只有作者或管理員可以修改")
    return admin


@router.patch("/api/templates/{template_id}")
async def update_template(
    template_id: str, body: PatchBody, request: Request, user_id: str = Depends(auth.require_user)
):
    admin = await _editable(template_id, request, user_id)
    fields = body.model_dump(exclude_unset=True)
    if "categoryId" in fields:
        fields["categoryId"] = await _valid_category(fields["categoryId"])
    if "tags" in fields:
        fields["tags"] = _clean_tags(fields["tags"] or [])
    columns = {"title": "title", "categoryId": "category_id", "tags": "tags", "mode": "mode",
               "promptEn": "prompt_en", "promptZh": "prompt_zh"}
    sets, args = [], [template_id]
    for key, value in fields.items():
        if key in ("title", "promptEn", "promptZh") and value is not None:
            value = value.strip()
        if value is None and key != "categoryId":
            continue
        args.append(value)
        sets.append(f"{columns[key]}=${len(args)}")
    if sets:
        await db.execute(f"UPDATE templates SET {', '.join(sets)}, updated_at=NOW() WHERE id=$1", *args)
    return detail(await fetch_detail(template_id, user_id), user_id, admin)


@router.delete("/api/templates/{template_id}")
async def delete_template(template_id: str, request: Request, user_id: str = Depends(auth.require_user)):
    await _editable(template_id, request, user_id)
    await db.execute("DELETE FROM templates WHERE id=$1", template_id)
    return {"success": True}


# ===== 管理員：換圖、分類 =====


class CategoryBody(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=30)


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=30)
    sortOrder: int | None = None


@router.post("/api/admin/templates/{template_id}/image")
async def replace_image(template_id: str, file: UploadFile = File(...), _: str = Depends(auth.require_admin)):
    if not await db.fetch_val("SELECT 1 FROM templates WHERE id=$1", template_id):
        raise HTTPException(status_code=404, detail="範本不存在")
    content = await file.read(20 * 1024 * 1024 + 1)
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="圖片超過 20 MB")
    image_url, thumb_url = await _store_image(content)
    await db.execute(
        "UPDATE templates SET image_url=$2, thumb_url=$3, updated_at=NOW() WHERE id=$1",
        template_id, image_url, thumb_url,
    )
    return {"imageUrl": image_url, "thumbUrl": thumb_url}


@router.post("/api/admin/template-categories")
async def create_category(body: CategoryBody, _: str = Depends(auth.require_admin)):
    if not _CAT_ID_RE.match(body.id):
        raise HTTPException(status_code=400, detail="分類 id 只能用小寫英數與連字號")
    order = await db.fetch_val("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM template_categories")
    result = await db.execute(
        "INSERT INTO template_categories(id,name,sort_order) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        body.id, body.name.strip(), order,
    )
    if result == "INSERT 0 0":
        raise HTTPException(status_code=409, detail="分類 id 已存在")
    return {"id": body.id, "name": body.name.strip(), "sortOrder": order}


@router.patch("/api/admin/template-categories/{category_id}")
async def update_category(category_id: str, body: CategoryPatch, _: str = Depends(auth.require_admin)):
    result = await db.execute(
        """UPDATE template_categories SET name=COALESCE($2,name), sort_order=COALESCE($3,sort_order)
        WHERE id=$1""",
        category_id, body.name.strip() if body.name else None, body.sortOrder,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="分類不存在")
    return {"success": True}


@router.delete("/api/admin/template-categories/{category_id}")
async def delete_category(category_id: str, _: str = Depends(auth.require_admin)):
    await db.execute("DELETE FROM template_categories WHERE id=$1", category_id)
    return {"success": True}
