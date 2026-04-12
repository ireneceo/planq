import asyncio
import csv
import io
import json
import os
import socket
import uuid
import ipaddress
from typing import Optional, List
from urllib.parse import urlparse

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from middleware.auth import get_current_user
from services.database import DB_PATH, connect as db_connect
from services.ingest import ingest_document, log_task_exception
from services.speaker_clustering import cluster_and_merge_speakers
from services.voice_fingerprint import (
  embed_pcm16, blob_to_embedding, cosine_similarity, SELF_MATCH_THRESHOLD,
)
from services.answer_service import find_answer, translate_answer_text
from services.qa_generator import generate_qa_for_session, generate_qa_for_document, log_task_exception as qa_log_task_exception

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
  user_name: Optional[str] = Field(None, max_length=100)
  user_bio: Optional[str] = Field(None, max_length=1000)
  user_expertise: Optional[str] = Field(None, max_length=500)
  user_organization: Optional[str] = Field(None, max_length=200)
  user_job_title: Optional[str] = Field(None, max_length=100)


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
  user_name: Optional[str] = Field(None, max_length=100)
  user_bio: Optional[str] = Field(None, max_length=1000)
  user_expertise: Optional[str] = Field(None, max_length=500)
  user_organization: Optional[str] = Field(None, max_length=200)
  user_job_title: Optional[str] = Field(None, max_length=100)


class AddUrlRequest(BaseModel):
  url: str = Field(..., max_length=2000)


class MatchSpeakerRequest(BaseModel):
  participant_name: Optional[str] = Field(None, max_length=100)
  is_self: Optional[bool] = None


