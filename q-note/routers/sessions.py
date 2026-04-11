import asyncio
import json
import os
import socket
import uuid
import ipaddress
from typing import Optional, List
from urllib.parse import urlparse

import io
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel, Field

from middleware.auth import get_current_user
from services.database import DB_PATH, connect as db_connect
from services.ingest import ingest_document, log_task_exception
from services.speaker_clustering import cluster_and_merge_speakers
from services.voice_fingerprint import (
  embed_pcm16, blob_to_embedding, cosine_similarity, SELF_MATCH_THRESHOLD,
)

router = APIRouter(prefix='/api/sessions', tags=['sessions'])

UPLOADS_ROOT = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'uploads')
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file
MAX_URL_LIST = 20
MAX_PARTICIPANTS = 50
MAX_BRIEF_LEN = 5000
MAX_PASTED_CONTEXT_LEN = 100_000

ALLOWED_EXTENSIONS = {
  'pdf', 'doc', 'docx', 'txt', 'md', 'ppt', 'pptx', 'xls', 'xlsx', 'csv',
}

# NOTE: 'urls' 컬럼은 deprecated — 이제 documents 테이블(source_type='url')이 source of truth
JSON_COLUMNS = {'participants', 'meeting_languages'}


# ─────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────

class Participant(BaseModel):
  name: str = Field(..., min_length=1, max_length=100)
  role: Optional[str] = Field(None, max_length=200)


CAPTURE_MODES = {'microphone', 'web_conference'}


class CreateSessionRequest(BaseModel):
  business_id: int
  title: Optional[str] = 'Untitled Session'
  brief: Optional[str] = None
  participants: Optional[List[Participant]] = None
  meeting_languages: Optional[List[str]] = None
  translation_language: Optional[str] = None
  answer_language: Optional[str] = None
  pasted_context: Optional[str] = None
  capture_mode: Optional[str] = None


class UpdateSessionRequest(BaseModel):
  title: Optional[str] = None
  status: Optional[str] = None
  brief: Optional[str] = None
  participants: Optional[List[Participant]] = None
  meeting_languages: Optional[List[str]] = None
  translation_language: Optional[str] = None
  answer_language: Optional[str] = None
  pasted_context: Optional[str] = None
  capture_mode: Optional[str] = None


class AddUrlRequest(BaseModel):
  url: str = Field(..., max_length=2000)


class MatchSpeakerRequest(BaseModel):
  participant_name: Optional[str] = Field(None, max_length=100)
  is_self: Optional[bool] = None


# ─────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────

def success(data=None, **kwargs):
  res = {'success': True}
  if data is not None:
    res['data'] = data
  res.update(kwargs)
  return res


def _deserialize_session(row: aiosqlite.Row) -> dict:
  data = dict(row)
  for col in JSON_COLUMNS:
    raw = data.get(col)
    if raw:
      try:
        data[col] = json.loads(raw)
      except (TypeError, ValueError):
        data[col] = None
    else:
      data[col] = None
  # 'urls' 컬럼은 deprecated — 응답에서 제거 (프론트는 documents[source_type='url']을 사용)
  data.pop('urls', None)
  return data


def _validate_brief(brief: Optional[str]) -> None:
  if brief is not None and len(brief) > MAX_BRIEF_LEN:
    raise HTTPException(status_code=400, detail=f'brief too long (max {MAX_BRIEF_LEN})')


def _validate_pasted_context(text: Optional[str]) -> None:
  if text is not None and len(text) > MAX_PASTED_CONTEXT_LEN:
    raise HTTPException(status_code=400, detail=f'pasted_context too long (max {MAX_PASTED_CONTEXT_LEN})')


def _validate_participants(plist: Optional[List[Participant]]) -> None:
  if plist is not None and len(plist) > MAX_PARTICIPANTS:
    raise HTTPException(status_code=400, detail=f'too many participants (max {MAX_PARTICIPANTS})')


def _validate_capture_mode(mode: Optional[str]) -> None:
  if mode is not None and mode not in CAPTURE_MODES:
    raise HTTPException(status_code=400, detail=f'invalid capture_mode (must be one of {sorted(CAPTURE_MODES)})')


