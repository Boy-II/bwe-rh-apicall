"""
server.py — RunningHub API 代理後端 (FastAPI)
前端 JS 請求本地後端，後端轉發至 RunningHub API，解決 CORS 問題
"""

import os
import json
import secrets
import hashlib
import hmac
import httpx
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

# ===== 設定載入 =====
# 優先使用持久化磁碟（Zeabur Volume），否則退回本地
_PERSISTENT_CONFIG = Path("/card/config.json")
_LOCAL_CONFIG      = Path(__file__).parent / "config.json"
CONFIG_PATH = _PERSISTENT_CONFIG if _PERSISTENT_CONFIG.parent.exists() else _LOCAL_CONFIG

def load_config():
    """載入設定：環境變數優先，其次 config.json"""
    config = {
        "apiKey": "",
        "baseUrl": "https://www.runninghub.ai",
        "adminPassword": "",
        "pollingInterval": 3000,
        "maxPollingRetries": 200,
        "cards": [],
        "aiBaseUrl": "",
        "aiApiKey": "",
        "aiModel": "",
        "users": [],
    }
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                config.update(json.load(f))
        except Exception as e:
            print(f"[Config] config.json 載入失敗: {e}")

    env_key = os.environ.get("RUNNINGHUB_API_KEY")
    if env_key:
        config["apiKey"] = env_key

    env_base = os.environ.get("RUNNINGHUB_BASE_URL")
    if env_base:
        config["baseUrl"] = env_base

    env_pw = os.environ.get("ADMIN_PASSWORD")
    if env_pw:
        config["adminPassword"] = env_pw

    env_gemini = os.environ.get("GEMINI_API_KEY")
    if env_gemini:
        config["geminiApiKey"] = env_gemini

    env_cards = os.environ.get("CARDS_JSON")
    if env_cards:
        try:
            config["cards"] = json.loads(env_cards)
        except Exception as e:
            print(f"[Config] CARDS_JSON 解析失敗: {e}")

    env_polling = os.environ.get("POLLING_INTERVAL")
    if env_polling:
        try:
            config["pollingInterval"] = int(env_polling)
        except ValueError:
            pass

    env_ai_base = os.environ.get("AI_BASE_URL")
    if env_ai_base:
        config["aiBaseUrl"] = env_ai_base

    env_ai_key = os.environ.get("AI_API_KEY")
    if env_ai_key:
        config["aiApiKey"] = env_ai_key

    env_ai_model = os.environ.get("AI_MODEL")
    if env_ai_model:
        config["aiModel"] = env_ai_model

    return config

config = load_config()

def save_config_to_disk():
    """將 config 寫回 config.json（自動建立目錄）"""
    try:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"設定儲存失敗: {str(e)}")

def hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
    return f"{salt}:{key.hex()}"

def verify_password(password: str, stored: str) -> bool:
    try:
        salt, key_hex = stored.split(":", 1)
        new_key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 100000)
        return hmac.compare_digest(new_key.hex(), key_hex)
    except Exception:
        return False

# ===== 管理員 Session =====
admin_sessions: set = set()
user_sessions: dict = {}  # token → user_id

def require_admin(request: Request) -> str:
    """驗證管理員 Token，失敗則拋出 401"""
    token = request.headers.get("X-Admin-Token", "")
    if not token or token not in admin_sessions:
        raise HTTPException(status_code=401, detail="需要管理員權限")
    return token

def require_user(request: Request) -> str:
    """驗證使用者 Token，失敗則拋出 401；回傳 user_id"""
    token = request.headers.get("X-User-Token", "")
    if not token or token not in user_sessions:
        raise HTTPException(status_code=401, detail="需要登入")
    return user_sessions[token]

def get_api_key() -> str:
    env_key = os.environ.get("RUNNINGHUB_API_KEY")
    return env_key if env_key else config.get("apiKey", "")

def get_base_url() -> str:
    return config.get("baseUrl", "https://www.runninghub.ai")

# ===== 生命週期 =====
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    yield
    await http_client.aclose()

