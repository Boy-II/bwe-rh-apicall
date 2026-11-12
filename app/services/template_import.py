"""初始範本匯入：解析開源提示詞合集 → LLM 補全（標題／分類／標籤／另一語言）→ 寫入 templates。

提示詞原文不改寫；只存 source_id 供重跑去重，不保留作者與出處。
"""

import asyncio
import logging
import re
import secrets
from dataclasses import dataclass, field
from pathlib import Path

import json

from app.core import db
from app.services import image_registry, media, prompt_tools

logger = logging.getLogger(__name__)


@dataclass
class RawTemplate:
    source_id: str
    title: str
    prompt: str
    tags: list[str]
    image: Path
    hint_category: str
    prompt_alt: str = ""  # 另一語言的原文（若來源本身就有）
    model_label: str = ""  # Gemini／GPT／Grok／ComfyUI；空字串＝不顯示


@dataclass
class ImportReport:
    created: int = 0
    skipped: int = 0
    failed: list[tuple[str, str]] = field(default_factory=list)


# ---------- 解析 ----------

_FM_RE = re.compile(r"^---\n(.*?)\n---\n(.*)$", re.S)


def _frontmatter(text: str) -> tuple[dict, str]:
    """只支援 awesome-prompts 用到的子集：key: value 與 key: 後接 '  - item' 清單。"""
    m = _FM_RE.match(text)
    if not m:
        return {}, text
    meta: dict = {}
    current = None
    for line in m.group(1).splitlines():
        if line.startswith("  - ") and current:
            meta.setdefault(current, []).append(line[4:].strip().strip("'\""))
            continue
        if ":" in line and not line.startswith(" "):
            key, _, value = line.partition(":")
            current = key.strip()
            value = value.strip()
            meta[current] = value.strip("'\"") if value else []
    return meta, m.group(2)


def parse_awesome_prompts(root: Path) -> list[RawTemplate]:
    out = []
    for path in sorted((root / "prompts").glob("*/*.md")):
        meta, body = _frontmatter(path.read_text(encoding="utf-8"))
        category = meta.get("category") or path.parent.name
        if category == "motion":
            continue
        preview = meta.get("preview") or ""
        if not isinstance(preview, str) or not preview.startswith("/"):
            continue  # 沒有本地範例圖（空白或外部 stock 圖）就不收
        image = root / "public" / preview.lstrip("/")
        body = re.split(r"\n## (?:Source|Example Output)\b", body)[0].strip()
        if not image.is_file() or not body:
            continue
        tags = meta.get("tags") if isinstance(meta.get("tags"), list) else []
        out.append(
            RawTemplate(
                source_id=f"awesome-prompts:{path.parent.name}/{path.stem}",
                title=str(meta.get("title") or path.stem),
                prompt=body,
                tags=tags,
                image=image,
                hint_category=category,
                model_label=image_registry.model_family(body),
            )
        )
    return out


_CASE_RE = re.compile(r"^### 例 (\d+)[：:]\s*(.+?)\s*$", re.M)
_IMG_RE = re.compile(r"!\[[^\]]*\]\(\.\./(data/images/[^)\s]+)\)")
_TEXT_RE = re.compile(r"```text\s*\n(.*?)\n```", re.S)


def parse_gpt_image2(root: Path) -> list[RawTemplate]:
    out = []
    for path in sorted((root / "docs").glob("gallery-part-*.md")):
        text = path.read_text(encoding="utf-8")
        heads = list(_CASE_RE.finditer(text))
        for i, h in enumerate(heads):
            block = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
            img, prompt = _IMG_RE.search(block), _TEXT_RE.search(block)
            if not img or not prompt:
                continue
            image = root / img.group(1)
            if not image.is_file() or not prompt.group(1).strip():
                continue
            out.append(
                RawTemplate(
                    source_id=f"gpt-image-2:case-{h.group(1)}",
                    title=h.group(2),
                    prompt=prompt.group(1).strip(),
                    tags=[],
                    image=image,
                    hint_category="",
                    model_label="GPT",  # awesome-gpt-image-2 全為 GPT Image 2 案例
                )
            )
    return out


def parse_manual(manifest: Path) -> list[RawTemplate]:
    items = json.loads(manifest.read_text(encoding="utf-8"))
    return [
        RawTemplate(
            source_id=it["sourceId"],
            title=it["title"],
            prompt=it["prompt"].strip(),
            tags=it.get("tags", []),
            image=manifest.parent / it["image"],
            hint_category=it.get("category", ""),
            prompt_alt=it.get("promptAlt", "").strip(),
            model_label=it.get("model") or image_registry.model_family(it["prompt"]),
        )
        for it in items
    ]


# ---------- 補全與寫入 ----------

_CJK_RE = re.compile(r"[㐀-鿿豈-﫿]")


def is_cjk(text: str) -> bool:
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return False
    return len(_CJK_RE.findall(text)) / len(chars) >= 0.3


async def enrich(raw: RawTemplate, categories: list[dict]) -> dict:
    hint = raw.title + (f"（原分類：{raw.hint_category}）" if raw.hint_category else "")
    meta = await prompt_tools.suggest_meta(raw.prompt, categories, hint_title=hint)
    zh_original = is_cjk(raw.prompt)
    if raw.prompt_alt:
        other = raw.prompt_alt
    else:
        other = await prompt_tools.translate(raw.prompt, "en" if zh_original else "zh")
    prompt_en, prompt_zh = (other, raw.prompt) if zh_original else (raw.prompt, other)
    return {**meta, "prompt_en": prompt_en, "prompt_zh": prompt_zh}


async def _import_one(raw: RawTemplate, categories: list[dict]) -> None:
    data = await enrich(raw, categories)
    content = raw.image.read_bytes()
    image_url = media.save_bytes("templates", content, media.image_ext(content))
    thumb_url = media.make_thumbnail(image_url)
    await db.execute(
        """INSERT INTO templates(id,title,category_id,tags,mode,prompt_en,prompt_zh,image_url,thumb_url,source_id,model_label)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (source_id) DO NOTHING""",
        secrets.token_hex(8),
        data["title"],
        data["categoryId"],
        data["tags"],
        data["mode"],
        data["prompt_en"],
        data["prompt_zh"],
        image_url,
        thumb_url,
        raw.source_id,
        raw.model_label,
    )


async def import_all(raws: list[RawTemplate], *, concurrency: int = 4) -> ImportReport:
    report = ImportReport()
    existing = {
        r["source_id"]
        for r in await db.fetch_all("SELECT source_id FROM templates WHERE source_id IS NOT NULL")
    }
    categories = await db.fetch_all("SELECT id, name FROM template_categories ORDER BY sort_order")
    todo = []
    for raw in raws:
        if raw.source_id in existing:
            report.skipped += 1
        else:
            todo.append(raw)
    sem = asyncio.Semaphore(concurrency)

    async def worker(raw: RawTemplate):
        async with sem:
            try:
                await _import_one(raw, categories)
                report.created += 1
                logger.info("匯入 %s", raw.source_id)
            except Exception as e:  # 單筆失敗不中斷整批
                report.failed.append((raw.source_id, str(e)[:300]))
                logger.warning("匯入失敗 %s：%s", raw.source_id, e)

    await asyncio.gather(*(worker(r) for r in todo))
    return report
