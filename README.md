# BWE-RH APICall

RunningHub AI 應用呼叫平台，支援 Gemini AI 助手側邊欄。

---

## 環境變數

在 Zeabur（或任何部屬平台）的 **Environment Variables** 設定以下變數：

| 變數名稱 | 必填 | 說明 |
|----------|------|------|
| `RUNNINGHUB_API_KEY` | ✅ | RunningHub API 金鑰 |
| `ADMIN_PASSWORD` | ✅ | 管理員登入密碼 |
| `GEMINI_API_KEY` | ✅ | Google Gemini API 金鑰（AI 助手功能） |
| `CARDS_JSON` | ⚪ | 預載應用卡片（JSON 陣列，見下方範例） |
| `RUNNINGHUB_BASE_URL` | ⚪ | RunningHub 服務位址（預設：`https://www.runninghub.ai`） |
| `POLLING_INTERVAL` | ⚪ | 任務輪詢間隔毫秒（預設：`3000`） |

### CARDS_JSON 格式範例

```json
[{"id":"card-1","webappId":"2031966329095327746","title":"BW-edit","description":"書籍封面轉立體書","icon":"🖼️","color":"#00B894","createdAt":"2026-01-01T00:00:00"}]
```

> 若未設定 `CARDS_JSON`，部屬後可透過管理員登入（🔐 管理）在 UI 新增卡片，資料會存在容器內；重新部屬後需再次新增。

---

## 本地開發

```bash
pip install -r requirements.txt
python server.py
```

開啟 [http://localhost:8000](http://localhost:8000)

---

## Zeabur 部屬步驟

1. Fork 或 push 此 repo 到 GitHub
2. 在 Zeabur 建立新 Service，選擇 **Deploy from GitHub**
3. 選擇此 repo，Zeabur 自動偵測 Python 並使用 `zbpack.json` 啟動
4. 在 **Variables** 頁面設定上表中的環境變數
5. 部屬完成後點擊產生的網址即可使用
