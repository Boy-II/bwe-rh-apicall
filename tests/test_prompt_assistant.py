import json
import unittest
from unittest.mock import patch

import httpx

from app.core import config
from app.services import llm, moss_layout


class AssistantTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_receives_actual_content_history(self):
        bodies = []

        def handler(req):
            bodies.append(json.loads(req.content))
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": "done"}}],
                    "candidates": [{"content": {"parts": [{"text": "done"}]}}],
                },
            )

        history = [
            {"role": "user", "content": "保留紅色杯子"},
            {"role": "assistant", "content": "上一版提示詞"},
        ]
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await llm._chat_openai(
                client,
                "改成藍色背景",
                history,
                {},
                [],
                "https://test.example",
                "key",
                "model",
            )
            await llm._chat_gemini(client, "改成藍色背景", history, {}, [])
        self.assertEqual(bodies[0]["messages"][1]["content"], "保留紅色杯子")
        self.assertEqual(bodies[0]["messages"][2]["content"], "上一版提示詞")
        self.assertEqual(bodies[1]["contents"][0]["parts"][0]["text"], "保留紅色杯子")

    def test_admin_additions_do_not_remove_model_rules(self):
        with patch.object(
            config, "get_ai_system_prompt", return_value="公司品牌使用深綠色"
        ):
            p = llm._build_system_prompt({"promptProfile": "krea2"})
        self.assertIn("公司品牌使用深綠色", p)
        self.assertIn("Krea", p)
        self.assertNotIn("abs_centralized", p)

    def test_layout_conversion_and_exact_visible_text(self):
        draft = {
            "width": 1536,
            "height": 1024,
            "bbox_coord_space": "abs",
            "bbox_format": "xyxy",
            "summary": {"caption": "A cup"},
            "items": [
                {"label": "object", "caption": "Cup", "bbox": [176, 224, 800, 864]},
                {
                    "label": "text",
                    "caption": "Title",
                    "text": "原文\nHello",
                    "bbox": [928, 272, 1408, 448],
                },
            ],
        }
        result = json.loads(moss_layout.compile_layout(draft))
        self.assertEqual(result["items"][0]["bbox"], [-288, -592, 352, 32])
        self.assertEqual(result["items"][1]["text"], "原文\nHello")
        self.assertNotIn("width", result)
        self.assertEqual(result["bbox_format"], "yxyx")
        self.assertNotIn("\n", moss_layout.compile_layout(draft))
        for bad in ([0, 0, 2000, 1024], [0, 0, float("nan"), 1], [10, 10, 0, 0]):
            draft["items"][0]["bbox"] = bad
            with self.assertRaises(ValueError):
                moss_layout.compile_layout(draft)

    def test_layout_rejects_wrong_dimensions_unknown_keys_and_missing_text(self):
        draft = {
            "width": 1000,
            "height": 1024,
            "bbox_coord_space": "abs",
            "bbox_format": "xyxy",
            "summary": {"caption": "x"},
            "items": [{"label": "text", "caption": "title", "bbox": [0, 0, 100, 100]}],
        }
        with self.assertRaises(ValueError):
            moss_layout.compile_layout(draft)
        draft["width"] = 1024
        with self.assertRaises(ValueError):
            moss_layout.compile_layout(draft)
        draft["items"][0]["text"] = "Title"
        draft["items"][0]["children"] = []
        with self.assertRaises(ValueError):
            moss_layout.compile_layout(draft)

    def test_tiny_fractional_box_is_enclosed_without_collapsing(self):
        draft = {
            "width": 1024,
            "height": 1024,
            "bbox_coord_space": "abs",
            "bbox_format": "xyxy",
            "summary": {"caption": "x"},
            "items": [
                {
                    "label": "object",
                    "caption": "dot",
                    "bbox": [1.0000000001, 1.0000000001, 1.0000000002, 1.0000000002],
                }
            ],
        }
        self.assertEqual(
            json.loads(moss_layout.compile_layout(draft))["items"][0]["bbox"],
            [-511, -511, -510, -510],
        )
