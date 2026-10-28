"""Portable default covers, independent of local PostgreSQL and upload volumes."""

import json
import os
import re
import shutil
import tempfile
from pathlib import Path

from app.core import db
from app.core.paths import COVER_PRESETS_DIR, COVERS_DIR

_FILENAME = re.compile(r"[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|gif|mp4|webm|mov)", re.I)


def _filename(url: str) -> str:
    if not isinstance(url, str) or not url.startswith("/covers/"):
        raise ValueError("只能打包本平台 /covers/ 封面")
    name = url.removeprefix("/covers/")
    if not _FILENAME.fullmatch(name):
        raise ValueError("封面路徑無效")
    return name


def export_presets(rows: list[dict], source: Path, bundle: Path) -> dict:
    mapping = {}
    files = {}
    # Validate the complete snapshot before changing the previous bundle.
    for row in rows:
        url = row.get("cover_url")
        if not url:
            continue
        name = _filename(url)
        path = source / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("有封面檔案不存在，未更新封面預設資料")
        mapping[row["id"]] = url
        files[name] = path.read_bytes()
    if not mapping:
        raise ValueError("目前沒有可匯出的封面，保留既有預設資料")
    bundle.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        target = bundle / name
        temp = target.with_suffix(target.suffix + ".tmp")
        temp.write_bytes(content)
        temp.replace(target)
    manifest = bundle / "manifest.json"
    temp = manifest.with_suffix(".json.tmp")
    temp.write_text(
        json.dumps({"version": 1, "cards": mapping}, ensure_ascii=False, indent=2)
        + "\n"
    )
    temp.replace(manifest)
    return {"cards": len(mapping), "files": len(files)}


def load_presets(bundle: Path = COVER_PRESETS_DIR) -> dict[str, str]:
    manifest = bundle / "manifest.json"
    if not manifest.exists():
        return {}
    data = json.loads(manifest.read_text())
    if data.get("version") != 1 or not isinstance(data.get("cards"), dict):
        raise ValueError("封面預設清單格式錯誤")
    for card_id, url in data["cards"].items():
        if not isinstance(card_id, str) or not card_id or len(card_id) > 200:
            raise ValueError("封面卡片識別碼無效")
        name = _filename(url)
        if not (bundle / name).is_file():
            raise ValueError("打包封面缺少檔案")
    return data["cards"]


def restore_files(bundle: Path = COVER_PRESETS_DIR, runtime: Path = COVERS_DIR) -> None:
    mapping = load_presets(bundle)
    runtime.mkdir(parents=True, exist_ok=True)
    for url in set(mapping.values()):
        name = _filename(url)
        target = runtime / name
        if target.exists():
            continue
        # Copy privately first, then atomically publish without replacing a
        # persistent-volume asset that may have appeared during the copy.
        temp_path = None
        try:
            with (
                tempfile.NamedTemporaryFile(
                    dir=runtime, prefix=".cover-", delete=False
                ) as out,
                (bundle / name).open("rb") as src,
            ):
                temp_path = Path(out.name)
                shutil.copyfileobj(src, out)
                out.flush()
                os.fsync(out.fileno())
            os.link(temp_path, target)
        except FileExistsError:
            continue
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)


async def apply_cover_presets(bundle: Path = COVER_PRESETS_DIR) -> None:
    for card_id, url in load_presets(bundle).items():
        await db.execute(
            "UPDATE cards SET cover_url=$2 WHERE id=$1 AND cover_url=''", card_id, url
        )
