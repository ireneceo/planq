"""
다국어 음성 핑거프린트 등록 / 삭제 / 조회 / 매칭 확인.

사용자는 자신이 회의에서 사용할 언어마다 각각 한 번씩 낭독해 등록한다.
라이브 매칭 시 저장된 모든 임베딩과 비교해 max(similarity) 를 사용.
(Resemblyzer 는 영어 편향이 있어 cross-language 시 유사도가 떨어지는 경향이 있음)

Endpoints:
  GET    /api/voice-fingerprint            — 등록된 언어 목록 + 메타
  POST   /api/voice-fingerprint            — form: file + language (upsert)
  DELETE /api/voice-fingerprint/:language  — 특정 언어 삭제
  DELETE /api/voice-fingerprint            — 전체 삭제
  POST   /api/voice-fingerprint/test       — form: file → 최고 유사도 + 매칭 여부
  PATCH  /api/voice-fingerprint/settings   — {match_enabled} 회의 자동 인식 켜기/끄기

2026-10-05 목소리 프로필(docs/VOICE_PROFILE_DESIGN.md §2) — 생체정보라 **본인이 동의해야만** 저장한다.
  등록 폼에 consent_version 이 현재 버전과 같아야 한다(아니면 400 consent_required — 행 0).
  원본 음성은 메모리에서 임베딩만 만들고 버린다(_decode_audio_to_pcm16 → embed_pcm16).
"""
import io
import logging
from typing import Optional

import aiosqlite
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Header, Request

from middleware.auth import get_current_user
from services.database import connect as db_connect
from services.rate_limit import rate_limit
from services.voice_profile import VOICE_CONSENT_VERSION, RETENTION_MONTHS, PROFILE_MATCH_THRESHOLD, audit as voice_audit
from services.voice_fingerprint import (
  embed_pcm16, embedding_to_blob, blob_to_embedding,
  cosine_similarity,
)

router = APIRouter(prefix='/api/voice-fingerprint', tags=['voice-fingerprint'])
logger = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 5 * 1024 * 1024
MIN_SECONDS = 5.0
MAX_SECONDS = 45.0  # 사용자 속도 편차 수용 (문장 완주 후 수동 종료)


def success(data=None, **kwargs):
  res = {'success': True}
  if data is not None:
    res['data'] = data
  res.update(kwargs)
  return res


def _decode_audio_to_pcm16(body: bytes, mime: Optional[str], min_sec: float = MIN_SECONDS) -> bytes:
  import librosa
  try:
    y, sr = librosa.load(io.BytesIO(body), sr=16000, mono=True)
  except Exception as e:
    raise HTTPException(status_code=400, detail=f'오디오 디코딩 실패: {type(e).__name__}')
  if y.size == 0:
    raise HTTPException(status_code=400, detail='빈 오디오 파일')
  duration = y.size / 16000
  if duration < min_sec:
    raise HTTPException(status_code=400, detail=f'오디오가 너무 짧습니다 (최소 {min_sec:.0f}초)')
  if duration > MAX_SECONDS:
    raise HTTPException(status_code=400, detail=f'오디오가 너무 깁니다 (최대 {MAX_SECONDS:.0f}초)')
  y_clip = np.clip(y, -1.0, 1.0)
  pcm = (y_clip * 32767).astype(np.int16).tobytes()
  return pcm


def _validate_language_code(code: str) -> str:
  """ISO 639-1 (2자) 또는 ISO 639-1 + 지역 코드 허용. 'unknown' 도 레거시로 허용."""
  if not code:
    raise HTTPException(status_code=400, detail='language 파라미터가 필요합니다')
  code = code.strip().lower()
  if code == 'unknown':
    return code
  import re as _re
  if not _re.match(r'^[a-z]{2}(-[a-z]{2})?$', code):
    raise HTTPException(status_code=400, detail=f'잘못된 language 코드: {code}')
  return code


# ─────────────────────────────────────────────────────────
# Registration
# ─────────────────────────────────────────────────────────

