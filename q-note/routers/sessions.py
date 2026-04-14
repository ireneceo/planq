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
from services.llm_service import generate_vocabulary_list
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
JSON_COLUMNS = {'participants', 'meeting_languages', 'user_language_levels', 'keywords'}


# ─────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────

class Participant(BaseModel):
  name: str = Field(..., min_length=1, max_length=100)
  role: Optional[str] = Field(None, max_length=200)


CAPTURE_MODES = {'microphone', 'web_conference'}


ANSWER_LENGTHS = {'short', 'medium', 'long'}
EXPERTISE_LEVELS = {'layman', 'practitioner', 'expert'}


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
  user_bio: Optional[str] = Field(None, max_length=2000)
  user_expertise: Optional[str] = Field(None, max_length=500)
  user_organization: Optional[str] = Field(None, max_length=200)
  user_job_title: Optional[str] = Field(None, max_length=100)
  user_language_levels: Optional[dict] = None
  user_expertise_level: Optional[str] = Field(None, max_length=20)
  meeting_answer_style: Optional[str] = Field(None, max_length=2000)
  meeting_answer_length: Optional[str] = Field(None, max_length=20)
  keywords: Optional[List[str]] = None  # STT 보정용 어휘 사전


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
  user_bio: Optional[str] = Field(None, max_length=2000)
  user_expertise: Optional[str] = Field(None, max_length=500)
  user_organization: Optional[str] = Field(None, max_length=200)
  user_job_title: Optional[str] = Field(None, max_length=100)
  user_language_levels: Optional[dict] = None
  user_expertise_level: Optional[str] = Field(None, max_length=20)
  meeting_answer_style: Optional[str] = Field(None, max_length=2000)
  meeting_answer_length: Optional[str] = Field(None, max_length=20)
  keywords: Optional[List[str]] = None


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
  if body.user_language_levels is not None:
    fields.append('user_language_levels = ?'); values.append(json.dumps(body.user_language_levels))
  if body.user_expertise_level is not None:
    if body.user_expertise_level and body.user_expertise_level not in EXPERTISE_LEVELS:
      raise HTTPException(status_code=400, detail='invalid expertise_level')
    fields.append('user_expertise_level = ?'); values.append(body.user_expertise_level or None)
  if body.meeting_answer_style is not None:
    fields.append('meeting_answer_style = ?'); values.append(body.meeting_answer_style)
  if body.meeting_answer_length is not None:
    if body.meeting_answer_length and body.meeting_answer_length not in ANSWER_LENGTHS:
      raise HTTPException(status_code=400, detail='invalid answer_length')
    fields.append('meeting_answer_length = ?'); values.append(body.meeting_answer_length or None)
  if body.keywords is not None:
    cleaned = _sanitize_keywords(body.keywords)
    fields.append('keywords = ?'); values.append(json.dumps(cleaned) if cleaned else None)
  return fields, values


def _sanitize_keywords(raw: Optional[List[str]]) -> List[str]:
  if not raw:
    return []
  seen: set[str] = set()
  out: List[str] = []
  for w in raw:
    if not isinstance(w, str):
      continue
    w = ' '.join(w.split()).strip()
    if not w or len(w) < 2 or len(w) > 80:
      continue
    k = w.lower()
    if k in seen:
      continue
    seen.add(k)
    out.append(w)
    if len(out) >= 200:
      break
  return out


# ─────────────────────────────────────────────────────────
# Session CRUD
# ─────────────────────────────────────────────────────────

class GenerateKeywordsRequest(BaseModel):
  brief: Optional[str] = Field(None, max_length=MAX_BRIEF_LEN)
  pasted_context: Optional[str] = Field(None, max_length=MAX_PASTED_CONTEXT_LEN)
  participants: Optional[List[Participant]] = None
  include_user_profile: Optional[bool] = True


