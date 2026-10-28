"""Validate MOSS pixel drafts and deterministically compile model coordinates.

Format reference: OpenMOSS/MOSS-Image skills/moss-image-prompt-enhancer,
revision 2b46b1e. Reference checkout is not required at runtime.
"""

import json
import math


def _object(value, allowed, required=()):
    if (
        not isinstance(value, dict)
        or value.keys() - set(allowed)
        or set(required) - value.keys()
    ):
        raise ValueError("Layout 欄位不完整或包含未知欄位")


def _text(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 20000:
        raise ValueError("Layout 文字欄位必須是非空字串")


def _tags(value):
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError("標籤格式無效")
    for text in value:
        _text(text)


def compile_layout(draft: dict) -> str:
    root = {"width", "height", "bbox_coord_space", "bbox_format", "summary", "items"}
    _object(draft, root, root)
    w, h = draft["width"], draft["height"]
    if any(type(v) is not int or v <= 0 or v % 16 or v > 8192 for v in (w, h)):
        raise ValueError("寬高必須是 16 的正整數倍，且不超過 8192")
    if draft["bbox_coord_space"] != "abs" or draft["bbox_format"] != "xyxy":
        raise ValueError("draft 座標必須使用 abs/xyxy")
    summary = draft["summary"]
    _object(summary, {"caption", "meta", "canvas", "palette"}, {"caption"})
    _text(summary["caption"])
    if "canvas" in summary and summary["canvas"] not in (
        "single",
        "multi_panel",
        "collage",
    ):
        raise ValueError("canvas 格式無效")
    for key in ("meta", "palette"):
        if key in summary:
            _tags(summary[key])
    if not isinstance(draft["items"], list) or not 1 <= len(draft["items"]) <= 100:
        raise ValueError("items 必須有 1 至 100 個項目")
    items = []
    for item in draft["items"]:
        _object(
            item,
            {"label", "caption", "bbox", "text", "tags", "palette"},
            {"label", "caption", "bbox"},
        )
        if item["label"] not in ("object", "character", "text"):
            raise ValueError("項目類型無效")
        _text(item["caption"])
        if item["label"] == "text" or "text" in item:
            _text(item.get("text"))
        for key in ("tags", "palette"):
            if key in item:
                _tags(item[key])
        box = item["bbox"]
        if (
            not isinstance(box, list)
            or len(box) != 4
            or any(type(v) not in (int, float) or not math.isfinite(v) for v in box)
        ):
            raise ValueError("bbox 必須包含四個有限數值")
        x1, y1, x2, y2 = box
        if not (0 <= x1 < x2 <= w and 0 <= y1 < y2 <= h):
            raise ValueError("bbox 出界或不是有效矩形")
        items.append(
            {
                **item,
                "bbox": [
                    math.floor(y1) - h // 2,
                    math.floor(x1) - w // 2,
                    math.ceil(y2) - h // 2,
                    math.ceil(x2) - w // 2,
                ],
            }
        )
    return json.dumps(
        {
            "summary": summary,
            "items": items,
            "bbox_coord_space": "abs_centralized",
            "bbox_format": "yxyx",
        },
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )
