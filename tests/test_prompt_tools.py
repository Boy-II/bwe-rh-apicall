import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from app.core import auth, db
from app.routers import prompt as prompt_router, templates
from app.services import image_registry, prompt_tools
from app.services.prompt_profiles import PROFILES
from tests.pg_support import PostgresMixin
from tests.test_templates import TemplatesBase, add_template

CATS = [{"id": "ad-kv", "name": "廣告主視覺"}, {"id": "creative", "name": "創意"}]


class PromptToolUnitTests(unittest.IsolatedAsyncioTestCase):
    async def test_optimize_includes_profile_rules_and_extracts_block(self):
        with patch.object(prompt_tools.llm, "complete", AsyncMock(return_value="說明\n```prompt\nNEW\n```")) as c:
            out = await prompt_tools.optimize("old", "換成海邊", "gpt-image-2")
        self.assertEqual(out, "NEW")
        system, user = c.call_args.args
        self.assertIn(PROFILES["gpt-image-2"], system)
        self.assertIn("換成海邊", user)
        self.assertIn("old", user)

    async def test_translate_keeps_inner_code_blocks(self):
        reply = '建立品牌聖誕樹：\n```json\n{"brand": "X"}\n```\n結尾說明'
        with patch.object(prompt_tools.llm, "complete", AsyncMock(return_value=reply)):
            self.assertEqual(await prompt_tools.translate("Create...", "zh"), reply)
        wrapped = "```text\n整段翻譯\n```"
        with patch.object(prompt_tools.llm, "complete", AsyncMock(return_value=wrapped)):
            self.assertEqual(await prompt_tools.translate("x", "zh"), "整段翻譯")

    async def test_optimize_prefers_prompt_block_over_inner_json(self):
        with patch.object(prompt_tools.llm, "complete", AsyncMock(return_value="```json\n{}\n```\n```prompt\nNEW\n```")):
            self.assertEqual(await prompt_tools.optimize("old", "r", "generic"), "NEW")

    async def test_translate_zh_asks_for_traditional(self):
        with patch.object(prompt_tools.llm, "complete", AsyncMock(return_value="一隻狐狸")) as c:
            self.assertEqual(await prompt_tools.translate("a fox", "zh"), "一隻狐狸")
        self.assertIn("繁體中文", c.call_args.args[0])

    async def test_suggest_meta_falls_back_to_creative_on_unknown_category(self):
        reply = json.dumps({"title": "標題", "categoryId": "nope", "tags": ["a", "b"], "mode": "t2i"})
        with patch.object(prompt_tools.llm, "complete", AsyncMock(return_value=reply)):
            meta = await prompt_tools.suggest_meta("p", CATS)
        self.assertEqual(meta, {"title": "標題", "categoryId": "creative", "tags": ["a", "b"], "mode": "t2i"})

    async def test_suggest_meta_retries_once_on_bad_json(self):
        good = json.dumps({"title": "T", "categoryId": "ad-kv", "tags": [], "mode": "edit"})
        with patch.object(prompt_tools.llm, "complete", AsyncMock(side_effect=["oops", "```json\n" + good + "\n```"])) as c:
            meta = await prompt_tools.suggest_meta("p", CATS)
        self.assertEqual((meta["categoryId"], meta["mode"], c.await_count), ("ad-kv", "edit", 2))
        with patch.object(prompt_tools.llm, "complete", AsyncMock(return_value="nope")):
            with self.assertRaises(ValueError):
                await prompt_tools.suggest_meta("p", CATS)

    async def test_suggest_meta_clamps_values(self):
        reply = json.dumps({"title": "很" * 40, "categoryId": "ad-kv", "tags": [str(i) for i in range(10)], "mode": "x"})
        with patch.object(prompt_tools.llm, "complete", AsyncMock(return_value=reply)):
            meta = await prompt_tools.suggest_meta("p", CATS)
        self.assertEqual((len(meta["title"]), len(meta["tags"]), meta["mode"]), (20, 6, "t2i"))


class PromptRoutesTests(TemplatesBase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await image_registry.seed_image_models()
        self.app.include_router(prompt_router.router)

    async def test_optimize_route_uses_model_profile(self):
        with patch.object(prompt_router.prompt_tools, "optimize", AsyncMock(return_value="X")) as o:
            res = await self.client.post(
                "/api/prompt/optimize",
                json={"prompt": "p", "request": "r", "modelKey": "gpt-image-2-text"},
            )
            self.assertEqual(res.json(), {"prompt": "X"})
            self.assertEqual(o.call_args.args, ("p", "r", "gpt-image-2"))
            await self.client.post("/api/prompt/optimize", json={"prompt": "p", "request": "r", "modelKey": "zzz"})
            self.assertEqual(o.call_args.args[2], "generic")
        self.assertEqual(
            (await self.client.post("/api/prompt/optimize", json={"prompt": " ", "request": "r", "modelKey": ""})).status_code,
            400,
        )

    async def test_suggest_meta_route(self):
        with patch.object(prompt_router.prompt_tools, "suggest_meta", AsyncMock(return_value={"title": "T"})) as s:
            res = await self.client.post("/api/prompt/suggest-meta", json={"prompt": "p"})
        self.assertEqual(res.json(), {"title": "T"})
        self.assertEqual([c["id"] for c in s.call_args.args[1]][0], "ad-kv")

    async def test_fill_language_generates_and_saves(self):
        await add_template("a", zh="一隻狐狸")
        with patch.object(templates.prompt_tools, "translate", AsyncMock(return_value="a fox")) as t:
            res = await self.client.post("/api/templates/a/fill-language", json={"lang": "en"})
        self.assertEqual(res.json(), {"text": "a fox", "generated": True})
        self.assertEqual(t.call_args.args, ("一隻狐狸", "en"))
        self.assertEqual(await db.fetch_val("SELECT prompt_en FROM templates WHERE id='a'"), "a fox")

    async def test_fill_language_does_not_overwrite(self):
        await add_template("a", en="A", zh="甲")
        with patch.object(templates.prompt_tools, "translate", AsyncMock()) as t:
            res = await self.client.post("/api/templates/a/fill-language", json={"lang": "en"})
        self.assertEqual(res.json(), {"text": "A", "generated": False})
        t.assert_not_called()

    async def test_fill_language_concurrent_second_loses(self):
        await add_template("a", zh="甲")

        async def racing_translate(text, lang):
            await db.execute("UPDATE templates SET prompt_en='FIRST' WHERE id='a'")
            return "SECOND"

        with patch.object(templates.prompt_tools, "translate", racing_translate):
            res = await self.client.post("/api/templates/a/fill-language", json={"lang": "en"})
        self.assertEqual(res.json(), {"text": "FIRST", "generated": False})
        self.assertEqual(await db.fetch_val("SELECT prompt_en FROM templates WHERE id='a'"), "FIRST")

    async def test_fill_language_both_empty_400(self):
        await add_template("a")
        res = await self.client.post("/api/templates/a/fill-language", json={"lang": "zh"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual((await self.client.post("/api/templates/a/fill-language", json={"lang": "fr"})).status_code, 422)


if __name__ == "__main__":
    unittest.main()
