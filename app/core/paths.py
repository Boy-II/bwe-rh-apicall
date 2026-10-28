"""Shared application paths for runtime uploads and packaged default assets."""

from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
COVERS_DIR = Path("/card/covers") if Path("/card").exists() else ROOT_DIR / "covers"
COVER_PRESETS_DIR = ROOT_DIR / "app/data/cover_presets"