class ReassignUtteranceRequest(BaseModel):
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
  # 사용자 프로필 스냅샷
  if body.user_name is not None:
    fields.append('user_name = ?'); values.append(body.user_name)
  if body.user_bio is not None:
    fields.append('user_bio = ?'); values.append(body.user_bio)
  if body.user_expertise is not None:
    fields.append('user_expertise = ?'); values.append(body.user_expertise)
  if body.user_organization is not None:
    fields.append('user_organization = ?'); values.append(body.user_organization)
  if body.user_job_title is not None:
    fields.append('user_job_title = ?'); values.append(body.user_job_title)
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
            meeting_languages, translation_language, answer_language, pasted_context, capture_mode,
            user_name, user_bio, user_expertise, user_organization, user_job_title)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
      (
        body.business_id, user['user_id'], body.title, language,
        body.brief, participants_json, languages_json,
        body.translation_language, body.answer_language, body.pasted_context, capture_mode,
        body.user_name, body.user_bio, body.user_expertise, body.user_organization, body.user_job_title,
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

    # 답변이 있는 질문들 — 프론트가 "답변 보기" 버튼 상태 초기화에 사용
    cursor = await db.execute(
      '''SELECT utterance_id, answer_text, answer_tier, matched_qa_id
         FROM detected_questions
         WHERE session_id = ? AND utterance_id IS NOT NULL AND answer_text IS NOT NULL''',
      (session_id,)
    )
    detected_questions = [dict(r) for r in await cursor.fetchall()]

    data = _deserialize_session(row)
    data['utterances'] = utterances
    data['documents'] = documents
    data['speakers'] = speakers
    data['detected_questions'] = detected_questions
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


@router.post('/{session_id}/utterances/{utterance_id}/reassign-speaker')
async def reassign_utterance_speaker(
  session_id: int,
  utterance_id: int,
  body: ReassignUtteranceRequest,
  user: dict = Depends(get_current_user)
):
  """
  문장 단위 화자 변경 — 이 utterance만 다른 speaker로 이동.
  같은 이름/is_self의 speaker가 이미 있으면 거기로, 없으면 새로 생성.
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute(
      'SELECT * FROM utterances WHERE id = ? AND session_id = ?',
      (utterance_id, session_id)
    )
    utt = await cursor.fetchone()
    if not utt:
      raise HTTPException(status_code=404, detail='Utterance not found')

    target_speaker_id = None

    if body.is_self:
      # "나" — 기존 is_self speaker 찾기
      cursor = await db.execute(
        'SELECT id FROM speakers WHERE session_id = ? AND is_self = 1',
        (session_id,)
      )
      existing = await cursor.fetchone()
      if existing:
        target_speaker_id = existing['id']
      else:
        # 새 speaker 생성 — deepgram_speaker_id 는 UNIQUE이므로 음수 자동 감소
        cursor = await db.execute(
          'SELECT COALESCE(MIN(deepgram_speaker_id), 0) - 1 AS next_id FROM speakers WHERE session_id = ?',
          (session_id,)
        )
        next_dg_id = (await cursor.fetchone())['next_id']
        cursor = await db.execute(
          'INSERT INTO speakers (session_id, deepgram_speaker_id, is_self) VALUES (?, ?, 1)',
          (session_id, next_dg_id)
        )
        target_speaker_id = cursor.lastrowid
    elif body.participant_name:
      # 이름으로 — 같은 이름 speaker 찾기
      cursor = await db.execute(
        'SELECT id FROM speakers WHERE session_id = ? AND participant_name = ?',
        (session_id, body.participant_name)
      )
      existing = await cursor.fetchone()
      if existing:
        target_speaker_id = existing['id']
      else:
        cursor = await db.execute(
          'SELECT COALESCE(MIN(deepgram_speaker_id), 0) - 1 AS next_id FROM speakers WHERE session_id = ?',
          (session_id,)
        )
        next_dg_id = (await cursor.fetchone())['next_id']
        cursor = await db.execute(
          'INSERT INTO speakers (session_id, deepgram_speaker_id, participant_name) VALUES (?, ?, ?)',
          (session_id, next_dg_id, body.participant_name)
        )
        target_speaker_id = cursor.lastrowid

    if target_speaker_id and target_speaker_id != utt['speaker_id']:
      await db.execute(
        'UPDATE utterances SET speaker_id = ? WHERE id = ?',
        (target_speaker_id, utterance_id)
      )
      await db.commit()

    return success({'utterance_id': utterance_id, 'speaker_id': target_speaker_id})


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


# ─────────────────────────────────────────────────────────
# Q&A Pairs — CRUD + CSV + Find Answer
# ─────────────────────────────────────────────────────────

class QAPairCreate(BaseModel):
  question_text: str = Field(..., min_length=1, max_length=2000)
  answer_text: Optional[str] = Field(None, max_length=5000)
  category: Optional[str] = Field(None, max_length=200)


class QAPairUpdate(BaseModel):
  question_text: Optional[str] = Field(None, min_length=1, max_length=2000)
  answer_text: Optional[str] = Field(None, max_length=5000)
  category: Optional[str] = Field(None, max_length=200)


class FindAnswerRequest(BaseModel):
  question_text: str = Field(..., min_length=1, max_length=2000)
  utterance_id: Optional[int] = None  # 제공되면 detected_questions에 저장/업데이트


@router.get('/{session_id}/qa-pairs')
async def list_qa_pairs(
  session_id: int,
  source: Optional[str] = Query(None, pattern='^(custom|generated)$'),
  user: dict = Depends(get_current_user)
):
  """Q&A 목록 조회. source 필터 가능. 꼬리질문은 parent_id로 연결."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    query = 'SELECT * FROM qa_pairs WHERE session_id = ?'
    params: list = [session_id]
    if source:
      query += ' AND source = ?'
      params.append(source)
    query += ' ORDER BY source DESC, sort_order, id'  # custom first

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return success([dict(r) for r in rows])


@router.post('/{session_id}/qa-pairs')
async def create_qa_pair(
  session_id: int,
  body: QAPairCreate,
  user: dict = Depends(get_current_user)
):
  """Q&A 단건 등록 (고객 직접 등록 = source='custom')."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute('''
      INSERT INTO qa_pairs (session_id, source, category, question_text, answer_text)
      VALUES (?, 'custom', ?, ?, ?)
    ''', (session_id, body.category, body.question_text.strip(), (body.answer_text or '').strip() or None))
    await db.commit()

    cursor = await db.execute('SELECT * FROM qa_pairs WHERE id = ?', (cursor.lastrowid,))
    row = await cursor.fetchone()
    return success(dict(row))


@router.put('/{session_id}/qa-pairs/{qa_id}')
async def update_qa_pair(
  session_id: int,
  qa_id: int,
  body: QAPairUpdate,
  user: dict = Depends(get_current_user)
):
  """Q&A 수정. AI 생성 답변 수정 시 is_reviewed=1 자동 설정."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute(
      'SELECT * FROM qa_pairs WHERE id = ? AND session_id = ?', (qa_id, session_id)
    )
    row = await cursor.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='Q&A pair not found')

    fields = ["updated_at = datetime('now')"]
    values: list = []
    if body.question_text is not None:
      fields.append('question_text = ?'); values.append(body.question_text.strip())
    if body.answer_text is not None:
      fields.append('answer_text = ?'); values.append(body.answer_text.strip())
    if body.category is not None:
      fields.append('category = ?'); values.append(body.category.strip() or None)

    # AI 생성 답변을 수정하면 custom급 신뢰도로 승격
    if row['source'] == 'generated' and body.answer_text is not None:
      fields.append('is_reviewed = 1')

    values.append(qa_id)
    await db.execute(f'UPDATE qa_pairs SET {", ".join(fields)} WHERE id = ?', values)
    await db.commit()

    cursor = await db.execute('SELECT * FROM qa_pairs WHERE id = ?', (qa_id,))
    updated = await cursor.fetchone()
    return success(dict(updated))


