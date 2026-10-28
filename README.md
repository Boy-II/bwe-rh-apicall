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
| `RUNNINGHUB_BASE_URL` | ⚪ | `https://www.runninghub.ai` |  |
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




## BWHR 員工帳號與區處授權

普通帳號改用 BWHR 員工編號及密碼，登入驗證只讀本平台 PostgreSQL。admin 帳號與 `ADMIN_PASSWORD` 保留。原自助註冊入口停用；舊本地帳號和歷史資料保留，但不自動與員工身分合併。

先備份本平台資料庫並套用 migration（正式環境需安排部署，本次修改未執行正式庫更新）：

```bash
rtk proxy python -m app.migrations.runner
```

在可存取 BWHR SQLite 的機器，以 SQLite backup API 建立一致性快照；不要只複製正在運行的 `bwhr.db` 主檔而遺漏 WAL。下例路徑請替換為實際唯讀來源與安全快照位置：

```python
from contextlib import closing
import sqlite3
with closing(sqlite3.connect('file:/path/to/bwhr.db?mode=ro', uri=True)) as source:
    with closing(sqlite3.connect('/safe/private/bwhr.snapshot.db')) as target:
        source.backup(target)
```

完整快照含有人事資料，應放在權限為 700 的私人目錄，僅供同步使用，完成後依組織資料管理規範清理。同步工具只擷取 `Employee` 的員編、bcrypt 雜湊、姓名、email、區處/部門/單位及啟用狀態；不輸出個資或密碼。程式不需要也不會取得明文密碼。

在可連線本平台 PG 的環境執行，連線沿用 `DB_POSTGRESDB_*`：

```bash
rtk proxy python -m app.sync_bwhr --sqlite-path /safe/private/bwhr.snapshot.db --dry-run
rtk proxy python -m app.sync_bwhr --sqlite-path /safe/private/bwhr.snapshot.db
```

同步以 transaction 完成，可重複執行。若員編與舊本地帳號衝突，整批回滾，須先人工確認身分對應；不會直接覆寫舊帳號。空來源、重複員編、錯誤欄位及不支援的雜湊會中止。來源中已刪除/停用的員工會失去使用資格，來源密碼變動會讓舊登入失效，本地個別拒絕與備註會保留。管理介面的 BWHR 帳號「停用」會保留身分與拒絕設定，不會實體刪除後又被下一次同步復活。沒有 BWHR 密碼的員工須先回 BWHR 設定。

管理員在「用戶 → 開放區處」選擇可使用的區處，預設健康事業處。清空名單代表不開放任何普通員工；更新名單也會限制已登入者的下一次請求。

新增員工、調職、離職及變更 BWHR 密碼，需重新同步才會反映於本平台。初版提供手動 CLI；若要定期同步，可由維運排程先建立一致性快照，再執行上述命令。此次未安裝 VPS 排程、未匯入正式員工資料。SQLite 檔案及本地參考倉庫已排除於 Git 與 Docker 建置內容。

## 分類、標準圖片模型與助手

首頁可依圖片／影片／音源分類及文生圖／圖生圖篩選。既有卡片預設圖片，管理員可調整分類及 AI 助手的模型規則。內建五組圖片模型：全能图片PRO（Gemini Pro）、全能图片V2（Gemini Flash）、悠船 v7（Midjourney）、GPT Image 2、Seedream v5 Pro（即夢）；每組各有文生圖/圖生圖卡片。首次啟動加入，後續不覆寫管理員的修改或停用狀態。

標準模型使用 `RUNNINGHUB_MODEL_BASE_URL`（預設 `https://www.runninghub.cn/openapi/v2`），與既有 workflow/webapp 的 `RUNNINGHUB_BASE_URL` 分開。兩者共用 `RUNNINGHUB_API_KEY`。圖片經標準 API 上傳取得 URL 後才提交模型任務；參數依本專案的版本化最小 schema 驗證。

圖生圖支援多選、新增、移除、預覽、失敗重試。輸入等比縮至長邊最多 2048px，不放大，JPEG 品質 0.9；PNG/WebP 以 PNG 保留透明度。依模型限制張數與縮圖後大小；Flash 參考圖最多 14 張，其餘多圖模型最多 10 張，悠船 v7 使用底圖/風格/角色參考各一張。未完成或失敗的上傳會阻止提交。停止等待不代表取消上游任務，已提交任務仍可能產生費用。

AI 助手專注生成、優化、修改提示詞及模型規則檢查。保留一鍵套用，加入模型 profile，修正多輪對話歷史；管理員 System Prompt 改作補充規則。Krea2/MOSS-Image 先提供提示詞協助，可綁定既有 workflow；未加入猜測的標準 API 端點。MOSS Layout 經程式驗證與座標轉換後才提供可套用結果，並顯示必須一致的畫布尺寸。

提示詞規則參考：

- [GPT Image 2 風格與模板](https://github.com/freestylefly/awesome-gpt-image-2)
- [Krea2 提示詞規則](https://github.com/AI-KSK/krea2-prompt-suite/blob/main/SKILL.md)
- [MOSS-Image caption 與 Layout](https://github.com/OpenMOSS/MOSS-Image/tree/main/skills/moss-image-prompt-enhancer)

完整參考資料只在本地 `runninghub/`，不提交。本產品僅保存自行整理的必要規則與最小模型 schema，不需要執行時存取這些本地倉庫。

## 變更驗證

```bash
rtk proxy python -m unittest discover -s tests -v
rtk proxy npm --prefix web ci
rtk proxy npm --prefix web test
rtk proxy npm --prefix web run build
rtk proxy npm --prefix web run test:browser
```

PG integration 使用自建臨時 cluster，完全不讀取應用 DB 憑證；可用 `TEST_PG_BIN` 指定 PostgreSQL 的 bin 目錄，未提供二進位時測試會明確 skip。瀏覽器測試使用本機 Chrome（macOS）或已安裝的 Playwright Chromium；其他環境可先執行 `rtk proxy npm --prefix web exec playwright install chromium`。測試的上游 API 均為 mock，不提交付費任務。


## 封面隨專案部署

目前選用的 10 張模型封面已保存於 `app/data/cover_presets/`，`manifest.json` 記錄固定卡片 ID 與 `/covers/` 路徑；這些是專案正式資產，可納入版本控制，與僅供本地查閱的 `runninghub/` 參考資料分開。

Dockerfile 的 `COPY app/ ./app/` 會將封面一起打包。應用啟動會將缺少的封面補入 `/card/covers/`（有持久卷時）或本地 `covers/`，再為尚未設定封面的既有卡片填入預設路徑。已有的持久卷檔案及非空白卡片封面設定不會被覆寫，不需要連線到開發用 PG 才能取得預設封面。

後續若在管理介面更換封面，在建置／部署前重新匯出即可更新專案資產：

```bash
rtk proxy python -m app.export_covers
```

此命令使用當前 PostgreSQL 中的卡片對應與本機／持久卷封面檔，只輸出封面與卡片 ID，不會匯出使用者、API key 或資料庫憑證。來源空白、檔案缺失或路徑異常時會拒絕更新清單，保留原本的打包資產。上傳但未套用到卡片的舊圖片仍保留於原始上傳目錄，不會被刪除。
