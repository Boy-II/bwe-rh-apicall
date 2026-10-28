import sqlite3
import tempfile
import unittest
from pathlib import Path

import bcrypt

from app import sync_bwhr
from app.core import security


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "bwhr.db"
        self.conn = sqlite3.connect(self.path)
        self.addCleanup(self.conn.close)
        self.conn.execute(
            "CREATE TABLE Employee (employeeId TEXT, passwordHash TEXT, name TEXT, email TEXT, division TEXT, department TEXT, unit TEXT, status TEXT)"
        )
        self.hashed = bcrypt.hashpw(b"secret123", bcrypt.gensalt(rounds=4)).decode()

    def employee(self, employee_id="00123", password=None):
        self.conn.execute(
            "INSERT INTO Employee VALUES (?,?,?,?,?,?,?,?)",
            (
                employee_id,
                password if password is not None else self.hashed,
                "測試員工",
                "test@example.test",
                "健康事業處",
                "測試部",
                "測試組",
                "ACTIVE",
            ),
        )
        self.conn.commit()

    def test_keeps_leading_zero_and_verifies_original_bcrypt(self):
        self.employee()
        rows = sync_bwhr.read_employees(self.path)
        self.assertEqual(rows[0]["employeeId"], "00123")
        self.assertTrue(security.verify_password("secret123", rows[0]["passwordHash"]))
        self.assertFalse(security.verify_password("wrong", rows[0]["passwordHash"]))

    def test_bwhr_admin_account_is_skipped(self):
        self.employee()
        self.employee(employee_id="ADMIN")
        rows = sync_bwhr.read_employees(self.path)
        self.assertEqual([r["employeeId"] for r in rows], ["00123"])

    def test_empty_source_cannot_disable_everyone(self):
        with self.assertRaises(ValueError):
            sync_bwhr.read_employees(self.path)

    def test_duplicate_identity_is_rejected(self):
        self.employee()
        self.employee()
        with self.assertRaises(ValueError):
            sync_bwhr.read_employees(self.path)

    def test_invalid_hash_is_rejected_and_null_hash_supported(self):
        self.employee(password="plain-secret")
        with self.assertRaises(ValueError):
            sync_bwhr.read_employees(self.path)
        self.conn.execute("UPDATE Employee SET passwordHash=NULL")
        self.conn.commit()
        self.assertIsNone(sync_bwhr.read_employees(self.path)[0]["passwordHash"])

    def test_source_not_mutated_and_missing_path_not_created(self):
        self.employee()
        before = self.path.read_bytes()
        sync_bwhr.read_employees(self.path)
        self.assertEqual(self.path.read_bytes(), before)
        missing = self.path.parent / "missing.db"
        with self.assertRaises((ValueError, sqlite3.Error)):
            sync_bwhr.read_employees(missing)
        self.assertFalse(missing.exists())

    def test_corrupt_bcrypt_salt_cannot_replace_a_valid_password(self):
        self.employee(password="$2b$04$" + "A" * 53)
        with self.assertRaises(ValueError):
            sync_bwhr.read_employees(self.path)

    def test_legacy_password_keeps_working(self):
        hashed = security.hash_password("old-password")
        self.assertTrue(security.verify_password("old-password", hashed))


if __name__ == "__main__":
    unittest.main()
