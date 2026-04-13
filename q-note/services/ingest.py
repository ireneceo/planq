"""
문서 인제스트 파이프라인.

documents 행 하나(파일 또는 URL)를 가져와 본문을 추출하고 청크로 나눠 FTS5 에 인덱싱.

흐름:
  pending → processing → (indexed | failed)

실패 시 documents.status='failed' + error_message 기록.

사용법:
    task = asyncio.create_task(ingest_document(doc_id))
    task.add_done_callback(log_task_exception)   # silent drop 방지
"""
import logging
import os
import traceback
from typing import Optional

import aiosqlite

from services.database import connect as db_connect
from services.url_fetcher import fetch_url, FetchError
from services.extractors import extract, ExtractError, ExtractResult
from services.chunker import chunk_text

logger = logging.getLogger(__name__)

UPLOADS_ROOT = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'uploads')


def log_task_exception(task):
  """asyncio.Task add_done_callback 용. 예외 silent drop 방지."""
  if task.cancelled():
    return
  exc = task.exception()
  if exc:
    logger.error('Ingest background task failed: %s\n%s', exc, ''.join(traceback.format_exception(type(exc), exc, exc.__traceback__)))


async def _update_status(db, doc_id: int, status: str, *, error_message: Optional[str] = None, chunk_count: Optional[int] = None, title: Optional[str] = None):
  fields = ['status = ?']
  values: list = [status]
  if error_message is not None:
    fields.append('error_message = ?'); values.append(error_message)
  if chunk_count is not None:
    fields.append('chunk_count = ?'); values.append(chunk_count)
  if title is not None:
    fields.append('title = ?'); values.append(title)
  if status == 'indexed':
    fields.append("indexed_at = datetime('now')")
  values.append(doc_id)
  await db.execute(f'UPDATE documents SET {", ".join(fields)} WHERE id = ?', values)
  await db.commit()


async def _load_file_body(doc_row) -> bytes:
  business_id = doc_row['business_id']
  session_id = doc_row['session_id']
  stored = doc_row['filename']
  path = os.path.join(UPLOADS_ROOT, str(business_id), str(session_id), stored)
  if not os.path.exists(path):
    raise ExtractError('업로드 파일을 찾을 수 없습니다')
  with open(path, 'rb') as f:
    return f.read()


async def ingest_document(doc_id: int) -> None:
  """
  단일 documents 행 인제스트.
  - source_type='file': 디스크에서 로드
  - source_type='url' : url_fetcher 로 다운로드
  → extract → chunk → document_chunks insert (FTS5 트리거가 자동 인덱싱)
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('SELECT * FROM documents WHERE id = ?', (doc_id,))
    row = await cursor.fetchone()
    if not row:
      logger.warning('ingest_document: doc %s not found', doc_id)
      return

    # 중복 실행 방지
    if row['status'] in ('processing', 'indexed'):
      logger.info('ingest_document: doc %s already in status=%s, skipping', doc_id, row['status'])
      return

    await _update_status(db, doc_id, 'processing', error_message=None)

    try:
      source_type = row['source_type'] or 'file'
      content_type: Optional[str] = row['mime_type']
      filename_hint: Optional[str] = row['original_filename']

      # 1) 본문 로드
      if source_type == 'url':
        url = row['source_url']
        if not url:
          raise ExtractError('source_url 이 비어있습니다')
        try:
          result = await fetch_url(url)
        except FetchError as e:
          raise ExtractError(f'URL 가져오기 실패: {e}')
        body = result.body
        content_type = result.content_type or content_type
        # URL 의 경우 filename_hint 가 없을 수 있음 → 최종 URL path 의 확장자 사용
        if not filename_hint:
          filename_hint = result.final_url.rsplit('/', 1)[-1] or None
      else:
        body = await _load_file_body(row)

      if not body:
        raise ExtractError('빈 본문')

      # 2) 텍스트 추출
      try:
        extracted: ExtractResult = await extract(body, content_type=content_type, filename_hint=filename_hint)
      except ExtractError:
        raise
      except Exception as e:
        raise ExtractError(f'추출 실패: {type(e).__name__}')

      # 3) 청크 분할
      chunks = chunk_text(extracted.text)
      if not chunks:
        raise ExtractError('청크를 생성할 수 없습니다 (본문 너무 짧음)')

      # 4) DB insert (기존 청크 제거 → 신규 insert)
      await db.execute('DELETE FROM document_chunks WHERE document_id = ?', (doc_id,))
      business_id = row['business_id']
      for idx, content in enumerate(chunks):
        await db.execute(
          '''INSERT INTO document_chunks (document_id, business_id, chunk_index, content)
             VALUES (?, ?, ?, ?)''',
          (doc_id, business_id, idx, content),
        )

      # 5) 상태 갱신
      final_title = extracted.title or row['title'] or row['original_filename']
      await _update_status(db, doc_id, 'indexed', chunk_count=len(chunks), title=final_title, error_message=None)
      logger.info('ingest_document: doc %s indexed (%s chunks)', doc_id, len(chunks))

      # 인제스트 완료 → 후처리 (백그라운드)
      if row['session_id']:
        sid = row['session_id']
        import asyncio as _asyncio
        # 1) 사전 Q&A 자동 생성
        try:
          from services.qa_generator import generate_qa_for_document, log_task_exception as qa_log
          task = _asyncio.create_task(generate_qa_for_document(doc_id, sid))
          task.add_done_callback(qa_log)
        except Exception as e:
          logger.warning('ingest_document: qa generation trigger failed: %s', e)
        # 2) 어휘사전 재추출 — 문서 내용 기반으로 session.keywords 갱신 (사용자 수동 추가 보존)
        try:
          from services.answer_service import refresh_session_vocabulary
          async def _refresh_vocab(_sid: int):
            try:
              n = await refresh_session_vocabulary(_sid, merge=True)
              logger.info('ingest_document: vocab refreshed session=%s total=%s', _sid, n)
            except Exception as _e:
              logger.warning('vocab refresh failed session=%s err=%s', _sid, _e)
          _asyncio.create_task(_refresh_vocab(sid))
        except Exception as e:
          logger.warning('ingest_document: vocab refresh trigger failed: %s', e)

    except ExtractError as e:
      await _update_status(db, doc_id, 'failed', error_message=str(e))
      logger.warning('ingest_document: doc %s failed: %s', doc_id, e)
    except Exception as e:
      await _update_status(db, doc_id, 'failed', error_message=f'내부 오류: {type(e).__name__}')
      logger.exception('ingest_document: doc %s unexpected failure', doc_id)