async def _load_session_or_403(db, session_id: int, user_id: int) -> aiosqlite.Row:
  cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
  row = await cursor.fetchone()
  if not row:
    raise HTTPException(status_code=404, detail='Session not found')
  if row['user_id'] != user_id:
    raise HTTPException(status_code=403, detail='Forbidden')
  return row


def _validate_url_ssrf(url: str) -> None:
  """SSRF 방어: https 강제 + 내부 IP 차단."""
  try:
    parsed = urlparse(url)
  except Exception:
    raise HTTPException(status_code=400, detail='invalid URL')

  if parsed.scheme != 'https':
    raise HTTPException(status_code=400, detail='only https URLs are allowed')
  if not parsed.hostname:
    raise HTTPException(status_code=400, detail='URL must have a hostname')

  hostname = parsed.hostname
  try:
    addr_infos = socket.getaddrinfo(hostname, None)
  except socket.gaierror:
    raise HTTPException(status_code=400, detail='could not resolve hostname')

  for info in addr_infos:
    ip_str = info[4][0]
    try:
      ip = ipaddress.ip_address(ip_str)
    except ValueError:
      continue
    if (
      ip.is_private
      or ip.is_loopback
      or ip.is_link_local
      or ip.is_reserved
      or ip.is_multicast
      or ip.is_unspecified
    ):
      raise HTTPException(status_code=400, detail='URL resolves to a blocked IP')


def _validate_extension(filename: str) -> str:
  if '.' not in filename:
    raise HTTPException(status_code=400, detail='file has no extension')
  ext = filename.rsplit('.', 1)[1].lower()
  if ext not in ALLOWED_EXTENSIONS:
    raise HTTPException(status_code=400, detail=f'extension .{ext} not allowed')
  return ext


def _build_field_updates(body: UpdateSessionRequest):
  """Return (fields, values) for dynamic UPDATE."""
  fields, values = [], []
  if body.title is not None:
    fields.append('title = ?'); values.append(body.title)
  if body.status is not None:
    fields.append('status = ?'); values.append(body.status)
  if body.brief is not None:
    _validate_brief(body.brief)
    fields.append('brief = ?'); values.append(body.brief)
  if body.participants is not None:
    _validate_participants(body.participants)
    fields.append('participants = ?'); values.append(json.dumps([p.model_dump() for p in body.participants]))
  if body.meeting_languages is not None:
    fields.append('meeting_languages = ?'); values.append(json.dumps(body.meeting_languages))
  if body.translation_language is not None:
    fields.append('translation_language = ?'); values.append(body.translation_language)
  if body.answer_language is not None:
    fields.append('answer_language = ?'); values.append(body.answer_language)
  if body.pasted_context is not None:
    _validate_pasted_context(body.pasted_context)
    fields.append('pasted_context = ?'); values.append(body.pasted_context)
  if body.capture_mode is not None:
    _validate_capture_mode(body.capture_mode)
    fields.append('capture_mode = ?'); values.append(body.capture_mode)
  return fields, values


# ─────────────────────────────────────────────────────────
# Session CRUD
# ─────────────────────────────────────────────────────────