# ===== FastAPI 應用 =====
app = FastAPI(title="RunningHub API Proxy", version="2.0.0", lifespan=lifespan)

http_client = httpx.AsyncClient(timeout=60.0)


# ===== 資料模型 =====
class NodeInfoRequest(BaseModel):
    webappId: str

class SubmitTaskRequest(BaseModel):
    webappId: str
    nodeInfoList: list

class TaskQueryRequest(BaseModel):
    taskId: str

class AdminLoginRequest(BaseModel):
    password: str

class CardData(BaseModel):
    webappId: str
    title: str
    description: str = ""
    icon: str = "🎨"
    color: str = "#6C5CE7"

class CardUpdateData(BaseModel):
    title: str
    description: str = ""
    icon: str
    color: str

class GeminiChatRequest(BaseModel):
    message: str
    history: list = []   # [{role: "user"|"model", text: "..."}]
    context: dict = {}   # {cards, currentCard, nodeInfoList}
    image: str = ""      # base64 data URL

class AIChatRequest(BaseModel):
    message: str
    history: list = []
    context: dict = {}
    image: str = ""   # base64 data URL, e.g. "data:image/jpeg;base64,..."

class AIConfigRequest(BaseModel):
    aiBaseUrl: str = ""
    aiApiKey: str = ""
    aiModel: str = ""

class AIModelsRequest(BaseModel):
    aiBaseUrl: str
    aiApiKey: str = ""

class UserRegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)

class UserLoginRequest(BaseModel):
    username: str
    password: str


# ===== 使用者認證端點 =====

@app.post("/api/auth/register")
async def user_register(req: UserRegisterRequest):
    """使用者申請帳號（建立 pending 狀態帳號）"""
    username = req.username.strip().lower()
    users = config.setdefault("users", [])
    if any(u["username"] == username for u in users):
        raise HTTPException(status_code=409, detail="帳號已存在")
    user = {
        "id": secrets.token_hex(8),
        "username": username,
        "passwordHash": hash_password(req.password),
        "status": "pending",
        "createdAt": datetime.utcnow().isoformat()
    }
    users.append(user)
    save_config_to_disk()
    return {"message": "帳號申請成功，請等待管理員審核"}

@app.post("/api/auth/login")
async def user_login(req: UserLoginRequest):
    """使用者登入，回傳 session token"""
    # 管理員帳號直接以 ADMIN_PASSWORD 登入，同時核發 user + admin token
    admin_pw = config.get("adminPassword", "")
    if req.username.strip().lower() == "admin" and admin_pw and req.password == admin_pw:
        token = secrets.token_hex(32)
        user_sessions[token] = "__admin__"
        admin_token = secrets.token_hex(32)
        admin_sessions.add(admin_token)
        return {"token": token, "username": "admin", "adminToken": admin_token}

    users = config.get("users", [])
    user = next((u for u in users if u["username"] == req.username.strip().lower()), None)
    if not user or not verify_password(req.password, user["passwordHash"]):
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")
    if user["status"] == "pending":
        raise HTTPException(status_code=403, detail="帳號尚待管理員審核")
    if user["status"] == "rejected":
        raise HTTPException(status_code=403, detail="帳號申請已被拒絕")
    token = secrets.token_hex(32)
    user_sessions[token] = user["id"]
    return {"token": token, "username": user["username"]}

@app.post("/api/auth/logout")
async def user_logout(request: Request):
    """使用者登出，移除 session"""
    token = request.headers.get("X-User-Token", "")
    user_sessions.pop(token, None)
    return {"success": True}

@app.get("/api/auth/verify")
async def user_verify(request: Request):
    """驗證使用者 Token 是否有效（含帳號狀態檢查）"""
    token = request.headers.get("X-User-Token", "")
    if not token or token not in user_sessions:
        return {"valid": False}
    user_id = user_sessions[token]
    if user_id == "__admin__":
        return {"valid": True, "username": "admin"}
    user = next((u for u in config.get("users", []) if u["id"] == user_id), None)
    if not user or user["status"] != "approved":
        user_sessions.pop(token, None)
        return {"valid": False}
    return {"valid": True, "username": user["username"]}


