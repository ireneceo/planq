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
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Header
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
from services.billing_client import check_membership
from services.rate_limit import rate_limit
from services.qa_generator import generate_qa_for_session, generate_qa_for_document, log_task_exception as qa_log_task_exception

router = APIRouter(prefix='/api/sessions', tags=['sessions'])


# ─── #63 Phase 3 — 내부 export (Node 워커가 자료 이동/내보내기에 본인 Q Note 세션 포함) ───
# 인증: x-internal-api-key (INTERNAL_API_KEY, Node↔qnote 공유). 사적 공간 원칙 — user_id 본인 세션만.
# session_id 가 int 타입이라 /internal/export 는 /{session_id} 와 충돌하지 않음.
@router.get('/internal/export')
async def internal_export_sessions(
    business_id: int = Query(...),
    user_id: int = Query(...),
    x_internal_api_key: Optional[str] = Header(None),
):
  expected = os.environ.get('INTERNAL_API_KEY')
  if not expected or x_internal_api_key != expected:
    raise HTTPException(status_code=401, detail='invalid internal key')
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cur = await db.execute(
      "SELECT id, title, summary_full, summary_key_points, body, created_at "
      "FROM sessions WHERE business_id = ? AND user_id = ? ORDER BY id ASC",
      (business_id, user_id),
    )
    rows = await cur.fetchall()
    out = []
    for r in rows:
      sid = r['id']
      # 전사 — utterances original_text 를 화자와 함께 결합 (최대 500개)
      ucur = await db.execute(
        "SELECT speaker, original_text FROM utterances WHERE session_id = ? ORDER BY id ASC LIMIT 500",
        (sid,),
      )
      utts = await ucur.fetchall()
      transcript = "\n".join(
        f"{(u['speaker'] or '?')}: {u['original_text']}" for u in utts if u['original_text']
      )
      key_points = None
      if r['summary_key_points']:
        try:
          key_points = json.loads(r['summary_key_points'])
        except (TypeError, ValueError):
          key_points = None
      out.append({
        'id': sid,
        'title': r['title'] or 'Untitled Session',
        'summary_full': r['summary_full'],
        'summary_key_points': key_points,
        'body': r['body'],
        'transcript_text': transcript,
        'created_at': r['created_at'],
      })
  return success(out)


UPLOADS_ROOT = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'uploads')
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB per file
MAX_URL_LIST = 20
MAX_PARTICIPANTS = 50
MAX_DOCS_PER_SESSION = 20  # 세션당 자료 상한 — KB 임베딩/RAG 비용 폭탄 방지 (H-f)
MAX_BRIEF_LEN = 5000
MAX_PASTED_CONTEXT_LEN = 100_000

ALLOWED_EXTENSIONS = {
  'pdf', 'doc', 'docx', 'txt', 'md', 'ppt', 'pptx', 'xls', 'xlsx', 'csv',
}

# NOTE: 'urls' 컬럼은 deprecated — 이제 documents 테이블(source_type='url')이 source of truth
JSON_COLUMNS = {'participants', 'meeting_languages', 'user_language_levels', 'keywords', 'summary_key_points', 'tags'}


# ─────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────

class Participant(BaseModel):
  name: str = Field(..., min_length=1, max_length=100)
  role: Optional[str] = Field(None, max_length=200)


CAPTURE_MODES = {'microphone', 'web_conference', 'text'}

INPUT_TYPES = {'voice', 'text'}

# 본문 (text 메모) 최대 길이 — 일반 메모 한 건이라 넉넉히 잡되 비정상 입력은 차단
MAX_BODY_LEN = 500_000


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
  input_type: Optional[str] = 'voice'  # 'voice' | 'text'
  translate_enabled: Optional[bool] = True
  linked_voice_session_id: Optional[int] = None
  body: Optional[str] = None  # text 메모 본문 (input_type='text' 일 때)
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
  category: Optional[str] = Field(None, max_length=100)  # 운영 #54 — 분류
  tags: Optional[List[str]] = None                       # 운영 #54 — 태그


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
  translate_enabled: Optional[bool] = None
  body: Optional[str] = None  # text 메모 본문 (자동저장)
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
  category: Optional[str] = Field(None, max_length=100)  # 운영 #54 — 분류
  tags: Optional[List[str]] = None                       # 운영 #54 — 태그
  # N+42 — 정리하기 모달이 트랜스크립트를 외부 자산(업무/지식/문서/공유) 으로 변환할 때 timestamp 기록
  mark_summarized: Optional[bool] = None


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


def _validate_input_type(input_type: Optional[str]) -> None:
  if input_type is not None and input_type not in INPUT_TYPES:
    raise HTTPException(status_code=400, detail=f'invalid input_type (must be one of {sorted(INPUT_TYPES)})')


def _validate_body(body: Optional[str]) -> None:
  if body is not None and len(body) > MAX_BODY_LEN:
    raise HTTPException(status_code=400, detail=f'body too long (max {MAX_BODY_LEN})')


