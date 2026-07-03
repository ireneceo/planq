"""
비용폭탄 방어 — q-note per-user rate-limit (in-memory).

Node `dev-backend/middleware/costGuard.js` 의 perUserDaily 를 미러링. q-note 에는 slowapi 등
rate-limit 인프라가 없어 경량 인메모리 고정 윈도우 카운터로 구현.

전제: 단일 uvicorn 프로세스 (routers/live.py 의 _active_live_streams 와 동일 가정).
  멀티 워커로 확장 시 Redis 등 공유 저장소로 교체 필요.

키: user_id (JWT payload 의 userId). q-note JWT 는 user_id 만 신뢰 가능(role/business_id claim 없음).

사용:
  from services.rate_limit import rate_limit
  @router.post('/x', dependencies=[Depends(rate_limit('qnote-x', per_min=10, per_day=100))])
  또는 핸들러 시그니처에 `_rl: None = Depends(rate_limit(...))` 로 주입.
"""
import time
from typing import Optional

from fastapi import Depends, HTTPException

from middleware.auth import get_current_user

# name -> user_id -> [window_start_monotonic, count]
_buckets: dict[str, dict[int, list]] = {}

# 비활성 사용자 엔트리 누수 방지 — 버킷 크기가 이 값을 넘으면 만료 엔트리 opportunistic prune.
_PRUNE_THRESHOLD = 2000


def _prune(bucket: dict[int, list], window_sec: float, now: float) -> None:
    stale = [uid for uid, rec in bucket.items() if now - rec[0] >= window_sec]
    for uid in stale:
        bucket.pop(uid, None)


def _hit(name: str, uid: int, window_sec: float, max_count: int) -> bool:
    """고정 윈도우 카운터. 허용이면 True(카운트 증가), 초과면 False."""
    now = time.monotonic()
    bucket = _buckets.setdefault(name, {})
    if len(bucket) > _PRUNE_THRESHOLD:
        _prune(bucket, window_sec, now)
    rec = bucket.get(uid)
    if rec is None or now - rec[0] >= window_sec:
        bucket[uid] = [now, 1]
        return True
    if rec[1] >= max_count:
        return False
    rec[1] += 1
    return True


def rate_limit(name: str, per_min: Optional[int] = None, per_day: Optional[int] = None):
    """per-user 분당 + 일당 이중 윈도우 rate-limit FastAPI 의존성.
    초과 시 429. costGuard.perUserDaily 와 동일 시맨틱(둘 다 통과해야 함)."""
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        uid = int(user['user_id'])
        if per_min and not _hit(f'{name}-m', uid, 60.0, per_min):
            raise HTTPException(status_code=429, detail='rate_limited')
        if per_day and not _hit(f'{name}-d', uid, 86400.0, per_day):
            raise HTTPException(status_code=429, detail='rate_limited_daily')
        return user
    return dep
