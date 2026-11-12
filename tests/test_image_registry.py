import json
import unittest
from pathlib import Path

from app.core import db
from app.services import image_registry
from tests.pg_support import PostgresMixin

KEEP = [
    "gemini-pro-text",
    "gemini-pro-image",
    "gemini-flash-text",
    "gemini-flash-image",
    "gpt-image-2-text",
    "gpt-image-2-image",
]


class ImageRegistryTests(PostgresMixin, unittest.IsolatedAsyncioTestCase):
    async def test_seed_keeps_only_six_models(self):
        await image_registry.seed_image_models()
        await image_registry.seed_image_models()
        rows = await db.fetch_all(
            "SELECT key, provider, upstream, display_name FROM image_models ORDER BY sort_order"
        )
        rows = [r for r in rows if r["provider"] == "runninghub"]
        self.assertEqual([r["key"] for r in rows], KEEP)
        catalog = {
            m["key"]: m
            for m in json.loads(
                (Path(__file__).parents[1] / "app/data/image_models.json").read_text()
            )["models"]
        }
        for r in rows:
            self.assertEqual(r["upstream"], catalog[r["key"]]["endpoint"])
        self.assertEqual(
            [r["display_name"] for r in rows],
            ["Gemini Pro", "Gemini Pro", "Gemini Flash", "Gemini Flash", "GPT Image 2", "GPT Image 2"],
        )

    async def test_openai_presets_seeded_disabled_once(self):
        await image_registry.seed_image_models()
        rows = await db.fetch_all(
            "SELECT key, provider, upstream, enabled, mode FROM image_models WHERE provider='openai' ORDER BY key"
        )
        self.assertEqual(
            [(r["key"], r["upstream"], r["enabled"], r["mode"]) for r in rows],
            [
                ("omni-gemini-flash-image-edit", "antigravity/gemini-3.1-flash-image", False, "image-to-image"),
                ("omni-gemini-flash-image-text", "antigravity/gemini-3.1-flash-image", False, "text-to-image"),
            ],
        )
        await db.execute("UPDATE image_models SET enabled=TRUE WHERE provider='openai'")
        await image_registry.seed_image_models()
        self.assertTrue(all(r["enabled"] for r in await db.fetch_all("SELECT enabled FROM image_models WHERE provider='openai'")))
        m = await image_registry.get("omni-gemini-flash-image-edit")
        self.assertEqual([p["fieldKey"] for p in m["params"]], ["prompt", "image", "size"])

    async def test_get_and_list_shape(self):
        await image_registry.seed_image_models()
        m = await image_registry.get("gpt-image-2-image")
        self.assertEqual(m["displayName"], "GPT Image 2")
        self.assertEqual(m["mode"], "image-to-image")
        self.assertIsInstance(m["params"], list)
        await db.execute("UPDATE image_models SET enabled=FALSE WHERE key='gemini-pro-text'")
        keys = [x["key"] for x in await image_registry.list()]
        self.assertNotIn("gemini-pro-text", keys)
        self.assertIn("gemini-pro-text", [x["key"] for x in await image_registry.list(enabled_only=False)])
        self.assertIsNone(await image_registry.get("nope"))

    async def test_cards_hidden_defaults_false(self):
        await db.execute(
            "INSERT INTO cards(id,webapp_id,title) VALUES('c1','w1','t')"
        )
        self.assertIs(await db.fetch_val("SELECT hidden FROM cards WHERE id='c1'"), False)
        self.assertEqual(
            await db.fetch_val("SELECT column_default FROM information_schema.columns WHERE table_name='tasks' AND column_name='provider'"),
            "'runninghub'::text",
        )



from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from app.core import auth, config
from app.routers import admin_models, models as models_router

OPENAI_MODEL = {
    "key": "omni-gpt-text",
    "displayName": "Omni GPT",
    "mode": "text-to-image",
    "provider": "openai",
    "upstream": "gpt-image-2",
    "profile": "gpt-image-2",
    "params": [{"fieldKey": "prompt", "type": "STRING", "required": True}],
    "enabled": True,
    "sortOrder": 20,
}


