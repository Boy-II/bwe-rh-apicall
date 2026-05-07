"""asyncpg 連線池 + 薄 query helper。"""

import json
from typing import Any, Optional

import asyncpg

from app.core import config

_pool: Optional[asyncpg.Pool] = None


async def init_pool() -> asyncpg.Pool:
    """建立連線池（lifespan 啟動時呼叫）"""
    global _pool
    if _pool is not None:
        return _pool

    _pool = await asyncpg.create_pool(
        host=config.DB_HOST,
        port=config.DB_PORT,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        database=config.DB_DATABASE,
        min_size=1,
        max_size=10,
        command_timeout=30,
        init=_setup_codecs,
    )
    return _pool


async def _setup_codecs(conn: asyncpg.Connection) -> None:
    """JSONB 自動 encode/decode 成 dict/list"""
    await conn.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )
    await conn.set_type_codec(
        "json",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool 尚未初始化（lifespan 未啟動？）")
    return _pool


# ===== 薄 helper =====


async def fetch_one(query: str, *args) -> Optional[dict[str, Any]]:
    async with pool().acquire() as conn:
        row = await conn.fetchrow(query, *args)
        return dict(row) if row else None


async def fetch_all(query: str, *args) -> list[dict[str, Any]]:
    async with pool().acquire() as conn:
        rows = await conn.fetch(query, *args)
        return [dict(r) for r in rows]


async def fetch_val(query: str, *args) -> Any:
    async with pool().acquire() as conn:
        return await conn.fetchval(query, *args)


async def execute(query: str, *args) -> str:
    async with pool().acquire() as conn:
        return await conn.execute(query, *args)


async def execute_many(query: str, args_list: list[tuple]) -> None:
    async with pool().acquire() as conn:
        await conn.executemany(query, args_list)