async def _validate_linked_voice_session(
  db, linked_id: Optional[int], business_id: int, user_id: int
) -> None:
  """linked_voice_session_id 가 본인의 voice 세션이고 같은 워크스페이스인지 검증.

  메모 popup 의 "현재 회의 연결" 토글이 누른 시점에 voice session 이 사용자 자신 것이 아니거나
  cross-business 면 즉시 거부.
  """
  if linked_id is None:
    return
  cur = await db.execute(
    "SELECT business_id, user_id, input_type, status FROM sessions WHERE id = ?",
    (linked_id,),
  )
  row = await cur.fetchone()
  if not row:
    raise HTTPException(status_code=400, detail='invalid_link_target: session not found')
  if row['business_id'] != business_id or row['user_id'] != user_id:
    raise HTTPException(status_code=400, detail='invalid_link_target: not your session')
  if row['input_type'] != 'voice':
    raise HTTPException(status_code=400, detail='invalid_link_target: must be voice session')


# ─────────────────────────────────────────────────────────
# Recorder lock (같은 세션 동시 녹음 방지)
# ─────────────────────────────────────────────────────────
RECORDER_LOCK_STALE_SECONDS = 12  # heartbeat 5s × 2회 + 버퍼 — 탭이 정상 release 못 해도 빠르게 회복


def _recorder_lock_state(row: aiosqlite.Row) -> dict:
  """세션 row 에서 녹음 락 상태를 유도. stale(30s 초과) 이면 active=False."""
  from datetime import datetime, timezone
  token = None
  hb = None
  try:
    token = row['active_recorder_token']
  except (KeyError, IndexError):
    pass
  try:
    hb = row['recorder_heartbeat_at']
  except (KeyError, IndexError):
    pass
  if not token or not hb:
    return {'active': False, 'token': None, 'heartbeat_at': hb, 'stale': False}
  try:
    hb_dt = datetime.fromisoformat(hb.replace('Z', '+00:00'))
    if hb_dt.tzinfo is None:
      hb_dt = hb_dt.replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - hb_dt).total_seconds()
  except Exception:
    age = RECORDER_LOCK_STALE_SECONDS + 1
  stale = age > RECORDER_LOCK_STALE_SECONDS
  return {
    'active': not stale,
    'token': token,
    'heartbeat_at': hb,
    'stale': stale,
  }


class RecorderLockBody(BaseModel):
  token: str = Field(..., min_length=8, max_length=64)


@router.post('/{session_id}/recorder/acquire')
async def recorder_acquire(
  session_id: int,
  body: RecorderLockBody,
  user: dict = Depends(get_current_user)
):
  """녹음 시작 시 호출. 다른 탭/기기가 이미 활성 락을 쥐고 있으면 409."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    row = await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))
    state = _recorder_lock_state(row)
    if state['active'] and state['token'] != body.token:
      raise HTTPException(
        status_code=409,
        detail={
          'message': 'recorder_locked',
          'heartbeat_at': state['heartbeat_at'],
        }
      )
    await db.execute(
      "UPDATE sessions SET active_recorder_token = ?, recorder_heartbeat_at = datetime('now') "
      "WHERE id = ?",
      (body.token, session_id)
    )
    await db.commit()
    return success({'token': body.token})


@router.post('/{session_id}/recorder/heartbeat')
async def recorder_heartbeat(
  session_id: int,
  body: RecorderLockBody,
  user: dict = Depends(get_current_user)
):
  """녹음 중 5초마다 호출. 내 토큰이 아니면 409 → 프론트가 녹음 중단."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    row = await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))
    state = _recorder_lock_state(row)
    if state['token'] != body.token:
      # 다른 탭이 가로챘거나 이미 release 됨
      raise HTTPException(
        status_code=409,
        detail={'message': 'recorder_lost', 'current_token': state['token']}
      )
    await db.execute(
      "UPDATE sessions SET recorder_heartbeat_at = datetime('now') WHERE id = ?",
      (session_id,)
    )
    await db.commit()
    return success({'token': body.token})