@router.post('/generate-keywords')
async def generate_keywords(
  body: GenerateKeywordsRequest,
  user: dict = Depends(get_current_user),
):
  """회의 브리프·자료·참여자·사용자 프로필에서 STT 보정용 어휘 사전을 AI로 추출.
  사용자가 검토·수정 후 세션 생성 시 전달하는 흐름."""
  # 사용자 프로필 조회 (Node 백엔드의 User 테이블) — 미지원이면 메모리 내 user 객체 사용
  user_profile = None
  if body.include_user_profile:
    try:
      user_profile = {
        'name': user.get('name'),
        'job_title': user.get('job_title'),
        'organization': user.get('organization'),
        'expertise': user.get('expertise'),
        'bio': user.get('bio'),
      }
    except Exception:
      pass

  participants_list = None
  if body.participants:
    participants_list = [p.model_dump() for p in body.participants]

  vocab = await generate_vocabulary_list(
    brief=body.brief,
    pasted_context=body.pasted_context,
    participants=participants_list,
    user_profile=user_profile,
  )
  return success({'keywords': vocab})


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

  # 새 필드 검증
  if body.user_expertise_level and body.user_expertise_level not in EXPERTISE_LEVELS:
    raise HTTPException(status_code=400, detail='invalid expertise_level')
  if body.meeting_answer_length and body.meeting_answer_length not in ANSWER_LENGTHS:
    raise HTTPException(status_code=400, detail='invalid answer_length')
  language_levels_json = json.dumps(body.user_language_levels) if body.user_language_levels else None

  # 사용자가 keywords 를 주지 않았으면 브리프/자료/참여자/프로필에서 자동 추출
  # (회의 시작 전에 미리 사전을 만들어두기 위함 — STT 부팅 시점에 이미 가지고 있음)
  # NOTE: 문서는 이 시점에 아직 업로드되기 전이므로 brief 기반 초안만. 문서 인덱싱 완료 후
  # ingest.py 가 refresh_session_vocabulary 를 호출해 문서 내용 기반으로 재추출 + 병합.
  keywords_list = _sanitize_keywords(body.keywords)
  if not keywords_list and (body.brief or body.pasted_context or body.participants or body.user_bio or body.user_expertise):
    try:
      user_profile = {}
      if body.user_name: user_profile['name'] = body.user_name
      if body.user_job_title: user_profile['job_title'] = body.user_job_title
      if body.user_organization: user_profile['organization'] = body.user_organization
      if body.user_expertise: user_profile['expertise'] = body.user_expertise
      if body.user_bio: user_profile['bio'] = body.user_bio
      auto_keywords = await generate_vocabulary_list(
        brief=body.brief,
        pasted_context=body.pasted_context,
        participants=[p.model_dump() for p in body.participants] if body.participants else None,
        user_profile=user_profile or None,
        meeting_languages=body.meeting_languages,
      )
      keywords_list = _sanitize_keywords(auto_keywords)
    except Exception as _e:
      keywords_list = []
  keywords_json = json.dumps(keywords_list) if keywords_list else None

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    # 신규 세션은 'prepared' 상태 — 사용자가 "녹음 시작" 을 눌러야 'recording' 으로 전환
    cursor = await db.execute(
      '''INSERT INTO sessions
           (business_id, user_id, title, language, status, brief, participants,
            meeting_languages, translation_language, answer_language, pasted_context, capture_mode,
            user_name, user_bio, user_expertise, user_organization, user_job_title,
            user_language_levels, user_expertise_level, meeting_answer_style, meeting_answer_length,
            keywords)
         VALUES (?, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
      (
        body.business_id, user['user_id'], body.title, language,
        body.brief, participants_json, languages_json,
        body.translation_language, body.answer_language, body.pasted_context, capture_mode,
        body.user_name, body.user_bio, body.user_expertise, body.user_organization, body.user_job_title,
        language_levels_json, body.user_expertise_level,
        body.meeting_answer_style, body.meeting_answer_length,
        keywords_json,
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
  target_language: Optional[str] = Field(None, max_length=10)  # translate-answer 전용: 목적지 언어 명시 (없으면 세션 translation_language 사용)


def _strip_qa_blob(row: dict) -> dict:
  """SELECT * 결과에서 embedding BLOB 을 제거 (JSON 직렬화 실패 방지).
  has_embedding 불리언을 남겨 프론트에서 준비 상태 표시."""
  row = dict(row)
  row['has_embedding'] = bool(row.get('embedding'))
  row.pop('embedding', None)
  return row


@router.get('/{session_id}/qa-pairs')
async def list_qa_pairs(
  session_id: int,
  source: Optional[str] = Query(None, pattern='^(custom|generated|priority)$'),
  user: dict = Depends(get_current_user)
):
  """Q&A 목록 조회. source 필터 가능 (custom|generated|priority)."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    query = 'SELECT * FROM qa_pairs WHERE session_id = ?'
    params: list = [session_id]
    if source == 'priority':
      query += ' AND is_priority = 1'
    elif source:
      query += ' AND source = ? AND is_priority = 0'
      params.append(source)
    query += ' ORDER BY is_priority DESC, source DESC, sort_order, id'

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return success([_strip_qa_blob(r) for r in rows])


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
      INSERT INTO qa_pairs (session_id, source, category, question_text, answer_text, is_priority)
      VALUES (?, 'custom', ?, ?, ?, 0)
    ''', (session_id, body.category, body.question_text.strip(), (body.answer_text or '').strip() or None))
    await db.commit()
    new_id = cursor.lastrowid

    # 임베딩 백그라운드 계산
    try:
      from services.answer_service import ensure_qa_embedding
      asyncio.create_task(ensure_qa_embedding(new_id, body.question_text.strip()))
    except Exception:
      pass

    cursor = await db.execute('SELECT * FROM qa_pairs WHERE id = ?', (new_id,))
    row = await cursor.fetchone()
    return success(_strip_qa_blob(row))