@router.delete('/{session_id}/qa-pairs/{qa_id}')
async def delete_qa_pair(
  session_id: int,
  qa_id: int,
  user: dict = Depends(get_current_user)
):
  """Q&A 삭제. 꼬리질문도 함께 삭제."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute(
      'SELECT id FROM qa_pairs WHERE id = ? AND session_id = ?', (qa_id, session_id)
    )
    if not await cursor.fetchone():
      raise HTTPException(status_code=404, detail='Q&A pair not found')

    # 꼬리질문도 삭제
    await db.execute('DELETE FROM qa_pairs WHERE parent_id = ?', (qa_id,))
    await db.execute('DELETE FROM qa_pairs WHERE id = ?', (qa_id,))
    await db.commit()
    return success({'id': qa_id})


@router.get('/{session_id}/qa-pairs/template')
async def download_qa_template(
  session_id: int,
  user: dict = Depends(get_current_user)
):
  """CSV 템플릿 다운로드."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

  output = io.StringIO()
  writer = csv.writer(output)
  writer.writerow(['question', 'answer', 'category'])
  writer.writerow([
    'Why did you choose this topic?',
    'The digital nomad workforce has grown 300% since 2020 according to MBO Partners. However, most existing research on remote work focuses on traditional office-based employees. There is a critical gap in understanding how location-independent workers maintain productivity, especially when they lack fixed organizational structures. This study addresses that gap by examining the specific factors that drive job performance in digital nomad contexts.',
    'Research Background',
  ])
  writer.writerow([
    'What is your research gap?',
    'Previous studies on remote work primarily examine employees who work from home within a single organization. They assume stable internet, fixed time zones, and employer-provided infrastructure. Digital nomads operate without these assumptions — they change locations frequently, work across time zones, and self-manage their work environment. No existing study combines self-leadership, self-efficacy, and digital work competency as predictors of performance in this population.',
    'Research Gap',
  ])
  writer.writerow([
    'How do you measure job performance?',
    'Job performance is measured using the Task Performance scale by Williams & Anderson (1991), adapted for remote work contexts. The scale includes 7 items rated on a 5-point Likert scale, covering core job duties completion, meeting formal performance requirements, and fulfilling responsibilities specified in the job description. We chose task performance specifically (rather than contextual or adaptive performance) because it represents the baseline output that digital nomad clients and employers most directly evaluate.',
    'Methodology',
  ])

  content = output.getvalue()
  return StreamingResponse(
    io.BytesIO(content.encode('utf-8-sig')),  # BOM for Excel compatibility
    media_type='text/csv',
    headers={'Content-Disposition': 'attachment; filename=qa_template.csv'},
  )


