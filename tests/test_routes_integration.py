import io
import tempfile
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from PIL import Image

from app.core import auth, db
from app.routers import cards, models, proxy, users
from app.services.model_catalog import seed_model_cards
from app.services.cover_presets import export_presets, apply_cover_presets
from tests.pg_support import PostgresMixin


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
        await seed_model_cards()
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

    async def test_seed_does_not_resurrect_removed_or_overwrite_admin_edit(self):
        res = await self.client.put(
            "/api/admin/cards/model:gemini-pro-text",
            json={"title": "Custom", "category": "video"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["category"], "image")
        await self.client.delete("/api/admin/cards/model:gemini-pro-text")
        await seed_model_cards()
        self.assertEqual(
            await db.fetch_val(
                "SELECT title FROM cards WHERE id='model:gemini-pro-text'"
            ),
            "Custom",
        )
        self.assertFalse(
            await db.fetch_val(
                "SELECT enabled FROM cards WHERE id='model:gemini-pro-text'"
            )
        )

    async def test_model_submit_query_history_and_other_user_isolation(self):
        with patch.object(
            models.model_api, "submit", AsyncMock(return_value={"taskId": "t-001"})
        ):
            result = await self.client.post(
                "/api/models/submit",
                json={"cardId": "model:gemini-pro-text", "payload": {"prompt": "cat"}},
            )
        self.assertEqual(result.status_code, 200, result.text)
        row = await db.fetch_one("SELECT * FROM tasks WHERE rh_task_id='t-001'")
        self.assertEqual(row["user_id"], "bwhr:001")
        self.assertEqual(row["node_input"][0]["fieldName"], "resolution")
        with patch.object(
            proxy.model_api, "query", AsyncMock(return_value={"status": "CANCEL"})
        ):
            result = await self.client.post(
                "/api/proxy/queryTaskOutputs", json={"taskId": "t-001"}
            )
        self.assertEqual(result.json()["status"], "CANCEL")
        self.assertEqual(
            await db.fetch_val("SELECT status FROM tasks WHERE rh_task_id='t-001'"),
            "CANCEL",
        )
        self.app.dependency_overrides[auth.require_user] = lambda: "bwhr:OTHER"
        result = await self.client.post(
            "/api/proxy/queryTaskOutputs", json={"taskId": "t-001"}
        )
        self.assertEqual(result.status_code, 404)

    async def test_upload_real_png_and_reject_wrong_format_or_disabled_card(self):
        image = io.BytesIO()
        Image.new("RGBA", (10, 10), (255, 0, 0, 0)).save(image, format="PNG")
        with patch.object(
            models.model_api,
            "upload",
            AsyncMock(return_value="https://example.test/upload.png"),
        ):
            result = await self.client.post(
                "/api/models/upload",
                data={"cardId": "model:gemini-pro-image", "fieldKey": "imageUrls"},
                files={"file": ("a.png", image.getvalue(), "image/png")},
            )
        self.assertEqual(result.status_code, 200, result.text)
        bad = await self.client.post(
            "/api/models/upload",
            data={"cardId": "model:gemini-pro-image", "fieldKey": "imageUrls"},
            files={"file": ("a.png", b"not an image", "image/png")},
        )
        self.assertEqual(bad.status_code, 400)
        await db.execute(
            "UPDATE cards SET enabled=FALSE WHERE id='model:gemini-pro-image'"
        )
        bad = await self.client.post(
            "/api/models/submit",
            json={
                "cardId": "model:gemini-pro-image",
                "payload": {"prompt": "x", "imageUrls": ["https://example.test/a.png"]},
            },
        )
        self.assertEqual(bad.status_code, 404)

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
