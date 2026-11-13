import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from PIL import Image

from app.core import auth, db
from app.services import media
from app.routers import templates
from tests.pg_support import PostgresMixin


async def add_template(tid, *, title="t", category="creative", tags=(), mode="t2i",
                       en="", zh="", created_by=None, age=0, model_label=""):
    await db.execute(
        f"""INSERT INTO templates(id,title,category_id,tags,mode,prompt_en,prompt_zh,image_url,thumb_url,created_by,created_at,model_label)
        VALUES($1,$2,$3,$4,$5,$6,$7,'/covers/media/templates/x.png','/covers/media/templates/x.webp',$8,
        NOW() - INTERVAL '{int(age)} seconds',$9)""",
        tid, title, category, list(tags), mode, en, zh, created_by, model_label,
    )


class TemplatesBase(PostgresMixin, unittest.IsolatedAsyncioTestCase):
    user = "u1"
    admin = False

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.app = FastAPI()
        self.app.include_router(templates.router)
        self.app.dependency_overrides[auth.require_user] = lambda: self.user
        self.app.dependency_overrides[auth.require_admin] = lambda: "admin"
        self.app.dependency_overrides[auth.require_template_editor] = lambda: "editor"
        p = patch.object(templates.auth, "is_admin_token_valid", AsyncMock(side_effect=lambda t: self.admin))
        p.start()
        self.addCleanup(p.stop)
        rp = patch("app.core.rate_limit.check_rate_limit", new=AsyncMock())
        rp.start()
        self.addCleanup(rp.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)


