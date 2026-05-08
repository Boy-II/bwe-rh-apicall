"""FastAPI 應用入口。"""

import json
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core import config, db
from app.core import redis_client
from app.migrations.runner import apply_migrations
from app.migrations.seed_from_config import run_seed
from app.routers import admin_ai, admin_rh, auth, cards, proxy, tasks, users
from app.services import runninghub

ROOT_DIR = Path(__file__).resolve().parents[1]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # === 啟動：DB / Redis / httpx ===
    await db.init_pool()
    await redis_client.init_client()
    runninghub.init_client()

    # === Migrations + 一次性 seed ===
    await apply_migrations()
    await run_seed()

    # === 載入 DB settings 到 in-memory 快取 ===
    # JSONB 已被 codec decode 成 Python 物件
    rows = await db.fetch_all("SELECT key, value FROM settings")
    db_settings: dict[str, str] = {}
    for r in rows:
        v = r["value"]
        if v is None:
            db_settings[r["key"]] = ""
        elif isinstance(v, (dict, list)):
            db_settings[r["key"]] = json.dumps(v)
        else:
            db_settings[r["key"]] = str(v)
    config.replace_db_settings(db_settings)

    # === 確保 jwt_secret 存在 ===
    if not config.get_jwt_secret():
        new_secret = secrets.token_hex(32)
        await db.execute(
            """
            INSERT INTO settings (key, value, updated_at)
            VALUES ('jwt_secret', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
            """,
            new_secret,
        )
        config.set_db_setting("jwt_secret", new_secret)
        print("[Lifespan] 自動生成 jwt_secret 並寫入 settings 表")

    print("[Lifespan] 啟動完成")

    yield

    # === 關閉 ===
    await runninghub.close_client()
    await redis_client.close_client()
    await db.close_pool()


app = FastAPI(title="BWE AI Platform API", version="3.1.0", lifespan=lifespan)


# ===== Routers =====
app.include_router(auth.router)
app.include_router(cards.router)
app.include_router(users.router)
app.include_router(admin_ai.router)
app.include_router(admin_rh.router)
app.include_router(tasks.router)
app.include_router(proxy.router)


# ===== 靜態檔案 =====
# 卡片預覽圖（持久化）
from pathlib import Path as _Path
COVERS_DIR = _Path("/card/covers") if _Path("/card").exists() else (ROOT_DIR / "covers")
COVERS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/covers", StaticFiles(directory=COVERS_DIR), name="covers")

WEB_DIST = ROOT_DIR / "web" / "dist"

if WEB_DIST.exists():
    # Vite 產出：assets/ + index.html，SPA fallback 由 StaticFiles(html=True) 處理
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/")
    async def serve_index():
        return FileResponse(WEB_DIST / "index.html")
else:
    # 舊版 vanilla JS SPA fallback
    app.mount("/css", StaticFiles(directory=ROOT_DIR / "css"), name="css")
    app.mount("/js", StaticFiles(directory=ROOT_DIR / "js"), name="js")

    @app.get("/")
    async def serve_index():
        return FileResponse(ROOT_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=config.PORT,
        reload=True,
        reload_excludes=["*.json", "config.json.migrated.bak"],
    )
