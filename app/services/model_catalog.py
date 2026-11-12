"""Minimal, versioned schema for the ten supported image model presets."""

import copy
import json
import math
from pathlib import Path
from urllib.parse import urlsplit

from app.services import media

_CATALOG = json.loads(
    (Path(__file__).parents[1] / "data/image_models.json").read_text()
)
_MODELS = {m["key"]: m for m in _CATALOG["models"]}
PROFILES = {
    "generic",
    "gemini-pro",
    "gemini-flash",
    "midjourney-v7",
    "gpt-image-2",
    "seedream",
    "krea2",
    "moss-image",
}


def get_model(key: str) -> dict:
    if key not in _MODELS:
        raise ValueError("不支援的模型")
    return copy.deepcopy(_MODELS[key])


def _image_url(value):
    if media.local_path(value) is not None:
        return
    if not isinstance(value, str) or len(value) > 8192:
        raise ValueError("圖片必須是上傳後的 HTTPS URL")
    url = urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise ValueError("圖片必須是上傳後的 HTTPS URL")


def validate_payload(model: dict, payload: dict) -> dict:
    params = {p["fieldKey"]: p for p in model["params"]}
    if payload.keys() - params.keys():
        raise ValueError("包含模型不支援的欄位")
    out = {}
    for key, p in params.items():
        value = payload.get(key)
        # Prompt must be consciously supplied; source example text is never submitted.
        if key == "prompt" and (not isinstance(value, str) or not value.strip()):
            raise ValueError("請輸入提示詞")
        if value is None or value == "" or value == []:
            value = p.get("defaultValue")
        if value is None or value == "" or value == []:
            if p["required"]:
                raise ValueError(f"{key} 為必填欄位")
            continue
        kind = p["type"]
        if kind == "IMAGE":
            if p.get("multipleInputs"):
                if not isinstance(value, list) or not 1 <= len(value) <= p.get(
                    "maxInputNum", 1
                ):
                    raise ValueError(f"{key} 圖片數量不符限制")
                for item in value:
                    _image_url(item)
            else:
                _image_url(value)
        elif kind == "BOOLEAN":
            if type(value) is not bool:
                raise ValueError(f"{key} 必須為布林值")
        elif kind in ("INT", "FLOAT"):
            if (
                type(value) not in (int, float)
                or not math.isfinite(value)
                or (kind == "INT" and type(value) is not int)
            ):
                raise ValueError(f"{key} 數值型別不正確")
            if value < p.get("min", -math.inf) or value > p.get("max", math.inf):
                raise ValueError(f"{key} 超過範圍")
        elif kind == "LIST":
            if value not in [o["value"] for o in p["options"]]:
                raise ValueError(f"{key} 不在允許選項中")
        elif kind == "STRING":
            if not isinstance(value, str) or len(value) > p.get("maxLength", 20000):
                raise ValueError(f"{key} 文字長度或型別不正確")
        out[key] = value
    if model["mode"] == "image-to-image" and not any(
        out.get(p["fieldKey"]) for p in params.values() if p["type"] == "IMAGE"
    ):
        raise ValueError("圖生圖至少需要一張參考圖片")
    return out