class TemplateBrowseTests(TemplatesBase):
    async def test_categories_seeded_in_order(self):
        await add_template("a", category="packaging")
        data = (await self.client.get("/api/template-categories")).json()
        self.assertEqual(
            [c["name"] for c in data],
            ["廣告主視覺", "海報・Banner", "辦公簡報", "商業攝影", "包裝設計", "二次元", "風格轉換",
             "換臉", "換裝", "創意"],
        )
        self.assertEqual({c["id"]: c["count"] for c in data}["packaging"], 1)

    async def test_category_migration_moves_templates_instead_of_dropping(self):
        from pathlib import Path
        sql = (Path(templates.__file__).parents[1] / "migrations/018_template_categories_v2.sql").read_text()
        await db.execute(
            "INSERT INTO template_categories(id,name,sort_order) VALUES('design-scene','設計情境',3),('portrait','寫實人像',5),('portrait-edit','人像編輯',6)"
        )
        await add_template("d", category="design-scene")
        await add_template("p", category="portrait")
        await add_template("e", category="portrait-edit")
        await db.execute(sql)
        rows = dict((r["id"], r["category_id"]) for r in await db.fetch_all("SELECT id, category_id FROM templates"))
        self.assertEqual(rows, {"d": "commercial-photo", "p": "commercial-photo", "e": "creative"})

    async def test_filter_by_category_tag_mode_and_paginate(self):
        for i in range(45):
            await add_template(f"p{i:02d}", category="ad-kv", tags=["產品"], age=i)
        await add_template("other", category="creative", tags=["3D"], mode="i2i")
        page = (await self.client.get("/api/templates?category=ad-kv")).json()
        self.assertEqual((len(page["items"]), page["total"], page["nextOffset"]), (40, 45, 40))
        self.assertEqual(page["items"][0]["id"], "p00")
        page2 = (await self.client.get("/api/templates?category=ad-kv&offset=40")).json()
        self.assertEqual((len(page2["items"]), page2["nextOffset"]), (5, None))
        self.assertEqual([x["id"] for x in (await self.client.get("/api/templates?tag=3D")).json()["items"]], ["other"])
        self.assertEqual([x["id"] for x in (await self.client.get("/api/templates?mode=i2i")).json()["items"]], ["other"])
        await add_template("edited", mode="edit")
        ids = [x["id"] for x in (await self.client.get("/api/templates?mode=i2i")).json()["items"]]
        self.assertEqual(sorted(ids), ["edited", "other"])
        self.assertEqual((await self.client.get("/api/templates?limit=500")).status_code, 422)

    async def test_search_matches_title_prompts_and_tags(self):
        await add_template("a", title="夏日海報")
        await add_template("b", en="a red fox")
        await add_template("c", zh="一隻貓")
        await add_template("d", tags=["極簡"])
        for q, expect in (("海報", "a"), ("FOX", "b"), ("貓", "c"), ("極簡", "d")):
            ids = [x["id"] for x in (await self.client.get("/api/templates", params={"q": q})).json()["items"]]
            self.assertEqual(ids, [expect], q)

    async def test_search_escapes_wildcards(self):
        await add_template("pct", title="折扣 100% 海報")
        await add_template("plain", title="1000 海報")
        ids = [x["id"] for x in (await self.client.get("/api/templates", params={"q": "100%"})).json()["items"]]
        self.assertEqual(ids, ["pct"])
        self.assertEqual((await self.client.get("/api/templates", params={"q": "_"})).json()["total"], 0)
        self.assertEqual((await self.client.get("/api/templates", params={"q": "\\"})).json()["total"], 0)

    async def test_favorite_idempotent_and_favorites_filter(self):
        await add_template("a")
        await add_template("b")
        for _ in range(2):
            self.assertEqual((await self.client.put("/api/templates/a/favorite")).status_code, 200)
        self.assertEqual(await db.fetch_val("SELECT favorite_count FROM templates WHERE id='a'"), 1)
        favs = (await self.client.get("/api/templates?favorites=1")).json()["items"]
        self.assertEqual([(x["id"], x["favorited"]) for x in favs], [("a", True)])
        await self.client.delete("/api/templates/a/favorite")
        await self.client.delete("/api/templates/a/favorite")
        self.assertEqual(await db.fetch_val("SELECT favorite_count FROM templates WHERE id='a'"), 0)
        self.assertEqual((await self.client.put("/api/templates/nope/favorite")).status_code, 404)

    async def test_can_edit_flags(self):
        await add_template("mine", created_by="u1")
        await add_template("theirs", created_by="u2")
        items = {x["id"]: x["canEdit"] for x in (await self.client.get("/api/templates")).json()["items"]}
        self.assertEqual(items, {"mine": True, "theirs": False})
        self.admin = True
        items = {x["id"]: x["canEdit"] for x in (await self.client.get("/api/templates")).json()["items"]}
        self.assertEqual(items, {"mine": True, "theirs": True})

    async def test_model_label_in_list_and_patch(self):
        await add_template("a", model_label="Gemini", created_by="u1")
        item = (await self.client.get("/api/templates")).json()["items"][0]
        self.assertEqual(item["modelLabel"], "Gemini")
        res = await self.client.patch("/api/templates/a", json={"modelLabel": "Grok"})
        self.assertEqual(res.json()["modelLabel"], "Grok")
        self.assertEqual((await self.client.patch("/api/templates/a", json={"modelLabel": "Midjourney"})).status_code, 422)

    async def test_model_label_backfill_migration(self):
        from pathlib import Path
        sql = (Path(templates.__file__).parents[1] / "migrations/019_template_model_label.sql").read_text()
        await add_template("g1")
        await db.execute("UPDATE templates SET source_id='gpt-image-2:case-1' WHERE id='g1'")
        await add_template("n1", en="made with nano banana")
        await add_template("u1t")
        await db.execute("UPDATE templates SET suggested_model='gpt-image-2-text' WHERE id='u1t'")
        await add_template("x1", en="a red apple")
        await db.execute("UPDATE templates SET model_label='' ")
        await db.execute(sql)
        rows = dict((r["id"], r["model_label"]) for r in await db.fetch_all("SELECT id, model_label FROM templates"))
        self.assertEqual(rows, {"g1": "GPT", "n1": "Gemini", "u1t": "GPT", "x1": ""})

    async def test_detail_and_tags(self):
        await add_template("a", en="fox", zh="狐狸", tags=["動物", "寫實"], category="anime")
        await add_template("b", tags=["動物"], category="anime")
        d = (await self.client.get("/api/templates/a")).json()
        self.assertEqual((d["promptEn"], d["promptZh"], d["canEdit"]), ("fox", "狐狸", False))
        self.assertEqual((await self.client.get("/api/templates/zzz")).status_code, 404)
        tags = (await self.client.get("/api/template-tags?category=anime")).json()
        self.assertEqual(tags[0], {"tag": "動物", "count": 2})



