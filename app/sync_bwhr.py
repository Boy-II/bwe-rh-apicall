"""Read-only BWHR SQLite snapshot → atomic PostgreSQL employee sync.

Run: python -m app.sync_bwhr --sqlite-path /safe/snapshot.db [--dry-run]
Only connects to the configured RHAPI PostgreSQL. Never logs employee records.
"""

from contextlib import closing
import argparse
import asyncio
import json
import re
import sqlite3
from pathlib import Path

from app.core import db

_COLUMNS = (
    "employeeId",
    "passwordHash",
    "name",
    "email",
    "division",
    "department",
    "unit",
    "status",
)
_BCRYPT_ALPHABET = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
_BCRYPT = re.compile(r"^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$")


def read_employees(path: str | Path) -> list[dict]:
    path = Path(path).resolve()
    if not path.is_file():
        raise ValueError("SQLite 來源不存在")
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA query_only=ON")
        rows = [
            dict(r)
            for r in conn.execute(
                "SELECT " + ",".join(f'"{c}"' for c in _COLUMNS) + ' FROM "Employee"'
            )
        ]
    # BWHR's own ADMIN account is reserved here; skip it rather than abort the sync.
    rows = [
        r
        for r in rows
        if not (isinstance(r["employeeId"], str) and r["employeeId"].lower() == "admin")
    ]
    if not rows:
        raise ValueError("來源無員工，已中止以避免停用所有帳號")
    seen = set()
    for row in rows:
        eid = row["employeeId"]
        if (
            not isinstance(eid, str)
            or not eid.strip()
            or eid != eid.strip()
            or eid in seen
            or eid.lower() == "admin"
        ):
            raise ValueError("來源包含無效、保留或重複員編")
        seen.add(eid)
        if row["status"] not in ("ACTIVE", "INACTIVE"):
            raise ValueError("來源員工狀態無效")
        hashed = row["passwordHash"]
        if hashed is not None and (
            not isinstance(hashed, str)
            or not _BCRYPT.fullmatch(hashed)
            or not 4 <= int(hashed[4:6]) <= 16
            or _BCRYPT_ALPHABET.index(hashed[28]) % 16 != 0
            or _BCRYPT_ALPHABET.index(hashed[-1]) % 4 != 0
        ):
            raise ValueError("來源包含不支援的密碼雜湊")
        if any(
            not isinstance(row[c], str)
            for c in ("name", "email", "division", "department", "unit")
        ):
            raise ValueError("來源個人/組織欄位格式無效")
    return rows


async def sync_employees(path: str | Path, dry_run: bool = False) -> dict:
    # Read and validate the entire source before any PostgreSQL mutation.
    rows = await asyncio.to_thread(read_employees, path)
    ids = [r["employeeId"] for r in rows]
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            # Serialize sync jobs; a partial concurrent snapshot cannot undo a new one.
            await conn.execute("SELECT pg_advisory_xact_lock(280102026)")
            conflict = await conn.fetchval(
                "SELECT COUNT(*) FROM users WHERE username=ANY($1::text[]) AND (auth_source<>'bwhr' OR employee_id IS DISTINCT FROM username)",
                ids,
            )
            if conflict:
                raise ValueError(
                    f"有 {conflict} 個員編與既有帳號衝突；請先由管理員處理身分對應，未寫入任何資料"
                )
            existing = await conn.fetch(
                "SELECT employee_id FROM users WHERE auth_source='bwhr'"
            )
            old_ids = {r["employee_id"] for r in existing}
            result = {
                "sourceCount": len(rows),
                "created": len(set(ids) - old_ids),
                "updated": len(set(ids) & old_ids),
                "missing": len(old_ids - set(ids)),
                "dryRun": dry_run,
            }
            if dry_run:
                return result
            for r in rows:
                await conn.execute(
                    """
                    INSERT INTO users (id,username,password_hash,status,role,auth_source,employee_id,name,email,division,department,unit,source_status,synced_at)
                    VALUES ($1,$2,$3,'approved','user','bwhr',$2,$4,$5,$6,$7,$8,$9,NOW())
                    ON CONFLICT (employee_id) DO UPDATE SET
                        username=EXCLUDED.username, password_hash=EXCLUDED.password_hash,
                        name=EXCLUDED.name,email=EXCLUDED.email,division=EXCLUDED.division,
                        department=EXCLUDED.department,unit=EXCLUDED.unit,
                        source_status=EXCLUDED.source_status,synced_at=NOW(),updated_at=NOW(),
                        session_version=users.session_version + CASE WHEN
                            users.password_hash IS DISTINCT FROM EXCLUDED.password_hash OR
                            users.source_status IS DISTINCT FROM EXCLUDED.source_status THEN 1 ELSE 0 END
                """,
                    "bwhr:" + r["employeeId"],
                    r["employeeId"],
                    r["passwordHash"] or "",
                    r["name"],
                    r["email"],
                    r["division"],
                    r["department"],
                    r["unit"],
                    r["status"],
                )
            await conn.execute(
                """UPDATE users SET source_status='INACTIVE',session_version=session_version+1,updated_at=NOW(),synced_at=NOW()
                WHERE auth_source='bwhr' AND NOT(employee_id=ANY($1::text[])) AND source_status<>'INACTIVE' """,
                ids,
            )
            await conn.execute(
                """INSERT INTO settings(key,value,updated_at) VALUES ('bwhr_sync', $1::jsonb, NOW())
                ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()""",
                result,
            )
            return result


async def _main(args):
    await db.init_pool()
    try:
        # Migrations must be explicitly applied first; dry-run never mutates schema.
        print(
            json.dumps(
                await sync_employees(args.sqlite_path, args.dry_run), ensure_ascii=False
            )
        )
    finally:
        await db.close_pool()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite-path", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        asyncio.run(_main(args))
    except (ValueError, sqlite3.Error) as e:
        parser.exit(2, f"匯入中止：{e}\n")