@router.post('')
async def register_fingerprint(
  language: str = Form(...),
  file: UploadFile = File(...),
  consent_version: Optional[str] = Form(None),
  user: dict = Depends(rate_limit('voice-register', per_min=3, per_day=10)),
):
  # ★ 동의가 먼저다 — 파일을 읽기도 전에 거른다(동의 없는 생체정보는 메모리에도 올리지 않는다)
  if (consent_version or '').strip() != VOICE_CONSENT_VERSION:
    raise HTTPException(status_code=400, detail='consent_required')
  lang = _validate_language_code(language)
  content = await file.read()
  if len(content) == 0:
    raise HTTPException(status_code=400, detail='빈 파일')
  if len(content) > MAX_AUDIO_BYTES:
    raise HTTPException(status_code=400, detail=f'파일이 너무 큽니다 ({MAX_AUDIO_BYTES // (1024*1024)}MB 초과)')

  pcm = _decode_audio_to_pcm16(content, file.content_type)
  sample_seconds = (len(pcm) / 2) / 16000

  try:
    emb = await embed_pcm16(pcm)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))
  except Exception as e:
    logger.exception('embed_pcm16 failed')
    raise HTTPException(status_code=500, detail=f'임베딩 계산 실패: {type(e).__name__}')

  blob = embedding_to_blob(emb)

  async with db_connect() as db:
    await db.execute(
      '''INSERT INTO voice_fingerprints (user_id, language, embedding, sample_seconds, consent_version, consent_at, last_matched_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(user_id, language) DO UPDATE SET
           embedding = excluded.embedding,
           sample_seconds = excluded.sample_seconds,
           consent_version = excluded.consent_version,
           consent_at = excluded.consent_at,
           last_matched_at = excluded.last_matched_at,
           expiry_notified_at = NULL,
           updated_at = datetime('now')''',
      (user['user_id'], lang, blob, sample_seconds, VOICE_CONSENT_VERSION)
    )
    # 동의는 사람 단위다 — 같은 사람의 다른 언어 행도 같은 동의 버전으로 맞춘다(재동의 한 번이면 전부 살아난다)
    await db.execute(
      "UPDATE voice_fingerprints SET consent_version = ?, consent_at = datetime('now') WHERE user_id = ?",
      (VOICE_CONSENT_VERSION, user['user_id'])
    )
    await db.commit()
  await voice_audit('voice_profile.register', user['user_id'],
                    new_value={'language': lang, 'consent_version': VOICE_CONSENT_VERSION})

  return success({
    'language': lang,
    'sample_seconds': round(sample_seconds, 2),
  })


