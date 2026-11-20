import json
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from middleware.auth import get_current_user
from services.database import DB_PATH, connect as db_connect
import logging
from datetime import datetime, timezone

from services.llm_service import translate_and_detect_question, generate_summary, generate_custom_request

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/llm', tags=['llm'])


class TranslateRequest(BaseModel):
  text: str
  session_id: Optional[int] = None


class SummaryRequest(BaseModel):
  transcript: str
  session_id: Optional[int] = None
  instruction: Optional[str] = None  # N+88 재요약 요구사항


class CustomRequestBody(BaseModel):
  session_id: int
  transcript: str
  instruction: str
  current_result: Optional[str] = None   # 있으면 «이 결과를 요청대로 고쳐 줘»
  summary: Optional[str] = None


class CustomClearBody(BaseModel):
  session_id: int


async def _load_meeting_context(session_id: int, user_id: int) -> Optional[dict]:
  """Load brief/participants/pasted_context for a session the user owns."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      'SELECT user_id, brief, participants, pasted_context FROM sessions WHERE id = ?',
      (session_id,)
    )
    row = await cursor.fetchone()
  if not row or row['user_id'] != user_id:
    return None
  ctx = {}
  if row['brief']:
    ctx['brief'] = row['brief']
  if row['participants']:
    try:
      ctx['participants'] = json.loads(row['participants'])
    except (TypeError, ValueError):
      pass
  if row['pasted_context']:
    ctx['pasted_context'] = row['pasted_context']
  return ctx or None


@router.post('/translate')
async def translate(body: TranslateRequest, user: dict = Depends(get_current_user)):
  meeting_context = None
  if body.session_id is not None:
    meeting_context = await _load_meeting_context(body.session_id, user['user_id'])
  result = await translate_and_detect_question(body.text, meeting_context=meeting_context)
  if result.get('detected_language') == 'error':
    raise HTTPException(status_code=502, detail=result.get('error', 'LLM error'))
  return {'success': True, 'data': result}


@router.post('/summary')
async def summary(body: SummaryRequest, user: dict = Depends(get_current_user)):
  meeting_context = None
  if body.session_id is not None:
    meeting_context = await _load_meeting_context(body.session_id, user['user_id'])
  result = await generate_summary(body.transcript, meeting_context=meeting_context, instruction=body.instruction)
  # N+88 — 요약 영속 (휘발 방지). 본인 세션일 때만 저장.
  if body.session_id is not None:
    async with db_connect() as db:
      cur = await db.execute('SELECT user_id FROM sessions WHERE id = ?', (body.session_id,))
      row = await cur.fetchone()
      if row and row[0] == user['user_id']:
        await db.execute(
          "UPDATE sessions SET summary_key_points = ?, summary_full = ?, summarized_at = datetime('now') WHERE id = ?",
          (json.dumps(result.get('key_points', []), ensure_ascii=False), result.get('full_summary', ''), body.session_id),
        )
        await db.commit()
  return {'success': True, 'data': result}


# 2026-11-20 — AI 추가 요청 (기본 요약 옆에 따로 남는 가공 결과 1건). 만들기·다듬기·지우기 모두 생성자만.
@router.post('/custom')
async def custom_request(body: CustomRequestBody, user: dict = Depends(get_current_user)):
  instruction = (body.instruction or '').strip()
  if not instruction:
    raise HTTPException(status_code=400, detail='instruction_required')
  if not (body.transcript or '').strip():
    raise HTTPException(status_code=400, detail='empty_transcript')
  # LLM 실행은 생성자만(PERMISSION_MATRIX §5.8 · sessions._load_session_or_403 의 'write' 기준과 같다) —
  #   공개 범위로 열린 노트를 보는 사람은 결과를 읽기만 한다.
  async with db_connect() as db:
    cur = await db.execute('SELECT user_id FROM sessions WHERE id = ?', (body.session_id,))
    row = await cur.fetchone()
  if not row:
    raise HTTPException(status_code=404, detail='session_not_found')
  if row[0] != user['user_id']:
    raise HTTPException(status_code=403, detail='forbidden')
  meeting_context = await _load_meeting_context(body.session_id, user['user_id'])
  try:
    text = await generate_custom_request(
      body.transcript, instruction,
      current_result=body.current_result, summary=body.summary, meeting_context=meeting_context,
    )
  except Exception as e:
    logger.warning(f'custom_request failed: {e}')
    raise HTTPException(status_code=502, detail='ai_unavailable')
  if not text:
    raise HTTPException(status_code=422, detail='ai_empty')
  at = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
  async with db_connect() as db:
    await db.execute(
      'UPDATE sessions SET ai_request_text = ?, ai_request_result = ?, ai_request_at = ? WHERE id = ? AND user_id = ?',
      (instruction[:1000], text, at, body.session_id, user['user_id']),
    )
    await db.commit()
  return {'success': True, 'data': {'request': instruction[:1000], 'result': text, 'at': at, 'saved': True}}


@router.post('/custom/clear')
async def custom_clear(body: CustomClearBody, user: dict = Depends(get_current_user)):
  async with db_connect() as db:
    cur = await db.execute('SELECT user_id FROM sessions WHERE id = ?', (body.session_id,))
    row = await cur.fetchone()
    if not row:
      raise HTTPException(status_code=404, detail='session_not_found')
    if row[0] != user['user_id']:
      raise HTTPException(status_code=403, detail='forbidden')
    await db.execute(
      'UPDATE sessions SET ai_request_text = NULL, ai_request_result = NULL, ai_request_at = NULL WHERE id = ?',
      (body.session_id,),
    )
    await db.commit()
  return {'success': True, 'data': {'cleared': True}}