@router.post('/{session_id}/qa-pairs/upload-csv')
async def upload_qa_csv(
  session_id: int,
  file: UploadFile = File(...),
  user: dict = Depends(get_current_user)
):
  """CSV 업로드로 Q&A 일괄 등록. 같은 question_text면 UPDATE."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

  raw = await file.read()
  if len(raw) > 2 * 1024 * 1024:
    raise HTTPException(status_code=400, detail='파일이 너무 큽니다 (최대 2MB)')

  # 인코딩 감지: UTF-8 BOM → UTF-8 → CP949
  text = None
  for enc in ('utf-8-sig', 'utf-8', 'cp949', 'euc-kr'):
    try:
      text = raw.decode(enc)
      break
    except (UnicodeDecodeError, ValueError):
      continue
  if text is None:
    raise HTTPException(status_code=400, detail='파일 인코딩을 인식할 수 없습니다 (UTF-8 또는 CP949)')

  reader = csv.DictReader(io.StringIO(text))
  if not reader.fieldnames or 'question' not in [f.strip().lower() for f in reader.fieldnames]:
    raise HTTPException(status_code=400, detail='CSV에 question 열이 필요합니다. 템플릿을 다운로드해 확인하세요.')

  # 헤더 정규화
  field_map = {}
  for f in reader.fieldnames:
    fl = f.strip().lower()
    if fl == 'question':
      field_map['question'] = f
    elif fl == 'answer':
      field_map['answer'] = f
    elif fl == 'category':
      field_map['category'] = f

  rows_to_insert = []
  for i, row in enumerate(reader):
    if i >= 500:
      break
    q = (row.get(field_map.get('question', '')) or '').strip()
    if not q:
      continue
    a = (row.get(field_map.get('answer', '')) or '').strip()
    cat = (row.get(field_map.get('category', '')) or '').strip() or None
    rows_to_insert.append((q, a or None, cat))

  if not rows_to_insert:
    raise HTTPException(status_code=400, detail='유효한 Q&A 항목이 없습니다')

  inserted = 0
  updated = 0
  async with db_connect() as db:
    for q, a, cat in rows_to_insert:
      # 같은 session + 같은 question_text (custom) 있으면 UPDATE
      cursor = await db.execute(
        "SELECT id FROM qa_pairs WHERE session_id = ? AND source = 'custom' AND question_text = ?",
        (session_id, q)
      )
      existing = await cursor.fetchone()
      if existing:
        await db.execute(
          "UPDATE qa_pairs SET answer_text = ?, category = ?, updated_at = datetime('now') WHERE id = ?",
          (a, cat, existing[0])
        )
        updated += 1
      else:
        await db.execute(
          'INSERT INTO qa_pairs (session_id, source, question_text, answer_text, category, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          (session_id, 'custom', q, a, cat, inserted)
        )
        inserted += 1
    await db.commit()

  return success({'inserted': inserted, 'updated': updated, 'total': inserted + updated})


@router.post('/{session_id}/qa-pairs/generate')
async def trigger_qa_generation(
  session_id: int,
  user: dict = Depends(get_current_user)
):
  """자료 기반 Q&A 자동 생성 (수동 트리거). 백그라운드 실행."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    # indexed 문서가 있는지 확인
    cursor = await db.execute(
      "SELECT COUNT(*) as cnt FROM documents WHERE session_id = ? AND status = 'indexed'",
      (session_id,)
    )
    row = await cursor.fetchone()
    if not row or row['cnt'] == 0:
      raise HTTPException(status_code=400, detail='인덱싱된 자료가 없습니다. 먼저 자료를 업로드하세요.')

  task = asyncio.create_task(generate_qa_for_session(session_id))
  task.add_done_callback(qa_log_task_exception)
  return success({'message': 'Q&A 생성이 시작되었습니다. 완료까지 잠시 기다려주세요.'})


