"""
목소리 프로필 → 화자 자동 이름 — 공용 판정 (docs/VOICE_PROFILE_DESIGN.md)

여기 한 곳에서:
  · 동의 버전(VOICE_CONSENT_VERSION) — 다르면 매칭 후보에서 빠진다
  · 후보 집합 — Node `GET /api/internal/qnote/voice-candidates` (테넌트 경계는 Node 의 멤버십)
  · 판정 — 누구든 0.85 + 1·2위 여유폭 0.08 (env, 2026-10-05 실측). 아니면 이름을 붙이지 않는다
  · 감사 — Node `POST /api/internal/audit` (실패해도 본 작업을 막지 않는다)

라이브(마이크·화상)·업로드가 같은 `decide_speaker` 를 쓴다 — 모드마다 판정을 따로 두지 않는다.
★ Node 호출이 실패하면 후보 = 녹음자 본인만(fail-closed). 이름을 못 붙이는 것은 되돌릴 수 있고,
  남의 이름을 붙이는 것은 되돌리기 어렵다.
"""
import os
import time
import logging
from typing import Optional

import httpx
import numpy as np

from services.voice_fingerprint import blob_to_embedding, cosine_similarity

logger = logging.getLogger(__name__)

VOICE_CONSENT_VERSION = os.getenv('VOICE_CONSENT_VERSION', '2026-10')
# ★ 2026-10-05 실측(§6-1, fixtures/voice — Deepgram TTS 4목소리 × 문장 2): 같은 목소리 0.944~0.977
#   (3초 조각 0.897~0.922) · **다른 목소리 최고 0.807**(여성 둘 asteria↔luna). 설계 초기값 0.72 로는
#   등록 안 된 사람에게 비슷한 목소리의 등록자 이름이 붙는다. 갈리는 자리 0.85 로 둔다 — 애매하면 안 붙인다.
PROFILE_MATCH_THRESHOLD = float(os.getenv('QNOTE_PROFILE_MATCH_THRESHOLD', '0.85'))
PROFILE_MATCH_MARGIN = float(os.getenv('QNOTE_PROFILE_MATCH_MARGIN', '0.08'))
CANDIDATE_TTL_SEC = 600.0   # 삭제·탈퇴·끄기가 열린 회의에 10분 안에 반영된다
RETENTION_MONTHS = 24       # Irene 결정 ① — 마지막 사용 후 24개월 미사용이면 삭제(30일 전 알림)


def _node_base() -> str:
  return (
    os.environ.get('PLANQ_NODE_BASE_URL')
    or os.environ.get('PLANQ_BACKEND_URL')
    or 'http://localhost:3003'
  )


def _key() -> Optional[str]:
  return os.environ.get('INTERNAL_API_KEY')


async def fetch_candidates(business_id: int, recorder_user_id: int,
                           project_id: Optional[int] = None, client_id: Optional[int] = None) -> Optional[list]:
  """Node 후보 목록 [{user_id, kind, display_name}]. 실패 = None (호출측이 fail-closed 로 처리)."""
  key = _key()
  if not key or not business_id or not recorder_user_id:
    return None
  params = {'business_id': business_id, 'recorder_user_id': recorder_user_id}
  if project_id:
    params['project_id'] = project_id
  if client_id:
    params['client_id'] = client_id
  try:
    async with httpx.AsyncClient(timeout=3.0) as client:
      r = await client.get(f'{_node_base()}/api/internal/qnote/voice-candidates',
                           params=params, headers={'x-internal-api-key': key})
      if r.status_code == 200:
        data = (r.json() or {}).get('data')
        return data if isinstance(data, list) else None
      logger.warning(f'[voice] candidates HTTP {r.status_code}')
  except Exception as e:
    logger.warning(f'[voice] candidates failed: {e}')
  return None


