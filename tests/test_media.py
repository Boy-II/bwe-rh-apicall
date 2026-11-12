import io
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from app.services import media


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = patch.object(media, "MEDIA_DIR", Path(self.tmp.name))
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_save_and_local_path_roundtrip(self):
        url = media.save_bytes("uploads", b"x", "png")
        self.assertRegex(url, r"^/covers/media/uploads/[0-9a-f]{32}\.png$")
        self.assertEqual(media.local_path(url).read_bytes(), b"x")

    def test_local_path_rejects_traversal(self):
        for bad in (
            "/covers/media/uploads/../../etc/passwd",
            "/covers/x.png",
            "https://a/b.png",
            "/covers/media/other/" + "a" * 32 + ".png",
        ):
            self.assertIsNone(media.local_path(bad), bad)

    def test_thumbnail_is_webp_480(self):
        buf = io.BytesIO()
        Image.new("RGB", (1200, 800), "red").save(buf, "PNG")
        url = media.save_bytes("templates", buf.getvalue(), "png")
        thumb = media.make_thumbnail(url)
        self.assertTrue(re.match(r"^/covers/media/templates/[0-9a-f]{32}\.webp$", thumb))
        with Image.open(media.local_path(thumb)) as im:
            self.assertEqual(im.format, "WEBP")
            self.assertEqual(im.width, 480)

    def test_read_local_and_unknown(self):
        url = media.save_bytes("results", b"abc", "jpg")
        self.assertEqual(media.read_sync_local(url), b"abc")
        with self.assertRaises(media.MediaError):
            media.read_sync_local("/covers/x.png")


if __name__ == "__main__":
    unittest.main()
