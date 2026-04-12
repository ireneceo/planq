"""
답변 찾기 서비스 — 3단계 우선순위.

1순위: 고객 직접 등록 Q&A (source='custom' 또는 is_reviewed=1)
2순위: AI 사전 생성 Q&A (source='generated')
3순위: 문서 청크 RAG (FTS5 검색 → LLM 답변 생성)
4순위: 일반 AI (자료 없이, 회의 컨텍스트만)

속도 전략:
- Tier 1+2: FTS5 검색 ~5ms (하나의 쿼리로 custom 우선, generated 차선)
- Tier 3: FTS5 ~10ms + LLM ~2-3초
- Tier 4: LLM ~2-3초
- 질문 감지 즉시 _prefetch_answer 로 백그라운드 실행 → 사용자 클릭 시 캐시 반환
"""
import logging
import re
from typing import Optional

import aiosqlite

from services.database import connect as db_connect
from services.llm_service import generate_answer, translate_text

logger = logging.getLogger('q-note.answer')

# FTS5 BM25 rank: 항상 음수 또는 0. 값이 작을수록(더 음수) 좋은 매칭.
# OR 쿼리 사용 시 부분 매칭이 많아 rank 가 0에 가까울 수 있음.
# 실질적으로 1개 이상 단어가 매칭되면 유효한 결과로 취급.
QA_MATCH_THRESHOLD = 0.0  # rank <= 0 이면 매칭 (FTS5 rank는 항상 <= 0)


_STOPWORDS = frozenset({
  # English
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose',
  'where', 'when', 'how', 'why',
  'in', 'on', 'at', 'by', 'for', 'with', 'about', 'from', 'to', 'of',
  'and', 'or', 'but', 'not', 'if', 'so', 'as', 'than',
  # Korean particles/common
  '이', '가', '은', '는', '을', '를', '의', '에', '에서', '로', '으로', '와', '과',
  '도', '만', '까지', '부터', '보다', '처럼', '같은', '대해', '대한',
  '그', '이', '저', '것', '수', '등', '및', '또는', '그리고',
})


def _fts5_escape(text: str) -> str:
  """FTS5 MATCH 쿼리용.
  - 특수문자 제거, stopwords 제외
  - 각 단어를 prefix 매칭으로 (한국어 조사 대응: "회의"*  → 회의, 회의는, 회의를 모두 매칭)
  - 어미 2글자 이상 제거로 어간 추출 (간단히 앞 2-N자 prefix 사용)
  """
  cleaned = re.sub(r'["\'\(\)\*\+\-\:\;\,\.\?\!]', ' ', text)
  words = [w for w in cleaned.split() if w.lower() not in _STOPWORDS and len(w) >= 2]
  if not words:
    return '""'
  # prefix 매칭: 한국어는 어간 2자 prefix (조사/어미/활용 대응), 영숫자는 그대로
  terms = []
  for w in words[:15]:
    is_korean = any('\uac00' <= ch <= '\ud7a3' for ch in w)
    if is_korean:
      # 한국어는 앞 2자 prefix. "참여하나요" → "참여*" → "참여자" 매칭
      stem = w[:2] if len(w) > 2 else w
    else:
      stem = w
    terms.append(f'{stem}*')
  return ' OR '.join(terms)


async def _search_qa_pairs(
  session_id: int,
  question_text: str,
) -> Optional[dict]:
  """
  FTS5 BM25 기반 Q&A 검색.
  custom(+is_reviewed) 우선, generated 차선. 최고 점수 1건 반환.
  """
  query = _fts5_escape(question_text)
  if not query or query == '""':
    return None

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    try:
      cursor = await db.execute('''
        SELECT q.*,
               rank AS score,
               CASE
                 WHEN q.source = 'custom' OR q.is_reviewed = 1 THEN 1
                 ELSE 2
               END AS tier_order
        FROM qa_pairs q
        JOIN qa_pairs_fts fts ON q.id = fts.rowid
        WHERE qa_pairs_fts MATCH ?
          AND q.session_id = ?
          AND q.answer_text IS NOT NULL
          AND q.answer_text != ''
        ORDER BY tier_order ASC, rank ASC
        LIMIT 1
      ''', (query, session_id))
      row = await cursor.fetchone()
      if row and row['score'] <= QA_MATCH_THRESHOLD:
        result = dict(row)
        result['tier'] = 'custom' if result['tier_order'] == 1 else 'generated'
        return result
    except Exception as e:
      logger.warning(f'qa_pairs FTS5 search failed: {e}')
  return None


async def _search_document_chunks(
  session_id: int,
  question_text: str,
  top_k: int = 5,
) -> list[dict]:
  """세션에 연결된 문서의 청크에서 FTS5 검색."""
  query = _fts5_escape(question_text)
  if not query or query == '""':
    return []

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    try:
      cursor = await db.execute('''
        SELECT c.id, c.document_id, c.content, c.chunk_index, rank AS score
        FROM document_chunks c
        JOIN document_chunks_fts fts ON c.id = fts.rowid
        JOIN documents d ON c.document_id = d.id
        WHERE document_chunks_fts MATCH ?
          AND d.session_id = ?
          AND d.status = 'indexed'
        ORDER BY rank ASC
        LIMIT ?
      ''', (query, session_id, top_k))
      rows = await cursor.fetchall()
      return [dict(r) for r in rows]
    except Exception as e:
      logger.warning(f'document_chunks FTS5 search failed: {e}')
  return []