# ─────────────────────────────────────────────────────────
# Priority Q&A — 최우선 답변 업로드 (별도 섹션)
# ─────────────────────────────────────────────────────────

class PriorityQACreate(BaseModel):
  question_text: str = Field(..., min_length=1, max_length=2000)
  answer_text: str = Field(..., min_length=1, max_length=5000)
  short_answer: Optional[str] = Field(None, max_length=500)
  keywords: Optional[str] = Field(None, max_length=500)   # 쉼표 구분 문자열
  category: Optional[str] = Field(None, max_length=200)


@router.get('/templates/priority-qa-csv')
async def download_priority_qa_template(user: dict = Depends(get_current_user)):
  """Priority Q&A CSV 템플릿 다운로드 (pre-session, 세션 없이 호출).

  컬럼:
    - question (필수) — 질문 원문
    - answer (필수) — 정식 답변 (길어도 OK, 말할 그대로)
    - short_answer (선택) — 1문장 버전 (meeting_answer_length='short' 일 때 우선 사용)
    - keywords (선택) — 쉼표 구분 키워드. FTS5 인덱스에 합쳐져 검색 정확도·속도 ↑
    - category (선택)
  업로드 시 같은 question 은 UPDATE, 없으면 INSERT.
  """
  output = io.StringIO()
  writer = csv.writer(output)
  writer.writerow(['question', 'answer', 'short_answer', 'keywords', 'category'])
  writer.writerow([
    'What is your core research topic?',
    'I study how remote work and digital nomad lifestyles change job performance. I look at self-leadership, self-efficacy, and digital work skills as key drivers.',
    'I study how remote work and nomad life change job performance.',
    'remote work, digital nomad, job performance, self-leadership, self-efficacy, digital work',
    'Research Topic',
  ])
  writer.writerow([
    'Why is this important?',
    'The digital nomad workforce grew more than 300% since 2020. Most remote work research covers traditional employees in one office, so there is a clear gap for location-independent workers.',
    'Nomad workers grew 300% since 2020, and existing research misses them.',
    'growth, 300%, 2020, research gap, location independent',
    'Significance',
  ])
  writer.writerow([
    '저희 제품의 가장 큰 강점은 무엇인가요?',
    '저희는 대화에서 바로 할일과 청구까지 한 번에 이어지는 업무 OS입니다. 특히 고객 초대 한 번이면 바로 접속해서 쓸 수 있는 점이 가장 큰 차이입니다.',
    '대화에서 할일·청구까지 한 번에 이어지는 업무 OS입니다.',
    '강점, 제품, 업무 OS, 대화, 할일, 청구, 고객 초대',
    '제품 소개',
  ])

  content = output.getvalue()
  return StreamingResponse(
    io.BytesIO(content.encode('utf-8-sig')),
    media_type='text/csv',
    headers={'Content-Disposition': 'attachment; filename=priority_qa_template.csv'},
  )