async def audit(action: str, user_id: int, business_id: Optional[int] = None,
                target_type: str = 'voice_profile', target_id: Optional[int] = None,
                new_value: Optional[dict] = None) -> None:
  key = _key()
  if not key:
    return
  try:
    async with httpx.AsyncClient(timeout=3.0) as client:
      r = await client.post(f'{_node_base()}/api/internal/audit', headers={'x-internal-api-key': key}, json={
        'action': action, 'user_id': user_id, 'business_id': business_id,
        'target_type': target_type, 'target_id': target_id, 'new_value': new_value,
      })
      if r.status_code != 200:
        logger.warning(f'[voice] audit {action} HTTP {r.status_code}')
  except Exception as e:
    logger.warning(f'[voice] audit {action} failed: {e}')


async def load_profiles(db, user_ids: list[int]) -> dict[int, list[np.ndarray]]:
  """후보 user_id 의 **현재 동의 + 자동 인식 켬** 지문만. {user_id: [embedding,…]}"""
  ids = [int(u) for u in user_ids if u]
  if not ids:
    return {}
  ph = ','.join('?' for _ in ids)
  cur = await db.execute(
    f'''SELECT user_id, embedding FROM voice_fingerprints
        WHERE user_id IN ({ph}) AND match_enabled = 1 AND consent_version = ?''',
    (*ids, VOICE_CONSENT_VERSION),
  )
  out: dict[int, list[np.ndarray]] = {}
  for row in await cur.fetchall():
    out.setdefault(int(row[0]), []).append(blob_to_embedding(row[1]))
  return out


class SessionCandidates:
  """한 회의의 후보 캐시 — 시작 시 1회 + 10분마다 다시 읽는다."""

  def __init__(self, business_id: int, recorder_user_id: int,
               project_id: Optional[int] = None, client_id: Optional[int] = None,
               exclude_recorder: bool = False):
    self.business_id = business_id
    self.recorder_user_id = recorder_user_id
    self.project_id = project_id
    self.client_id = client_id
    self.exclude_recorder = exclude_recorder   # 화상회의 상대 채널 — 본인은 채널 0 이 이미 «나»
    self.people: dict[int, dict] = {}           # user_id → {kind, display_name}
    self.profiles: dict[int, list[np.ndarray]] = {}
    self.loaded_at = 0.0

  async def refresh(self, db, force: bool = False) -> None:
    if not force and self.loaded_at and time.monotonic() - self.loaded_at < CANDIDATE_TTL_SEC:
      return
    people = await fetch_candidates(self.business_id, self.recorder_user_id, self.project_id, self.client_id)
    if people is None:
      # fail-closed — 녹음자 본인만 (본인 이름은 Node 없이도 «나» 로 표시된다)
      people = [{'user_id': self.recorder_user_id, 'kind': 'user', 'display_name': None}]
    self.people = {int(p['user_id']): p for p in people if p.get('user_id')}
    if self.exclude_recorder:
      self.people.pop(int(self.recorder_user_id), None)
    self.profiles = await load_profiles(db, list(self.people.keys()))
    self.loaded_at = time.monotonic()


def decide_speaker(emb: np.ndarray, cands: SessionCandidates) -> Optional[dict]:
  """화자 임베딩 1개 → 이름을 붙일 사람 1명 또는 None.

  · 누구든 1위 ≥ PROFILE_MATCH_THRESHOLD 그리고 (1위 − 2위) ≥ PROFILE_MATCH_MARGIN 일 때만
  · 1위가 녹음자면 is_self
  ★ 본인 기준을 따로(0.62) 두지 않는다 — 실측에서 다른 사람 목소리가 0.81 까지 나왔다. 본인만 등록된
    회의라면 2위가 없어 여유폭도 못 막고, 옆자리 사람이 «나» 로 찍힌다(§6-1).
  반환 {user_id, kind, display_name, similarity, is_self} 또는 None
  """
  scores = []
  for uid, embs in cands.profiles.items():
    best = max(cosine_similarity(e, emb) for e in embs)
    scores.append((best, uid))
  if not scores:
    return None
  scores.sort(reverse=True)
  top_sim, top_uid = scores[0]
  second = scores[1][0] if len(scores) > 1 else -1.0
  person = cands.people.get(top_uid) or {}
  is_recorder = (top_uid == int(cands.recorder_user_id)) and not cands.exclude_recorder
  if top_sim >= PROFILE_MATCH_THRESHOLD and (top_sim - second) >= PROFILE_MATCH_MARGIN:
    return {'user_id': top_uid, 'kind': person.get('kind', 'user'), 'display_name': person.get('display_name'),
            'similarity': round(float(top_sim), 3), 'is_self': bool(is_recorder)}
  return None


