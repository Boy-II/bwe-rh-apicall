import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from app.core import auth, db
from app.routers import admin_media
from app.services import media, media_retention
from tests.pg_support import PostgresMixin


class MediaRetentionTests(PostgresMixin, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = patch.object(media, "MEDIA_DIR", Path(tmp.name))
        p.start()
        self.addCleanup(p.stop)
        self.app = FastAPI()
        self.app.include_router(admin_media.router)
        self.app.dependency_overrides[auth.require_admin] = lambda: "admin"
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)

    def _file(self, age_days=0):
        url = media.save_bytes("results", b"x" * 10, "png")
        path = media.local_path(url)
        t = time.time() - age_days * 86400
        os.utime(path, (t, t))
        return url, path

    async def _task(self, tid, urls):
        await db.execute(
            """INSERT INTO users(id,username,password_hash,status,name) VALUES('u1','u1','x','approved','王小明')
            ON CONFLICT DO NOTHING""")
        await db.execute(
            """INSERT INTO tasks(id,user_id,card_title,webapp_id,rh_task_id,status,results,provider)
            VALUES($1,'u1','本地生圖','',$1,'SUCCESS',$2,'comfyui')""",
            tid, [{"url": u, "fileType": "png"} for u in urls],
        )

    async def test_list_newest_first_with_task_info(self):
        old_url, _ = self._file(age_days=3)
        new_url, _ = self._file()
        orphan_url, _ = self._file(age_days=1)
        await self._task("t1", [old_url, new_url])
        d = (await self.client.get("/api/admin/media/results")).json()
        self.assertEqual([i["url"] for i in d["items"]], [new_url, orphan_url, old_url])
        self.assertEqual((d["total"], d["totalSize"], d["retentionDays"]), (3, 30, 45))
        self.assertEqual(d["items"][0]["task"]["userName"], "王小明")
        self.assertEqual(d["items"][0]["task"]["cardTitle"], "本地生圖")
        self.assertIsNone(d["items"][1]["task"])
        page = (await self.client.get("/api/admin/media/results?limit=2")).json()
        self.assertEqual((len(page["items"]), page["nextOffset"]), (2, 2))

    async def test_delete_removes_files_and_task_references(self):
        a, pa = self._file()
        b, pb = self._file()
        await self._task("t1", [a, b])
        res = await self.client.post("/api/admin/media/results/delete",
                                     json={"names": [Path(a).name, "../../etc/passwd", "nothex.png"]})
        self.assertEqual(res.json()["deleted"], 1)
        self.assertFalse(pa.exists())
        self.assertTrue(pb.exists())
        results = await db.fetch_val("SELECT results FROM tasks WHERE id='t1'")
        self.assertEqual([r["url"] for r in results], [b])

    async def test_cleanup_expired_after_45_days(self):
        old, p_old = self._file(age_days=46)
        keep, p_keep = self._file(age_days=44)
        await self._task("t1", [old, keep])
        self.assertEqual(await media_retention.cleanup_expired(), 1)
        self.assertFalse(p_old.exists())
        self.assertTrue(p_keep.exists())
        results = await db.fetch_val("SELECT results FROM tasks WHERE id='t1'")
        self.assertEqual([r["url"] for r in results], [keep])