# ===== 管理員認證端點 =====

@app.post("/api/admin/login")
async def admin_login(req: AdminLoginRequest):
    """管理員登入：驗證密碼，回傳 session token"""
    admin_pw = config.get("adminPassword", "")
    if not admin_pw or req.password != admin_pw:
        raise HTTPException(status_code=401, detail="密碼錯誤")
    token = secrets.token_hex(32)
    admin_sessions.add(token)
    return {"token": token}

@app.post("/api/admin/logout")
async def admin_logout(request: Request):
    """管理員登出：移除 session token"""
    token = request.headers.get("X-Admin-Token", "")
    admin_sessions.discard(token)
    return {"success": True}

@app.get("/api/admin/verify")
async def admin_verify(request: Request):
    """驗證管理員 Token 是否有效"""
    token = request.headers.get("X-Admin-Token", "")
    return {"valid": bool(token and token in admin_sessions)}


# ===== 卡片管理端點 =====

@app.get("/api/cards")
async def get_cards(request: Request):
    """取得所有應用卡片（需登入）"""
    require_user(request)
    return {"cards": config.get("cards", [])}

@app.post("/api/admin/cards")
async def admin_add_card(req: CardData, request: Request):
    """新增應用卡片（管理員）"""
    require_admin(request)
    if "cards" not in config:
        config["cards"] = []
    card = {
        "id": secrets.token_hex(8),
        "webappId": req.webappId.strip(),
        "title": req.title.strip() or f"應用 {req.webappId}",
        "description": req.description.strip(),
        "icon": req.icon,
        "color": req.color,
        "createdAt": datetime.utcnow().isoformat()
    }
    config["cards"].append(card)
    save_config_to_disk()
    return card

@app.put("/api/admin/cards/{card_id}")
async def admin_update_card(card_id: str, req: CardUpdateData, request: Request):
    """更新應用卡片（管理員）"""
    require_admin(request)
    for card in config.get("cards", []):
        if card["id"] == card_id:
            card.update({
                "title": req.title.strip(),
                "description": req.description.strip(),
                "icon": req.icon,
                "color": req.color
            })
            save_config_to_disk()
            return card
    raise HTTPException(status_code=404, detail="卡片不存在")

@app.delete("/api/admin/cards/{card_id}")
async def admin_delete_card(card_id: str, request: Request):
    """刪除應用卡片（管理員）"""
    require_admin(request)
    cards = config.get("cards", [])
    new_cards = [c for c in cards if c["id"] != card_id]
    if len(new_cards) == len(cards):
        raise HTTPException(status_code=404, detail="卡片不存在")
    config["cards"] = new_cards
    save_config_to_disk()
    return {"success": True}


# ===== RunningHub API 代理端點 =====

@app.post("/api/proxy/getNodeInfo")
async def proxy_get_node_info(request: Request, req: NodeInfoRequest):
    """代理：獲取節點資訊（GET /api/webapp/apiCallDemo?apiKey=&webappId=）"""
    require_user(request)
    base = get_base_url()
    url = f"{base}/api/webapp/apiCallDemo"
    try:
        resp = await http_client.get(
            url,
            params={"apiKey": get_api_key(), "webappId": req.webappId}
        )
        return resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="RunningHub API 請求逾時")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"請求失敗: {str(e)}")

@app.post("/api/proxy/submitTask")
async def proxy_submit_task(request: Request, req: SubmitTaskRequest):
    """代理：提交任務（POST /task/openapi/ai-app/run，body apiKey）"""
    require_user(request)
    return await forward_json_with_apikey("/task/openapi/ai-app/run", {
        "webappId": req.webappId,
        "nodeInfoList": req.nodeInfoList
    })

@app.post("/api/proxy/queryTaskOutputs")
async def proxy_query_outputs(request: Request, req: TaskQueryRequest):
    """代理：查詢任務狀態與結果（v2 Bearer，支援 status 欄位）"""
    require_user(request)
    return await forward_json("/openapi/v2/query", {
        "taskId": req.taskId
    })