@router.post('')
async def create_session(body: CreateSessionRequest, user: dict = Depends(get_current_user)):
  _validate_brief(body.brief)
  _validate_pasted_context(body.pasted_context)
  _validate_participants(body.participants)
  _validate_capture_mode(body.capture_mode)

  language = 'multi'
  if body.meeting_languages and len(body.meeting_languages) == 1:
    language = body.meeting_languages[0]

  participants_json = json.dumps([p.model_dump() for p in body.participants]) if body.participants else None
  languages_json = json.dumps(body.meeting_languages) if body.meeting_languages else None
  capture_mode = body.capture_mode or 'microphone'

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      '''INSERT INTO sessions
           (business_id, user_id, title, language, brief, participants,
            meeting_languages, translation_language, answer_language, pasted_context, capture_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
      (
        body.business_id, user['user_id'], body.title, language,
        body.brief, participants_json, languages_json,
        body.translation_language, body.answer_language, body.pasted_context, capture_mode,
      )
    )
    await db.commit()
    session_id = cursor.lastrowid
    cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
    row = await cursor.fetchone()
    return success(_deserialize_session(row))


@router.get('')
async def list_sessions(
  business_id: int = Query(...),
  page: int = Query(1, ge=1),
  limit: int = Query(20, ge=1, le=100),
  user: dict = Depends(get_current_user)
):
  offset = (page - 1) * limit
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      '''SELECT * FROM sessions
         WHERE business_id = ? AND user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?''',
      (business_id, user['user_id'], limit, offset)
    )
    rows = await cursor.fetchall()
    cursor = await db.execute(
      'SELECT COUNT(*) as cnt FROM sessions WHERE business_id = ? AND user_id = ?',
      (business_id, user['user_id'])
    )
    total = (await cursor.fetchone())['cnt']
    return success(
      [_deserialize_session(r) for r in rows],
      pagination={'page': page, 'limit': limit, 'total': total}
    )


@router.get('/{session_id}')
async def get_session(session_id: int, user: dict = Depends(get_current_user)):
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    row = await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute(
      'SELECT * FROM utterances WHERE session_id = ? ORDER BY id ASC',
      (session_id,)
    )
    utterances = [dict(r) for r in await cursor.fetchall()]

    cursor = await db.execute(
      '''SELECT id, filename, original_filename, file_size, mime_type, status,
                source_type, source_url, title, error_message, chunk_count, indexed_at, created_at
         FROM documents WHERE session_id = ? ORDER BY id ASC''',
      (session_id,)
    )
    documents = [dict(r) for r in await cursor.fetchall()]

    cursor = await db.execute(
      'SELECT id, deepgram_speaker_id, participant_name, is_self '
      'FROM speakers WHERE session_id = ? ORDER BY id ASC',
      (session_id,)
    )
    speakers = [dict(r) for r in await cursor.fetchall()]

    data = _deserialize_session(row)
    data['utterances'] = utterances
    data['documents'] = documents
    data['speakers'] = speakers
    return success(data)


@router.put('/{session_id}')
async def update_session(
  session_id: int,
  body: UpdateSessionRequest,
  user: dict = Depends(get_current_user)
):
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    fields, values = _build_field_updates(body)
    if fields:
      fields.append("updated_at = datetime('now')")
      values.append(session_id)
      await db.execute(
        f'UPDATE sessions SET {", ".join(fields)} WHERE id = ?',
        values
      )
      await db.commit()

    cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
    result = _deserialize_session(await cursor.fetchone())

  # 세션이 completed 로 전환되는 시점에 배치 화자 병합 실행 (D-3)
  if body.status == 'completed':
    try:
      task = asyncio.create_task(cluster_and_merge_speakers(session_id))
      task.add_done_callback(log_task_exception)
    except Exception:
      pass  # 병합 실패는 세션 종료를 막지 않음

  return success(result)


@router.delete('/{session_id}')
async def delete_session(session_id: int, user: dict = Depends(get_current_user)):
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])
    await db.execute('DELETE FROM sessions WHERE id = ?', (session_id,))
    await db.commit()
    return success({'id': session_id})


# ─────────────────────────────────────────────────────────
# Documents (회의 자료)
# ─────────────────────────────────────────────────────────

@router.post('/{session_id}/documents')
async def upload_document(
  session_id: int,
  file: UploadFile = File(...),
  user: dict = Depends(get_current_user)
):
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    session = await _load_session_or_403(db, session_id, user['user_id'])
    business_id = session['business_id']

    original_name = file.filename or 'unnamed'
    ext = _validate_extension(original_name)

    # Read file with size guard
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
      raise HTTPException(status_code=400, detail=f'file exceeds {MAX_FILE_SIZE // (1024*1024)}MB limit')
    if len(content) == 0:
      raise HTTPException(status_code=400, detail='empty file')

    # Save to disk with UUID filename
    session_dir = os.path.join(UPLOADS_ROOT, str(business_id), str(session_id))
    os.makedirs(session_dir, exist_ok=True)
    stored_filename = f'{uuid.uuid4().hex}.{ext}'
    stored_path = os.path.join(session_dir, stored_filename)
    with open(stored_path, 'wb') as f:
      f.write(content)

    cursor = await db.execute(
      '''INSERT INTO documents
           (business_id, user_id, session_id, filename, original_filename,
            file_size, mime_type, status, source_type, title)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'file', ?)''',
      (
        business_id, user['user_id'], session_id,
        stored_filename, original_name,
        len(content), file.content_type or 'application/octet-stream',
        original_name,
      )
    )
    await db.commit()
    doc_id = cursor.lastrowid

    cursor = await db.execute(
      '''SELECT id, filename, original_filename, file_size, mime_type, status,
                source_type, source_url, title, error_message, chunk_count, indexed_at, created_at
         FROM documents WHERE id = ?''',
      (doc_id,)
    )
    doc_dict = dict(await cursor.fetchone())

  # Background ingest — 예외 silent drop 방지를 위해 add_done_callback
  task = asyncio.create_task(ingest_document(doc_id))
  task.add_done_callback(log_task_exception)

  return success(doc_dict)


@router.delete('/{session_id}/documents/{document_id}')
async def delete_document(
  session_id: int,
  document_id: int,
  user: dict = Depends(get_current_user)
):
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute(
      'SELECT * FROM documents WHERE id = ? AND session_id = ?',
      (document_id, session_id)
    )
    doc = await cursor.fetchone()
    if not doc:
      raise HTTPException(status_code=404, detail='Document not found')

    stored_path = os.path.join(UPLOADS_ROOT, str(doc['business_id']), str(session_id), doc['filename'])
    if os.path.exists(stored_path):
      try:
        os.remove(stored_path)
      except OSError:
        pass  # DB row removal is authoritative

    await db.execute('DELETE FROM documents WHERE id = ?', (document_id,))
    await db.commit()
    return success({'id': document_id})


# ─────────────────────────────────────────────────────────
# URLs (회의 자료)
# ─────────────────────────────────────────────────────────

@router.post('/{session_id}/urls')
async def add_url(
  session_id: int,
  body: AddUrlRequest,
  user: dict = Depends(get_current_user)
):
  """
  URL 을 documents 테이블에 source_type='url' 로 등록하고 background 에서 fetch + extract + index.
  프론트는 GET /sessions/:id 의 documents 에서 source_type='url' 행들을 필터링해 표시.
  """
  _validate_url_ssrf(body.url)

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    session = await _load_session_or_403(db, session_id, user['user_id'])
    business_id = session['business_id']

    # 세션당 URL 개수 제한 (documents 에서 source_type='url' 카운트)
    cursor = await db.execute(
      "SELECT COUNT(*) AS cnt FROM documents WHERE session_id = ? AND source_type = 'url'",
      (session_id,)
    )
    url_count = (await cursor.fetchone())['cnt']
    if url_count >= MAX_URL_LIST:
      raise HTTPException(status_code=400, detail=f'url list full (max {MAX_URL_LIST})')

    # filename 은 NOT NULL 이라 placeholder 사용 (실제 저장 파일 없음)
    placeholder_filename = f'url-{uuid.uuid4().hex[:12]}'
    parsed = urlparse(body.url)
    hostname = parsed.hostname or body.url
    title_hint = hostname  # 인덱싱 후 실제 제목으로 덮어써짐

    cursor = await db.execute(
      '''INSERT INTO documents
           (business_id, user_id, session_id, filename, original_filename,
            file_size, mime_type, status, source_type, source_url, title)
         VALUES (?, ?, ?, ?, ?, 0, '', 'pending', 'url', ?, ?)''',
      (
        business_id, user['user_id'], session_id,
        placeholder_filename, body.url,
        body.url, title_hint,
      )
    )
    await db.commit()
    doc_id = cursor.lastrowid

    cursor = await db.execute(
      '''SELECT id, filename, original_filename, file_size, mime_type, status,
                source_type, source_url, title, error_message, chunk_count, indexed_at, created_at
         FROM documents WHERE id = ?''',
      (doc_id,)
    )
    doc_dict = dict(await cursor.fetchone())

  # Background ingest
  task = asyncio.create_task(ingest_document(doc_id))
  task.add_done_callback(log_task_exception)

  return success(doc_dict)


# ─────────────────────────────────────────────────────────
# Speakers (화자 매칭)
# ─────────────────────────────────────────────────────────

@router.post('/{session_id}/self-voice-sample')
async def upload_self_voice_sample(
  session_id: int,
  file: UploadFile = File(...),
  dg_speaker_hint: Optional[int] = Form(None),
  user: dict = Depends(get_current_user),
):
  """
  웹 화상회의 모드의 본인 매칭용 **마이크 전용** 오디오 샘플.

  매칭 알고리즘:
  1. 업로드 오디오로 깨끗한 임베딩 계산
  2. 저장된 모든 언어 핑거프린트와 비교 → max similarity
  3. 최고 유사도가 임계값 ≥ 이면 본인 판정
  4. 대상 dg_speaker_id 결정 순위:
     (a) 클라이언트가 보낸 dg_speaker_hint (프론트가 최초 10초 창에서 관찰한 ID)
     (b) fallback: 직전 N초 내 가장 많이 발화한 dg_speaker_id
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute(
      'SELECT embedding FROM voice_fingerprints WHERE user_id = ?', (user['user_id'],)
    )
    fp_rows = await cursor.fetchall()
  if not fp_rows:
    raise HTTPException(status_code=400, detail='등록된 음성 핑거프린트가 없습니다 — 프로필에서 등록해주세요')
  stored_embeddings = [blob_to_embedding(r['embedding']) for r in fp_rows]

  content = await file.read()
  if not content:
    raise HTTPException(status_code=400, detail='빈 파일')
  if len(content) > 10 * 1024 * 1024:
    raise HTTPException(status_code=400, detail='파일이 너무 큽니다 (10MB 초과)')

  try:
    import librosa
    import numpy as _np
    y, sr = librosa.load(io.BytesIO(content), sr=16000, mono=True)
  except Exception as e:
    raise HTTPException(status_code=400, detail=f'오디오 디코딩 실패: {type(e).__name__}')
  if y.size < 16000 * 3:
    raise HTTPException(status_code=400, detail='오디오가 너무 짧습니다 (최소 3초)')
  y_clip = _np.clip(y, -1.0, 1.0)
  pcm = (y_clip * 32767).astype(_np.int16).tobytes()

  try:
    test_emb = await embed_pcm16(pcm)
  except Exception as e:
    raise HTTPException(status_code=500, detail=f'임베딩 실패: {type(e).__name__}')

  # 다국어 max similarity
  best_sim = -1.0
  per_lang_sims = []
  for emb in stored_embeddings:
    s = float(cosine_similarity(emb, test_emb))
    per_lang_sims.append(round(s, 3))
    if s > best_sim:
      best_sim = s
  import logging as _lg
  _lg.getLogger('q-note.live').info(
    f'self-voice-sample: session={session_id} best_sim={best_sim:.3f} '
    f'per_lang={per_lang_sims} hint={dg_speaker_hint}'
  )

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row

    target_row = None
    # (a) hint 우선
    if dg_speaker_hint is not None:
      cursor = await db.execute(
        'SELECT id, deepgram_speaker_id FROM speakers WHERE session_id = ? AND deepgram_speaker_id = ?',
        (session_id, dg_speaker_hint)
      )
      target_row = await cursor.fetchone()

    # (b) fallback: 직전 30초 내 가장 많이 발화한 화자
    if target_row is None:
      cursor = await db.execute(
        '''SELECT s.id AS id, s.deepgram_speaker_id, COUNT(u.id) AS cnt
           FROM speakers s
           LEFT JOIN utterances u ON u.speaker_id = s.id
             AND u.created_at >= datetime('now', '-30 seconds')
           WHERE s.session_id = ?
           GROUP BY s.id
           ORDER BY cnt DESC
           LIMIT 1''',
        (session_id,)
      )
      target_row = await cursor.fetchone()

    matched = False
    target_speaker_id = None
    target_dg = None
    if best_sim >= SELF_MATCH_THRESHOLD and target_row:
      target_speaker_id = target_row['id']
      target_dg = target_row['deepgram_speaker_id']
      await db.execute(
        'UPDATE speakers SET is_self = 1 WHERE id = ?', (target_speaker_id,)
      )
      await db.execute(
        '''DELETE FROM detected_questions
           WHERE session_id = ?
             AND utterance_id IN (SELECT id FROM utterances WHERE speaker_id = ?)''',
        (session_id, target_speaker_id)
      )
      await db.execute(
        'UPDATE utterances SET is_question = 0 WHERE speaker_id = ?', (target_speaker_id,)
      )
      await db.commit()
      matched = True

  return success({
    'similarity': round(float(best_sim), 3),
    'threshold': SELF_MATCH_THRESHOLD,
    'matched': matched,
    'speaker_id': target_speaker_id,
    'dg_speaker_id': target_dg,
    'used_hint': dg_speaker_hint is not None and matched,
  })


@router.post('/{session_id}/speakers/{from_speaker_id}/merge-into/{into_speaker_id}')
async def merge_speakers(
  session_id: int,
  from_speaker_id: int,
  into_speaker_id: int,
  user: dict = Depends(get_current_user)
):
  """
  두 speaker 를 수동 병합. D-3 자동 클러스터링이 놓친 경우의 fallback.
  from_speaker_id 를 지우고 해당 발화를 into_speaker_id 로 이관.
  """
  if from_speaker_id == into_speaker_id:
    raise HTTPException(status_code=400, detail='같은 화자를 병합할 수 없습니다')

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute(
      'SELECT id, is_self FROM speakers WHERE id IN (?, ?) AND session_id = ?',
      (from_speaker_id, into_speaker_id, session_id)
    )
    rows = await cursor.fetchall()
    if len(rows) != 2:
      raise HTTPException(status_code=404, detail='두 화자 모두 존재해야 합니다')

    # from 이 is_self 면 into 에 상속 + 과거 is_question 소급 클리어
    from_self = any(r['id'] == from_speaker_id and r['is_self'] for r in rows)

    await db.execute(
      'UPDATE utterances SET speaker_id = ? WHERE speaker_id = ?',
      (into_speaker_id, from_speaker_id)
    )
    if from_self:
      await db.execute('UPDATE speakers SET is_self = 1 WHERE id = ?', (into_speaker_id,))
      await db.execute(
        '''DELETE FROM detected_questions
           WHERE session_id = ?
             AND utterance_id IN (SELECT id FROM utterances WHERE speaker_id = ?)''',
        (session_id, into_speaker_id)
      )
      await db.execute(
        'UPDATE utterances SET is_question = 0 WHERE speaker_id = ?', (into_speaker_id,)
      )
    await db.execute('DELETE FROM speakers WHERE id = ?', (from_speaker_id,))
    await db.commit()

  return success({'into': into_speaker_id, 'from': from_speaker_id})


@router.post('/{session_id}/speakers/{speaker_id}/match')
async def match_speaker(
  session_id: int,
  speaker_id: int,
  body: MatchSpeakerRequest,
  user: dict = Depends(get_current_user)
):
  """
  Matches a Deepgram speaker to a participant name and/or is_self flag.
  When is_self=True, retroactively clears all is_question flags and removes
  detected_questions rows for that speaker's utterances.
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute(
      'SELECT * FROM speakers WHERE id = ? AND session_id = ?',
      (speaker_id, session_id)
    )
    speaker = await cursor.fetchone()
    if not speaker:
      raise HTTPException(status_code=404, detail='Speaker not found')

    fields, values = [], []
    if body.participant_name is not None:
      fields.append('participant_name = ?'); values.append(body.participant_name)
    if body.is_self is not None:
      fields.append('is_self = ?'); values.append(1 if body.is_self else 0)

    if fields:
      values.append(speaker_id)
      await db.execute(f'UPDATE speakers SET {", ".join(fields)} WHERE id = ?', values)

    # If marked as self, retroactively strip question flags for this speaker
    if body.is_self is True:
      await db.execute(
        '''DELETE FROM detected_questions
           WHERE session_id = ?
             AND utterance_id IN (SELECT id FROM utterances WHERE speaker_id = ?)''',
        (session_id, speaker_id)
      )
      await db.execute(
        'UPDATE utterances SET is_question = 0 WHERE speaker_id = ?',
        (speaker_id,)
      )

    await db.commit()

    cursor = await db.execute('SELECT * FROM speakers WHERE id = ?', (speaker_id,))
    return success(dict(await cursor.fetchone()))


@router.delete('/{session_id}/urls/{url_id}')
async def delete_url(
  session_id: int,
  url_id: int,
  user: dict = Depends(get_current_user)
):
  """url_id 는 documents.id (source_type='url')."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute(
      "SELECT id FROM documents WHERE id = ? AND session_id = ? AND source_type = 'url'",
      (url_id, session_id)
    )
    row = await cursor.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='URL not found')

    await db.execute('DELETE FROM documents WHERE id = ?', (url_id,))
    await db.commit()
    return success({'id': url_id})
