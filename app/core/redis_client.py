"""Redis async client（admin token + rate limit 共用）。"""

from typing import Optional

from redis.asyncio import Redis

from app.core import config

_client: Optional[Redis] = None


async def init_client() -> Redis:
    global _client
    if _client is not None:
        return _client
    _client = Redis(
        host=config.REDIS_HOST,
        port=config.REDIS_PORT,
        password=config.REDIS_PASSWORD,
        decode_responses=True,
    )
    await _client.ping()
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def client() -> Redis:
    if _client is None:
        raise RuntimeError("Redis client 尚未初始化（lifespan 未啟動？）")
    return _client