async def apply_person(db, session_id: int, speaker_row_id: int, person: dict) -> int:
  """판정된 사람을 화자 행에 붙인다 — 라이브·회의 종료 배치가 같이 쓴다. 반환: 최종 화자 행 id.

  · 한 사람 = 한 화자: 같은 사람(본인이면 is_self 행)이 이미 다른 행에 있으면 발화를 그쪽으로 옮기고 이 행을 지운다
  · 이름이 이미 있는 행은 건드리지 않는다(UPDATE … WHERE name_source IS NULL)
  · 마지막 사용 시각 갱신(24개월 보관기간 판정)
  """
  if person['is_self']:
    cur = await db.execute(
      'SELECT id FROM speakers WHERE session_id = ? AND is_self = 1 AND id != ?', (session_id, speaker_row_id))
  else:
    cur = await db.execute(
      'SELECT id FROM speakers WHERE session_id = ? AND matched_user_id = ? AND id != ?',
      (session_id, person['user_id'], speaker_row_id))
  existing = await cur.fetchone()
  target_id = speaker_row_id
  if existing:
    target_id = existing[0]
    await db.execute('UPDATE utterances SET speaker_id = ? WHERE speaker_id = ?', (target_id, speaker_row_id))
    await db.execute('DELETE FROM speaker_embeddings WHERE speaker_id = ?', (speaker_row_id,))
    await db.execute('DELETE FROM speakers WHERE id = ?', (speaker_row_id,))
  else:
    await db.execute(
      '''UPDATE speakers SET is_self = ?, participant_name = ?, matched_user_id = ?, matched_kind = ?,
           name_source = 'voice_auto', match_similarity = ?
         WHERE id = ? AND name_source IS NULL''',
      (1 if person['is_self'] else 0,
       None if person['is_self'] else person.get('display_name'),
       person['user_id'], person.get('kind'), person['similarity'], speaker_row_id))
  if person['is_self']:
    # 내 발화는 «질문 감지» 대상이 아니다 (기존 자기 매칭과 같다)
    await db.execute(
      '''DELETE FROM detected_questions WHERE session_id = ?
           AND utterance_id IN (SELECT id FROM utterances WHERE speaker_id = ?)''', (session_id, target_id))
    await db.execute('UPDATE utterances SET is_question = 0 WHERE speaker_id = ?', (target_id,))
  await db.execute(
    "UPDATE voice_fingerprints SET last_matched_at = datetime('now'), expiry_notified_at = NULL WHERE user_id = ?",
    (person['user_id'],))
  return target_id


async def name_speakers_after_meeting(session_id: int) -> dict:
  """회의 종료(completed) 배치 — 아직 이름 없는 화자를 누적 임베딩(최대 30초)으로 한 번 더 본다 (§3-2 3차).
  화자 병합(cluster_and_merge_speakers) **뒤에** 부른다. 업로드 노트도 같은 길이다."""
  from services.database import connect as db_connect
  async with db_connect() as db:
    cur = await db.execute(
      'SELECT business_id, user_id, project_id, client_id, capture_mode FROM sessions WHERE id = ?', (session_id,))
    sess = await cur.fetchone()
    if not sess or not sess[0]:
      return {'named': 0, 'reason': 'no_session'}
    cands = SessionCandidates(sess[0], sess[1], project_id=sess[2], client_id=sess[3],
                              exclude_recorder=(sess[4] == 'web_conference'))
    await cands.refresh(db, force=True)
    if not cands.profiles:
      return {'named': 0, 'reason': 'no_profiles'}
    cur = await db.execute(
      '''SELECT s.id, se.embedding FROM speakers s JOIN speaker_embeddings se ON se.speaker_id = s.id
         WHERE s.session_id = ? AND s.name_source IS NULL AND s.is_self = 0''', (session_id,))
    rows = await cur.fetchall()
    named = []
    for sid, blob in rows:
      # 앞 행이 합쳐지며 지워졌을 수 있다
      still = await (await db.execute('SELECT name_source FROM speakers WHERE id = ?', (sid,))).fetchone()
      if not still or still[0] is not None:
        continue
      person = decide_speaker(blob_to_embedding(blob), cands)
      if person:
        tid = await apply_person(db, session_id, sid, person)
        named.append((sid, tid, person))
    await db.commit()
  for sid, tid, person in named:
    await audit('qnote.speaker.auto_named', int(sess[1]), business_id=sess[0],
                target_type='qnote_session', target_id=session_id,
                new_value={'speaker_id': tid, 'named_user_id': person['user_id'], 'similarity': person['similarity'],
                           'self': person['is_self'], 'batch': True})
  return {'named': len(named)}


