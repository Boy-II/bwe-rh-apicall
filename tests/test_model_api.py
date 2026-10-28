import unittest
from unittest.mock import patch

import httpx

from app.core import config
from app.services import model_api, runninghub


class ModelApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_submit_uses_standard_base_and_bearer_with_flat_taskid(self):
        def handler(req):
            self.assertEqual(
                str(req.url),
                "https://models.example.test/openapi/v2/seedream-v5-pro/text-to-image",
            )
            self.assertEqual(req.headers["Authorization"], "Bearer test-key")
            return httpx.Response(200, json={"taskId": "task-001"})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with (
                patch.object(runninghub, "client", return_value=client),
                patch.object(
                    config,
                    "RUNNINGHUB_MODEL_BASE_URL",
                    "https://models.example.test/openapi/v2",
                ),
                patch.object(config, "RUNNINGHUB_API_KEY", "test-key"),
            ):
                result = await model_api.submit(
                    "seedream-v5-pro/text-to-image", {"prompt": "cat"}
                )
                self.assertEqual(result["taskId"], "task-001")

    async def test_query_retries_transient_response_but_submit_does_not_repeat(self):
        count = 0

        def handler(req):
            nonlocal count
            count += 1
            return (
                httpx.Response(503, json={"message": "temporary"})
                if count == 1
                else httpx.Response(200, json={"status": "CANCEL"})
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with (
                patch.object(runninghub, "client", return_value=client),
                patch.object(config, "RUNNINGHUB_API_KEY", "test-key"),
            ):
                self.assertEqual((await model_api.query("task"))["status"], "CANCEL")
        self.assertEqual(count, 2)
