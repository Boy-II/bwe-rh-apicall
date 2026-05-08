# BWE AI 應用平台

以卡片化 UI 整合 [RunningHub](https://www.runninghub.ai) AI 應用 / 工作流的服務平台，提供使用者帳號、AI 助手、生成歷史、權限分級、成本追蹤等功能。

> 後端：FastAPI · 前端：Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui · 儲存：PostgreSQL + Redis · 部署：Zeabur（Dockerfile multi-stage）

---

## 主要功能

**使用者端**
- 卡片網格瀏覽 AI 應用，支援標籤搜尋、最近使用排序
- AI 助手側邊欄（OpenAI 相容 API，無設定時 fallback Gemini）— 對著當前卡片問問題、自動套用建議提示詞、支援 2 張圖片附件（拖曳上傳，自動壓 JPG）
- 任務生成、輪詢、結果預覽（圖片／影片／音訊）
- 個人歷史頁（30 天 / 50 筆）：縮圖、重新下載、**一鍵重跑**（自動換 seed）、瀏覽器通知任務完成、執行中可取消
- 深色 / 淺色 / 跟隨系統 主題切換

**管理員端**
- 卡片 CRUD：webapp 或 workflow 兩種型別、預覽圖（圖片或 mp4 短影片，hover 才播放）、標籤、AI 助手專用功能說明（不對使用者顯示）、可拖曳排序
- workflow 卡片可勾選使用者可編輯的欄位白名單；可選擇 24G 或 48G 4090 GPU；可設個別最長執行時長
- RunningHub 應用市集瀏覽（推薦/最熱/最新），一鍵加入為平台卡片
- 用戶管理：核准 / 拒絕註冊；本月用量（次數 / 秒數 / RH coin / 第三方金額）；備註欄
- 平台 RH 餘額即時顯示
- AI 助手設定：Base URL / API Key / 模型 / 全域 system prompt / 金額幣別

---

## 架構

```
.
├── app/                          # FastAPI 後端
│   ├── main.py                   # 入口、lifespan、靜態檔掛載
│   ├── core/                     # config / db / redis / auth / rate_limit
│   ├── routers/                  # auth, cards, users, tasks, proxy, admin_ai, admin_rh
│   ├── services/                 # llm (OpenAI/Gemini)、runninghub
│   ├── schemas.py                # Pydantic 請求/回應模型
│   └── migrations/               # 001_init.sql ~ 012_card_tags.sql + runner.py
├── web/                          # Vite + React 前端
│   ├── src/
│   │   ├── components/           # CardGrid, TaskView, ChatSidebar, …
│   │   ├── components/ui/        # shadcn 基礎元件
│   │   └── lib/                  # api client, auth-store, theme-store, …
│   └── dist/                     # 由 Dockerfile 階段建置（不入版）
├── covers/                       # 本地開發用，Zeabur 上掛 /card/covers/
├── Dockerfile                    # multi-stage: node:20-alpine → python:3.12-slim
└── docker-compose.yml            # 本地 PG (5433) + Redis (6380)
```

**認證雙軌制**
- 使用者：PyJWT (HS256) 30 天，header `X-User-Token`，stateless 驗證
- 管理員：Redis 24h token，header `X-Admin-Token`
- 用使用者帳號 `admin` + `ADMIN_PASSWORD` 登入時同時取得兩把 token

**Migration 機制**
- `app/migrations/*.sql` 依檔名排序執行，`_migrations` 表記錄 sha256 checksum 防止重複套用
- lifespan 啟動時自動套用所有未執行的 migration

---

## 本地開發

需要 Docker（跑 PG + Redis）+ Python 3.12 + Node 20。

```bash
# 1. 啟動本地 PG + Redis（端口 5433 / 6380 避開預設）
docker compose up -d

# 2. 後端
cp .env.example .env             # 填入 RUNNINGHUB_API_KEY / ADMIN_PASSWORD 等
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-exclude="*.json"

# 3. 前端（另開終端）
cd web
npm install
npm run dev                      # Vite 跑在 5173，proxy /api → 8000
```

開啟 `http://localhost:5173`（dev 模式，hot reload）或 `http://localhost:8000`（後端直接服務 web/dist 的 production build）。

---

## 環境變數

複製 `.env.example` 為 `.env` 後填入。Zeabur 部署用 reference variable 從 PostgreSQL / Redis service 的 *Connect* 面板抓即可。

| 變數 | 必填 | 預設值 | 說明 |
|---|---|---|---|
| `RUNNINGHUB_API_KEY` | ✅ |  | RH API 金鑰 |
| `ADMIN_PASSWORD` | ✅ |  | 管理員登入密碼 |
| `JWT_SECRET` | 建議 | 自動生成寫入 DB | HS256 簽名金鑰；env 沒設則自動生成存到 `settings` 表 |
| `RUNNINGHUB_BASE_URL` | ⚪ | `https://www.runninghub.ai` | 海外用 `.ai`，大陸用 `.cn` |
| `GEMINI_API_KEY` | ⚪ |  | OpenAI 相容設定缺少時的 fallback |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | ⚪ |  | AI 助手 OpenAI 相容端點；可改用 admin UI 設定 |
| `DB_POSTGRESDB_HOST` | ✅ | `localhost` |  |
| `DB_POSTGRESDB_PORT` | ✅ | `5432` |  |
| `DB_POSTGRESDB_DATABASE` | ✅ | `rhapi` |  |
| `DB_POSTGRESDB_USER` | ✅ | `rhapi` |  |
| `DB_POSTGRESDB_PASSWORD` | ✅ |  |  |
| `REDIS_HOST` | ✅ | `localhost` |  |
| `REDIS_PORT` | ✅ | `6379` |  |
| `REDIS_PASSWORD` | ⚪ |  |  |
| `POLLING_INTERVAL` | ⚪ | `3000` | 任務輪詢間隔（毫秒） |
| `MAX_POLLING_RETRIES` | ⚪ | `200` | 全域輪詢上限（每張卡可在 admin UI 個別覆寫） |
| `PORT` | ⚪ | `8000` | 服務監聽埠 |

---

## 部署到 Zeabur

```bash
git push
```

`Dockerfile` 是 multi-stage：

1. `node:20-alpine` 建 `web/dist`（容器內 `npm ci && npm run build`）
2. `python:3.12-slim` 安裝後端 deps、複製 `app/` 與 `web/dist`
3. `uvicorn app.main:app` 啟動

**Zeabur 設定**
- 在 BWE service 的 **Variables** 頁，從 PostgreSQL / Redis service 的 *Connect* 面板 reference 對應的 host/port/credentials
- 掛 `/card/` 為 **Persistent Volume**（卡片預覽圖會落到 `/card/covers/`，redeploy 不會消失）
- 第一次 deploy 後 lifespan 自動跑完所有 migration，建好 `cards` / `users` / `tasks` / `settings` / `_migrations` 表
- 用 `admin` + `ADMIN_PASSWORD` 登入後即可開始建卡片

---

## API 端點概覽

| 範圍 | 端點 |
|---|---|
| Auth | `/api/auth/{register,login,logout,verify}`、`/api/admin/{login,logout,verify}` |
| 卡片（user） | `GET /api/cards` |
| 卡片（admin） | `POST/PUT/DELETE /api/admin/cards/*`、`POST /api/admin/cards/{reorder,upload-cover}` |
| 用戶（admin） | `GET /api/admin/users`、`PUT /api/admin/users/{id}/note`、`POST .../approve\|reject`、`DELETE`、`GET .../usage` |
| AI 助手（admin） | `GET/POST /api/admin/ai-config`、`POST /api/admin/ai-models` |
| RH 平台（admin） | `POST /api/admin/account-status`、`POST /api/admin/aiapp-list` |
| 任務（user） | `GET /api/users/me/tasks`、`POST /api/users/me/tasks/mark-timeout` |
| RH 代理（user） | `POST /api/proxy/{getNodeInfo,submitTask,getWorkflowJson,submitWorkflowTask,queryTaskOutputs,cancelTask,uploadFile,chat,getAccountStatus}` |

所有 `/api/proxy/*` 都需要使用者 token + Redis 速率限制（chat 10/min、submit 30/hr、upload 20/min）。

---

## 授權

Internal use.
