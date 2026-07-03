# Q Note STT 과금 클라이언트 — Node internal API 경유 (공유시크릿 x-internal-api-key).
#   설계: docs/QNOTE_STT_BILLING_DESIGN.md §3
#   판정 tri-state: True/False = Node 정의적 응답, None = 미도달/시크릿 미설정 → 호출측 fail-open.
#   (Node down 은 앱 전체 장애 + flush 도 실패해 과금 자체가 안 됨 → 진입 fail-open 이 안전.
#    1차 방어는 create_session 시점 멤버십 검증, /ws/live 는 옛 세션 대비 재검증.)
import os
import asyncio
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# linear16 / 16000Hz / 2bytes = 32000 bytes/s/channel (deepgram_service.py 와 일치)
BYTES_PER_SEC_PER_CHANNEL = 32000


def _node_base() -> str:
  return (
    os.environ.get('PLANQ_NODE_BASE_URL')
    or os.environ.get('PLANQ_BACKEND_URL')
    or 'http://localhost:3003'
  )


def _key() -> Optional[str]:
  return os.environ.get('INTERNAL_API_KEY')


def billed_seconds(delta_bytes: int, is_stereo: bool) -> float:
  """벽시계 초 × 채널수 = billed 초. Deepgram 은 채널별 과금 → stereo(웹회의)는 벽시계 ×2.
  결과적으로 mono·stereo 모두 delta_bytes/32000 이지만 채널 팩터를 명시해 자기문서화."""
  channels = 2 if is_stereo else 1
  wall = delta_bytes / (BYTES_PER_SEC_PER_CHANNEL * channels)
  return wall * channels


async def check_membership(user_id: int, business_id: int) -> Optional[bool]:
  key = _key()
  if not key:
    return None
  try:
    async with httpx.AsyncClient(timeout=2.0) as client:
      r = await client.get(
        f'{_node_base()}/api/internal/business-membership/{user_id}/{business_id}',
        headers={'x-internal-api-key': key},
      )
      if r.status_code == 200:
        d = (r.json() or {}).get('data') or {}
        return bool(d.get('member'))
  except Exception as e:
    logger.warning(f'[billing] membership check failed: {e}')
  return None


async def check_quota(business_id: int, seconds: int = 1) -> Optional[dict]:
  key = _key()
  if not key:
    return None
  try:
    async with httpx.AsyncClient(timeout=2.0) as client:
      r = await client.get(
        f'{_node_base()}/api/internal/qnote/can',
        params={'business_id': business_id, 'seconds': seconds},
        headers={'x-internal-api-key': key},
      )
      if r.status_code == 200:
        return (r.json() or {}).get('data') or {}
  except Exception as e:
    logger.warning(f'[billing] quota check failed: {e}')
  return None


async def record_usage(stream_id: str, segment_seq: int, session_id: int,
                       business_id: int, user_id: int, seconds: int, is_stereo: bool) -> bool:
  """usage 세그먼트 기록. 재시도 3회. 성공 True / 최종실패 False (호출측이 롤포워드).
     시크릿 미설정(로컬)이면 no-op True."""
  key = _key()
  if not key:
    return True
  payload = {
    'stream_id': stream_id, 'segment_seq': segment_seq, 'session_id': session_id,
    'business_id': business_id, 'user_id': user_id, 'seconds': seconds, 'is_stereo': bool(is_stereo),
  }
  for attempt in range(3):
    try:
      async with httpx.AsyncClient(timeout=3.0) as client:
        r = await client.post(
          f'{_node_base()}/api/internal/qnote/usage',
          json=payload, headers={'x-internal-api-key': key},
        )
        if r.status_code == 200:
          return True
        logger.warning(f'[billing] usage POST status={r.status_code} seq={segment_seq}')
    except Exception as e:
      logger.warning(f'[billing] usage POST error seq={segment_seq}: {e}')
    await asyncio.sleep(0.2 * (attempt + 1))
  return False


async def alert_flush_failure(user_id: int, business_id: int, message: str) -> None:
  key = _key()
  if not key:
    return
  try:
    async with httpx.AsyncClient(timeout=3.0) as client:
      await client.post(
        f'{_node_base()}/api/internal/qnote/alert',
        json={'user_id': user_id, 'business_id': business_id, 'message': message},
        headers={'x-internal-api-key': key},
      )
  except Exception:
    pass
