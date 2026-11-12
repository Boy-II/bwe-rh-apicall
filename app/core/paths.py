"""Shared application paths for runtime uploads and packaged default assets."""

from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
COVERS_DIR = Path("/card/covers") if Path("/card").exists() else ROOT_DIR / "covers"
COVER_PRESETS_DIR = ROOT_DIR / "app/data/cover_presets"
# 自有儲存：上傳參考圖、OpenAI 路由結果、範本圖（沿用 /covers 靜態掛載與同一個 volume）
MEDIA_DIR = COVERS_DIR / "media"