def png():
    buf = io.BytesIO()
    Image.new("RGB", (800, 600), "green").save(buf, "PNG")
    return buf.getvalue()


SAVE = {"resultIndex": 0, "title": "新範本", "categoryId": "ad-kv", "tags": ["產品"], "mode": "t2i",
        "promptEn": "", "promptZh": "一張海報"}


class TemplateManageTests(TemplatesBase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        from app.services import image_registry
        await image_registry.seed_image_models()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = patch.object(media, "MEDIA_DIR", Path(tmp.name))
        p.start()
        self.addCleanup(p.stop)

    async def _task(self, tid="L1", rh="R1", user="u1", status="SUCCESS", url=None):
        url = url or media.save_bytes("results", png(), "png")
        await db.execute(
            """INSERT INTO tasks(id,user_id,card_title,card_type,webapp_id,rh_task_id,status,results,model_key)
            VALUES($1,$2,'GPT Image 2','model','',$3,$4,$5,'gpt-image-2-text')""",
            tid, user, rh, status, [{"url": url, "fileType": "image"}],
        )

    async def test_save_from_task_copies_image_and_sets_owner(self):
        await self._task()
        res = await self.client.post("/api/templates", json={**SAVE, "taskId": "R1"})
        self.assertEqual(res.status_code, 200, res.text)
        d = res.json()
        self.assertEqual((d["title"], d["categoryId"], d["promptZh"], d["createdBy"], d["canEdit"]),
                         ("新範本", "ad-kv", "一張海報", "u1", True))
        self.assertEqual(d["suggestedModel"], "gpt-image-2-text")
        self.assertEqual(d["modelLabel"], "GPT")
        self.assertTrue(d["imageUrl"].startswith("/covers/media/templates/"))
        self.assertTrue(d["thumbUrl"].endswith(".webp"))
        row = await db.fetch_one("SELECT source_task_id FROM templates WHERE id=$1", d["id"])
        self.assertEqual(row["source_task_id"], "L1")
        # 用本地 id 也可以
        res = await self.client.post("/api/templates", json={**SAVE, "taskId": "L1"})
        self.assertEqual(res.status_code, 200, res.text)

    async def test_save_fails_cleanly_when_result_unreachable(self):
        await self._task(url="https://expired.test/x.png")
        with patch.object(templates.media, "read", AsyncMock(side_effect=media.MediaError("gone"))):
            res = await self.client.post("/api/templates", json={**SAVE, "taskId": "R1"})
        self.assertEqual(res.status_code, 502)
        self.assertIn("請重新生成", res.json()["detail"])
        self.assertEqual(await db.fetch_val("SELECT COUNT(*) FROM templates"), 0)

    async def test_save_rejects_others_or_unfinished_task(self):
        await self._task(user="u2")
        await self._task(tid="L2", rh="R2", status="RUNNING")
        self.assertEqual((await self.client.post("/api/templates", json={**SAVE, "taskId": "R1"})).status_code, 404)
        self.assertEqual((await self.client.post("/api/templates", json={**SAVE, "taskId": "R2"})).status_code, 400)
        await self._task(tid="L3", rh="R3")
        bad = {**SAVE, "taskId": "R3", "resultIndex": 3}
        self.assertEqual((await self.client.post("/api/templates", json=bad)).status_code, 400)
        bad = {**SAVE, "taskId": "R3", "promptZh": "", "promptEn": ""}
        self.assertEqual((await self.client.post("/api/templates", json=bad)).status_code, 400)

    async def test_patch_delete_permissions(self):
        await add_template("mine", created_by="u1")
        await add_template("theirs", created_by="u2")
        res = await self.client.patch("/api/templates/mine", json={"title": "改", "tags": ["x"], "promptEn": "e"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()["title"], res.json()["tags"], res.json()["promptEn"]), ("改", ["x"], "e"))
        self.assertEqual((await self.client.patch("/api/templates/theirs", json={"title": "x"})).status_code, 403)
        self.assertEqual((await self.client.delete("/api/templates/theirs")).status_code, 403)
        self.assertEqual((await self.client.delete("/api/templates/mine")).status_code, 200)
        self.admin = True
        self.assertEqual((await self.client.patch("/api/templates/theirs", json={"mode": "edit"})).status_code, 200)
        self.assertEqual((await self.client.patch("/api/templates/theirs", json={"mode": "bad"})).status_code, 422)
        self.assertEqual((await self.client.delete("/api/templates/theirs")).status_code, 200)
        self.assertEqual(await db.fetch_val("SELECT COUNT(*) FROM templates"), 0)

    async def _template_with_files(self, tid, created_by=None):
        img = media.save_bytes("templates", png(), "png")
        thumb = media.make_thumbnail(img)
        await add_template(tid, created_by=created_by)
        await db.execute("UPDATE templates SET image_url=$2, thumb_url=$3 WHERE id=$1", tid, img, thumb)
        return media.local_path(img), media.local_path(thumb)

    async def test_delete_removes_image_files(self):
        img, thumb = await self._template_with_files("mine", created_by="u1")
        self.assertTrue(img.is_file() and thumb.is_file())
        self.assertEqual((await self.client.delete("/api/templates/mine")).status_code, 200)
        self.assertFalse(img.exists() or thumb.exists())

    async def test_delete_keeps_files_still_used_by_other_template(self):
        img, thumb = await self._template_with_files("a", created_by="u1")
        await add_template("b")
        await db.execute("UPDATE templates SET image_url=(SELECT image_url FROM templates WHERE id='a') WHERE id='b'")
        self.assertEqual((await self.client.delete("/api/templates/a")).status_code, 200)
        self.assertTrue(img.is_file())
        self.assertFalse(thumb.exists())

    async def test_admin_batch_delete_removes_rows_and_files(self):
        files = [await self._template_with_files(t) for t in ("a", "b")]
        await add_template("keep")
        res = await self.client.post("/api/admin/templates/batch-delete", json={"ids": ["a", "b", "a", "missing"]})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["deleted"], 2)
        self.assertEqual(await db.fetch_val("SELECT array_agg(id) FROM templates"), ["keep"])
        self.assertFalse(any(p.exists() for pair in files for p in pair))
        self.assertEqual((await self.client.post("/api/admin/templates/batch-delete", json={"ids": []})).status_code, 422)

    async def test_admin_batch_delete_requires_admin(self):
        del self.app.dependency_overrides[auth.require_admin]
        await add_template("a")
        res = await self.client.post("/api/admin/templates/batch-delete", json={"ids": ["a"]})
        self.assertIn(res.status_code, (401, 403))
        self.assertEqual(await db.fetch_val("SELECT COUNT(*) FROM templates"), 1)

    async def test_delete_category_nulls_templates(self):
        res = await self.client.post("/api/admin/template-categories", json={"id": "food", "name": "食品"})
        self.assertEqual(res.status_code, 200, res.text)
        await add_template("a", category="food")
        res = await self.client.patch("/api/admin/template-categories/food", json={"name": "餐飲", "sortOrder": 99})
        self.assertEqual(res.status_code, 200)
        cats = (await self.client.get("/api/template-categories")).json()
        self.assertEqual(cats[-1]["name"], "餐飲")
        self.assertEqual((await self.client.delete("/api/admin/template-categories/food")).status_code, 200)
        self.assertIsNone(await db.fetch_val("SELECT category_id FROM templates WHERE id='a'"))
        self.assertEqual((await self.client.post("/api/admin/template-categories", json={"id": "Bad Id", "name": "x"})).status_code, 400)

    async def test_admin_replace_image(self):
        old_img, old_thumb = await self._template_with_files("a")
        res = await self.client.post("/api/admin/templates/a/image", files={"file": ("n.png", png(), "image/png")})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertFalse(old_img.exists() or old_thumb.exists())
        row = await db.fetch_one("SELECT image_url, thumb_url FROM templates WHERE id='a'")
        self.assertIsNotNone(media.local_path(row["image_url"]))
        self.assertTrue(row["thumb_url"].endswith(".webp"))
        bad = await self.client.post("/api/admin/templates/a/image", files={"file": ("n.png", b"xx", "image/png")})
        self.assertEqual(bad.status_code, 400)


    async def test_admin_create_template_with_ai_fill(self):
        meta = {"title": "AI 標題", "categoryId": "anime", "tags": ["二次元"], "mode": "i2i"}
        with patch.object(templates.prompt_tools, "suggest_meta", AsyncMock(return_value=meta)) as sm:
            res = await self.client.post(
                "/api/admin/templates",
                data={"promptZh": "把照片轉成二次元角色", "promptEn": ""},
                files={"file": ("a.png", png(), "image/png")},
            )
        self.assertEqual(res.status_code, 200, res.text)
        d = res.json()
        self.assertEqual((d["title"], d["categoryId"], d["mode"], d["promptZh"], d["promptEn"]),
                         ("AI 標題", "anime", "i2i", "把照片轉成二次元角色", ""))
        self.assertTrue(d["thumbUrl"].endswith(".webp"))
        self.assertEqual(sm.call_args.args[0], "把照片轉成二次元角色")

    async def test_admin_create_template_uses_given_fields_without_ai(self):
        with patch.object(templates.prompt_tools, "suggest_meta", AsyncMock()) as sm:
            res = await self.client.post(
                "/api/admin/templates",
                data={"promptEn": "a poster", "title": "手動", "categoryId": "poster-banner", "mode": "t2i", "modelLabel": "ComfyUI"},
                files={"file": ("a.png", png(), "image/png")},
            )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((res.json()["title"], res.json()["categoryId"], res.json()["modelLabel"]), ("手動", "poster-banner", "ComfyUI"))
        sm.assert_not_called()

    async def test_admin_create_template_validation(self):
        res = await self.client.post("/api/admin/templates", data={"promptZh": " ", "promptEn": ""},
                                     files={"file": ("a.png", png(), "image/png")})
        self.assertEqual(res.status_code, 400)
        res = await self.client.post("/api/admin/templates", data={"promptEn": "x", "title": "t", "categoryId": "anime"},
                                     files={"file": ("a.png", b"nope", "image/png")})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(await db.fetch_val("SELECT COUNT(*) FROM templates"), 0)


