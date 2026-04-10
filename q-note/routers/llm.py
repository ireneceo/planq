from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from middleware.auth import get_current_user
from services.llm_service import translate_and_detect_question, generate_summary

router = APIRouter(prefix='/api/llm', tags=['llm'])


class TranslateRequest(BaseModel):
  text: str


class SummaryRequest(BaseModel):
  transcript: str


@router.post('/translate')
async def translate(body: TranslateRequest, user: dict = Depends(get_current_user)):
  result = await translate_and_detect_question(body.text)
  if result.get('detected_language') == 'error':
    raise HTTPException(status_code=502, detail=result.get('error', 'LLM error'))
  return {'success': True, 'data': result}


@router.post('/summary')
async def summary(body: SummaryRequest, user: dict = Depends(get_current_user)):
  result = await generate_summary(body.transcript)
  return {'success': True, 'data': result}
