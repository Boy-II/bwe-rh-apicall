import unittest

from app.services import model_catalog


class ModelValidationTests(unittest.TestCase):
    def test_text_mode_rejects_images_and_extra_parameters(self):
        model = model_catalog.get_model("gemini-pro-text")
        for payload in (
            {"prompt": "cat", "imageUrls": ["https://example.test/a.png"]},
            {"prompt": "cat", "unsupported": 1},
        ):
            with self.assertRaises(ValueError):
                model_catalog.validate_payload(model, payload)

    def test_defaults_are_typed_and_wrong_enum_rejected(self):
        model = model_catalog.get_model("midjourney-v7-text")
        result = model_catalog.validate_payload(model, {"prompt": "一隻貓"})
        self.assertIs(result["raw"], False)
        self.assertEqual(result["chaos"], 0)
        for payload in (
            {"prompt": "cat", "quality": "ultra"},
            {"prompt": "cat", "chaos": True},
            {"prompt": "cat", "raw": "false"},
            {"prompt": "cat", "chaos": 101},
        ):
            with self.assertRaises(ValueError):
                model_catalog.validate_payload(model, payload)

    def test_multi_image_limits_and_scheme(self):
        model = model_catalog.get_model("gemini-flash-image")
        model_catalog.validate_payload(
            model, {"prompt": "cat", "imageUrls": ["https://example.test/x.png"] * 14}
        )
        for images in (
            [],
            ["https://example.test/x.png"] * 15,
            ["file:///etc/passwd"],
            ["javascript:bad"],
        ):
            with self.assertRaises(ValueError):
                model_catalog.validate_payload(
                    model, {"prompt": "cat", "imageUrls": images}
                )

    def test_midjourney_reference_roles_cannot_be_arbitrary_arrays(self):
        model = model_catalog.get_model("midjourney-v7-image")
        model_catalog.validate_payload(
            model, {"prompt": "cat", "sref": "https://example.test/style.png"}
        )
        for payload in (
            {"prompt": "cat"},
            {"prompt": "cat", "imageUrl": ["https://example.test/x.png"]},
        ):
            with self.assertRaises(ValueError):
                model_catalog.validate_payload(model, payload)

    def test_prompt_required_and_whitespace_does_not_count(self):
        model = model_catalog.get_model("gpt-image-2-text")
        for value in ("", "  ", None, 123):
            with self.assertRaises(ValueError):
                model_catalog.validate_payload(model, {"prompt": value})

    def test_image_to_image_aspect_ratio_has_no_auto_option(self):
        image = ["https://example.test/a.png"]
        for key in ("gemini-flash-image", "gemini-pro-image", "gpt-image-2-image"):
            model = model_catalog.get_model(key)
            out = model_catalog.validate_payload(
                model, {"prompt": "cat", "imageUrls": image}
            )
            self.assertEqual(out["aspectRatio"], "1:1")
            with self.assertRaises(ValueError):
                model_catalog.validate_payload(
                    model,
                    {"prompt": "cat", "imageUrls": image, "aspectRatio": "empty"},
                )

    def test_image_accepts_local_media_url(self):
        model = model_catalog.get_model("gpt-image-2-image")
        url = "/covers/media/uploads/" + "a" * 32 + ".png"
        out = model_catalog.validate_payload(model, {"prompt": "x", "imageUrls": [url]})
        self.assertEqual(out["imageUrls"], [url])

    def test_image_rejects_non_media_local_path(self):
        model = model_catalog.get_model("gpt-image-2-image")
        for bad in ("/covers/other.png", "/etc/passwd"):
            with self.assertRaises(ValueError):
                model_catalog.validate_payload(model, {"prompt": "x", "imageUrls": [bad]})
