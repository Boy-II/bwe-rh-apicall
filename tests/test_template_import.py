import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from PIL import Image

from app.core import db
from app.services import media, template_import as ti
from tests.pg_support import PostgresMixin


def png(color="red"):
    buf = io.BytesIO()
    Image.new("RGB", (600, 400), color).save(buf, "PNG")
    return buf.getvalue()


def build_awesome_prompts(root: Path):
    for cat, slug, body in (
        ("portraits", "bw-portrait", "A black and white portrait.\n\n## Source\n- [x](y)\n\n## Example Output\n![a](/media/portraits/bw-portrait.webp)\n"),
        ("3d", "chibi", "Turn the people in the photo into chibi figures.\n\n## Example Output\n![a](/media/3d/chibi.webp)\n"),
        ("motion", "promo", "Camera pans.\n"),
        ("posters", "no-image", "A poster.\n"),
    ):
        d = root / "prompts" / cat
        d.mkdir(parents=True, exist_ok=True)
        preview = "" if slug == "no-image" else f"/media/{cat}/{slug}.webp"
        (d / f"{slug}.md").write_text(
            f"---\ntitle: {slug.title()}\ncategory: {cat}\ntags:\n  - {cat}\n  - test\npreview: '{preview}'\n---\n\n{body}",
            encoding="utf-8",
        )
        if preview:
            img = root / "public" / preview.lstrip("/")
            img.parent.mkdir(parents=True, exist_ok=True)
            img.write_bytes(png())


def build_gpt_image2(root: Path):
    docs = root / "docs"
    docs.mkdir(parents=True)
    (root / "data/images").mkdir(parents=True)
    (root / "data/images/case1.jpg").write_bytes(png("blue"))
    (root / "data/images/case3.jpg").write_bytes(png("green"))
    (docs / "gallery-part-1.md").write_text(
        """# 画廊

### 例 1：信息图可视化设计

![城市](../data/images/case1.jpg)

**提示词：**

```text
竖版 9:16 等距剖面信息图「城市生命系统图谱」
```

***

### 例 2：没有图片

**提示词：**

```text
no image here
```

***

### 例 3：英文海报

![poster](../data/images/case3.jpg)

```text
A neon poster that says "OPEN 24H".
```
""",
        encoding="utf-8",
    )


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_parse_awesome_prompts_skips_motion_and_missing_image(self):
        build_awesome_prompts(self.root)
        raws = sorted(ti.parse_awesome_prompts(self.root), key=lambda r: r.source_id)
        self.assertEqual([r.source_id for r in raws], ["awesome-prompts:3d/chibi", "awesome-prompts:portraits/bw-portrait"])
        bw = raws[1]
        self.assertEqual(bw.prompt, "A black and white portrait.")
        self.assertEqual(bw.title, "Bw-Portrait")
        self.assertEqual(bw.tags, ["portraits", "test"])
        self.assertEqual(bw.hint_category, "portraits")
        self.assertEqual(bw.model_label, "")
        self.assertTrue(bw.image.is_file())

    def test_parse_gpt_image2_skips_case_without_image(self):
        build_gpt_image2(self.root)
        raws = ti.parse_gpt_image2(self.root)
        self.assertEqual([r.source_id for r in raws], ["gpt-image-2:case-1", "gpt-image-2:case-3"])
        self.assertEqual(raws[0].title, "信息图可视化设计")
        self.assertEqual(raws[0].prompt, "竖版 9:16 等距剖面信息图「城市生命系统图谱」")
        self.assertEqual(raws[1].image.name, "case3.jpg")
        self.assertEqual(raws[0].model_label, "GPT")

    def test_parse_manual(self):
        (self.root / "a.png").write_bytes(png())
        (self.root / "m.json").write_text(json.dumps([
            {"sourceId": "neek:figure", "title": "手辦", "prompt": "turn this photo into a figure",
             "promptAlt": "把照片轉成手辦", "image": "a.png", "category": "creative"}
        ]), encoding="utf-8")
        raws = ti.parse_manual(self.root / "m.json")
        self.assertEqual((raws[0].source_id, raws[0].prompt_alt, raws[0].image), ("neek:figure", "把照片轉成手辦", self.root / "a.png"))

    def test_bundled_manual_manifest_is_valid(self):
        raws = ti.parse_manual(Path(ti.__file__).parents[1] / "data/manual_templates.json")
        self.assertGreaterEqual(len(raws), 2)
        self.assertTrue(all(r.image.is_file() for r in raws))

    def test_is_cjk(self):
        self.assertTrue(ti.is_cjk("竖版 9:16 等距剖面信息图"))
        self.assertFalse(ti.is_cjk('A neon poster that says "營業中"'))
        self.assertFalse(ti.is_cjk(""))


