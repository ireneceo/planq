import json
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from middleware.auth import get_current_user
from services.database import DB_PATH, connect as db_connect
from services.llm_service import translate_and_detect_question, generate_summary

router = APIRouter(prefix='/api/llm', tags=['llm'])


class TranslateRequest(BaseModel):
  text: str
  session_id: Optional[int] = None


class SummaryRequest(BaseModel):
  transcript: str
  session_id: Optional[int] = None


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
  result = await generate_summary(body.transcript, meeting_context=meeting_context)
  return {'success': True, 'data': result}