@app.post("/api/proxy/uploadFile")
async def proxy_upload_file(
    file: UploadFile = File(...),
):
    """代理：上傳檔案（POST /openapi/v2/media/upload/binary，Bearer auth）"""
    base = get_base_url()
    url = f"{base}/openapi/v2/media/upload/binary"
    file_content = await file.read()
    try:
        resp = await http_client.post(
            url,
            headers={"Authorization": f"Bearer {get_api_key()}"},
            files={"file": (file.filename, file_content, file.content_type or "application/octet-stream")}
        )
        return resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"上傳失敗: {str(e)}")

@app.post("/api/proxy/getAccountStatus")
async def proxy_get_account(request: Request):
    """代理：取得帳戶狀態"""
    require_user(request)
    return await forward_json_with_apikey("/api/user/getAccountStatus", {})

@app.get("/api/config/status")
async def get_config_status():
    """取得設定狀態（不回傳完整 Key）"""
    key = get_api_key()
    return {
        "hasApiKey": bool(key) and key != "YOUR_API_KEY_HERE",
        "baseUrl": get_base_url(),
        "pollingInterval": config.get("pollingInterval", 3000),
        "maxPollingRetries": config.get("maxPollingRetries", 200)
    }


# ===== Gemini AI 代理端點 =====

def get_gemini_api_key() -> str:
    env_key = os.environ.get("GEMINI_API_KEY")
    if env_key and env_key != "your_key_here":
        return env_key
    return config.get("geminiApiKey", "")

@app.post("/api/proxy/gemini")
async def proxy_gemini(request: Request, req: GeminiChatRequest):
    """代理：呼叫 Gemini 2.5 Flash API"""
    require_user(request)
    key = get_gemini_api_key()
    if not key:
        raise HTTPException(status_code=503, detail="Gemini API Key 未設定")

    # 組裝 system prompt
    cards = req.context.get("cards", [])
    current_card = req.context.get("currentCard")
    node_info_list = req.context.get("nodeInfoList")

    cards_text = "\n".join(
        f"- {c.get('title', '')}（{c.get('description', '')}）" for c in cards
    ) if cards else "（尚無可用應用）"

    system_parts = [
        "你是 BWE-RH APICall 的 AI 助手，協助使用者選擇 AI 應用並撰寫提示詞。",
        f"可用應用：\n{cards_text}",
    ]

    if current_card:
        node_fields = ""
        if node_info_list:
            node_fields = "、".join(
                n.get("description", n.get("nodeId", "")) for n in node_info_list
                if n.get("fieldType") == "STRING"
            )
        system_parts.append(
            f"目前應用：{current_card.get('title', '')}，"
            f"可修改欄位：{node_fields or '（無文字欄位）'}"
        )

    system_parts.append("當建議提示詞時，用 ```prompt 區塊包裹，使用者可一鍵套用。")
    system_parts.append("請用繁體中文回答。")
    system_prompt = "\n".join(system_parts)

    # 組裝 Gemini contents
    contents = []
    for h in req.history:
        role = "user" if h.get("role") == "user" else "model"
        contents.append({"role": role, "parts": [{"text": h.get("text", "")}]})

    # 組裝當前訊息（含圖片）
    user_parts: list = [{"text": req.message}]
    if req.image:
        try:
            header, b64data = req.image.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0]
        except Exception:
            mime_type, b64data = "image/jpeg", req.image
        user_parts.append({"inlineData": {"mimeType": mime_type, "data": b64data}})
    contents.append({"role": "user", "parts": user_parts})

    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048}
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key={key}"
    try:
        resp = await http_client.post(url, json=payload, timeout=30.0)
        data = resp.json()
        # 提取回應文字
        try:
            text = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            text = data.get("error", {}).get("message", "Gemini 回應格式異常")
            raise HTTPException(status_code=502, detail=text)
        return {"text": text}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Gemini API 請求逾時")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini 請求失敗: {str(e)}")


# ===== AI 設定管理端點 =====

