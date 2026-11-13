import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI, HTTPException
from PIL import Image

from app.core import auth, config, db
from app.routers import cards, proxy
from app.services import comfyui, media, runninghub
from tests.pg_support import PostgresMixin

WORKFLOW = {
    "3": {"class_type": "KSampler", "inputs": {"seed": 1, "steps": 20, "cfg": 7.5, "model": ["4", 0]}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a cat", "clip": ["4", 1]}, "_meta": {"title": "Prompt"}},
    "10": {"class_type": "LoadImage", "inputs": {"image": "example.png"}},
    "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "out", "images": ["8", 0]}},
    "20": {"class_type": "Lora Stacker", "inputs": {"loras": {"__value__": []}, "Update inputs": None}},
}
EDITABLE = [{"nodeId": "6", "fieldName": "text"}, {"nodeId": "3", "fieldName": "seed"},
            {"nodeId": "10", "fieldName": "image", "fieldType": "IMAGE"}]


def png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buf, "PNG")
    return buf.getvalue()


class ComfyUnitTests(unittest.TestCase):
    def test_validate_rejects_ui_format_with_hint(self):
        with self.assertRaises(HTTPException) as e:
            comfyui.validate_workflow({"nodes": [], "links": []})
        self.assertIn("Export (API)", e.exception.detail)
        with self.assertRaises(HTTPException):
            comfyui.validate_workflow({"1": {"inputs": {}}})
        self.assertIs(comfyui.validate_workflow(WORKFLOW), WORKFLOW)

    def test_build_prompt_applies_only_whitelisted_fields_with_types(self):
        prompt = comfyui.build_prompt(WORKFLOW, EDITABLE, [
            {"nodeId": "6", "fieldName": "text", "fieldValue": "a dog"},
            {"nodeId": "3", "fieldName": "seed", "fieldValue": "42"},
            {"nodeId": "3", "fieldName": "steps", "fieldValue": 999},  # 不在白名單
            {"nodeId": "3", "fieldName": "model", "fieldValue": "x"},  # 不在白名單
            {"nodeId": "99", "fieldName": "text", "fieldValue": "x"},
        ])
        self.assertEqual(prompt["6"]["inputs"]["text"], "a dog")
        self.assertEqual(prompt["3"]["inputs"]["seed"], 42)
        self.assertEqual(prompt["3"]["inputs"]["steps"], 20)
        self.assertEqual(prompt["3"]["inputs"]["model"], ["4", 0])
        self.assertEqual(WORKFLOW["6"]["inputs"]["text"], "a cat")  # 不改原 workflow

    def test_hidden_seed_randomized_public_seed_kept(self):
        seeds = {comfyui.build_prompt(WORKFLOW, [], [])["3"]["inputs"]["seed"] for _ in range(5)}
        self.assertGreater(len(seeds), 1)
        p = comfyui.build_prompt(WORKFLOW, EDITABLE, [{"nodeId": "3", "fieldName": "seed", "fieldValue": 7}])
        self.assertEqual(p["3"]["inputs"]["seed"], 7)
        with self.assertRaises(HTTPException):
            comfyui.build_prompt(WORKFLOW, EDITABLE, [{"nodeId": "3", "fieldName": "seed", "fieldValue": "abc"}])


class FakeComfy:
    """模擬 ComfyUI HTTP API。"""

    def __init__(self):
        self.calls = []
        self.history = {}
        self.queue = {"queue_running": [], "queue_pending": []}
        self.submitted = None
        self.status_override = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append((request.method, request.url.path, dict(request.headers)))
        path = request.url.path
        if self.status_override:
            return httpx.Response(self.status_override)
        if path == "/prompt":
            self.submitted = json.loads(request.content)["prompt"]
            self.queue["queue_pending"] = [[0, "pid-1", {}]]
            return httpx.Response(200, json={"prompt_id": "pid-1", "number": 0, "node_errors": {}})
        if path == "/upload/image":
            return httpx.Response(200, json={"name": "up.png", "subfolder": "", "type": "input"})
        if path.startswith("/history/"):
            return httpx.Response(200, json=self.history)
        if path == "/queue":
            return httpx.Response(200, json=self.queue)
        if path == "/interrupt":
            return httpx.Response(200)
        if path == "/view":
            return httpx.Response(200, content=png())
        return httpx.Response(404)