@router.get('')
async def list_fingerprints(user: dict = Depends(get_current_user)):
  """등록된 언어 목록 반환 (임베딩 벡터는 노출하지 않음)."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      '''SELECT language, sample_seconds, created_at, updated_at, consent_version, consent_at, match_enabled
         FROM voice_fingerprints
         WHERE user_id = ?
         ORDER BY updated_at DESC''',
      (user['user_id'],)
    )
    rows = await cursor.fetchall()

  match_enabled = all(int(r['match_enabled'] if r['match_enabled'] is not None else 1) == 1 for r in rows) if rows else True
  consent_current = bool(rows) and all(r['consent_version'] == VOICE_CONSENT_VERSION for r in rows)
  return success({
    'registered': len(rows) > 0,
    'count': len(rows),
    'consent_version_required': VOICE_CONSENT_VERSION,
    'consent_current': consent_current,
    'consent_at': max((r['consent_at'] or '' for r in rows), default='') or None,
    'match_enabled': match_enabled,
    'retention_months': RETENTION_MONTHS,
    'languages': [
      {
        'language': r['language'],
        'sample_seconds': r['sample_seconds'],
        'created_at': r['created_at'],
        'updated_at': r['updated_at'],
      }
      for r in rows
    ],
  })


@router.delete('/{language}')
async def delete_fingerprint_language(
  language: str,
  user: dict = Depends(get_current_user),
):
  lang = _validate_language_code(language)
  async with db_connect() as db:
    cursor = await db.execute(
      'DELETE FROM voice_fingerprints WHERE user_id = ? AND language = ?',
      (user['user_id'], lang)
    )
    await db.commit()
    if cursor.rowcount == 0:
      raise HTTPException(status_code=404, detail='해당 언어의 등록이 없습니다')
  await voice_audit('voice_profile.delete', user['user_id'], new_value={'language': lang})
  return success({'language': lang, 'deleted': True})


@router.delete('')
async def delete_all_fingerprints(user: dict = Depends(get_current_user)):
  async with db_connect() as db:
    await db.execute('DELETE FROM voice_fingerprints WHERE user_id = ?', (user['user_id'],))
    await db.commit()
  await voice_audit('voice_profile.delete', user['user_id'], new_value={'language': 'all'})
  return success({'registered': False})


@router.patch('/settings')
async def update_settings(
  body: dict,
  user: dict = Depends(get_current_user),
):
  """회의 자동 인식 켜기/끄기 — 등록은 그대로 두고 매칭만 멈춘다."""
  if not isinstance(body, dict) or not isinstance(body.get('match_enabled'), bool):
    raise HTTPException(status_code=400, detail='match_enabled(bool) 이 필요합니다')
  enabled = 1 if body['match_enabled'] else 0
  async with db_connect() as db:
    cur = await db.execute('UPDATE voice_fingerprints SET match_enabled = ? WHERE user_id = ?', (enabled, user['user_id']))
    await db.commit()
    if cur.rowcount == 0:
      raise HTTPException(status_code=404, detail='등록된 목소리가 없습니다')
  await voice_audit('voice_profile.settings', user['user_id'], new_value={'match_enabled': bool(enabled)})
  return success({'match_enabled': bool(enabled)})


# ─────────────────────────────────────────────────────────
# Matching verification
# ─────────────────────────────────────────────────────────

@router.post('/test')
async def test_fingerprint(
  file: UploadFile = File(...),
  user: dict = Depends(rate_limit('voice-test', per_min=5, per_day=20)),
):
  """
  저장된 모든 언어의 핑거프린트와 유사도를 비교해 **최고값** 을 반환.
  어느 언어에서 가장 잘 매칭되는지도 함께 제공 → 사용자가 어떤 언어 등록이
  더 필요한지 판단할 수 있게 한다.
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      'SELECT language, embedding FROM voice_fingerprints WHERE user_id = ?',
      (user['user_id'],)
    )
    rows = await cursor.fetchall()
  if not rows:
    raise HTTPException(status_code=404, detail='등록된 음성 핑거프린트가 없습니다')

  content = await file.read()
  if not content:
    raise HTTPException(status_code=400, detail='빈 파일')
  if len(content) > MAX_AUDIO_BYTES:
    raise HTTPException(status_code=400, detail='파일이 너무 큽니다')

  pcm = _decode_audio_to_pcm16(content, file.content_type, min_sec=3.0)
  try:
    test_emb = await embed_pcm16(pcm)
  except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))

  per_language = []
  best_sim = -1.0
  best_lang = None
  for r in rows:
    stored = blob_to_embedding(r['embedding'])
    sim = float(cosine_similarity(stored, test_emb))
    per_language.append({'language': r['language'], 'similarity': round(sim, 3)})
    if sim > best_sim:
      best_sim = sim
      best_lang = r['language']

  # 회의에서 쓰는 기준과 같은 값 — 여기서만 관대하면 «인식됩니다» 가 회의에서 거짓이 된다
  match = best_sim >= PROFILE_MATCH_THRESHOLD
  return success({
    'similarity': round(best_sim, 3),
    'threshold': PROFILE_MATCH_THRESHOLD,
    'match': bool(match),
    'best_language': best_lang,
    'per_language': per_language,
    'message': (
      '본인으로 인식됩니다'
      if match else
      '유사도가 낮습니다 — 회의에서 사용할 언어를 추가로 등록해보세요'
    ),
  })


# ─── 내부: 개인정보 내보내기용 메타 (VOICE_PROFILE_DESIGN §2-3) ───
#   임베딩 바이트는 내보내지 않는다 — 사용자에게 의미가 없고(복원 불가 숫자) 유출 표면만 넓힌다.
@router.get('/internal/meta')
async def internal_voice_meta(
  request: Request,
  user_id: int,
  x_internal_api_key: Optional[str] = Header(None),
):
  import os
  # 같은 서버(Node)만 부른다 — nginx /qnote/ 로 바깥에서 닿아도 키 한 겹에만 기대지 않는다 (Fable F-4)
  if not request.client or request.client.host not in ('127.0.0.1', '::1'):
    raise HTTPException(status_code=404, detail='not found')
  expected = os.environ.get('INTERNAL_API_KEY')
  if not expected or x_internal_api_key != expected:
    raise HTTPException(status_code=401, detail='invalid internal key')
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cur = await db.execute(
      '''SELECT language, sample_seconds, consent_version, consent_at, match_enabled, last_matched_at, created_at, updated_at
         FROM voice_fingerprints WHERE user_id = ? ORDER BY language''', (int(user_id),))
    rows = await cur.fetchall()
  return success({
    'registered': bool(rows),
    'languages': [dict(r) for r in rows],
    'note': 'embedding values are not exported',
  })
