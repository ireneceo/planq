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
"""
import io
import logging
from typing import Optional

import aiosqlite
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from middleware.auth import get_current_user
from services.database import connect as db_connect
from services.voice_fingerprint import (
  embed_pcm16, embedding_to_blob, blob_to_embedding,
  cosine_similarity, SELF_MATCH_THRESHOLD,
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
  user: dict = Depends(get_current_user),
):
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
      '''INSERT INTO voice_fingerprints (user_id, language, embedding, sample_seconds)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, language) DO UPDATE SET
           embedding = excluded.embedding,
           sample_seconds = excluded.sample_seconds,
           updated_at = datetime('now')''',
      (user['user_id'], lang, blob, sample_seconds)
    )
    await db.commit()

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
      '''SELECT language, sample_seconds, created_at, updated_at
         FROM voice_fingerprints
         WHERE user_id = ?
         ORDER BY updated_at DESC''',
      (user['user_id'],)
    )
    rows = await cursor.fetchall()

  return success({
    'registered': len(rows) > 0,
    'count': len(rows),
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
  return success({'language': lang, 'deleted': True})


@router.delete('')
async def delete_all_fingerprints(user: dict = Depends(get_current_user)):
  async with db_connect() as db:
    await db.execute('DELETE FROM voice_fingerprints WHERE user_id = ?', (user['user_id'],))
    await db.commit()
  return success({'registered': False})


# ─────────────────────────────────────────────────────────
# Matching verification
# ─────────────────────────────────────────────────────────

@router.post('/test')
async def test_fingerprint(
  file: UploadFile = File(...),
  user: dict = Depends(get_current_user),
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

  match = best_sim >= SELF_MATCH_THRESHOLD
  return success({
    'similarity': round(best_sim, 3),
    'threshold': SELF_MATCH_THRESHOLD,
    'match': bool(match),
    'best_language': best_lang,
    'per_language': per_language,
    'message': (
      '본인으로 인식됩니다'
      if match else
      '유사도가 낮습니다 — 회의에서 사용할 언어를 추가로 등록해보세요'
    ),
  })
