"""自有媒體儲存：檔案存在 MEDIA_DIR，對外以 /covers/media/<kind>/<id>.<ext> 提供。"""

import io
import re
import secrets
from pathlib import Path
from typing import Literal

import httpx
from PIL import Image

from app.core.paths import MEDIA_DIR

MEDIA_URL_PREFIX = "/covers/media"
KINDS = ("uploads", "results", "templates")
MAX_REMOTE_BYTES = 30 * 1024 * 1024
EXTS = ("png", "jpg", "jpeg", "webp", "gif", "mp4", "webm")
_URL_RE = re.compile(
    r"^/covers/media/(uploads|results|templates)/([0-9a-f]{32}\.(?:png|jpg|jpeg|webp|gif|mp4|webm))$"
)

Kind = Literal["uploads", "results", "templates"]


class MediaError(Exception):
    pass


def ensure_dirs() -> None:
    for kind in KINDS:
        (MEDIA_DIR / kind).mkdir(parents=True, exist_ok=True)


def save_bytes(kind: Kind, content: bytes, ext: str) -> str:
    ext = ext.lower().lstrip(".")
    if kind not in KINDS or ext not in EXTS:
        raise MediaError("不支援的檔案類型")
    name = f"{secrets.token_hex(16)}.{ext}"
    folder = MEDIA_DIR / kind
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(content)
    return f"{MEDIA_URL_PREFIX}/{kind}/{name}"


def local_path(url: str) -> Path | None:
    if not isinstance(url, str):
        return None
    m = _URL_RE.match(url)
    if not m:
        return None
    return MEDIA_DIR / m.group(1) / m.group(2)


def delete_local(url: str) -> bool:
    """刪除自有儲存的檔案；非自有 URL 或檔案不存在時回傳 False。"""
    path = local_path(url)
    if path is None:
        return False
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def read_sync_local(url: str) -> bytes:
    path = local_path(url)
    if path is None or not path.is_file():
        raise MediaError("找不到檔案")
    return path.read_bytes()


async def read(url: str, client: httpx.AsyncClient | None = None) -> bytes:
    """本地 media URL 讀檔；https:// 下載（30 秒、30MB 上限）。"""
    if local_path(url) is not None:
        return read_sync_local(url)
    if not isinstance(url, str) or not url.startswith("https://"):
        raise MediaError("無效的圖片位址")
    own = client is None
    client = client or httpx.AsyncClient(timeout=30.0, follow_redirects=True)
    try:
        async with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise MediaError(f"下載失敗 HTTP {resp.status_code}")
            chunks, size = [], 0
            async for chunk in resp.aiter_bytes():
                size += len(chunk)
                if size > MAX_REMOTE_BYTES:
                    raise MediaError("檔案過大")
                chunks.append(chunk)
            return b"".join(chunks)
    except httpx.HTTPError as e:
        raise MediaError(f"下載失敗：{e}") from None
    finally:
        if own:
            await client.aclose()


def image_ext(content: bytes) -> str:
    """依內容判斷副檔名；非圖片丟 MediaError。"""
    try:
        with Image.open(io.BytesIO(content)) as im:
            fmt = im.format
    except Exception:
        raise MediaError("不是有效的圖片") from None
    ext = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}.get(fmt or "")
    if not ext:
        raise MediaError("不支援的圖片格式")
    return ext


def make_thumbnail(url: str, width: int = 480) -> str:
    path = local_path(url)
    if path is None:
        raise MediaError("縮圖來源必須是自有儲存")
    with Image.open(path) as im:
        im = im.convert("RGB") if im.mode not in ("RGB", "RGBA") else im
        height = max(1, round(im.height * width / im.width))
        thumb = im.resize((width, height), Image.LANCZOS)
        buf = io.BytesIO()
        thumb.save(buf, "WEBP", quality=82)
    return save_bytes("templates", buf.getvalue(), "webp")


def conform(content: bytes, accept: str | None) -> tuple[bytes, str]:
    """依目標欄位 accept（如 '["JPG","PNG"]'）確保格式；不被接受時轉成 PNG。回傳 (內容, 副檔名)。"""
    import json

    ext = image_ext(content)
    try:
        allowed = {str(x).upper().replace("JPEG", "JPG") for x in json.loads(accept or '["JPG","PNG"]')}
    except ValueError:
        allowed = {"JPG", "PNG"}
    if ext.upper() in allowed:
        return content, ext
    with Image.open(io.BytesIO(content)) as im:
        buf = io.BytesIO()
        im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB").save(buf, "PNG")
    return buf.getvalue(), "png"
