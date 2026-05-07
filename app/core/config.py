"""應用設定：env vars + DB settings 表的 in-memory 快取。"""

import os
from dotenv import load_dotenv

# 自動載入 .env（本地開發用；生產環境靠 Zeabur 注入）
load_dotenv()

# ===== env-only：runtime 不可改 =====
RUNNINGHUB_API_KEY = os.environ.get("RUNNINGHUB_API_KEY", "")
RUNNINGHUB_BASE_URL = os.environ.get("RUNNINGHUB_BASE_URL", "https://www.runninghub.ai")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

POLLING_INTERVAL = int(os.environ.get("POLLING_INTERVAL", "3000"))
MAX_POLLING_RETRIES = int(os.environ.get("MAX_POLLING_RETRIES", "200"))

PORT = int(os.environ.get("PORT", "8000"))

# ===== PostgreSQL（n8n 同款命名） =====
DB_HOST = os.environ.get("DB_POSTGRESDB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_POSTGRESDB_PORT", "5432"))
DB_USER = os.environ.get("DB_POSTGRESDB_USER", "rhapi")
DB_PASSWORD = os.environ.get("DB_POSTGRESDB_PASSWORD", "")
DB_DATABASE = os.environ.get("DB_POSTGRESDB_DATABASE", "rhapi")

# ===== Redis =====
REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD", "") or None

# ===== env-overridable：env 為主、無則查 DB settings 表 =====
_ENV_AI_BASE_URL = os.environ.get("AI_BASE_URL", "")
_ENV_AI_API_KEY = os.environ.get("AI_API_KEY", "")
_ENV_AI_MODEL = os.environ.get("AI_MODEL", "")
_ENV_JWT_SECRET = os.environ.get("JWT_SECRET", "")

# DB-backed settings 的 in-memory 快取（lifespan 啟動時載入）
_db_settings: dict[str, str] = {}


def set_db_setting(key: str, value: str) -> None:
    """更新 in-memory 快取（DB 寫入由呼叫端負責）"""
    _db_settings[key] = value


def get_db_setting(key: str) -> str:
    return _db_settings.get(key, "")


def replace_db_settings(items: dict[str, str]) -> None:
    """整批替換（lifespan 啟動時用）"""
    _db_settings.clear()
    _db_settings.update(items)


# ===== AI / JWT 取值 helper =====


def get_ai_base_url() -> str:
    return _ENV_AI_BASE_URL or get_db_setting("ai_base_url")


def get_ai_api_key() -> str:
    return _ENV_AI_API_KEY or get_db_setting("ai_api_key")


def get_ai_model() -> str:
    return _ENV_AI_MODEL or get_db_setting("ai_model")


def get_jwt_secret() -> str:
    return _ENV_JWT_SECRET or get_db_setting("jwt_secret")


def has_env_jwt_secret() -> bool:
    return bool(_ENV_JWT_SECRET)


def has_env_ai_api_key() -> bool:
    return bool(_ENV_AI_API_KEY)
