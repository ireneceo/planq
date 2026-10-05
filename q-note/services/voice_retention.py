"""
목소리 데이터 보관기간 (docs/VOICE_PROFILE_DESIGN.md §2-4 · Irene 결정 ①② 2026-10-05)

  ① 목소리 프로필(voice_fingerprints): 마지막 사용(last_matched_at — 없으면 등록·갱신 시각) 후 24개월 미사용이면 삭제.
     삭제 30일 전에 본인에게 한 번 알린다(expiry_notified_at). 다시 쓰이면(회의에서 인식·재등록) 알림 기록이 지워진다.
  ② 회의 화자 임베딩(speaker_embeddings): 동의 없는 상대의 파생 생체정보다. 용도는 회의 종료 병합·이름 판정뿐이라
     회의가 끝났거나 멈춘 채 **7일 동안 움직임이 없으면**(sessions.updated_at — 발화가 들어올 때마다 갱신) 상태와 무관하게 지운다.
     ★ 처음엔 status='completed' 만 봐서 일시정지·방치된 회의의 임베딩이 영구히 남았다(Fable F-2 — 처리방침 문구와 어긋남).
     7일 뒤 이어서 녹음하면 종료 병합·자동 이름만 그 전 조각을 못 쓴다. 화자 행(이름)과 회의록은 남는다.

개인정보처리방침(legal.json privacy s1·s4)이 이 숫자를 그대로 말한다 — 바꾸면 문구도 같이 바꾼다.
하루 두 번(12시간) 돈다. 서버가 재시작되면 1분 뒤 한 번.
"""
import asyncio
import logging

from services.database import connect as db_connect
from services.voice_profile import RETENTION_MONTHS, audit, _node_base, _key

import httpx

logger = logging.getLogger(__name__)

NOTICE_DAYS = 30
SPEAKER_EMBEDDING_DAYS = 7
INTERVAL_SEC = 12 * 3600


def _last_used_expr() -> str:
  return "COALESCE(last_matched_at, updated_at, created_at)"


async def _send_notice(user_id: int) -> bool:
  key = _key()
  if not key:
    return False
  try:
    async with httpx.AsyncClient(timeout=5.0) as client:
      r = await client.post(f'{_node_base()}/api/internal/qnote/voice-expiry-notice',
                            headers={'x-internal-api-key': key},
                            json={'user_id': user_id, 'days': NOTICE_DAYS})
      return r.status_code == 200
  except Exception as e:
    logger.warning(f'[voice-retention] notice failed user={user_id}: {e}')
    return False


async def run_once() -> dict:
  months = int(RETENTION_MONTHS)
  out = {'expired_users': 0, 'noticed_users': 0, 'speaker_embeddings_deleted': 0}
  async with db_connect() as db:
    # ① 만료 — 사람 단위(그 사람의 모든 언어 행 중 **가장 최근 사용**이 기준)
    cur = await db.execute(
      f'''SELECT user_id FROM voice_fingerprints GROUP BY user_id
          HAVING MAX({_last_used_expr()}) < datetime('now', ?)''', (f'-{months} months',))
    expired = [r[0] for r in await cur.fetchall()]
    for uid in expired:
      await db.execute('DELETE FROM voice_fingerprints WHERE user_id = ?', (uid,))
    # 30일 전 알림 — 아직 안 알린 사람만
    cur = await db.execute(
      f'''SELECT user_id FROM voice_fingerprints GROUP BY user_id
          HAVING MAX({_last_used_expr()}) < datetime('now', ?, ?)
             AND MAX(expiry_notified_at) IS NULL''',
      (f'-{months} months', f'+{NOTICE_DAYS} days'))
    to_notice = [r[0] for r in await cur.fetchall()]
    # ② 회의 화자 임베딩 — 7일 동안 움직임이 없는 회의(끝났든 멈췄든)
    cur = await db.execute(
      '''DELETE FROM speaker_embeddings WHERE speaker_id IN (
           SELECT sp.id FROM speakers sp JOIN sessions s ON s.id = sp.session_id
           WHERE s.updated_at < datetime('now', ?))''',
      (f'-{SPEAKER_EMBEDDING_DAYS} days',))
    out['speaker_embeddings_deleted'] = cur.rowcount or 0
    await db.commit()
  for uid in expired:
    await audit('voice_profile.expire', uid, new_value={'reason': f'unused_{months}_months'})
  out['expired_users'] = len(expired)
  for uid in to_notice:
    if await _send_notice(uid):
      async with db_connect() as db:
        await db.execute("UPDATE voice_fingerprints SET expiry_notified_at = datetime('now') WHERE user_id = ?", (uid,))
        await db.commit()
      out['noticed_users'] += 1
  if any(out.values()):
    logger.info(f'[voice-retention] {out}')
  return out


async def loop() -> None:
  await asyncio.sleep(60)
  while True:
    try:
      await run_once()
    except Exception as e:
      logger.warning(f'[voice-retention] run failed: {e}')
    await asyncio.sleep(INTERVAL_SEC)