@router.post('/{session_id}/refresh-vocabulary')
async def refresh_vocabulary_endpoint(
  session_id: int,
  user: dict = Depends(get_current_user),
):
  """세션의 어휘사전을 현재 인덱싱된 문서 기반으로 재추출.
  기존 수동 추가 키워드는 보존. 편집 모달 "어휘 재추출" 버튼용."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

  from services.answer_service import refresh_session_vocabulary
  total = await refresh_session_vocabulary(session_id, merge=True)

  # 갱신된 keywords 조회해서 반환
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cur = await db.execute('SELECT keywords FROM sessions WHERE id = ?', (session_id,))
    row = await cur.fetchone()
    kws = []
    if row and row['keywords']:
      try:
        kws = json.loads(row['keywords'])
      except Exception:
        pass
  return success({'total': total, 'keywords': kws})


@router.post('/{session_id}/priority-qa')
async def create_priority_qa(
  session_id: int,
  body: PriorityQACreate,
  user: dict = Depends(get_current_user)
):
  """Priority Q&A 단건 등록 (is_priority=1, 최우선 답변).
  임베딩은 SYNC 로 계산 — 생성 직후 find-answer 가 즉시 매칭 가능해야 한다."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

    short_ans = (body.short_answer or '').strip() or None
    kw_clean = (body.keywords or '').strip() or None

    cursor = await db.execute(
      'SELECT id FROM qa_pairs WHERE session_id = ? AND question_text = ? AND is_priority = 1',
      (session_id, body.question_text.strip()),
    )
    existing = await cursor.fetchone()
    if existing:
      await db.execute(
        """UPDATE qa_pairs SET answer_text = ?, short_answer = ?, keywords = ?, category = ?,
           updated_at = datetime('now') WHERE id = ?""",
        (body.answer_text.strip(), short_ans, kw_clean, body.category, existing['id']),
      )
      new_id = existing['id']
    else:
      cursor = await db.execute('''
        INSERT INTO qa_pairs (session_id, source, category, question_text, answer_text, short_answer, keywords, is_priority)
        VALUES (?, 'custom', ?, ?, ?, ?, ?, 1)
      ''', (session_id, body.category, body.question_text.strip(), body.answer_text.strip(), short_ans, kw_clean))
      new_id = cursor.lastrowid
    await db.commit()

    # 동기 임베딩 — priority Q&A 는 즉시 검색 가능해야 함.
    # 질문 + 키워드를 합쳐 임베딩 → 키워드가 의미 벡터에도 포함됨.
    try:
      from services.answer_service import ensure_qa_embedding
      emb_text = body.question_text.strip()
      if kw_clean:
        emb_text = f'{emb_text} {kw_clean}'
      await ensure_qa_embedding(new_id, emb_text)
    except Exception:
      pass

    cursor = await db.execute('SELECT * FROM qa_pairs WHERE id = ?', (new_id,))
    row = await cursor.fetchone()
    return success(_strip_qa_blob(row))


async def _ingest_priority_qa_pairs(
  session_id: int,
  pairs: list[dict],
  source_filename: Optional[str],
) -> tuple[int, int, int]:
  """pairs(list of {question, answer, short_answer, keywords, category}) 를 DB 에 저장 + 임베딩.
  Returns: (created, updated, embedded)"""
  if not pairs:
    return 0, 0, 0

  created_ids: list[int] = []
  created = 0
  updated = 0
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    for p in pairs:
      q = p['question']
      a = p['answer']
      sa = p.get('short_answer')
      kw = p.get('keywords')
      cat = p.get('category')
      cursor = await db.execute(
        'SELECT id FROM qa_pairs WHERE session_id = ? AND question_text = ? AND is_priority = 1',
        (session_id, q),
      )
      existing = await cursor.fetchone()
      if existing:
        await db.execute(
          """UPDATE qa_pairs SET answer_text = ?, short_answer = ?, keywords = ?, category = ?,
             source_filename = COALESCE(?, source_filename),
             updated_at = datetime('now') WHERE id = ?""",
          (a, sa, kw, cat, source_filename, existing['id']),
        )
        created_ids.append(existing['id'])
        updated += 1
      else:
        cursor = await db.execute(
          """INSERT INTO qa_pairs
             (session_id, source, question_text, answer_text, short_answer, keywords, category, is_priority, source_filename)
             VALUES (?, 'custom', ?, ?, ?, ?, ?, 1, ?)""",
          (session_id, q, a, sa, kw, cat, source_filename),
        )
        created_ids.append(cursor.lastrowid)
        created += 1
    await db.commit()

  # 임베딩 SYNC — 업로드 리턴 시점에 모든 Q&A 가 검색 가능해야 함.
  embedded = 0
  if created_ids:
    try:
      from services.answer_service import ensure_qa_embedding
      async with db_connect() as db2:
        db2.row_factory = aiosqlite.Row
        for _id in created_ids:
          cur = await db2.execute('SELECT question_text, keywords FROM qa_pairs WHERE id = ?', (_id,))
          r = await cur.fetchone()
          if r:
            emb_text = r['question_text']
            if r['keywords']:
              emb_text = f"{emb_text} {r['keywords']}"
            await ensure_qa_embedding(_id, emb_text)
            embedded += 1
    except Exception as e:
      import logging
      logging.getLogger('q-note.live').warning(f'priority sync embed failed: {e}')

  return created, updated, embedded