@app.get("/api/admin/ai-config")
async def get_ai_config(request: Request):
    """取得 AI 設定（管理員）"""
    require_admin(request)
    return {
        "aiBaseUrl": config.get("aiBaseUrl", ""),
        "aiModel": config.get("aiModel", ""),
        "hasApiKey": bool(config.get("aiApiKey", ""))
    }

@app.post("/api/admin/ai-config")
async def save_ai_config(req: AIConfigRequest, request: Request):
    """儲存 AI 設定（管理員）"""
    require_admin(request)
    config["aiBaseUrl"] = req.aiBaseUrl.strip()
    if req.aiApiKey.strip():
        config["aiApiKey"] = req.aiApiKey.strip()
    config["aiModel"] = req.aiModel.strip()
    save_config_to_disk()
    return {"success": True}

@app.post("/api/admin/ai-models")
async def fetch_ai_models(req: AIModelsRequest, request: Request):
    """代理：從 OpenAI 格式端點拉取模型列表（管理員）"""
    require_admin(request)
    base_url = req.aiBaseUrl.rstrip("/")
    api_key = req.aiApiKey.strip() or config.get("aiApiKey", "")
    url = f"{base_url}/v1/models"
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        resp = await http_client.get(url, headers=headers, timeout=10.0)
        data = resp.json()
        models = [m["id"] for m in data.get("data", [])]
        return {"models": sorted(models)}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="模型列表請求逾時")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"無法取得模型列表: {str(e)}")


# ===== 用戶管理端點（管理員）=====

@app.get("/api/admin/users")
async def admin_list_users(request: Request):
    """列出所有用戶（管理員）"""
    require_admin(request)
    users = config.get("users", [])
    return {
        "users": [
            {
                "id": u["id"],
                "username": u["username"],
                "status": u["status"],
                "createdAt": u["createdAt"]
            }
            for u in users
        ]
    }

@app.post("/api/admin/users/{user_id}/approve")
async def admin_approve_user(user_id: str, request: Request):
    """批准用戶帳號（管理員）"""
    require_admin(request)
    user = next((u for u in config.get("users", []) if u["id"] == user_id), None)
    if not user:
        raise HTTPException(status_code=404, detail="用戶不存在")
    user["status"] = "approved"
    save_config_to_disk()
    return {"success": True}

@app.post("/api/admin/users/{user_id}/reject")
async def admin_reject_user(user_id: str, request: Request):
    """拒絕用戶帳號，並踢出現有 session（管理員）"""
    require_admin(request)
    user = next((u for u in config.get("users", []) if u["id"] == user_id), None)
    if not user:
        raise HTTPException(status_code=404, detail="用戶不存在")
    user["status"] = "rejected"
    to_remove = [t for t, uid in user_sessions.items() if uid == user_id]
    for t in to_remove:
        user_sessions.pop(t, None)
    save_config_to_disk()
    return {"success": True}

@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: str, request: Request):
    """刪除用戶帳號（管理員）"""
    require_admin(request)
    users = config.get("users", [])
    new_users = [u for u in users if u["id"] != user_id]
    if len(new_users) == len(users):
        raise HTTPException(status_code=404, detail="用戶不存在")
    config["users"] = new_users
    to_remove = [t for t, uid in user_sessions.items() if uid == user_id]
    for t in to_remove:
        user_sessions.pop(t, None)
    save_config_to_disk()
    return {"success": True}


# ===== OpenAI 格式聊天代理端點 =====

def _build_ai_system_prompt(context: dict) -> str:
    """組裝 AI 助手 system prompt"""
    cards = context.get("cards", [])
    current_card = context.get("currentCard")
    node_info_list = context.get("nodeInfoList")

    cards_text = "\n".join(
        f"- {c.get('title', '')}（{c.get('description', '')}）" for c in cards
    ) if cards else "（尚無可用應用）"

    parts = [
        "你是 BWE-RH APICall 的 AI 助手，協助使用者選擇 AI 應用並撰寫提示詞。",
        f"可用應用：\n{cards_text}",
    ]

    if current_card:
        node_fields = ""
        if node_info_list:
            node_fields = "、".join(
                n.get("description", n.get("nodeId", "")) for n in node_info_list
                if n.get("fieldType") == "STRING"
            )
        parts.append(
            f"目前應用：{current_card.get('title', '')}，"
            f"可修改欄位：{node_fields or '（無文字欄位）'}"
        )

    parts.append("當建議提示詞時，用 ```prompt 區塊包裹，使用者可一鍵套用。")
    parts.append("請用繁體中文回答。")
    return "\n".join(parts)