class AdminModelsRoutes(PostgresMixin, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await image_registry.seed_image_models()
        self.app = FastAPI()
        self.app.include_router(admin_models.router)
        self.app.include_router(models_router.router)
        self.app.dependency_overrides[auth.require_user] = lambda: "u1"
        self.app.dependency_overrides[auth.require_admin] = lambda: "admin"
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)
        for k in ("openai_image_base_url", "openai_image_api_key"):
            self.addCleanup(config.set_db_setting, k, "")

    async def test_admin_create_openai_model_then_listed_for_users(self):
        res = await self.client.post("/api/admin/image-models", json=OPENAI_MODEL)
        self.assertEqual(res.status_code, 200, res.text)
        admin_list = (await self.client.get("/api/admin/image-models")).json()
        self.assertEqual(admin_list[-1]["upstream"], "gpt-image-2")
        user_list = (await self.client.get("/api/image-models")).json()
        self.assertIn("omni-gpt-text", [m["key"] for m in user_list])
        res = await self.client.patch("/api/admin/image-models/omni-gpt-text", json={"enabled": False})
        self.assertEqual(res.status_code, 200, res.text)
        user_list = (await self.client.get("/api/image-models")).json()
        self.assertNotIn("omni-gpt-text", [m["key"] for m in user_list])
        self.assertEqual((await self.client.delete("/api/admin/image-models/omni-gpt-text")).status_code, 200)
        self.assertIsNone(await image_registry.get("omni-gpt-text"))
        self.assertEqual((await self.client.post("/api/admin/image-models", json={**OPENAI_MODEL, "key": "Bad Key"})).status_code, 400)

    async def test_reject_params_without_prompt(self):
        body = {**OPENAI_MODEL, "params": [{"fieldKey": "size", "type": "LIST", "options": []}]}
        res = await self.client.post("/api/admin/image-models", json=body)
        self.assertEqual(res.status_code, 400)
        body = {**OPENAI_MODEL, "params": [{"fieldKey": "prompt", "type": "WEIRD"}]}
        self.assertEqual((await self.client.post("/api/admin/image-models", json=body)).status_code, 400)

    async def test_reject_i2i_without_image_param(self):
        body = {**OPENAI_MODEL, "key": "omni-i2i", "mode": "image-to-image"}
        res = await self.client.post("/api/admin/image-models", json=body)
        self.assertEqual(res.status_code, 400)
        self.assertIn("圖片", res.json()["detail"])

    async def test_api_key_blank_keeps_existing(self):
        await self.client.post("/api/admin/openai-route", json={"baseUrl": "http://omniroute:20128/", "apiKey": "sk-1"})
        await self.client.post("/api/admin/openai-route", json={"baseUrl": "http://omniroute:20128", "apiKey": ""})
        self.assertEqual(config.get_openai_image_api_key(), "sk-1")
        data = (await self.client.get("/api/admin/openai-route")).json()
        self.assertEqual(data, {"baseUrl": "http://omniroute:20128", "hasApiKey": True})
        self.assertEqual(await db.fetch_val("SELECT value FROM settings WHERE key='openai_image_api_key'"), "sk-1")

    async def test_route_models_lists_upstream(self):
        config.set_db_setting("openai_image_base_url", "http://omni.test")
        with patch.object(admin_models.llm, "fetch_models", AsyncMock(return_value=["gpt-image-2"])) as fm, \
                patch.object(admin_models.runninghub, "client", lambda: None):
            res = await self.client.post("/api/admin/openai-route/models")
        self.assertEqual(res.json(), {"models": ["gpt-image-2"]})
        self.assertEqual(fm.call_args.args[1], "http://omni.test")

    async def test_non_admin_forbidden(self):
        del self.app.dependency_overrides[auth.require_admin]
        with patch.object(auth, "is_admin_token_valid", AsyncMock(return_value=False)):
            res = await self.client.get("/api/admin/image-models")
        self.assertEqual(res.status_code, 401)


if __name__ == "__main__":
    unittest.main()