@router.post('/{session_id}/priority-qa/upload')
async def upload_priority_qa_file(
  session_id: int,
  file: UploadFile = File(...),
  user: dict = Depends(get_current_user)
):
  """Priority Q&A 파일 업로드 (is_priority=1).

  지원 포맷: csv, tsv, xlsx, xls, json, txt, md, pdf, docx
  - 구조화 (csv/xlsx/json): 컬럼명 alias 허용 (question/질문/Q, answer/답변/A, short_answer, keywords, category)
  - 비구조화 (txt/md/pdf/docx): 정규식 Q/A 패턴 → fallback 으로 LLM 추출
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])

  raw = await file.read()
  if len(raw) > 10 * 1024 * 1024:
    raise HTTPException(status_code=400, detail='파일이 너무 큽니다 (최대 10MB)')

  filename = file.filename or 'upload'
  from services.qa_upload_parser import parse_qa_file
  pairs, parse_errors = await parse_qa_file(raw, filename)

  if not pairs and parse_errors:
    # 파싱 에러 — 400 으로 내보내서 프론트에서 표시
    raise HTTPException(status_code=400, detail='; '.join(parse_errors))

  created, updated, embedded = await _ingest_priority_qa_pairs(session_id, pairs, filename)

  return success({
    'created': created,
    'updated': updated,
    'embedded': embedded,
    'parsed': len(pairs),
    'source_filename': filename,
    'errors': parse_errors,
  })


# 구 엔드포인트 — 하위 호환용 alias
@router.post('/{session_id}/priority-qa/upload-csv')
async def upload_priority_qa_csv(
  session_id: int,
  file: UploadFile = File(...),
  user: dict = Depends(get_current_user)
):
  return await upload_priority_qa_file(session_id, file, user)


@router.delete('/{session_id}/priority-qa/by-file')
async def delete_priority_qa_by_file(
  session_id: int,
  filename: str = Query(..., min_length=1, max_length=300),
  user: dict = Depends(get_current_user)
):
  """특정 업로드 파일에서 온 priority Q&A 를 일괄 삭제.
  주의: /{qa_id} 보다 먼저 선언되어야 한다 (FastAPI 라우팅 매칭 순서)."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])
    cursor = await db.execute(
      '''DELETE FROM qa_pairs
         WHERE session_id = ? AND is_priority = 1 AND source_filename = ?''',
      (session_id, filename),
    )
    deleted = cursor.rowcount
    await db.commit()
    return success({'deleted': deleted, 'filename': filename})


@router.delete('/{session_id}/priority-qa/{qa_id}')
async def delete_priority_qa(
  session_id: int,
  qa_id: int,
  user: dict = Depends(get_current_user)
):
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    await _load_session_or_403(db, session_id, user['user_id'])
    cursor = await db.execute(
      'SELECT id FROM qa_pairs WHERE id = ? AND session_id = ? AND is_priority = 1',
      (qa_id, session_id),
    )
    if not await cursor.fetchone():
      raise HTTPException(status_code=404, detail='priority Q&A not found')
    await db.execute('DELETE FROM qa_pairs WHERE id = ?', (qa_id,))
    await db.commit()
    return success({'id': qa_id})


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

    # 질문 텍스트가 변경되면 임베딩 재계산
    if body.question_text is not None:
      try:
        from services.answer_service import ensure_qa_embedding
        asyncio.create_task(ensure_qa_embedding(qa_id, body.question_text.strip()))
      except Exception:
        pass

    cursor = await db.execute('SELECT * FROM qa_pairs WHERE id = ?', (qa_id,))
    updated = await cursor.fetchone()
    return success(_strip_qa_blob(updated))


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
  # 명시적 target_language 가 오면 그걸로, 아니면 세션 translation_language 로
  if body.target_language:
    effective_trans = body.target_language
  else:
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
