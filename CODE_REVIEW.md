# 代碼審查報告：BWE AI 應用平台

**審查日期**：2026/5/14  
**專案版本**：3.1.0  
**審查範圍**：全專案 (後端 + 前端 + 資料庫)

---

## 一、後端 (Python/FastAPI) 優化建議

### 1.1 app/main.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 1 | L97 | `from pathlib import Path as _Path` 重複 import（L30 已 import） | 移除重複 import，統一使用 L30 的 `Path` |
| 2 | L98 | `_Path("/card").exists()` 檢查邏輯可能不可靠（權限問題） | 建議改用 env var `COVERS_PATH` 控制 mount path |
| 3 | L129 | `reload_excludes` 硬編碼 | 可考慮從 config 讀取 |

**影響**：低（維護性）

---

### 1.2 app/core/config.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 4 | L7 | `load_dotenv()` 無條件執行，每次 import 都觸發 | 建議加條件：`if not os.environ.get("_ENV_LOADED")` |
| 5 | L39-54 | `_db_settings` 是 plain dict，單 worker 下 asyncio 協作式多工無 race condition | 若啟用多 worker（`--workers N`），各 worker 為獨立 process，`_db_settings` 各自獨立，`threading.Lock` 無效；真正需要共享的設定值應走 Redis |
| 6 | L80-82 | `cost_currency` 註解說「已移除 cost_per_second」但 DB 可能殘留舊值 | 建議加 deprecated settings 清理邏輯或 migration note |

**影響**：中（并发安全性）

---

### 1.3 app/core/db.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 7 | L26-28 | pool `max_size=10` 固定，無法調控 | 建議可配置：`DB_POOL_MAX_SIZE` env var |
| 8 | L56-59 | `pool()` 無 error handling，若 pool 已關閉但還有請求會 raise RuntimeError | 建議加 graceful fallback 或 log |
| 9 | L65-84 | helper 函數無詳細 type hint | 建議加 `-> Optional[dict[str, Any]]` 等更精確類型 |

**影響**：中（可擴展性）

---

### 1.4 app/core/auth.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 10 | L43-44 | `is_admin_token_valid` 只做 exists 檢查，未做 TTL refresh | 建議用 Redis `touch` 或每次驗證時延長 TTL |
| 11 | L82-86 | `require_user` 每次請求都查 DB 確認 status | 高流量時可考慮加 Redis cache (TTL 5min) |
| 12 | L90-106 | `optional_user` 捕捉 HTTPException 但 decode_user_token 也可能因 expired 丟錯 | 邏輯正確，但建議更明確區分 expired vs invalid |

**影響**：中（效能 & 安全性）

---

### 1.5 app/core/rate_limit.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 13 | L32-37 | 確認使用 `redis.asyncio` 而非同步 redis 客戶端 | `redis.asyncio` 的 `pipeline()` 本身就是 async context manager，`await pipe.execute()` 為正確用法；若誤用同步 `redis.Redis` 則整個 event loop 會被阻塞，建議在 import 時明確從 `redis.asyncio` 導入以避免混用 |
| 14 | L35 | score 用 timestamp，value 用 `now * 1000 % 100000` | 高並發下可能衝突，建議加 random suffix |
| 15 | L40 | `retry_after` 固定 = window_seconds | 建議計算實際過期時間 |

**影響**：中（正確性）

---

### 1.6 app/core/security.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 16 | L7 | `ITERATIONS = 100_000` 固定 | 建議可配置 `PBKDF2_ITERATIONS` env var，方便測試環境 |
| 17 | L11 | `os.urandom(16).hex()` salt (128-bit) | 建議增加到 32 bytes (256-bit) 以增強安全性 |

**影響**：低（安全性微調）

---

### 1.7 app/schemas.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 18 | L75 | `history: list = []` 無泛型 | 建議：`history: list[dict] = []` |
| 19 | L76 | `context: dict = {}` 無泛型 | 建議：`context: dict[str, Any] = {}` |
| 20 | L42 | `icon: str = "🎨"` 硬編碼預設值 | 建議移到 config 或 constants |

**影響**：低（類型安全）

---

### 1.8 app/routers/auth.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 21 | L43-46 | admin 捷徑同時 issue user JWT + admin token | 建議 log 記錄 admin login |
| 22 | L64-66 | `user_logout` 完全 stateless，client 自行清除 | 正確，但建議加 token blacklist 選項 |

**影響**：低

---

### 1.9 app/routers/cards.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 23 | L33-53 | `_row_to_dict` 手動 mapping 每個欄位 | 建議用 Pydantic 或 dataclass 自動 mapping |
| 24 | L56-60 | `_CARD_COLUMNS` 硬編碼欄位列表 | 建議從 model 生成 |
| 25 | L216-223 | `admin_reorder_cards` 用 transaction 逐筆更新 | 建議用 `executemany` 或 bulk update |

**影響**：中（維護性）

---