def _read_segments_pcm16(path: str, segments: list[tuple[float, float]], max_sec: float = 30.0) -> Optional[bytes]:
  """파일에서 구간들만 읽어 16kHz mono PCM16 으로 잇는다(최대 max_sec). 못 읽는 형식이면 None.
  soundfile(libsndfile) — wav·flac·ogg·mp3. m4a·webm 은 ffmpeg 가 없어 못 읽는다(서버에 ffmpeg 없음)."""
  import soundfile as sf
  try:
    info = sf.info(path)
  except Exception:
    return None
  sr = info.samplerate
  out = []
  total = 0.0
  for start, end in segments:
    if total >= max_sec:
      break
    if end is None or start is None or end <= start:
      continue
    dur = min(end - start, max_sec - total)
    try:
      y, _ = sf.read(path, start=int(start * sr), frames=int(dur * sr), dtype='float32', always_2d=True)
    except Exception:
      return None
    if y.size == 0:
      continue
    mono = y.mean(axis=1)
    if sr != 16000:
      import librosa
      mono = librosa.resample(mono, orig_sr=sr, target_sr=16000)
    out.append(np.clip(mono, -1.0, 1.0))
    total += dur
  if not out:
    return None
  return (np.concatenate(out) * 32767).astype(np.int16).tobytes()


async def embed_upload_speakers(session_id: int, path: str) -> dict:
  """업로드 노트 — 원본을 지우기 **전에** 화자별 최대 30초를 읽어 화자 임베딩을 남기고 이름을 본다.
  원본 음성은 메모리에서만 다루고 임베딩만 남긴다(라이브와 같다)."""
  import asyncio
  from services.database import connect as db_connect
  from services.voice_fingerprint import embed_pcm16, embedding_to_blob
  async with db_connect() as db:
    cur = await db.execute(
      '''SELECT s.id, u.start_time, u.end_time FROM speakers s JOIN utterances u ON u.speaker_id = s.id
         WHERE s.session_id = ? ORDER BY s.id, u.start_time''', (session_id,))
    rows = await cur.fetchall()
  by_speaker: dict[int, list] = {}
  for sid, st, en in rows:
    by_speaker.setdefault(sid, []).append((st, en))
  made = 0
  for sid, segs in by_speaker.items():
    pcm = await asyncio.to_thread(_read_segments_pcm16, path, segs)
    if pcm is None:
      logger.info(f'[voice] upload session={session_id}: 이 형식은 읽을 수 없어 자동 인식을 건너뜀')
      return {'named': 0, 'reason': 'unreadable_format'}
    if len(pcm) < 16000 * 2 * 3:   # 3초 미만 — 판정하지 않는다
      continue
    try:
      emb = await embed_pcm16(pcm)
    except Exception as e:
      logger.warning(f'[voice] upload embed failed session={session_id} speaker={sid}: {e}')
      continue
    async with db_connect() as db:
      await db.execute(
        '''INSERT INTO speaker_embeddings (speaker_id, embedding, sample_seconds) VALUES (?, ?, ?)
           ON CONFLICT(speaker_id) DO UPDATE SET embedding = excluded.embedding, sample_seconds = excluded.sample_seconds''',
        (sid, embedding_to_blob(emb), len(pcm) / 32000))
      await db.commit()
    made += 1
  if not made:
    return {'named': 0, 'reason': 'no_audio'}
  return await name_speakers_after_meeting(session_id)
