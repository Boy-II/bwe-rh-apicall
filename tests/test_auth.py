import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from starlette.requests import Request

from app.core import auth, config


class AccessTests(unittest.IsolatedAsyncioTestCase):
    def employee(self, **changes):
        return dict(
            id="bwhr:001",
            username="001",
            auth_source="bwhr",
            status="approved",
            source_status="ACTIVE",
            division="健康事業處",
            session_version=2,
            **changes,
        )

    async def test_allowed_division_and_empty_list_revoke_access(self):
        with patch.object(
            auth.db, "fetch_one", AsyncMock(return_value={"value": ["健康事業處"]})
        ):
            self.assertTrue(await auth.user_accessible(self.employee()))
        with patch.object(auth.db, "fetch_one", AsyncMock(return_value={"value": []})):
            self.assertFalse(await auth.user_accessible(self.employee()))

    async def test_local_inactive_rejected_cannot_bypass_division(self):
        for field, value in [
            ("auth_source", "local"),
            ("source_status", "INACTIVE"),
            ("status", "rejected"),
        ]:
            u = self.employee()
            u[field] = value
            with patch.object(
                auth.db, "fetch_one", AsyncMock(return_value={"value": ["健康事業處"]})
            ):
                self.assertFalse(await auth.user_accessible(u))

    async def test_token_checks_session_version_and_preserves_admin(self):
        with patch.object(
            config,
            "get_jwt_secret",
            return_value="test-secret-with-at-least-32-characters",
        ):
            token = auth.create_user_token("bwhr:001", session_version=1)
            request = Request(
                {"type": "http", "headers": [(b"x-user-token", token.encode())]}
            )
            with patch.object(
                auth.db,
                "fetch_one",
                AsyncMock(side_effect=[self.employee(), {"value": ["健康事業處"]}]),
            ):
                with self.assertRaises(HTTPException):
                    await auth.require_user(request)
            admin = auth.create_user_token(auth.ADMIN_USER_ID)
            req = Request(
                {"type": "http", "headers": [(b"x-user-token", admin.encode())]}
            )
            self.assertEqual(await auth.require_user(req), "__admin__")