### 1.10 app/routers/tasks.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 26 | L42 | 註解說 "admin 也記錄／可看自己的歷史（user_id = __admin__）" | 建議明確在 DB 有對應行為說明 |
| 27 | L70-71 | `float(r["consume_money"])` 無空值保護 | 已有 `if r[...] is not None` 保護，正確 |

**影響**：低

---

### 1.11 app/routers/proxy.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 28 | L30 | import 在 function 定義之後 (L10-28) | 建議統一放到檔案頂部 |
| 29 | L253 | `is_error_envelope` 判斷邏輯複雜 | 建議拆成 helper function |
| 30 | L260-274 | `_to_float` / `_to_int` 重複邏輯 | 建議移到共用工具模組或 services/ |
| 31 | L211-243 | `cancel_task` 直接拼 URL 和 payload | 建議抽離到 runninghub.py |

**影響**：中（可維護性）

---

### 1.12 app/services/runninghub.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 32 | L15 | timeout 固定 `_DEFAULT_TIMEOUT` | 建議可配置 `RH_TIMEOUT_READ` env var |
| 33 | L82-85 | retry log 用 `print()` | 建議用 `logging` module |
| 34 | L91-95 | `_raise_upstream` 直接 expose httpx error msg | production 環境可能洩漏內部資訊 |

**影響**：中（可觀測性）

---

### 1.13 app/services/llm.py

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 35 | L171 | Gemini model 寫死 `gemini-2.5-flash-preview-04-17` | 建議加 `GEMINI_MODEL` env var |
| 36 | L112 | OpenAI 固定 `temperature=0.7, max_tokens=2048` | 建議可從 config 讀取或 admin UI 配置 |
| 37 | L156-159 | image split 錯誤時 fallback `image/jpeg` | 建議記錄 log 方便除錯 |
| 38 | L192-206 | `fetch_models` 無 cache | 建議 cache 結果 5min |

**影響**：中（靈活性）

---

## 二、前端 (React/TypeScript) 優化建議

### 2.1 web/src/lib/api.ts

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 39 | L30-31 | `userToken` / `adminToken` 是 module-level var | 建議用 class 或 store pattern 管理，方便測試 mock |
| 40 | L48-75 | `request()` 函數手動 parse JSON + text fallback | 建議統一用 `res.json()` + try/catch |
| 41 | L146-164, L329-351 | upload 函數自實現 fetch + parse，重複代碼 | 可重構共用 upload 邏輯 |
| 42 | L79-84 | `unwrapRh` 無 type guard | 建議加 runtime type check |

**影響**：中（可測試性）

---

### 2.2 web/src/lib/types.ts

| # | 位置 | 問題 | 建議 |
|---|------|------|------|
| 43 | L135 | `status: string` 不夠精確 | 建議：`status: TaskStatus` 其中 `TaskStatus = 'QUEUED' \| 'RUNNING' \| 'SUCCESS' \| 'FAILED' \| 'TIMEOUT' \| 'CANCELED'` |
| 44 | L200 | `[k: string]: unknown` 過多 | 建議明確定義結構，減少 any-like 類型 |
| 45 | L192 | `TaskQueryData` 有太多 optional 欄位 | 建議拆成多個類型 |

**影響**：低（類型安全）

---

### 2.3 前端元件觀察

| 檔案 | 觀察 | 建議 |
|------|------|------|
| `CardEditModal.tsx` | 手動 form state 管理 | 建議加 react-hook-form + zod validation |
| `ChatSidebar.tsx` | 圖片上傳邏輯在 component 內 | 建議抽離成 custom hook |
| `TaskHistoryView.tsx` | 大量歷史列表無 virtualization | 建議加 react-window 或類似 |
| `NodeRenderer.tsx` | fieldType 渲染邏輯重複 | 建議抽象成 renderer map |
| `HomePage.tsx` | 未檢視 | - |

**影響**：中（開發效率 & 效能）

---

## 三、資料庫 (PostgreSQL) 優化建議

### 3.1 Index 優化

| # | 表 | 問題 | 建議 |
|---|------|------|------|
| 46 | `cards` | `enabled` 過濾無 partial index | 建議：`CREATE INDEX idx_cards_enabled ON cards(sort_order, created_at) WHERE enabled = TRUE` |
| 47 | `tasks` | 缺少 `(user_id, status, created_at)` composite index | 管理員查詢用量 + 狀態過濾可受益 |
| 48 | `tasks` | 隨著時間增長無 partitioning | 建議加 partition by `created_at` (每月) |

### 3.2 Schema 建議

| # | 表 | 問題 | 建議 |
|---|------|------|------|
| 49 | `users` | 無 soft delete 機制，直接 DELETE | 建議考慮加 `deleted_at TIMESTAMPTZ` |
| 50 | `settings` | 只有 key PK，若未來有 prefix 查詢需加 pattern index | 建議：`CREATE INDEX idx_settings_key_pattern ON settings(key text_pattern_ops);`（PostgreSQL 語法；`prefix(32)` 是 MySQL 語法，在 PG 中無效） |

**影響**：中（效能 & 可擴展性）