@router.post('/{session_id}/recorder/release')
async def recorder_release(
  session_id: int,
  body: RecorderLockBody,
  user: dict = Depends(get_current_user)
):
  """녹음 종료/일시정지 시 호출. 내 토큰일 때만 해제."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    row = await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))
    state = _recorder_lock_state(row)
    if state['token'] == body.token:
      await db.execute(
        "UPDATE sessions SET active_recorder_token = NULL, recorder_heartbeat_at = NULL "
        "WHERE id = ?",
        (session_id,)
      )
      await db.commit()
    return success({'released': True})


async def _load_session_or_403(db, session_id: int, user_id: int, user_business_id: Optional[int] = None) -> aiosqlite.Row:
  """세션 로딩 + visibility 권한 검사 (사이클 N+14).

  정책:
    - status='recording' → owner only (편집·디버그용, 다른 사람 접근 절대 차단)
    - L1 (개인)        → owner only
    - L2 (프로젝트 팀) → owner OR same-project member (Node internal API 호출)
    - L3 (워크스페이스) → owner OR same-business 멤버
    - L4 (외부 공유)   → share_token 별도 endpoint 로만 접근. 인증 사용자도 visibility 검사 따름
                         (이 endpoint 는 인증 user 용 — L4 도 검사 path 동일하게 적용)
  """
  cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
  row = await cursor.fetchone()
  if not row:
    raise HTTPException(status_code=404, detail='Session not found')

  # owner 항상 통과
  if row['user_id'] == user_id:
    return row

  # 녹화 중은 owner only — 잠정 데이터 절대 노출 금지
  if row['status'] == 'recording':
    raise HTTPException(status_code=403, detail='recording_owner_only')

  visibility = row['visibility'] if 'visibility' in row.keys() else 'L1'
  if visibility == 'L1':
    raise HTTPException(status_code=403, detail='Forbidden')

  # L3: same business 멤버 → user_business_id 비교
  if visibility == 'L3':
    if user_business_id is not None and user_business_id == row['business_id']:
      return row
    raise HTTPException(status_code=403, detail='Forbidden')

  # L2: project 멤버 → Node internal API 검사
  if visibility == 'L2':
    proj_id = row['project_id'] if 'project_id' in row.keys() else None
    if not proj_id:
      raise HTTPException(status_code=403, detail='L2 requires project_id')
    if await _is_user_in_project(user_id, proj_id):
      return row
    raise HTTPException(status_code=403, detail='Forbidden')

  # L4: 인증된 사용자가 동일 워크스페이스라면 OK (외부 token 사용자는 별도 endpoint)
  if visibility == 'L4':
    if user_business_id is not None and user_business_id == row['business_id']:
      return row
    raise HTTPException(status_code=403, detail='Forbidden')

  raise HTTPException(status_code=403, detail='Forbidden')


async def _is_user_in_project(user_id: int, project_id: int) -> bool:
  """Node 백엔드의 internal API 호출하여 project membership 확인.

  Node API: GET /api/internal/project-membership/:userId/:projectId
            INTERNAL_API_KEY 헤더 필수.
  실패 시 False 반환 (보수적).
  """
  import httpx
  internal_key = os.environ.get('INTERNAL_API_KEY')
  if not internal_key:
    return False
  node_base = os.environ.get('PLANQ_BACKEND_URL', 'http://localhost:3003')
  try:
    async with httpx.AsyncClient(timeout=2.0) as client:
      r = await client.get(
        f'{node_base}/api/internal/project-membership/{user_id}/{project_id}',
        headers={'x-internal-api-key': internal_key},
      )
      if r.status_code == 200:
        body = r.json()
        # Node 응답: { success: true, data: { member: bool, role: str } }
        d = body.get('data') if isinstance(body, dict) else None
        if isinstance(d, dict):
          return bool(d.get('member'))
        return False
  except Exception:
    return False
  return False


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
  if body.translate_enabled is not None:
    fields.append('translate_enabled = ?'); values.append(1 if body.translate_enabled else 0)
  if body.mark_summarized:
    fields.append("summarized_at = datetime('now')")
  if body.body is not None:
    _validate_body(body.body)
    fields.append('body = ?'); values.append(body.body)
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
  # 운영 #54 — 분류/태그
  if body.category is not None:
    fields.append('category = ?'); values.append(body.category.strip() or None)
  if body.tags is not None:
    cleaned_tags = _sanitize_tags(body.tags)
    fields.append('tags = ?'); values.append(json.dumps(cleaned_tags) if cleaned_tags else None)
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


def _sanitize_tags(raw: Optional[List[str]]) -> List[str]:
  """운영 #54 — 태그 정규화 (공백 정리·중복 제거·최대 20개·길이 1~40)."""
  if not raw:
    return []
  seen: set[str] = set()
  out: List[str] = []
  for w in raw:
    if not isinstance(w, str):
      continue
    w = ' '.join(w.split()).strip()
    if not w or len(w) > 40:
      continue
    k = w.lower()
    if k in seen:
      continue
    seen.add(k)
    out.append(w)
    if len(out) >= 20:
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


@router.post(
  '/generate-keywords',
  # 비용폭탄 H-f — LLM(generate_vocabulary_list) per-user rate-limit. 입력 캡은 스키마 max_length +
  # generate_vocabulary_list 내부 truncate(brief[:3000]/pasted[:6000])로 이미 방어됨.
  dependencies=[Depends(rate_limit('qnote-genkeywords', per_min=10, per_day=100))],
)
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


