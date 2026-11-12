import base64
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI
from PIL import Image

from app.core import auth, config, db
from app.routers import models, proxy
from app.services import image_registry, media, openai_images
from tests.pg_support import PostgresMixin


def png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "blue").save(buf, "PNG")
    return buf.getvalue()


T2I_PARAMS = [
    {"fieldKey": "prompt", "type": "STRING", "required": True},
    {"fieldKey": "size", "type": "LIST", "required": False, "defaultValue": "1024x1024",
     "options": [{"value": "1024x1024"}, {"value": "1024x1536"}]},
    {"fieldKey": "quality", "type": "LIST", "required": False, "defaultValue": "medium",
     "options": [{"value": "medium"}, {"value": "high"}]},
]
I2I_PARAMS = T2I_PARAMS + [
    {"fieldKey": "image", "type": "IMAGE", "required": True, "multipleInputs": True, "maxInputNum": 4},
]


class OpenAIImagesTests(PostgresMixin, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        await image_registry.seed_image_models()
        for key, mode, params in (
            ("omni-gpt-text", "text-to-image", T2I_PARAMS),
            ("omni-gpt-image", "image-to-image", I2I_PARAMS),
        ):
            await db.execute(
                """INSERT INTO image_models(key,display_name,mode,provider,upstream,profile,params,sort_order)
                VALUES($1,'Omni GPT',$2,'openai','gpt-image-2','gpt-image-2',$3,10)""",
                key, mode, params,
            )
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = patch.object(media, "MEDIA_DIR", Path(tmp.name))
        p.start()
        self.addCleanup(p.stop)
        config.set_db_setting("openai_image_base_url", "http://omni.test")
        config.set_db_setting("openai_image_api_key", "sk-test")
        self.addCleanup(config.set_db_setting, "openai_image_base_url", "")
        self.addCleanup(config.set_db_setting, "openai_image_api_key", "")
        self.requests: list[httpx.Request] = []
        self.reply = httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png_bytes()).decode()}]})

        def handler(request: httpx.Request):
            self.requests.append(request)
            return self.reply

        t = patch.object(openai_images, "_transport", httpx.MockTransport(handler))
        t.start()
        self.addCleanup(t.stop)

        self.app = FastAPI()
        self.app.include_router(models.router)
        self.app.include_router(proxy.router)
        self.app.dependency_overrides[auth.require_user] = lambda: "u1"
        rp = patch("app.core.rate_limit.check_rate_limit", new=AsyncMock())
        rp.start()
        self.addCleanup(rp.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)

    async def _task(self, task_id="L1", status="RUNNING", age_minutes=0):
        await db.execute(
            f"""INSERT INTO tasks(id,user_id,card_title,card_type,webapp_id,rh_task_id,status,model_key,provider,created_at)
            VALUES($1,'u1','Omni GPT','model','',$1,$2,'omni-gpt-text','openai',NOW() - INTERVAL '{int(age_minutes)} minutes')""",
            task_id, status,
        )

    async def test_generation_request_shape(self):
        model = await image_registry.get("omni-gpt-text")
        await self._task()
        await openai_images.run("L1", model, {"prompt": "貓", "size": "1024x1536", "quality": "high"})
        req = self.requests[0]
        self.assertEqual(str(req.url), "http://omni.test/v1/images/generations")
        self.assertEqual(req.headers["authorization"], "Bearer sk-test")
        self.assertEqual(
            json.loads(req.content),
            {"model": "gpt-image-2", "prompt": "貓", "n": 1, "size": "1024x1536", "quality": "high"},
        )

    async def test_edit_sends_multipart_images(self):
        model = await image_registry.get("omni-gpt-image")
        a = media.save_bytes("uploads", png_bytes(), "png")
        b = media.save_bytes("uploads", png_bytes(), "png")
        await self._task()
        await openai_images.run("L1", model, {"prompt": "換背景", "image": [a, b], "size": "1024x1024"})
        req = self.requests[0]
        self.assertEqual(str(req.url), "http://omni.test/v1/images/edits")
        self.assertIn("multipart/form-data", req.headers["content-type"])
        body = req.content
        self.assertEqual(body.count(b'name="image[]"'), 2)
        self.assertIn(b'name="model"', body)
        self.assertIn(b'name="n"', body)

    async def test_b64_result_saved_and_task_success(self):
        model = await image_registry.get("omni-gpt-text")
        await self._task()
        await openai_images.run("L1", model, {"prompt": "x"})
        row = await db.fetch_one("SELECT status, results FROM tasks WHERE id='L1'")
        self.assertEqual(row["status"], "SUCCESS")
        url = row["results"][0]["url"]
        self.assertTrue(url.startswith("/covers/media/results/"))
        self.assertEqual(media.read_sync_local(url), png_bytes())

    async def test_url_result_downloaded(self):
        def handler(request):
            self.requests.append(request)
            if request.url.path.endswith("/generations"):
                return httpx.Response(200, json={"data": [{"url": "https://cdn.test/a.png"}]})
            return httpx.Response(200, content=png_bytes())

        with patch.object(openai_images, "_transport", httpx.MockTransport(handler)):
            model = await image_registry.get("omni-gpt-text")
            await self._task()
            await openai_images.run("L1", model, {"prompt": "x"})
        self.assertEqual(await db.fetch_val("SELECT status FROM tasks WHERE id='L1'"), "SUCCESS")

    async def test_upstream_error_marks_failed(self):
        self.reply = httpx.Response(400, json={"error": {"message": "bad size"}})
        model = await image_registry.get("omni-gpt-text")
        await self._task()
        await openai_images.run("L1", model, {"prompt": "x"})
        row = await db.fetch_one("SELECT status, error_message FROM tasks WHERE id='L1'")
        self.assertEqual(row["status"], "FAILED")
        self.assertIn("bad size", row["error_message"])

    async def test_stale_running_task_failed_on_query(self):
        await self._task(age_minutes=20)
        res = await self.client.post("/api/proxy/queryTaskOutputs", json={"taskId": "L1"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["status"], "FAILED")
        self.assertIn("服務重啟或逾時", res.json()["errorMessage"])
        self.assertEqual(await db.fetch_val("SELECT status FROM tasks WHERE id='L1'"), "FAILED")

    async def test_query_success_shape(self):
        await self._task(status="SUCCESS")
        await db.execute(
            "UPDATE tasks SET results=$1 WHERE id='L1'",
            [{"url": "/covers/media/results/" + "a" * 32 + ".png", "fileType": "image"}],
        )
        data = (await self.client.post("/api/proxy/queryTaskOutputs", json={"taskId": "L1"})).json()
        self.assertEqual(data["status"], "SUCCESS")
        self.assertEqual(data["results"][0]["outputType"], "image")

    async def test_cancel_then_late_result_not_overwritten(self):
        model = await image_registry.get("omni-gpt-text")
        await self._task()
        res = await self.client.post("/api/proxy/cancelTask", json={"taskId": "L1"})
        self.assertEqual(res.status_code, 200, res.text)
        await openai_images.run("L1", model, {"prompt": "x"})
        self.assertEqual(await db.fetch_val("SELECT status FROM tasks WHERE id='L1'"), "CANCELED")

    async def test_submit_runs_in_background(self):
        with patch.object(openai_images, "run", AsyncMock()) as run:
            res = await self.client.post(
                "/api/models/submit",
                json={"modelKey": "omni-gpt-text", "payload": {"prompt": "x"}},
            )
            self.assertEqual(res.status_code, 200, res.text)
            task_id = res.json()["taskId"]
            await openai_images.drain()
        row = await db.fetch_one("SELECT * FROM tasks WHERE rh_task_id=$1", task_id)
        self.assertEqual(row["id"], task_id)
        self.assertEqual((row["provider"], row["status"]), ("openai", "RUNNING"))
        run.assert_awaited_once()

    async def test_switch_provider_reuses_upload(self):
        url = media.save_bytes("uploads", png_bytes(), "png")
        with patch.object(openai_images, "run", AsyncMock()):
            res = await self.client.post(
                "/api/models/submit",
                json={"modelKey": "omni-gpt-image", "payload": {"prompt": "x", "image": [url]}},
            )
            self.assertEqual(res.status_code, 200, res.text)
            await openai_images.drain()
        with patch.object(models.model_api, "upload", AsyncMock(return_value="https://rh.test/u.png")), \
                patch.object(models.model_api, "submit", AsyncMock(return_value={"taskId": "R9"})):
            res = await self.client.post(
                "/api/models/submit",
                json={"modelKey": "gpt-image-2-image", "payload": {"prompt": "x", "imageUrls": [url]}},
            )
        self.assertEqual(res.status_code, 200, res.text)

    async def test_missing_base_url_503(self):
        config.set_db_setting("openai_image_base_url", "")
        res = await self.client.post(
            "/api/models/submit", json={"modelKey": "omni-gpt-text", "payload": {"prompt": "x"}}
        )
        self.assertEqual(res.status_code, 503)
        self.assertIn("尚未設定 OpenAI 圖片路由", res.json()["detail"])


    async def test_openai_route_rejects_remote_image_urls(self):
        with patch.object(openai_images, "run", AsyncMock()) as run:
            res = await self.client.post(
                "/api/models/submit",
                json={"modelKey": "omni-gpt-image", "payload": {"prompt": "x", "image": ["https://169.254.169.254.example/a.png"]}},
            )
        self.assertEqual(res.status_code, 400, res.text)
        self.assertIn("重新上傳", res.json()["detail"])
        run.assert_not_called()

    async def test_webp_upload_transcoded_for_rh_model_that_rejects_webp(self):
        buf = io.BytesIO()
        Image.new("RGB", (4, 4), "red").save(buf, "WEBP")
        url = media.save_bytes("uploads", buf.getvalue(), "webp")
        with patch.object(models.model_api, "upload", AsyncMock(return_value="https://rh.test/u.png")) as up, \
                patch.object(models.model_api, "submit", AsyncMock(return_value={"taskId": "R7"})):
            res = await self.client.post(
                "/api/models/submit",
                json={"modelKey": "gemini-pro-image", "payload": {"prompt": "x", "imageUrls": [url]}},
            )
        self.assertEqual(res.status_code, 200, res.text)
        name, content, mime = up.call_args.args
        self.assertEqual(mime, "image/png")
        self.assertTrue(name.endswith(".png"))
        self.assertEqual(Image.open(io.BytesIO(content)).format, "PNG")

    async def test_startup_fails_orphaned_running_tasks(self):
        await self._task("L1")
        await self._task("L2", status="SUCCESS")
        await openai_images.fail_orphans()
        rows = {r["id"]: (r["status"], r["error_message"]) for r in await db.fetch_all("SELECT id,status,error_message FROM tasks")}
        self.assertEqual(rows["L1"][0], "FAILED")
        self.assertIn("服務重啟", rows["L1"][1])
        self.assertEqual(rows["L2"][0], "SUCCESS")


if __name__ == "__main__":
    unittest.main()
