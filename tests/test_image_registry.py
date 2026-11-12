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
        self.assertEqual([r["key"] for r in rows], KEEP)
        self.assertTrue(all(r["provider"] == "runninghub" for r in rows))
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


if __name__ == "__main__":
    unittest.main()