@router.post(
  '',
  # 비용폭탄 H-f — 세션 생성 per-user rate-limit. voice 세션은 내부에서 generate_vocabulary_list(LLM)
  # 도 호출하므로 이 게이트가 세션 스팸 + LLM 남용을 함께 차단.
  dependencies=[Depends(rate_limit('qnote-create-session', per_min=20, per_day=200))],
)
async def create_session(body: CreateSessionRequest, user: dict = Depends(get_current_user)):
  _validate_brief(body.brief)
  _validate_pasted_context(body.pasted_context)
  _validate_participants(body.participants)
  _validate_capture_mode(body.capture_mode)
  _validate_input_type(body.input_type)
  _validate_body(body.body)

  # 비용폭탄 C1 — business_id 소유권 검증. 무검증 저장 시 남 워크스페이스로 과금·오염(Fable BLOCK2).
  #   Node 미도달/시크릿 미설정(None) → fail-open. 정의적 non-member 만 403.
  _member = await check_membership(user['user_id'], body.business_id)
  if _member is False:
    raise HTTPException(status_code=403, detail='not a member of this workspace')

  input_type = body.input_type or 'voice'
  is_text = input_type == 'text'

  language = 'multi'
  if body.meeting_languages and len(body.meeting_languages) == 1:
    language = body.meeting_languages[0]

  participants_json = json.dumps([p.model_dump() for p in body.participants]) if body.participants else None
  languages_json = json.dumps(body.meeting_languages) if body.meeting_languages else None
  # text 메모는 capture_mode 자동 'text', voice 는 기존 default 'microphone'
  capture_mode = body.capture_mode or ('text' if is_text else 'microphone')
  if is_text and capture_mode != 'text':
    raise HTTPException(status_code=400, detail='text input must have capture_mode=text')

  # 새 필드 검증
  if body.user_expertise_level and body.user_expertise_level not in EXPERTISE_LEVELS:
    raise HTTPException(status_code=400, detail='invalid expertise_level')
  if body.meeting_answer_length and body.meeting_answer_length not in ANSWER_LENGTHS:
    raise HTTPException(status_code=400, detail='invalid answer_length')
  language_levels_json = json.dumps(body.user_language_levels) if body.user_language_levels else None

  # voice 만 keywords 자동 생성 — text 메모는 STT 없으므로 어휘사전 불필요
  keywords_list = _sanitize_keywords(body.keywords)
  if not is_text and not keywords_list and (body.brief or body.pasted_context or body.participants or body.user_bio or body.user_expertise):
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

  # 운영 #54 — 분류/태그 (생성 시 선택)
  category_val = (body.category.strip() or None) if body.category else None
  tags_list = _sanitize_tags(body.tags)
  tags_json = json.dumps(tags_list) if tags_list else None

  # text 메모는 STT 단계 X → 'active' 로 바로 진입 (사용자 입력 중)
  # voice 는 기존 그대로 'prepared' → 사용자가 "녹음 시작" 누르면 'recording'
  initial_status = 'active' if is_text else 'prepared'
  translate_enabled_int = 1 if (body.translate_enabled is None or body.translate_enabled) else 0

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    # linked_voice_session_id 검증 (text 메모만 의미 있음)
    if body.linked_voice_session_id is not None and not is_text:
      raise HTTPException(status_code=400, detail='linked_voice_session_id only allowed for text input')
    await _validate_linked_voice_session(db, body.linked_voice_session_id, body.business_id, user['user_id'])

    cursor = await db.execute(
      '''INSERT INTO sessions
           (business_id, user_id, title, language, status, brief, participants,
            meeting_languages, translation_language, answer_language, pasted_context, capture_mode,
            user_name, user_bio, user_expertise, user_organization, user_job_title,
            user_language_levels, user_expertise_level, meeting_answer_style, meeting_answer_length,
            keywords, input_type, translate_enabled, linked_voice_session_id, body, category, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
      (
        body.business_id, user['user_id'], body.title, language, initial_status,
        body.brief, participants_json, languages_json,
        body.translation_language, body.answer_language, body.pasted_context, capture_mode,
        body.user_name, body.user_bio, body.user_expertise, body.user_organization, body.user_job_title,
        language_levels_json, body.user_expertise_level,
        body.meeting_answer_style, body.meeting_answer_length,
        keywords_json,
        input_type, translate_enabled_int, body.linked_voice_session_id, body.body,
        category_val, tags_json,
      )
    )
    await db.commit()
    session_id = cursor.lastrowid
    cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
    row = await cursor.fetchone()
    return success(_deserialize_session(row))


@router.get('/me/recent-memos')
async def list_my_recent_memos(
  business_id: int = Query(...),
  limit: int = Query(10, ge=1, le=50),
  q: Optional[str] = Query(None, max_length=100),
  user: dict = Depends(get_current_user),
):
  """본인의 최근 text 메모 목록 (Quick Capture 검색바 + 자동 이어쓰기 용).

  - input_type='text' 만
  - user_id = 본인
  - status IN ('active', 'completed')  — 작성중/완료 둘 다
  - 최근 updated_at 순
  - q 입력 시 title / body LIKE 부분일치 (대소문자 무시, % escape)
  """
  conds = ['business_id = ?', 'user_id = ?', "input_type = 'text'", "status IN ('active','completed')"]
  params: list = [business_id, user['user_id']]
  if q and q.strip():
    needle = q.strip()
    # SQL LIKE wildcard escape — %, _, \ 안전 처리
    needle = needle.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    conds.append("(LOWER(IFNULL(title,'')) LIKE LOWER(?) ESCAPE '\\' OR LOWER(IFNULL(body,'')) LIKE LOWER(?) ESCAPE '\\')")
    params.extend([f'%{needle}%', f'%{needle}%'])

  where_sql = ' AND '.join(conds)
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      # id DESC fallback — 같은 초에 INSERT 된 메모도 안정적 정렬 (큰 id = 최신)
      f'SELECT * FROM sessions WHERE {where_sql} ORDER BY updated_at DESC, id DESC LIMIT ?',
      [*params, limit],
    )
    rows = await cursor.fetchall()
    return success([_deserialize_session(r) for r in rows])


@router.get('')
async def list_sessions(
  business_id: int = Query(...),
  page: int = Query(1, ge=1),
  limit: int = Query(20, ge=1, le=100),
  scope: str = Query('mine', pattern='^(mine|shared|all)$'),
  visibility: Optional[str] = Query(None, pattern='^L[1-4]$'),
  user: dict = Depends(get_current_user)
):
  """세션 목록 (사이클 N+14 visibility 통합).

  scope:
    - mine   — 내가 만든 session 만 (개인 보관함 sessions 탭이 사용)
    - shared — 다른 사람이 만들었지만 내가 볼 수 있는 (L2 멤버 / L3 워크스페이스)
    - all    — mine + shared
  visibility: 특정 level 만 필터 (개인 보관함 'L1' 으로 호출)
  """
  offset = (page - 1) * limit
  uid = user['user_id']

  # base WHERE: business_id 동일
  conds = ['business_id = ?']
  params: list = [business_id]

  # scope 분기
  if scope == 'mine':
    conds.append('user_id = ?')
    params.append(uid)
  elif scope == 'shared':
    # 본인 소유 제외 + 권한 통과 (L3 항상 OK, L2 는 my project IDs)
    my_proj_ids = await _get_user_project_ids(uid, business_id)
    if my_proj_ids:
      placeholders = ','.join(['?'] * len(my_proj_ids))
      conds.append(f"user_id <> ? AND (visibility = 'L3' OR (visibility = 'L2' AND project_id IN ({placeholders})))")
      params.append(uid)
      params.extend(my_proj_ids)
    else:
      conds.append("user_id <> ? AND visibility = 'L3'")
      params.append(uid)
  else:  # all
    my_proj_ids = await _get_user_project_ids(uid, business_id)
    if my_proj_ids:
      placeholders = ','.join(['?'] * len(my_proj_ids))
      conds.append(f"(user_id = ? OR visibility = 'L3' OR (visibility = 'L2' AND project_id IN ({placeholders})))")
      params.append(uid)
      params.extend(my_proj_ids)
    else:
      conds.append("(user_id = ? OR visibility = 'L3')")
      params.append(uid)

  if visibility:
    conds.append('visibility = ?')
    params.append(visibility)

  where_sql = ' AND '.join(conds)

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      f'SELECT * FROM sessions WHERE {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?',
      tuple(params + [limit, offset])
    )
    rows = await cursor.fetchall()
    cursor = await db.execute(
      f'SELECT COUNT(*) as cnt FROM sessions WHERE {where_sql}',
      tuple(params)
    )
    total = (await cursor.fetchone())['cnt']
    return success(
      [_deserialize_session(r) for r in rows],
      pagination={'page': page, 'limit': limit, 'total': total}
    )


async def _get_user_project_ids(user_id: int, business_id: int) -> list:
  """Node API 호출 — 사용자가 속한 project IDs (해당 business 내).

  INTERNAL_API_KEY 사용. 실패 시 빈 리스트 (보수적).
  """
  import httpx
  internal_key = os.environ.get('INTERNAL_API_KEY')
  if not internal_key:
    return []
  node_base = os.environ.get('PLANQ_BACKEND_URL', 'http://localhost:3003')
  try:
    async with httpx.AsyncClient(timeout=2.0) as client:
      r = await client.get(
        f'{node_base}/api/internal/user-project-ids/{user_id}',
        params={'business_id': business_id},
        headers={'x-internal-api-key': internal_key},
      )
      if r.status_code == 200:
        body = r.json()
        # Node 응답: { success: true, data: { project_ids: [...] } }
        d = body.get('data') if isinstance(body, dict) else None
        ids = (d or {}).get('project_ids') or []
        return [int(x) for x in ids if isinstance(x, int) or (isinstance(x, str) and x.isdigit())]
  except Exception:
    return []
  return []


@router.get('/{session_id}')
async def get_session(session_id: int, user: dict = Depends(get_current_user)):
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    row = await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    lock_state = _recorder_lock_state(row)
    data['recorder_lock'] = {
      'active': lock_state['active'],
      'heartbeat_at': lock_state['heartbeat_at'],
    }
    data.pop('active_recorder_token', None)
    data.pop('recorder_heartbeat_at', None)
    return success(data)


@router.put('/{session_id}')
async def update_session(
  session_id: int,
  body: UpdateSessionRequest,
  user: dict = Depends(get_current_user)
):
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    row = await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))
    # Q Note 는 본인 도구 — visibility 는 read 권한만 부여. 편집은 owner only (memo 이든 회의이든)
    if row['user_id'] != user['user_id']:
      raise HTTPException(status_code=403, detail='owner_only')

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
    row = await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))
    # Q Note 는 본인 도구 — 삭제도 owner only (다른 사람이 L3 공유받았다고 지우면 안 됨)
    if row['user_id'] != user['user_id']:
      raise HTTPException(status_code=403, detail='owner_only')
    # voice session 삭제 시 이를 link 한 text 메모들의 reference 를 NULL 로 정리 (FK 위반 방지)
    await db.execute(
      'UPDATE sessions SET linked_voice_session_id = NULL WHERE linked_voice_session_id = ?',
      (session_id,),
    )
    await db.execute('DELETE FROM sessions WHERE id = ?', (session_id,))
    await db.commit()
    return success({'id': session_id})


# ─────────────────────────────────────────────────────────
# Visibility 변경 + 공유 (사이클 N+14)
# 정책:
#   - owner 만 변경 가능
#   - status='recording' → 변경 차단 (잠정 데이터)
#   - L2 선택 시 project_id 필수
#   - 외부 참석자 (participants 에 external) + L3/L4 → shared_consent=1 필수
# ─────────────────────────────────────────────────────────

class VisibilityChangeBody(BaseModel):
  # N+67 — L4 통일 (외부 공유). L4 선택 시 자동으로 share_token 발급.
  visibility: str = Field(..., pattern='^L[1-4]$')
  project_id: Optional[int] = None
  shared_consent: Optional[bool] = None


@router.put('/{session_id}/visibility')
async def change_visibility(
  session_id: int,
  body: VisibilityChangeBody,
  user: dict = Depends(get_current_user),
):
  """Q Note session 공유 범위 변경 (L1/L2/L3/L4).

  N+67 — L4 통일. L4 선택 시 share_token 자동 발급 (POST /share 와 같은 결과).
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
    row = await cursor.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='Session not found')
    if row['user_id'] != user['user_id']:
      raise HTTPException(status_code=403, detail='owner_only')
    if row['status'] == 'recording':
      raise HTTPException(status_code=400, detail='cannot_change_while_recording')

    new_vis = body.visibility
    new_proj_id = body.project_id

    if new_vis == 'L2':
      if not new_proj_id:
        raise HTTPException(status_code=400, detail='project_id_required_for_L2')
      if not await _is_user_in_project(user['user_id'], new_proj_id):
        raise HTTPException(status_code=403, detail='not_a_project_member')
    else:
      new_proj_id = None

    # 외부 참석자 동의 검사 — L3/L4 공유 시
    if new_vis in ('L3', 'L4'):
      participants_raw = row['participants'] if 'participants' in row.keys() else None
      has_external = False
      if participants_raw:
        try:
          participants = json.loads(participants_raw) if isinstance(participants_raw, str) else participants_raw
          if isinstance(participants, list):
            has_external = any(p.get('external') or p.get('is_external') for p in participants)
        except Exception:
          has_external = False
      if has_external and not body.shared_consent and not row['shared_consent']:
        raise HTTPException(status_code=400, detail='external_consent_required')

    shared_consent = 1 if body.shared_consent else (row['shared_consent'] or 0)

    # N+67 — L4 선택 시 share_token 자동 발급 (없으면)
    new_share_token = row['share_token'] if 'share_token' in row.keys() else None
    new_shared_at = row['shared_at'] if 'shared_at' in row.keys() else None
    if new_vis == 'L4' and not new_share_token:
      import secrets
      new_share_token = secrets.token_urlsafe(32)
      await db.execute(
        """UPDATE sessions
           SET visibility = ?, project_id = ?, shared_consent = ?,
               share_token = ?, shared_at = datetime('now'),
               updated_at = datetime('now')
           WHERE id = ?""",
        (new_vis, new_proj_id, shared_consent, new_share_token, session_id)
      )
    else:
      await db.execute(
        """UPDATE sessions
           SET visibility = ?, project_id = ?, shared_consent = ?, updated_at = datetime('now')
           WHERE id = ?""",
        (new_vis, new_proj_id, shared_consent, session_id)
      )
    await db.commit()
    cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
    updated = await cursor.fetchone()
    return success(_deserialize_session(updated))


@router.post('/{session_id}/share')
async def create_share_token(session_id: int, user: dict = Depends(get_current_user)):
  """L4 (외부 공유 링크) 활성화 — share_token 발급.

  visibility 도 L4 로 표시되지만 L1/L2/L3 컬럼은 따로 유지 (token 폐기 시 복원).
  """
  import secrets
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
    row = await cursor.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='Session not found')
    if row['user_id'] != user['user_id']:
      raise HTTPException(status_code=403, detail='owner_only')
    if row['status'] == 'recording':
      raise HTTPException(status_code=400, detail='cannot_share_while_recording')

    if row['share_token']:
      return success({'share_token': row['share_token'], 'shared_at': row['shared_at']})

    token = secrets.token_urlsafe(32)
    now = 'datetime("now")'
    await db.execute(
      f"""UPDATE sessions
          SET share_token = ?, shared_at = {now}, updated_at = {now}
          WHERE id = ?""",
      (token, session_id)
    )
    await db.commit()
    return success({'share_token': token})


@router.delete('/{session_id}/share')
async def revoke_share_token(session_id: int, user: dict = Depends(get_current_user)):
  """share_token 폐기 — L4 비활성화. visibility 는 그대로 유지."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('SELECT * FROM sessions WHERE id = ?', (session_id,))
    row = await cursor.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='Session not found')
    if row['user_id'] != user['user_id']:
      raise HTTPException(status_code=403, detail='owner_only')
    await db.execute(
      """UPDATE sessions
         SET share_token = NULL, shared_at = NULL, share_expires_at = NULL,
             updated_at = datetime('now')
         WHERE id = ?""",
      (session_id,)
    )
    await db.commit()
    return success({'revoked': True})


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
    session = await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))
    business_id = session['business_id']

    # 세션당 자료 상한 — 파일 읽기 전에 검사해 낭비 차단 (H-f, KB 비용 폭탄 방지)
    cur = await db.execute('SELECT COUNT(*) FROM documents WHERE session_id = ?', (session_id,))
    doc_count = (await cur.fetchone())[0]
    if doc_count >= MAX_DOCS_PER_SESSION:
      raise HTTPException(status_code=400, detail=f'too many documents (max {MAX_DOCS_PER_SESSION})')

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

  # Drive 자동 저장 — Node 백엔드에 sync 요청 (실패해도 로컬 ingest 는 지속)
  sync_task = asyncio.create_task(_sync_to_drive(
    business_id=business_id,
    session_id=session_id,
    session_title=session.get('title') if isinstance(session, dict) else session['title'],
    session_date=session.get('created_at') if isinstance(session, dict) else session['created_at'],
    document_id=doc_id,
    local_path=stored_path,
    file_name=original_name,
    mime_type=file.content_type or 'application/octet-stream',
  ))
  sync_task.add_done_callback(log_task_exception)

  return success(doc_dict)


async def _sync_to_drive(*, business_id, session_id, session_title, session_date, document_id, local_path, file_name, mime_type):
  """Q Note 업로드 후 Node 백엔드의 /api/cloud/qnote/sync 호출 — 해당 워크스페이스가 Drive 연동된 경우에만 실제 업로드됨."""
  import httpx
  node_url = os.environ.get('PLANQ_NODE_BASE_URL', 'http://localhost:3003')
  api_key = os.environ.get('INTERNAL_API_KEY')
  if not api_key:
    return  # 환경변수 미설정 → 스킵
  payload = {
    'business_id': business_id,
    'session_id': session_id,
    'session_title': session_title,
    'session_date': str(session_date) if session_date else None,
    'document_id': document_id,
    'local_path': local_path,
    'file_name': file_name,
    'mime_type': mime_type,
  }
  try:
    async with httpx.AsyncClient(timeout=60.0) as client:
      r = await client.post(f'{node_url}/api/cloud/qnote/sync', json=payload, headers={'x-internal-api-key': api_key})
      if r.status_code >= 400:
        print(f'[qnote→drive sync] {r.status_code}: {r.text[:200]}')
  except Exception as e:
    print(f'[qnote→drive sync] failed: {e}')


# 사이클 O4 — 워크스페이스 파일을 Q Note 자료로 link (재업로드 X, 같은 서버 path 직접 read)
class LinkWorkspaceFileBody(BaseModel):
  workspace_file_id: int = Field(..., gt=0)


@router.post('/{session_id}/documents/link-workspace-file')
async def link_workspace_file_to_session(
  session_id: int,
  body: LinkWorkspaceFileBody,
  user: dict = Depends(get_current_user)
):
  import httpx
  node_url = os.environ.get('PLANQ_NODE_BASE_URL', 'http://localhost:3003')
  api_key = os.environ.get('INTERNAL_API_KEY')
  if not api_key:
    raise HTTPException(status_code=500, detail='internal_api_key_not_configured')

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    session = await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))
    business_id = session['business_id']

  # Node 의 internal endpoint 로 file 메타 + path 가져오기
  try:
    async with httpx.AsyncClient(timeout=30.0) as client:
      r = await client.get(
        f'{node_url}/api/files/internal/{body.workspace_file_id}',
        headers={'x-internal-api-key': api_key},
        params={'business_id': business_id},
      )
      if r.status_code == 404:
        raise HTTPException(status_code=404, detail='workspace_file_not_found')
      if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f'node_api_error_{r.status_code}')
      file_meta = r.json().get('data') or {}
  except httpx.RequestError as e:
    raise HTTPException(status_code=502, detail=f'node_api_unreachable: {e}')

  source_path = file_meta.get('absolute_path')
  original_name = file_meta.get('file_name', f'workspace-file-{body.workspace_file_id}')
  mime_type = file_meta.get('mime_type') or 'application/octet-stream'
  if not source_path or not os.path.exists(source_path):
    raise HTTPException(status_code=404, detail='workspace_file_path_unavailable')

  ext = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else 'bin'
  if ext not in ALLOWED_EXTENSIONS:
    raise HTTPException(status_code=400, detail='disallowed_extension_for_qnote')

  # 같은 서버이므로 hardlink 시도 (저장공간 절약), 실패 시 copy
  session_dir = os.path.join(UPLOADS_ROOT, str(business_id), str(session_id))
  os.makedirs(session_dir, exist_ok=True)
  stored_filename = f'{uuid.uuid4().hex}.{ext}'
  stored_path = os.path.join(session_dir, stored_filename)
  try:
    os.link(source_path, stored_path)
  except OSError:
    # cross-device 또는 권한 문제 → 복사
    import shutil
    shutil.copy2(source_path, stored_path)

  file_size = os.path.getsize(stored_path)

  async with db_connect() as db:
    cursor = await db.execute(
      '''INSERT INTO documents
           (business_id, user_id, session_id, filename, original_filename,
            file_size, mime_type, status, source_type, title)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'workspace_file', ?)''',
      (
        business_id, user['user_id'], session_id,
        stored_filename, original_name,
        file_size, mime_type,
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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    session = await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))
    business_id = session['business_id']

    # 세션당 전체 자료 상한 (file+url 합산) — KB 임베딩/RAG 비용 총량 제한 (H-f)
    cursor = await db.execute('SELECT COUNT(*) AS cnt FROM documents WHERE session_id = ?', (session_id,))
    if (await cursor.fetchone())['cnt'] >= MAX_DOCS_PER_SESSION:
      raise HTTPException(status_code=400, detail=f'too many documents (max {MAX_DOCS_PER_SESSION})')

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))
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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))
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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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
    await _load_session_or_403(db, session_id, user['user_id'], user.get('business_id'))

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


# ─── Public (인증 없음) ─────────────────────────────────────
# 사이클 N+25 — 외부 공유 링크. share_token 기반 read-only 미리보기.
# share_token 발급은 POST /{session_id}/share (소유자만). 본 라우트는 anonymous.

@router.get('/public/by-token/{token}')
async def get_public_session_by_token(token: str):
  """share_token 으로 세션 read-only 조회 (외부 공유 미리보기).

  반환: 회의 메타 + utterances + summary + 질문/답변. recorder_lock / pasted_context 같은 운영 필드는 제외.
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      'SELECT * FROM sessions WHERE share_token = ? AND status IN ("completed", "active")',
      (token,)
    )
    row = await cursor.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='not_found_or_expired')
    # 만료 검사 (share_expires_at 가 있으면)
    if row['share_expires_at']:
      cur = await db.execute("SELECT datetime('now') >= ? AS expired", (row['share_expires_at'],))
      expired = (await cur.fetchone())['expired']
      if expired:
        raise HTTPException(status_code=410, detail='link_expired')

    session_id = row['id']
    cursor = await db.execute(
      '''SELECT id, speaker, original_text, translated_text, original_language,
                is_question, start_time, end_time
         FROM utterances WHERE session_id = ? ORDER BY id ASC''',
      (session_id,)
    )
    utterances = [dict(r) for r in await cursor.fetchall()]

    cursor = await db.execute(
      'SELECT id, deepgram_speaker_id, participant_name, is_self '
      'FROM speakers WHERE session_id = ? ORDER BY id ASC',
      (session_id,)
    )
    speakers = [dict(r) for r in await cursor.fetchall()]

    cursor = await db.execute(
      'SELECT key_points, full_summary FROM summaries WHERE session_id = ?',
      (session_id,)
    )
    summary_row = await cursor.fetchone()
    summary = dict(summary_row) if summary_row else None

    # 민감 필드 제외하고 응답 (active_recorder_token / heartbeat / pasted_context 등 제외)
    public_meta = {
      'id': row['id'],
      'title': row['title'],
      'language': row['language'],
      'meeting_languages': json.loads(row['meeting_languages']) if row['meeting_languages'] else [],
      'translation_language': row['translation_language'],
      'duration_seconds': row['duration_seconds'],
      'utterance_count': row['utterance_count'],
      'status': row['status'],
      'created_at': row['created_at'],
      'shared_at': row['shared_at'],
      'participants': json.loads(row['participants']) if row['participants'] else [],
      'brief': row['brief'],
      'input_type': row['input_type'] if 'input_type' in row.keys() else 'voice',
      'body': row['body'] if 'body' in row.keys() else None,
    }
    return success({
      'session': public_meta,
      'utterances': utterances,
      'speakers': speakers,
      'summary': summary,
    })
