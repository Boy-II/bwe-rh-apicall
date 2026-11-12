import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from app.core import auth, db
from app.routers import templates
from tests.pg_support import PostgresMixin


async def add_template(tid, *, title="t", category="creative", tags=(), mode="t2i",
                       en="", zh="", created_by=None, age=0):
    await db.execute(
        f"""INSERT INTO templates(id,title,category_id,tags,mode,prompt_en,prompt_zh,image_url,thumb_url,created_by,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'/covers/media/templates/x.png','/covers/media/templates/x.webp',$8,
        NOW() - INTERVAL '{int(age)} seconds')""",
        tid, title, category, list(tags), mode, en, zh, created_by,
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
            ["廣告主視覺", "海報・Banner", "辦公簡報", "設計情境", "包裝設計・刀模", "寫實人像", "人像編輯", "創意"],
        )
        self.assertEqual({c["id"]: c["count"] for c in data}["packaging"], 1)

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

    async def test_detail_and_tags(self):
        await add_template("a", en="fox", zh="狐狸", tags=["動物", "寫實"], category="portrait")
        await add_template("b", tags=["動物"], category="portrait")
        d = (await self.client.get("/api/templates/a")).json()
        self.assertEqual((d["promptEn"], d["promptZh"], d["canEdit"]), ("fox", "狐狸", False))
        self.assertEqual((await self.client.get("/api/templates/zzz")).status_code, 404)
        tags = (await self.client.get("/api/template-tags?category=portrait")).json()
        self.assertEqual(tags[0], {"tag": "動物", "count": 2})


if __name__ == "__main__":
    unittest.main()