@app.post("/api/proxy/chat")
async def proxy_chat(request: Request, req: AIChatRequest):
    """統一聊天代理：優先使用 OpenAI 格式設定，否則回退 Gemini"""
    require_user(request)
    ai_base = config.get("aiBaseUrl", "").rstrip("/")
    ai_key = config.get("aiApiKey", "")
    ai_model = config.get("aiModel", "")

    if ai_base and ai_key and ai_model:
        system_prompt = _build_ai_system_prompt(req.context)
        messages = [{"role": "system", "content": system_prompt}]
        for h in req.history:
            role = "user" if h.get("role") == "user" else "assistant"
            messages.append({"role": role, "content": h.get("text", "")})

        # 組裝當前訊息（含圖片）
        if req.image:
            user_content = [
                {"type": "text", "text": req.message},
                {"type": "image_url", "image_url": {"url": req.image}}
            ]
        else:
            user_content = req.message
        messages.append({"role": "user", "content": user_content})

        url = f"{ai_base}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {ai_key}",
            "Content-Type": "application/json"
        }
        payload = {"model": ai_model, "messages": messages, "temperature": 0.7, "max_tokens": 2048}
        try:
            resp = await http_client.post(url, json=payload, headers=headers, timeout=60.0)
            data = resp.json()
            if not resp.is_success:
                err_msg = data.get("error", {}).get("message") or data.get("message") or f"HTTP {resp.status_code}"
                if req.image:
                    err_msg += "（提示：請確認所選模型支援圖片輸入）"
                raise HTTPException(status_code=502, detail=err_msg)
            try:
                text = data["choices"][0]["message"]["content"]
            except (KeyError, IndexError):
                err_msg = data.get("error", {}).get("message", "AI 回應格式異常")
                raise HTTPException(status_code=502, detail=err_msg)
            return {"text": text}
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="AI API 請求逾時")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AI 請求失敗: {str(e)}")

    # 回退至 Gemini
    gemini_key = get_gemini_api_key()
    if not gemini_key:
        raise HTTPException(status_code=503, detail="AI 助手未設定，請在管理介面配置 AI 設定")
    gemini_req = GeminiChatRequest(
        message=req.message, history=req.history,
        context=req.context, image=req.image
    )
    return await proxy_gemini(gemini_req)


# ===== 通用轉發 =====
async def forward_json(endpoint: str, body: dict):
    """轉發 JSON POST 請求（Bearer auth，用於 v2 端點）"""
    base = get_base_url()
    url = f"{base}{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {get_api_key()}"
    }
    try:
        resp = await http_client.post(url, json=body, headers=headers)
        return resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="RunningHub API 請求逾時")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"請求失敗: {str(e)}")

async def forward_json_with_apikey(endpoint: str, body: dict):
    """轉發 JSON POST 請求（body 注入 apiKey，用於 task/openapi 端點）"""
    base = get_base_url()
    url = f"{base}{endpoint}"
    try:
        resp = await http_client.post(url, json={**body, "apiKey": get_api_key()})
        return resp.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="RunningHub API 請求逾時")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"請求失敗: {str(e)}")


# ===== 靜態檔案服務 =====
static_dir = Path(__file__).parent
app.mount("/css", StaticFiles(directory=static_dir / "css"), name="css")
app.mount("/js", StaticFiles(directory=static_dir / "js"), name="js")

@app.get("/")
async def serve_index():
    return FileResponse(static_dir / "index.html")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True, reload_excludes=["*.json"])
