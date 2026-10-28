"""Ephemeral PostgreSQL fixture; never uses application environment credentials."""

import os
import subprocess
import tempfile
from pathlib import Path

import asyncpg

from app.core import db
from app.migrations.runner import apply_migrations


class PostgresMixin:
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.pg_bin = Path(
            os.environ.get("TEST_PG_BIN", "/opt/homebrew/opt/postgresql@17/bin")
        )
        if not (cls.pg_bin / "initdb").exists():
            import unittest

            raise unittest.SkipTest(
                "Set TEST_PG_BIN to PostgreSQL binaries to run integration tests"
            )
        cls.pg_tmp = tempfile.TemporaryDirectory(prefix="rhapi-pg-test-")
        root = Path(cls.pg_tmp.name)
        cls.pg_data = root / "data"
        cls.pg_socket = root / "socket"
        cls.pg_socket.mkdir()
        subprocess.run(
            [
                str(cls.pg_bin / "initdb"),
                "-D",
                str(cls.pg_data),
                "-A",
                "trust",
                "-U",
                "rhapi_test",
                "--no-locale",
                "-E",
                "UTF8",
            ],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                str(cls.pg_bin / "pg_ctl"),
                "-D",
                str(cls.pg_data),
                "-l",
                str(root / "server.log"),
                "-o",
                f'-h "" -k {cls.pg_socket} -p 55487',
                "-w",
                "start",
            ],
            check=True,
            capture_output=True,
        )

    @classmethod
    def tearDownClass(cls):
        subprocess.run(
            [
                str(cls.pg_bin / "pg_ctl"),
                "-D",
                str(cls.pg_data),
                "-m",
                "immediate",
                "-w",
                "stop",
            ],
            capture_output=True,
        )
        cls.pg_tmp.cleanup()
        super().tearDownClass()

    async def asyncSetUp(self):
        db._pool = await asyncpg.create_pool(
            host=str(self.pg_socket),
            port=55487,
            user="rhapi_test",
            database="postgres",
            min_size=1,
            max_size=3,
            init=db._setup_codecs,
        )
        await db.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
        await apply_migrations()

    async def asyncTearDown(self):
        await db.close_pool()