class EnrichTests(unittest.IsolatedAsyncioTestCase):
    async def test_enrich_keeps_original_prompt_verbatim(self):
        raw = ti.RawTemplate("s:1", "信息图", "竖版信息图「城市」", [], Path("x.png"), "")
        meta = {"title": "資訊圖", "categoryId": "office-slides", "tags": ["資訊圖"], "mode": "t2i"}
        with patch.object(ti.prompt_tools, "suggest_meta", AsyncMock(return_value=meta)), \
                patch.object(ti.prompt_tools, "translate", AsyncMock(return_value="vertical infographic")) as tr:
            out = await ti.enrich(raw, [])
        self.assertEqual(out["prompt_zh"], "竖版信息图「城市」")
        self.assertEqual(out["prompt_en"], "vertical infographic")
        self.assertEqual(tr.call_args.args, ("竖版信息图「城市」", "en"))
        self.assertEqual(out["title"], "資訊圖")

    async def test_enrich_uses_alt_prompt_without_translation(self):
        raw = ti.RawTemplate("s:2", "fig", "turn into figure", [], Path("x.png"), "", prompt_alt="轉成手辦")
        meta = {"title": "手辦", "categoryId": "creative", "tags": [], "mode": "i2i"}
        with patch.object(ti.prompt_tools, "suggest_meta", AsyncMock(return_value=meta)), \
                patch.object(ti.prompt_tools, "translate", AsyncMock()) as tr:
            out = await ti.enrich(raw, [])
        tr.assert_not_called()
        self.assertEqual((out["prompt_en"], out["prompt_zh"], out["mode"]), ("turn into figure", "轉成手辦", "i2i"))


class ImportAllTests(PostgresMixin, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = patch.object(media, "MEDIA_DIR", Path(self.tmp.name) / "media")
        p.start()
        self.addCleanup(p.stop)
        self.root = Path(self.tmp.name) / "src"
        build_gpt_image2(self.root)
        self.raws = ti.parse_gpt_image2(self.root)

    async def fake_enrich(self, raw, categories):
        if raw.source_id == getattr(self, "fail_id", None):
            raise RuntimeError("LLM down")
        return {"title": raw.title, "categoryId": "creative", "tags": ["t"], "mode": "t2i",
                "prompt_en": "en", "prompt_zh": raw.prompt}

    async def test_import_all_is_idempotent_and_continues_on_failure(self):
        self.fail_id = "gpt-image-2:case-1"
        with patch.object(ti, "enrich", self.fake_enrich):
            r1 = await ti.import_all(self.raws)
            self.assertEqual((r1.created, r1.skipped, [f[0] for f in r1.failed]), (1, 0, ["gpt-image-2:case-1"]))
            self.fail_id = None
            r2 = await ti.import_all(self.raws)
            self.assertEqual((r2.created, r2.skipped, r2.failed), (1, 1, []))
            r3 = await ti.import_all(self.raws)
            self.assertEqual((r3.created, r3.skipped), (0, 2))
        self.assertEqual(await db.fetch_val("SELECT COUNT(*) FROM templates"), 2)

    async def test_imported_images_and_thumbs_are_local(self):
        with patch.object(ti, "enrich", self.fake_enrich):
            await ti.import_all(self.raws[:1])
        row = await db.fetch_one("SELECT * FROM templates")
        self.assertIsNotNone(media.local_path(row["image_url"]))
        self.assertTrue(row["thumb_url"].endswith(".webp"))
        self.assertEqual((row["source_id"], row["created_by"], row["category_id"]), ("gpt-image-2:case-1", None, "creative"))
        self.assertEqual(row["model_label"], "GPT")
        self.assertEqual(media.read_sync_local(row["image_url"]), (self.root / "data/images/case1.jpg").read_bytes())


if __name__ == "__main__":
    unittest.main()
