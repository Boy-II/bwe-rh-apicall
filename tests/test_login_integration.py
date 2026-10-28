import unittest
from unittest.mock import AsyncMock, patch

import bcrypt
import httpx
from fastapi import FastAPI

from app.core import config, db
from app.routers import auth, cards
from tests.pg_support import PostgresMixin


class LoginIntegration(PostgresMixin, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        app = FastAPI()
        app.include_router(auth.router)
        app.include_router(cards.router)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        self.rate = patch("app.core.rate_limit.check_rate_limit", new=AsyncMock())
        self.rate.start()
        self.addCleanup(self.rate.stop)
        self.secret = patch.object(
            config,
            "get_jwt_secret",
            return_value="integration-jwt-secret-at-least-32-characters",
        )
        self.secret.start()
        self.addCleanup(self.secret.stop)
        await db.execute(
            "INSERT INTO users(id,username,password_hash,status,auth_source,employee_id,name,email,division,source_status) VALUES('bwhr:001','001',$1,'approved','bwhr','001','測試員工','test@example.test','健康事業處','ACTIVE')",
            bcrypt.hashpw(b"test-pass", bcrypt.gensalt(rounds=4)).decode(),
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        await super().asyncTearDown()

    async def test_login_profile_and_existing_token_revoked_by_division_and_password_update(
        self,
    ):
        result = await self.client.post(
            "/api/auth/login", json={"username": "001", "password": "test-pass"}
        )
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["name"], "測試員工")
        self.assertNotIn("password_hash", result.json())
        headers = {"X-User-Token": result.json()["token"]}
        self.assertEqual(
            (await self.client.get("/api/cards", headers=headers)).status_code, 200
        )
        await db.execute(
            "UPDATE settings SET value='[]'::jsonb WHERE key='allowed_divisions'"
        )
        self.assertFalse(
            (await self.client.get("/api/auth/verify", headers=headers)).json()["valid"]
        )
        self.assertEqual(
            (await self.client.get("/api/cards", headers=headers)).status_code, 401
        )
        await db.execute(
            "UPDATE settings SET value='[\"健康事業處\"]'::jsonb WHERE key='allowed_divisions'"
        )
        await db.execute(
            "UPDATE users SET session_version=session_version+1 WHERE username='001'"
        )
        self.assertFalse(
            (await self.client.get("/api/auth/verify", headers=headers)).json()["valid"]
        )

    async def test_register_and_inactive_login_rejected(self):
        self.assertEqual(
            (
                await self.client.post(
                    "/api/auth/register",
                    json={"username": "new", "password": "password"},
                )
            ).status_code,
            403,
        )
        await db.execute("UPDATE users SET source_status='INACTIVE'")
        self.assertEqual(
            (
                await self.client.post(
                    "/api/auth/login", json={"username": "001", "password": "test-pass"}
                )
            ).status_code,
            403,
        )

    async def test_admin_non_ascii_wrong_password_does_not_crash(self):
        with patch.object(config, "ADMIN_PASSWORD", "admin-test-password"):
            result = await self.client.post(
                "/api/auth/login", json={"username": "admin", "password": "密碼錯誤"}
            )
        self.assertEqual(result.status_code, 401)
