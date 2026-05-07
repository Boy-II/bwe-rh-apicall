"""密碼 hash / verify（PBKDF2-SHA256）。"""

import hashlib
import hmac
import os

ITERATIONS = 100_000


def hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), ITERATIONS)
    return f"{salt}:{key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, key_hex = stored.split(":", 1)
        new_key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), ITERATIONS)
        return hmac.compare_digest(new_key.hex(), key_hex)
    except Exception:
        return False