---

## 四、架構層面建議

### 4.1 可觀測性 🔴

| 問題 | 建議 |
|------|------|
| 缺少 logging system，全專案用 `print()` | 用 `logging` module 並加 structured logging (JSON) |
| 缺少 health check endpoint | 加 `GET /api/health` 回傳 DB/Redis/RH 狀態 |
| 缺少 metrics | 加請求數、延遲、錯誤率統計 |

### 4.2 錯誤處理 🔴

| 問題 | 建議 |
|------|------|
| HTTPException `detail` 直接回傳，可能洩漏內部資訊 | production 環境用通用訊息 |
| 502/504 錯誤訊息太詳細，前端直接顯示給 user | 建議簡化或加 error code mapping |

### 4.3 安全性 🟡

| 問題 | 建議 |
|------|------|
| JWT_SECRET 自動生成存 DB，redeploy 時若 DB 重置所有 user JWT 失效 | 這是預期行為但應文件化 |
| ADMIN_PASSWORD 只存 env，無 hash | 建議加 `ADMIN_PASSWORD_HASH` 選項 |
| 缺少 CORS 設定 | 若前端與後端不同域名，需加 `CORSDomain` 配置 |
| rate limit 無 per-user 差異 | 建議 admin 可設更高 limit |

### 4.4 效能 🟡

| 問題 | 建議 |
|------|------|
| config.py 啟動時載入所有 settings | 若 settings 表增長，建議加 pagination 或 key pattern 過濾 |
| cards 查詢無 caching | 建議加 Redis cache (TTL 1-5min) |
| httpx client connection pool size 固定 | 建議可配置 |

### 4.5 測試 🟢

| 問題 | 建議 |
|------|------|
| 無測試套件 | 加 pytest + 基本 integration test |
| 建議至少覆蓋 | auth flow、rate limit、migration runner |

---

## 五、文件與配置

### 5.1 .env.example

| 問題 | 建議 |
|------|------|
| 缺少部分可選 env var 說明 | 補充 `DB_POOL_MAX_SIZE`、`PBKDF2_ITERATIONS`、`RH_TIMEOUT_READ` |
| 缺少 GEMINI_MODEL | 建議加入 |

### 5.2 Docker 相關

| 觀察 | 建議 |
|------|------|
| `Dockerfile` multi-stage 設計良好 | - |
| `.dockerignore` 存在但未檢視 | 確認排除 `node_modules`、`__pycache__`、`.git` |

### 5.3 API 文件

| 問題 | 建議 |
|------|------|
| FastAPI 原生支援 OpenAPI/Swagger 但未明確配置 | 建議加 endpoint 級別 docstring |
| 建議加 API versioning | 目前 `/api/` 無 version |

---

## 六、優先級總結

### 🔴 高優先級

| # | 項目 | 影響範圍 |
|---|------|----------|
| 1 | 加 `logging` module 取代 print | 所有服務 |
| 2 | 加 health check endpoint | 部署 & monitoring |
| 3 | 錯誤訊息 production-safe | 安全性 |

### 🟡 中優先級

| # | 項目 | 影響範圍 |
|---|------|----------|
| 4 | tasks 表 partitioning | 資料量增長 |
| 5 | 前端 form validation | 開發效率 |
| 6 | Gemini model 可配置化 | 靈活性 |
| 7 | cards 查詢 Redis cache | 效能 |
| 8 | rate limit 改進 | 正確性 |
| 9 | config.py 并发保護 | 穩定性 |

### 🟢 低優先級

| # | 項目 | 影響範圍 |
|---|------|----------|
| 10 | CORS 設定 | 部署 |
| 11 | 加測試套件 | 開發品質 |
| 12 | config cache TTL | 效能 |
| 13 | 類型精進 | 維護性 |

---

## 七、建議實施順序

```
Phase 1 (立即):
  ├── 1. logging module
  ├── 2. health check endpoint
  └── 3. error message hardening

Phase 2 (1-2 週):
  ├── 4. tasks partitioning planning
  ├── 5. Gemini model config
  ├── 6. rate limit improvements
  └── 7. config.py threading.Lock

Phase 3 (1 個月):
  ├── 8. frontend form validation
  ├── 9. cards cache
  ├── 10. test suite setup
  └── 11. type improvements

Phase 4 (長期):
  ├── 12. full monitoring stack
  ├── 13. API versioning
  └── 14. soft delete for users
```

---

## 八、正面評價

在提出建議的同時，也發現專案有許多優點：

1. **架構清晰**：後端 core/routers/services 分層明確
2. **認證設計良好**：雙軌制 (JWT + Redis) 實現正確
3. **Migration 機制完善**：checksum 防重複、transaction 包裹
4. **RunningHub 代理設計優雅**：三種 auth 模式 + retry 邏輯清晰
5. **前端類型定義完整**：types.ts 與後端 schemas 對應
6. **Rate limiting 實現正確**：Redis sorted set sliding window
7. **多階段 Dockerfile**：build size 優化良好