if __name__ == "__main__":
    unittest.main()


class TemplateEditorRoleTests(TemplatesBase):
    """範本編輯者：可管理分類與編輯任何範本，但不能刪除他人範本或使用其他管理功能。"""

    role = "editor"

    async def asyncSetUp(self):
        await super().asyncSetUp()
        for dep in (auth.require_admin, auth.require_template_editor):
            self.app.dependency_overrides.pop(dep, None)
        p = patch.object(auth, "authenticated_user", AsyncMock(side_effect=lambda r: {"id": self.user, "role": self.role}))
        p.start()
        self.addCleanup(p.stop)

    async def test_editor_can_edit_any_template_and_manage_categories(self):
        await add_template("theirs", created_by="u2")
        items = (await self.client.get("/api/templates")).json()["items"]
        self.assertEqual((items[0]["canEdit"], items[0]["canDelete"]), (True, False))
        res = await self.client.patch("/api/templates/theirs", json={"title": "改"})
        self.assertEqual(res.status_code, 200, res.text)
        res = await self.client.post("/api/admin/template-categories", json={"id": "food", "name": "食品"})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual((await self.client.patch("/api/admin/template-categories/food", json={"name": "餐"})).status_code, 200)
        self.assertEqual((await self.client.delete("/api/admin/template-categories/food")).status_code, 200)

    async def test_editor_cannot_delete_or_use_admin_only_endpoints(self):
        await add_template("theirs", created_by="u2")
        self.assertEqual((await self.client.delete("/api/templates/theirs")).status_code, 403)
        res = await self.client.post("/api/admin/templates/batch-delete", json={"ids": ["theirs"]})
        self.assertEqual(res.status_code, 401)
        self.assertEqual(await db.fetch_val("SELECT COUNT(*) FROM templates"), 1)

    async def test_plain_user_cannot_edit_others_or_manage_categories(self):
        self.role = "user"
        await add_template("theirs", created_by="u2")
        self.assertEqual((await self.client.patch("/api/templates/theirs", json={"title": "x"})).status_code, 403)
        res = await self.client.post("/api/admin/template-categories", json={"id": "food", "name": "食品"})
        self.assertEqual(res.status_code, 403)
