import io
import tempfile
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from PIL import Image

from app.core import auth, db
from app.services import media
from app.routers import cards, models, proxy, users
from app.services.image_registry import seed_image_models
from app.services.cover_presets import export_presets, apply_cover_presets
from tests.pg_support import PostgresMixin


async def insert_legacy_model_cards():
    for key, mode in (("gemini-pro-text", "text-to-image"), ("gemini-pro-image", "image-to-image")):
        await db.execute(
            """INSERT INTO cards(id,webapp_id,title,card_type,category,image_mode,model_key,hidden)
            VALUES($1,'',$2,'model','image',$3,$2,TRUE) ON CONFLICT(id) DO NOTHING""",
            "model:" + key,
            key,
            mode,
        )


class RoutesIntegration(PostgresMixin, unittest.IsolatedAsyncioTestCase):
    async def test_deployment_applies_cover_defaults_without_overwriting_custom_cover(
        self,
    ):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source"
            source.mkdir()
            bundle = Path(tmp) / "bundle"
            (source / "cover.jpg").write_bytes(b"packaged image")
            export_presets(
                [
                    {"id": "model:gemini-pro-text", "cover_url": "/covers/cover.jpg"},
                    {"id": "model:gemini-pro-image", "cover_url": "/covers/cover.jpg"},
                ],
                source,
                bundle,
            )
            await db.execute(
                "UPDATE cards SET cover_url='/covers/production-custom.png' WHERE id='model:gemini-pro-image'"
            )
            await apply_cover_presets(bundle)
            self.assertEqual(
                await db.fetch_val(
                    "SELECT cover_url FROM cards WHERE id='model:gemini-pro-text'"
                ),
                "/covers/cover.jpg",
            )
            self.assertEqual(
                await db.fetch_val(
                    "SELECT cover_url FROM cards WHERE id='model:gemini-pro-image'"
                ),
                "/covers/production-custom.png",
            )

    async def asyncSetUp(self):
        await super().asyncSetUp()
        await seed_image_models()
        await insert_legacy_model_cards()
        self.app = FastAPI()
        for router in (cards.router, models.router, proxy.router, users.router):
            self.app.include_router(router)
        self.app.dependency_overrides[auth.require_user] = lambda: "bwhr:001"
        self.app.dependency_overrides[auth.require_admin] = lambda: "admin-token"
        self.rate_patch = patch("app.core.rate_limit.check_rate_limit", new=AsyncMock())
        self.rate_patch.start()
        self.addCleanup(self.rate_patch.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test"
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        await super().asyncTearDown()

    def _png(self):
        image = io.BytesIO()
        Image.new("RGBA", (10, 10), (255, 0, 0, 0)).save(image, format="PNG")
        return image.getvalue()

    async def _media_tmp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = patch.object(media, "MEDIA_DIR", Path(tmp.name))
        p.start()
        self.addCleanup(p.stop)

    async def test_image_models_lists_six_without_upstream(self):
        res = await self.client.get("/api/image-models")
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertEqual(len(data), 6)
        self.assertNotIn("upstream", data[0])
        self.assertEqual(data[0]["displayName"], "Gemini Pro")

    async def test_upload_stores_locally_independent_of_provider(self):
        await self._media_tmp()
        with patch.object(models.model_api, "upload", AsyncMock()) as up:
            res = await self.client.post(
                "/api/models/upload",
                data={"modelKey": "gemini-pro-image", "fieldKey": "imageUrls"},
                files={"file": ("a.png", self._png(), "image/png")},
            )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.json()["url"].startswith("/covers/media/uploads/"))
        up.assert_not_called()
        bad = await self.client.post(
            "/api/models/upload",
            data={"modelKey": "gemini-pro-image", "fieldKey": "imageUrls"},
            files={"file": ("a.png", b"not an image", "image/png")},
        )
        self.assertEqual(bad.status_code, 400)

    async def test_rh_submit_converts_local_images(self):
        await self._media_tmp()
        local = media.save_bytes("uploads", self._png(), "png")
        with patch.object(
            models.model_api, "upload", AsyncMock(return_value="https://rh.test/u.png")
        ), patch.object(
            models.model_api, "submit", AsyncMock(return_value={"taskId": "t-002"})
        ) as sub:
            res = await self.client.post(
                "/api/models/submit",
                json={
                    "modelKey": "gpt-image-2-image",
                    "payload": {"prompt": "cat", "imageUrls": [local, "https://keep.test/x.png"]},
                    "templateId": "tpl1",
                },
            )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["taskId"], "t-002")
        sent = sub.call_args.args[1]
        self.assertEqual(sent["imageUrls"], ["https://rh.test/u.png", "https://keep.test/x.png"])
        row = await db.fetch_one("SELECT * FROM tasks WHERE rh_task_id='t-002'")
        self.assertEqual(row["provider"], "runninghub")
        self.assertEqual(row["model_key"], "gpt-image-2-image")
        self.assertEqual(row["card_type"], "model")
        self.assertIsNone(row["card_id"])
        self.assertEqual(row["card_title"], "GPT Image 2")
        self.assertEqual(row["raw_response"]["templateId"], "tpl1")
        # node_input 保存本地 URL，重跑時可再用
        img = [n for n in row["node_input"] if n["fieldName"] == "imageUrls"][0]
        self.assertEqual(img["fieldValue"][0], local)

    async def test_submit_unknown_or_disabled_model_404(self):
        res = await self.client.post(
            "/api/models/submit", json={"modelKey": "nope", "payload": {"prompt": "x"}}
        )
        self.assertEqual(res.status_code, 404)
        await db.execute("UPDATE image_models SET enabled=FALSE WHERE key='gemini-pro-text'")
        res = await self.client.post(
            "/api/models/submit",
            json={"modelKey": "gemini-pro-text", "payload": {"prompt": "x"}},
        )
        self.assertEqual(res.status_code, 404)

    async def test_query_and_other_user_isolation(self):
        with patch.object(
            models.model_api, "submit", AsyncMock(return_value={"taskId": "t-001"})
        ):
            await self.client.post(
                "/api/models/submit",
                json={"modelKey": "gemini-pro-text", "payload": {"prompt": "cat"}},
            )
        with patch.object(
            proxy.model_api, "query", AsyncMock(return_value={"status": "CANCEL"})
        ):
            result = await self.client.post(
                "/api/proxy/queryTaskOutputs", json={"taskId": "t-001"}
            )
        self.assertEqual(result.json()["status"], "CANCEL")
        self.app.dependency_overrides[auth.require_user] = lambda: "bwhr:OTHER"
        result = await self.client.post(
            "/api/proxy/queryTaskOutputs", json={"taskId": "t-001"}
        )
        self.assertEqual(result.status_code, 404)

    async def test_download_result_only_owner(self):
        await self._media_tmp()
        url = media.save_bytes("results", self._png(), "png")
        await db.execute(
            """INSERT INTO tasks(id,user_id,card_title,card_type,webapp_id,rh_task_id,status,results,model_key)
            VALUES('L1','bwhr:001','GPT Image 2','model','','R1','SUCCESS',$1,'gpt-image-2-text')""",
            [{"url": url, "fileType": "image"}],
        )
        res = await self.client.get("/api/models/tasks/R1/results/0")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.content, self._png())
        self.assertIn('attachment; filename="bwe-R1-0.png"', res.headers["content-disposition"])
        self.assertEqual((await self.client.get("/api/models/tasks/R1/results/5")).status_code, 404)
        self.app.dependency_overrides[auth.require_user] = lambda: "bwhr:OTHER"
        self.assertEqual((await self.client.get("/api/models/tasks/R1/results/0")).status_code, 404)

    async def test_empty_access_setting_is_saved_as_empty_not_default(self):
        result = await self.client.put(
            "/api/admin/access", json={"allowedDivisions": []}
        )
        self.assertEqual(result.status_code, 200)
        self.assertEqual(
            (await self.client.get("/api/admin/access")).json()["allowedDivisions"], []
        )

    async def test_deleting_synced_employee_keeps_rejection_and_revokes_sessions(self):
        await db.execute(
            "INSERT INTO users(id,username,password_hash,status,auth_source,employee_id) VALUES('bwhr:001','001','','approved','bwhr','001')"
        )
        result = await self.client.delete("/api/admin/users/bwhr:001")
        self.assertEqual(result.status_code, 200)
        user = await db.fetch_one(
            "SELECT status,session_version FROM users WHERE id='bwhr:001'"
        )
        self.assertEqual(user, {"status": "rejected", "session_version": 1})

    async def test_hidden_cards_excluded_for_users_visible_for_admin(self):
        await db.execute(
            """INSERT INTO cards(id,webapp_id,title,category) VALUES
            ('img','w1','圖片應用','image'),('vid','w2','影片應用','video')"""
        )
        await db.execute("UPDATE cards SET hidden=TRUE WHERE id='vid'")
        with patch.object(cards.auth, "is_admin_token_valid", AsyncMock(return_value=False)):
            ids = [c["id"] for c in (await self.client.get("/api/cards")).json()["cards"]]
        self.assertIn("img", ids)
        self.assertNotIn("vid", ids)
        self.assertNotIn("model:gemini-pro-text", ids)
        with patch.object(cards.auth, "is_admin_token_valid", AsyncMock(return_value=True)):
            data = {c["id"]: c for c in (await self.client.get("/api/cards")).json()["cards"]}
        self.assertTrue(data["vid"]["hidden"])
        self.assertFalse(data["img"]["hidden"])
        res = await self.client.put("/api/admin/cards/vid", json={"title": "影片應用", "hidden": False})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertFalse(res.json()["hidden"])