class ComfyRouteTests(PostgresMixin, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.app = FastAPI()
        for router in (cards.router, proxy.router):
            self.app.include_router(router)
        self.app.dependency_overrides[auth.require_user] = lambda: "u1"
        self.app.dependency_overrides[auth.require_admin] = lambda: "admin"
        for p in (
            patch("app.core.rate_limit.check_rate_limit", new=AsyncMock()),
            patch.object(config, "COMFYUI_BASE_URL", "https://comfy.test"),
            patch.object(config, "COMFYUI_CF_ACCESS_CLIENT_ID", "id.access"),
            patch.object(config, "COMFYUI_CF_ACCESS_CLIENT_SECRET", "sec"),
        ):
            p.start()
            self.addCleanup(p.stop)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        mp = patch.object(media, "MEDIA_DIR", Path(tmp.name))
        mp.start()
        self.addCleanup(mp.stop)
        self.comfy = FakeComfy()
        fake_client = httpx.AsyncClient(transport=httpx.MockTransport(self.comfy.handler))
        cp = patch.object(runninghub, "_client", fake_client)
        cp.start()
        self.addCleanup(cp.stop)
        self.addAsyncCleanup(fake_client.aclose)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)

    async def _card(self):
        res = await self.client.post("/api/admin/cards", json={
            "cardType": "workflow", "instanceType": "comfyui", "title": "本地生圖",
            "comfyWorkflow": WORKFLOW, "editableFields": EDITABLE,
        })
        self.assertEqual(res.status_code, 200, res.text)
        card = res.json()
        self.assertEqual((card["instanceType"], card["hasComfyWorkflow"]), ("comfyui", True))
        return card["id"]

    async def test_admin_reads_and_updates_stored_workflow(self):
        card_id = await self._card()
        res = await self.client.get(f"/api/admin/cards/{card_id}/comfy-workflow")
        self.assertEqual(res.json()["workflow"], WORKFLOW)
        changed = {**WORKFLOW, "3": {**WORKFLOW["3"], "inputs": {**WORKFLOW["3"]["inputs"], "steps": 30}}}
        res = await self.client.put(f"/api/admin/cards/{card_id}", json={"title": "本地生圖", "comfyWorkflow": changed})
        self.assertEqual(res.status_code, 200, res.text)
        stored = (await self.client.get(f"/api/admin/cards/{card_id}/comfy-workflow")).json()["workflow"]
        self.assertEqual(stored["3"]["inputs"]["steps"], 30)

    async def test_card_rejects_ui_format_workflow(self):
        res = await self.client.post("/api/admin/cards", json={
            "cardType": "workflow", "instanceType": "comfyui", "title": "x", "comfyWorkflow": {"nodes": [], "links": []},
        })
        self.assertEqual(res.status_code, 400)

    async def test_node_list_upload_submit_query_end_to_end(self):
        card_id = await self._card()
        res = await self.client.post("/api/proxy/getWorkflowJson", json={"cardId": card_id})
        nodes = res.json()["data"]["nodeInfoList"]
        image = next(n for n in nodes if n["nodeId"] == "10")
        self.assertEqual(image["fieldType"], "IMAGE")
        self.assertFalse(any(n["fieldName"] == "model" for n in nodes))  # 連線不暴露
        self.assertFalse(any(n["nodeId"] == "20" for n in nodes))  # 物件型設定不暴露

        up = await self.client.post("/api/proxy/uploadFile?target=comfyui", files={"file": ("a.png", png(), "image/png")})
        self.assertEqual(up.json()["data"]["fileName"], "up.png")

        res = await self.client.post("/api/proxy/submitWorkflowTask", json={
            "cardId": card_id, "cardTitle": "本地生圖",
            "nodeInfoList": [{"nodeId": "6", "fieldName": "text", "fieldValue": "a dog"},
                             {"nodeId": "10", "fieldName": "image", "fieldValue": "up.png"}],
        })
        self.assertEqual(res.json(), {"code": 0, "msg": "success", "data": {"taskId": "pid-1"}})
        self.assertEqual(self.comfy.submitted["6"]["inputs"]["text"], "a dog")
        self.assertEqual(self.comfy.submitted["10"]["inputs"]["image"], "up.png")
        headers = self.comfy.calls[-1][2]
        self.assertEqual((headers["cf-access-client-id"], headers["cf-access-client-secret"]), ("id.access", "sec"))

        q = (await self.client.post("/api/proxy/queryTaskOutputs", json={"taskId": "pid-1"})).json()
        self.assertEqual(q["status"], "QUEUED")

        self.comfy.queue = {"queue_running": [], "queue_pending": []}
        self.comfy.history = {"pid-1": {"status": {"status_str": "success", "completed": True}, "outputs": {
            "9": {"images": [{"filename": "out_0001.png", "subfolder": "", "type": "output"},
                             {"filename": "preview.png", "subfolder": "", "type": "temp"}]}}}}
        q = (await self.client.post("/api/proxy/queryTaskOutputs", json={"taskId": "pid-1"})).json()
        self.assertEqual(q["status"], "SUCCESS")
        self.assertEqual(len(q["results"]), 1)
        self.assertTrue(media.local_path(q["results"][0]["url"]).is_file())
        row = await db.fetch_one("SELECT status, provider, card_type, results FROM tasks WHERE rh_task_id='pid-1'")
        self.assertEqual((row["status"], row["provider"], row["card_type"]), ("SUCCESS", "comfyui", "workflow"))

        # 已完成：直接回 DB 結果，不再打 ComfyUI
        n = len(self.comfy.calls)
        q2 = (await self.client.post("/api/proxy/queryTaskOutputs", json={"taskId": "pid-1"})).json()
        self.assertEqual(q2["results"], q["results"])
        self.assertEqual(len(self.comfy.calls), n)

    async def test_execution_error_marks_failed(self):
        card_id = await self._card()
        await self.client.post("/api/proxy/submitWorkflowTask", json={"cardId": card_id, "nodeInfoList": []})
        self.comfy.queue = {"queue_running": [], "queue_pending": []}
        self.comfy.history = {"pid-1": {"status": {"status_str": "error", "completed": False, "messages": [
            ["execution_error", {"node_type": "KSampler", "exception_message": "CUDA out of memory"}]]}, "outputs": {}}}
        q = (await self.client.post("/api/proxy/queryTaskOutputs", json={"taskId": "pid-1"})).json()
        self.assertEqual(q["status"], "FAILED")
        self.assertIn("CUDA out of memory", q["errorMessage"])

    async def test_cancel_running_task(self):
        card_id = await self._card()
        await self.client.post("/api/proxy/submitWorkflowTask", json={"cardId": card_id, "nodeInfoList": []})
        self.comfy.queue = {"queue_running": [[0, "pid-1", {}]], "queue_pending": []}
        res = await self.client.post("/api/proxy/cancelTask", json={"taskId": "pid-1"})
        self.assertEqual(res.json()["code"], 0)
        self.assertIn(("POST", "/interrupt"), [(m, p) for m, p, _ in self.comfy.calls])
        self.assertEqual(await db.fetch_val("SELECT status FROM tasks WHERE rh_task_id='pid-1'"), "CANCELED")

    async def test_offline_or_access_denied_gives_clear_error(self):
        card_id = await self._card()
        self.comfy.status_override = 530
        res = await self.client.post("/api/proxy/submitWorkflowTask", json={"cardId": card_id, "nodeInfoList": []})
        self.assertEqual(res.status_code, 502)
        self.assertIn("離線", res.json()["detail"])
        self.comfy.status_override = 302
        res = await self.client.post("/api/proxy/submitWorkflowTask", json={"cardId": card_id, "nodeInfoList": []})
        self.assertIn("Service Token", res.json()["detail"])


class ComfyQueryRaceTests(unittest.IsolatedAsyncioTestCase):
    async def test_finished_between_requests_is_success_not_missing(self):
        """任務在查佇列後才完成：歷史已寫入，不可誤判找不到。"""
        calls = []

        async def fake_request(method, path, **kw):
            calls.append(path)
            if path == "/queue":
                return httpx.Response(200, json={"queue_running": [], "queue_pending": []})
            return httpx.Response(200, json={"p": {"status": {"status_str": "success", "completed": True},
                                                   "outputs": {"9": {"images": [{"filename": "a.png", "type": "output"}]}}}})

        with patch.object(comfyui, "_request", fake_request):
            r = await comfyui.query("p")
        self.assertEqual(r["status"], "SUCCESS")
        self.assertEqual(calls[0], "/queue")

    async def test_missing_everywhere_rechecks_then_fails(self):
        async def fake_request(method, path, **kw):
            return httpx.Response(200, json={"queue_running": [], "queue_pending": []} if path == "/queue" else {})

        with patch.object(comfyui, "_request", fake_request), patch.object(comfyui.asyncio, "sleep", AsyncMock()) as sl:
            r = await comfyui.query("p")
        self.assertEqual(r["status"], "FAILED")
        sl.assert_awaited_once()
