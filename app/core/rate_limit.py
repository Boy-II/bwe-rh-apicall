"""Redis sliding-window rate limiter。

用法：
    @router.post("/something", dependencies=[Depends(rate_limit("chat", 10, 60))])

或在 endpoint 內部呼叫：
    await check_rate_limit(user_id, "chat", 10, 60)
"""

import time

from fastapi import HTTPException, Request, Depends

from app.core import redis_client
from app.core.auth import require_user


async def check_rate_limit(
    identifier: str, bucket: str, limit: int, window_seconds: int
) -> None:
    """超過限制就丟 429。

    用 Redis sorted set 實作 sliding window：
    - score / value 都用 timestamp（亂數 suffix 避重）
    - 每次請求：移除過期成員 → 計數 → 不超就加入
    """
    now = time.time()
    key = f"ratelimit:{bucket}:{identifier}"
    window_start = now - window_seconds

    redis = redis_client.client()
    pipe = redis.pipeline()
    pipe.zremrangebyscore(key, 0, window_start)
    pipe.zcard(key)
    pipe.zadd(key, {f"{now}:{int(now * 1000) % 100000}": now})
    pipe.expire(key, window_seconds + 5)
    _, current_count, _, _ = await pipe.execute()

    if current_count >= limit:
        retry_after = max(1, int(window_seconds))
        raise HTTPException(
            status_code=429,
            detail=f"請求過於頻繁，請 {retry_after} 秒後再試",
            headers={"Retry-After": str(retry_after)},
        )


def rate_limit(bucket: str, limit: int, window_seconds: int):
    """FastAPI dependency factory：以 user_id 為 key。"""

    async def _dep(
        request: Request,
        user_id: str = Depends(require_user),
    ) -> None:
        await check_rate_limit(user_id, bucket, limit, window_seconds)

    return _dep
