"""
문서 기반 사전 Q&A 자동 생성.

문서 인제스트 완료 후 호출. 문서 청크에서 예상 질문+답변을 추출해
qa_pairs 테이블에 source='generated'로 저장.
"""
import json
import logging
import traceback
from typing import Optional

import aiosqlite

from services.database import connect as db_connect
from services.llm_service import generate_qa_from_chunks

logger = logging.getLogger('q-note.qa_gen')


def log_task_exception(task):
  if task.cancelled():
    return
  exc = task.exception()
  if exc:
    logger.error('QA generation task failed: %s\n%s', exc,
                 ''.join(traceback.format_exception(type(exc), exc, exc.__traceback__)))


async def generate_qa_for_document(doc_id: int, session_id: int) -> int:
  """
  문서의 청크에서 Q&A 쌍을 생성해 qa_pairs에 저장.
  Returns: 생성된 Q&A 쌍 수.
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row

    # 1. 문서 청크 로드
    cursor = await db.execute(
      'SELECT content FROM document_chunks WHERE document_id = ? ORDER BY chunk_index',
      (doc_id,)
    )
    chunks = [row['content'] for row in await cursor.fetchall()]
    if not chunks:
      logger.info(f'qa_gen: doc {doc_id} has no chunks, skipping')
      return 0

    # 2. 세션의 언어 설정 로드
    cursor = await db.execute(
      'SELECT answer_language, translation_language, meeting_languages, brief, participants, pasted_context FROM sessions WHERE id = ?',
      (session_id,)
    )
    sess = await cursor.fetchone()
    if not sess:
      logger.warning(f'qa_gen: session {session_id} not found')
      return 0

    meeting_lang = None
    if sess['meeting_languages']:
      try:
        langs = json.loads(sess['meeting_languages'])
        if langs and isinstance(langs, list):
          meeting_lang = langs[0]
      except Exception:
        pass

    answer_lang = sess['answer_language'] or meeting_lang
    translation_lang = sess['translation_language'] or ('en' if answer_lang == 'ko' else 'ko')

    meeting_context: Optional[dict] = None
    ctx_parts: dict = {}
    if sess['brief']:
      ctx_parts['brief'] = sess['brief']
    if sess['participants']:
      try:
        ctx_parts['participants'] = json.loads(sess['participants'])
      except Exception:
        pass
    if sess['pasted_context']:
      ctx_parts['pasted_context'] = sess['pasted_context']
    if ctx_parts:
      meeting_context = ctx_parts

  # 3. LLM으로 Q&A 생성 (DB connection 밖에서 — 시간 오래 걸릴 수 있음)
  qa_pairs = await generate_qa_from_chunks(
    chunks,
    meeting_context=meeting_context,
    answer_language=answer_lang,
    translation_language=translation_lang,
  )

  if not qa_pairs:
    logger.info(f'qa_gen: doc {doc_id} generated 0 Q&A pairs')
    return 0

  # 4. DB 저장
  count = 0
  new_ids: list[int] = []
  async with db_connect() as db:
    for idx, pair in enumerate(qa_pairs):
      q = (pair.get('question') or '').strip()
      a = (pair.get('answer') or '').strip()
      if not q:
        continue

      cursor = await db.execute('''
        INSERT INTO qa_pairs (session_id, source, category, question_text, answer_text, answer_translation, confidence, sort_order)
        VALUES (?, 'generated', ?, ?, ?, ?, ?, ?)
      ''', (
        session_id,
        pair.get('category'),
        q,
        a or None,
        (pair.get('answer_translation') or '').strip() or None,
        pair.get('confidence', 'medium'),
        idx,
      ))
      new_ids.append((cursor.lastrowid, q))
      count += 1

    await db.commit()

  # 임베딩 백그라운드 계산
  try:
    from services.answer_service import ensure_qa_embedding
    import asyncio as _asyncio
    for _id, _q in new_ids:
      _asyncio.create_task(ensure_qa_embedding(_id, _q))
  except Exception as e:
    logger.warning(f'qa_gen embedding schedule failed: {e}')

  logger.info(f'qa_gen: doc {doc_id} session {session_id} → {count} Q&A pairs generated')
  return count


async def generate_qa_for_session(session_id: int) -> int:
  """
  세션의 모든 indexed 문서에서 Q&A 생성 (수동 트리거용).
  기존 generated Q&A는 유지 (중복 방지는 추후).
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      "SELECT id FROM documents WHERE session_id = ? AND status = 'indexed'",
      (session_id,)
    )
    docs = await cursor.fetchall()

  total = 0
  for doc in docs:
    total += await generate_qa_for_document(doc['id'], session_id)
  return total
