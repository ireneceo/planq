import json
import os
import socket
import uuid
import ipaddress
from typing import Optional, List
from urllib.parse import urlparse

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field

from middleware.auth import get_current_user
from services.database import DB_PATH, connect as db_connect

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

JSON_COLUMNS = {'participants', 'urls', 'meeting_languages'}


# ─────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────

class Participant(BaseModel):
  name: str = Field(..., min_length=1, max_length=100)
  role: Optional[str] = Field(None, max_length=200)


class CreateSessionRequest(BaseModel):
  business_id: int
  title: Optional[str] = 'Untitled Session'
  brief: Optional[str] = None
  participants: Optional[List[Participant]] = None
  meeting_languages: Optional[List[str]] = None
  translation_language: Optional[str] = None
  answer_language: Optional[str] = None
  pasted_context: Optional[str] = None


class UpdateSessionRequest(BaseModel):
  title: Optional[str] = None
  status: Optional[str] = None
  brief: Optional[str] = None
  participants: Optional[List[Participant]] = None
  meeting_languages: Optional[List[str]] = None
  translation_language: Optional[str] = None
  answer_language: Optional[str] = None
  pasted_context: Optional[str] = None


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
  return fields, values


# ─────────────────────────────────────────────────────────
# Session CRUD
# ─────────────────────────────────────────────────────────

@router.post('')
async def create_session(body: CreateSessionRequest, user: dict = Depends(get_current_user)):
  _validate_brief(body.brief)
  _validate_pasted_context(body.pasted_context)
  _validate_participants(body.participants)

  language = 'multi'
  if body.meeting_languages and len(body.meeting_languages) == 1:
    language = body.meeting_languages[0]

  participants_json = json.dumps([p.model_dump() for p in body.participants]) if body.participants else None
  languages_json = json.dumps(body.meeting_languages) if body.meeting_languages else None

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      '''INSERT INTO sessions
           (business_id, user_id, title, language, brief, participants,
            meeting_languages, translation_language, answer_language, pasted_context)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
      (
        body.business_id, user['user_id'], body.title, language,
        body.brief, participants_json, languages_json,
        body.translation_language, body.answer_language, body.pasted_context,
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
      'SELECT id, filename, original_filename, file_size, mime_type, status, created_at '
      'FROM documents WHERE session_id = ? ORDER BY id ASC',
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
    return success(_deserialize_session(await cursor.fetchone()))


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
            file_size, mime_type, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded')''',
      (
        business_id, user['user_id'], session_id,
        stored_filename, original_name,
        len(content), file.content_type or 'application/octet-stream',
      )
    )
    await db.commit()
    doc_id = cursor.lastrowid

    cursor = await db.execute(
      'SELECT id, filename, original_filename, file_size, mime_type, status, created_at '
      'FROM documents WHERE id = ?',
      (doc_id,)
    )
    return success(dict(await cursor.fetchone()))


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
  _validate_url_ssrf(body.url)

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    session = await _load_session_or_403(db, session_id, user['user_id'])

    existing = []
    if session['urls']:
      try:
        existing = json.loads(session['urls'])
      except (TypeError, ValueError):
        existing = []

    if len(existing) >= MAX_URL_LIST:
      raise HTTPException(status_code=400, detail=f'url list full (max {MAX_URL_LIST})')

    entry = {
      'id': uuid.uuid4().hex,
      'url': body.url,
      'status': 'pending',  # B-5에서 fetched/failed로 갱신
    }
    existing.append(entry)

    await db.execute(
      "UPDATE sessions SET urls = ?, updated_at = datetime('now') WHERE id = ?",
      (json.dumps(existing), session_id)
    )
    await db.commit()
    return success(entry)


# ─────────────────────────────────────────────────────────
# Speakers (화자 매칭)
# ─────────────────────────────────────────────────────────

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
  url_id: str,
  user: dict = Depends(get_current_user)
):
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    session = await _load_session_or_403(db, session_id, user['user_id'])

    existing = []
    if session['urls']:
      try:
        existing = json.loads(session['urls'])
      except (TypeError, ValueError):
        existing = []

    remaining = [e for e in existing if e.get('id') != url_id]
    if len(remaining) == len(existing):
      raise HTTPException(status_code=404, detail='URL not found')

    await db.execute(
      "UPDATE sessions SET urls = ?, updated_at = datetime('now') WHERE id = ?",
      (json.dumps(remaining), session_id)
    )
    await db.commit()
    return success({'id': url_id})