@router.post('/{session_id}/find-answer')
async def find_answer_endpoint(
  session_id: int,
  body: FindAnswerRequest,
  user: dict = Depends(get_current_user)
):
  """
  답변 찾기 — 답변 즉시 반환, 번역은 백그라운드.
  utterance_id 제공 시 detected_questions 에 저장/업데이트 (새로고침 후에도 유지).
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

  result = await find_answer(session_id, body.question_text.strip())

  # 번역 언어 정보를 추출하고 응답에서 제거 (내부용)
  translation_lang = result.pop('_translation_lang', None)

  # 답변이 있고 번역이 아직 없으면 → 백그라운드 번역 시작
  if result.get('answer') and not result.get('answer_translation') and translation_lang:
    async def _bg_translate():
      try:
        translated = await translate_answer_text(result['answer'], translation_lang)
        if translated:
          result['answer_translation'] = translated
      except Exception:
        pass
    import asyncio
    task = asyncio.create_task(_bg_translate())
    try:
      await asyncio.wait_for(asyncio.shield(task), timeout=1.0)
    except asyncio.TimeoutError:
      pass

  # utterance_id 제공 시 detected_questions 에 저장 (persistence)
  if body.utterance_id and result.get('answer'):
    try:
      async with db_connect() as db:
        db.row_factory = aiosqlite.Row
        # 기존 row 있으면 UPDATE, 없으면 INSERT
        cur = await db.execute(
          'SELECT id FROM detected_questions WHERE session_id = ? AND utterance_id = ?',
          (session_id, body.utterance_id)
        )
        existing = await cur.fetchone()
        sources_json = json.dumps(result.get('sources', []), ensure_ascii=False) if result.get('sources') else None
        if existing:
          await db.execute('''
            UPDATE detected_questions
            SET answer_text = ?, answer_tier = ?, matched_qa_id = ?,
                answer_sources = ?, answered_at = datetime('now')
            WHERE id = ?
          ''', (
            result['answer'], result.get('tier'), result.get('matched_qa_id'),
            sources_json, existing['id']
          ))
        else:
          await db.execute('''
            INSERT INTO detected_questions
              (session_id, utterance_id, question_text, answer_text, answer_tier, matched_qa_id, answer_sources, answered_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ''', (
            session_id, body.utterance_id, body.question_text.strip(),
            result['answer'], result.get('tier'), result.get('matched_qa_id'), sources_json
          ))
        await db.commit()
    except Exception as e:
      import logging
      logging.getLogger('q-note').warning(f'find-answer persist failed: {e}')

  return success(result)


@router.post('/{session_id}/translate-answer')
async def translate_answer_endpoint(
  session_id: int,
  body: FindAnswerRequest,
  user: dict = Depends(get_current_user)
):
  """답변 텍스트 번역 (프론트에서 답변 표시 후 별도 호출)."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

  from services.answer_service import _get_session_languages
  answer_lang, translation_lang, meeting_lang = await _get_session_languages(session_id)
  effective_answer_lang = answer_lang or meeting_lang
  effective_trans = translation_lang or ('en' if effective_answer_lang == 'ko' else 'ko')

  translated = await translate_answer_text(body.question_text.strip(), effective_trans)
  return success({'translation': translated})


@router.get('/{session_id}/utterances/{utterance_id}/cached-answer')
async def get_cached_answer(
  session_id: int,
  utterance_id: int,
  user: dict = Depends(get_current_user)
):
  """
  Prefetch된 답변 캐시 조회. 있으면 즉시 반환 (0ms), 없으면 404.
  프론트에서: 먼저 이것 시도 → 404면 find-answer 호출.
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    cursor = await db.execute(
      'SELECT * FROM detected_questions WHERE session_id = ? AND utterance_id = ? AND answer_text IS NOT NULL',
      (session_id, utterance_id)
    )
    row = await cursor.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='No cached answer')

    return success({
      'answer': row['answer_text'],
      'answer_tier': row['answer_tier'],
      'matched_qa_id': row['matched_qa_id'],
      'sources': json.loads(row['answer_sources']) if row['answer_sources'] else [],
    })
