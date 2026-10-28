from contextlib import closing
import sqlite3
import tempfile
import unittest
from pathlib import Path

import bcrypt

from app import sync_bwhr
from app.core import db
from tests.pg_support import PostgresMixin


class SyncIntegration(PostgresMixin, unittest.IsolatedAsyncioTestCase):
    def source(self, ids=("001", "002")):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "source.db"
        with closing(sqlite3.connect(path)) as c:
            c.execute(
                "CREATE TABLE Employee(employeeId TEXT,passwordHash TEXT,name TEXT,email TEXT,division TEXT,department TEXT,unit TEXT,status TEXT)"
            )
            for eid in ids:
                c.execute(
                    "INSERT INTO Employee VALUES (?,?,?,?,?,?,?,?)",
                    (
                        eid,
                        bcrypt.hashpw(b"pass123", bcrypt.gensalt(rounds=4)).decode(),
                        "Test",
                        "test@example.test",
                        "健康事業處",
                        "dept",
                        "unit",
                        "ACTIVE",
                    ),
                )
            c.commit()
        return path

    async def test_dry_run_upsert_revocation_and_local_rejection(self):
        path = self.source()
        await sync_bwhr.sync_employees(path, True)
        self.assertEqual(await db.fetch_val("SELECT COUNT(*) FROM users"), 0)
        first = await sync_bwhr.sync_employees(path)
        self.assertEqual(first["created"], 2)
        await db.execute(
            "UPDATE users SET status='rejected',note='keep' WHERE username='001'"
        )
        await sync_bwhr.sync_employees(path)
        u = await db.fetch_one("SELECT * FROM users WHERE username='001'")
        self.assertEqual(
            (u["status"], u["note"], u["session_version"]), ("rejected", "keep", 0)
        )
        with closing(sqlite3.connect(path)) as c:
            c.execute("DELETE FROM Employee WHERE employeeId=?", ("002",))
            c.execute(
                "UPDATE Employee SET passwordHash=?, name=?",
                (
                    bcrypt.hashpw(b"changed", bcrypt.gensalt(rounds=4)).decode(),
                    "Changed",
                ),
            )
            c.commit()
        await sync_bwhr.sync_employees(path)
        self.assertEqual(
            await db.fetch_val(
                "SELECT session_version FROM users WHERE username='001'"
            ),
            1,
        )
        self.assertEqual(
            await db.fetch_val("SELECT source_status FROM users WHERE username='002'"),
            "INACTIVE",
        )
        self.assertEqual(
            await db.fetch_val("SELECT name FROM users WHERE username='001'"), "Changed"
        )

    async def test_conflict_rolls_back_entire_sync(self):
        path = self.source()
        await db.execute(
            "INSERT INTO users(id,username,password_hash,status) VALUES ('legacy','002','legacy','approved')"
        )
        with self.assertRaises(ValueError):
            await sync_bwhr.sync_employees(path)
        self.assertEqual(await db.fetch_val("SELECT COUNT(*) FROM users"), 1)
        self.assertIsNone(
            await db.fetch_one("SELECT * FROM settings WHERE key='bwhr_sync'")
        )

    async def test_corrupt_source_hash_leaves_existing_pg_unchanged(self):
        path = self.source()
        await sync_bwhr.sync_employees(path)
        before = await db.fetch_all("SELECT * FROM users ORDER BY id")
        with closing(sqlite3.connect(path)) as c:
            c.execute("UPDATE Employee SET passwordHash=?", ("$2b$04$" + "A" * 53,))
            c.commit()
        with self.assertRaises(ValueError):
            await sync_bwhr.sync_employees(path)
        self.assertEqual(await db.fetch_all("SELECT * FROM users ORDER BY id"), before)
