"""提示詞優化與範本資料建議。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core import auth, db
from app.core.rate_limit import rate_limit
from app.services import image_registry, prompt_tools

router = APIRouter()


class OptimizeBody(BaseModel):
    prompt: str
    request: str
    modelKey: str = ""


class MetaBody(BaseModel):
    prompt: str


async def category_list() -> list[dict]:
    return await db.fetch_all("SELECT id, name FROM template_categories ORDER BY sort_order, id")


@router.post("/api/prompt/optimize", dependencies=[Depends(rate_limit("prompt", 30, 60))])
async def optimize(body: OptimizeBody, _user: str = Depends(auth.require_user)):
    if not body.prompt.strip() or not body.request.strip():
        raise HTTPException(status_code=400, detail="請輸入提示詞與優化需求")
    model = await image_registry.get(body.modelKey) if body.modelKey else None
    profile = model["profile"] if model else "generic"
    return {"prompt": await prompt_tools.optimize(body.prompt, body.request, profile)}


@router.post("/api/prompt/suggest-meta", dependencies=[Depends(rate_limit("prompt", 30, 60))])
async def suggest_meta(body: MetaBody, _user: str = Depends(auth.require_user)):
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="請輸入提示詞")
    try:
        return await prompt_tools.suggest_meta(body.prompt, await category_list())
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e)) from None