async def _load_meeting_context(session_id: int) -> Optional[dict]:
  """세션의 회의 컨텍스트 + 사용자 프로필 로드."""
  import json as _json
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      '''SELECT brief, participants, pasted_context,
                answer_language, translation_language, meeting_languages,
                user_name, user_bio, user_expertise, user_organization, user_job_title
         FROM sessions WHERE id = ?''',
      (session_id,)
    )
    row = await cursor.fetchone()
    if not row:
      return None
    ctx: dict = {}
    if row['brief']:
      ctx['brief'] = row['brief']
    if row['participants']:
      try:
        ctx['participants'] = _json.loads(row['participants'])
      except Exception:
        pass
    if row['pasted_context']:
      ctx['pasted_context'] = row['pasted_context']
    # 사용자 프로필 (답변을 "나"로서 하기 위해)
    profile = {}
    if row['user_name']: profile['name'] = row['user_name']
    if row['user_bio']: profile['bio'] = row['user_bio']
    if row['user_expertise']: profile['expertise'] = row['user_expertise']
    if row['user_organization']: profile['organization'] = row['user_organization']
    if row['user_job_title']: profile['job_title'] = row['user_job_title']
    if profile:
      ctx['user_profile'] = profile
    return ctx if ctx else None


async def _get_session_languages(session_id: int) -> tuple[Optional[str], Optional[str], Optional[str]]:
  """세션의 (answer_language, translation_language, meeting_language) 반환."""
  import json as _json
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      'SELECT answer_language, translation_language, meeting_languages FROM sessions WHERE id = ?',
      (session_id,)
    )
    row = await cursor.fetchone()
    if not row:
      return None, None, None
    meeting_lang = None
    if row['meeting_languages']:
      try:
        langs = _json.loads(row['meeting_languages'])
        if langs and isinstance(langs, list):
          meeting_lang = langs[0]
      except Exception:
        pass
    return row['answer_language'], row['translation_language'], meeting_lang


async def find_answer(
  session_id: int,
  question_text: str,
  meeting_context: Optional[dict] = None,
) -> dict:
  """
  3단계 우선순위로 답변 탐색.
  Returns: {
    tier: 'custom' | 'generated' | 'rag' | 'general' | 'none',
    answer: str | None,
    answer_translation: str | None,
    confidence: str | None,
    sources: list,
    matched_qa_id: int | None,
  }
  """
  # 답변/번역 언어 결정
  answer_lang, translation_lang, meeting_lang = await _get_session_languages(session_id)
  effective_answer_lang = answer_lang or meeting_lang
  effective_translation_lang = translation_lang or ('en' if effective_answer_lang == 'ko' else 'ko')

  if not meeting_context:
    meeting_context = await _load_meeting_context(session_id)

  # ── Tier 1+2: Q&A 쌍 검색 (custom 우선, generated 차선) ──
  qa_match = await _search_qa_pairs(session_id, question_text)
  if qa_match:
    return {
      'tier': qa_match['tier'],
      'answer': qa_match['answer_text'],
      'answer_translation': qa_match.get('answer_translation') or '',
      'confidence': qa_match.get('confidence') or 'high',
      'sources': [],
      'matched_qa_id': qa_match['id'],
      '_translation_lang': effective_translation_lang,
    }

  # ── Tier 3: 문서 청크 RAG ──
  chunks = await _search_document_chunks(session_id, question_text)
  if chunks:
    result = await generate_answer(
      question_text, [c['content'] for c in chunks], meeting_context,
      answer_language=effective_answer_lang,
    )
    answer_text = result.get('answer', '')
    if answer_text and '찾지 못했습니다' not in answer_text and 'not in the context' not in answer_text.lower():
      return {
        'tier': 'rag',
        'answer': answer_text,
        'answer_translation': '',
        'confidence': result.get('confidence', 'medium'),
        'sources': [{'chunk_id': c['id'], 'snippet': c['content'][:150]} for c in chunks[:3]],
        'matched_qa_id': None,
        '_translation_lang': effective_translation_lang,
      }

  # ── Tier 4: 일반 AI (자료 없이) ──
  result = await generate_answer(
    question_text, [], meeting_context,
    answer_language=effective_answer_lang,
  )
  answer_text = result.get('answer', '')
  if answer_text:
    return {
      'tier': 'general',
      'answer': answer_text,
      'answer_translation': '',
      'confidence': result.get('confidence', 'low'),
      'sources': [],
      'matched_qa_id': None,
      '_translation_lang': effective_translation_lang,
    }

  return {
    'tier': 'none', 'answer': None, 'answer_translation': None,
    'confidence': None, 'sources': [], 'matched_qa_id': None,
  }


async def translate_answer_text(answer_text: str, translation_lang: str) -> str:
  """답변 텍스트를 번역. 답변 반환 후 백그라운드에서 호출."""
  if not answer_text or not translation_lang:
    return ''
  return await translate_text(answer_text, translation_lang)
