import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from app.services import cover_presets


class CoverPresetsTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.source = self.root / "uploads"
        self.source.mkdir()
        self.bundle = self.root / "bundle"
        self.runtime = self.root / "runtime"

    def test_export_and_restore_preserve_card_url_and_bytes(self):
        (self.source / "cover.jpg").write_bytes(b"original image")
        rows = [{"id": "model:gemini-pro-text", "cover_url": "/covers/cover.jpg"}]
        result = cover_presets.export_presets(rows, self.source, self.bundle)
        self.assertEqual(result, {"cards": 1, "files": 1})
        mapping = cover_presets.load_presets(self.bundle)
        self.assertEqual(mapping, {"model:gemini-pro-text": "/covers/cover.jpg"})
        cover_presets.restore_files(self.bundle, self.runtime)
        self.assertEqual((self.runtime / "cover.jpg").read_bytes(), b"original image")

    def test_restore_never_overwrites_runtime_file(self):
        (self.source / "cover.jpg").write_bytes(b"bundled image")
        cover_presets.export_presets(
            [{"id": "model:test", "cover_url": "/covers/cover.jpg"}],
            self.source,
            self.bundle,
        )
        self.runtime.mkdir()
        (self.runtime / "cover.jpg").write_bytes(b"production replacement")
        cover_presets.restore_files(self.bundle, self.runtime)
        self.assertEqual(
            (self.runtime / "cover.jpg").read_bytes(), b"production replacement"
        )

    def test_invalid_or_missing_reference_keeps_previous_export(self):
        (self.source / "cover.jpg").write_bytes(b"original")
        rows = [{"id": "model:test", "cover_url": "/covers/cover.jpg"}]
        cover_presets.export_presets(rows, self.source, self.bundle)
        before = (self.bundle / "manifest.json").read_bytes()
        for value in ["/covers/../secret.jpg", "/covers/missing.jpg"]:
            with self.assertRaises(ValueError):
                cover_presets.export_presets(
                    [{"id": "model:test", "cover_url": value}], self.source, self.bundle
                )
            self.assertEqual((self.bundle / "manifest.json").read_bytes(), before)

    def test_reused_image_is_copied_once(self):
        (self.source / "cover.png").write_bytes(b"image")
        rows = [
            {"id": f"model:{i}", "cover_url": "/covers/cover.png"} for i in range(2)
        ]
        self.assertEqual(
            cover_presets.export_presets(rows, self.source, self.bundle),
            {"cards": 2, "files": 1},
        )

    def test_empty_export_cannot_erase_existing_cover_manifest(self):
        (self.source / "cover.png").write_bytes(b"image")
        cover_presets.export_presets(
            [{"id": "model:test", "cover_url": "/covers/cover.png"}],
            self.source,
            self.bundle,
        )
        before = (self.bundle / "manifest.json").read_bytes()
        with self.assertRaises(ValueError):
            cover_presets.export_presets([], self.source, self.bundle)
        self.assertEqual((self.bundle / "manifest.json").read_bytes(), before)

    def test_interrupted_restore_does_not_leave_a_partial_cover(self):
        (self.source / "cover.jpg").write_bytes(b"complete image")
        cover_presets.export_presets(
            [{"id": "model:test", "cover_url": "/covers/cover.jpg"}],
            self.source,
            self.bundle,
        )

        def fail_copy(src, out):
            out.write(b"partial")
            raise OSError("simulated interrupted copy")

        with patch.object(cover_presets.shutil, "copyfileobj", side_effect=fail_copy):
            with self.assertRaises(OSError):
                cover_presets.restore_files(self.bundle, self.runtime)
        self.assertFalse((self.runtime / "cover.jpg").exists())
        cover_presets.restore_files(self.bundle, self.runtime)
        self.assertEqual((self.runtime / "cover.jpg").read_bytes(), b"complete image")
