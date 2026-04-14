"""
답변 찾기 서비스 — 6단계 우선순위 + 시맨틱 임베딩 재랭킹.

1순위: priority Q&A (is_priority=1) — 사용자가 "최우선"으로 업로드한 Q&A
2순위: custom Q&A (source='custom' or is_reviewed=1)
3순위: session history — 같은 세션에서 이미 답변한 유사 질문 재사용
4순위: generated Q&A (source='generated', 문서에서 미리 생성)
5순위: 문서 청크 RAG (FTS5 + LLM)
6순위: 일반 AI (프로필 기반)

각 Q&A 단계는 FTS5(렉시컬)로 후보군을 뽑고 OpenAI 임베딩으로 재랭킹해
paraphrase 대응력을 확보한다.

속도:
- Tier 1-2 (priority + custom): FTS5 ~5ms + 임베딩 ~200ms = 총 ~250ms
- Tier 3 (session history): in-memory 임베딩 ~10ms
- Tier 4-5 (generated + RAG): 같은 방식
- Tier 6 (general): LLM ~2-3s
"""
import logging
import re
from typing import Optional

import aiosqlite
import numpy as np

from services.database import connect as db_connect
from services.llm_service import (
  generate_answer, translate_text, llm_match_question, generate_vocabulary_list,
  augment_answer_with_rag,
  _enforce_length_cap,
)
from services.embedding_service import (
  embed_text, blob_to_embedding, cosine_similarity as embed_cosine,
  embedding_to_blob,
)

logger = logging.getLogger('q-note.answer')


def _detect_simple_lang(text: str) -> Optional[str]:
  """Minimal heuristic language detection for pre-registered Q&A answers.
  - 한글 음절 포함 → 'ko'
  - 아니고 ASCII 라틴 문자 포함 → 'en'
  - 그 외 (JP/ZH 등) → None (번역 스킵)
  """
  if not text:
    return None
  has_hangul = any('\uAC00' <= c <= '\uD7A3' for c in text)
  if has_hangul:
    return 'ko'
  has_latin = any(('a' <= c <= 'z') or ('A' <= c <= 'Z') for c in text)
  if has_latin:
    return 'en'
  return None

# FTS5 BM25 rank 임계값 (1차 필터용 — 관대하게)
FTS_THRESHOLD = 0.0
# 시맨틱 임베딩 최소 유사도 (paraphrase 매칭 게이트)
# priority 는 사용자가 직접 등록한 것이므로 매우 관대.
# 실측: "What are you researching?" vs "What is your core research topic? ..." → 0.495
# 완전 무관한 질문 ("What is your favorite food?") → 0.20 ~ 0.30
# → 임계값 0.35 (paraphrase 폭 확보 + 노이즈 제거)
SEMANTIC_THRESHOLD_PRIORITY = 0.35
SEMANTIC_THRESHOLD_CUSTOM = 0.50
SEMANTIC_THRESHOLD_GENERATED = 0.60
# Session history 는 near-duplicate 질문만 재사용. 관련 있지만 다른 질문은 절대 재사용 금지.
# 실측: 동일 질문 paraphrase 0.88~0.96, 같은 주제 다른 aspect 0.78~0.88 → 0.93 으로 엄격히.
SEMANTIC_THRESHOLD_SESSION_HISTORY = 0.93
SEMANTIC_THRESHOLD_RAG = 0.50


_STOPWORDS = frozenset({
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'whose',
  'where', 'when', 'how', 'why',
  'in', 'on', 'at', 'by', 'for', 'with', 'about', 'from', 'to', 'of',
  'and', 'or', 'but', 'not', 'if', 'so', 'as', 'than',
  '이', '가', '은', '는', '을', '를', '의', '에', '에서', '로', '으로', '와', '과',
  '도', '만', '까지', '부터', '보다', '처럼', '같은', '대해', '대한',
  '그', '이', '저', '것', '수', '등', '및', '또는', '그리고',
})


def _fts5_escape(text: str) -> str:
  cleaned = re.sub(r'["\'\(\)\*\+\-\:\;\,\.\?\!]', ' ', text)
  words = [w for w in cleaned.split() if w.lower() not in _STOPWORDS and len(w) >= 2]
  if not words:
    return '""'
  terms = []
  for w in words[:15]:
    is_korean = any('\uac00' <= ch <= '\ud7a3' for ch in w)
    if is_korean:
      stem = w[:2] if len(w) > 2 else w
    else:
      stem = w
    terms.append(f'{stem}*')
  return ' OR '.join(terms)


async def _fts5_candidates(
  session_id: int,
  question_text: str,
  where_extra: str,
  params_extra: tuple,
  limit: int = 10,
) -> list[dict]:
  """FTS5 로 Q&A 후보군 추출 (1차 필터). 반환: qa_pair 레코드 리스트."""
  query = _fts5_escape(question_text)
  if not query or query == '""':
    return []
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    try:
      cursor = await db.execute(f'''
        SELECT q.*, rank AS fts_score
        FROM qa_pairs q
        JOIN qa_pairs_fts fts ON q.id = fts.rowid
        WHERE qa_pairs_fts MATCH ?
          AND q.session_id = ?
          AND q.answer_text IS NOT NULL
          AND q.answer_text != ''
          {where_extra}
        ORDER BY rank ASC
        LIMIT ?
      ''', (query, session_id, *params_extra, limit))
      rows = await cursor.fetchall()
      return [dict(r) for r in rows]
    except Exception as e:
      logger.warning(f'qa FTS5 candidate fetch failed: {e}')
  return []


async def _semantic_rerank(
  candidates: list[dict],
  q_emb: Optional[np.ndarray],
  threshold: float,
) -> Optional[dict]:
  """후보군을 임베딩으로 재랭킹해 최고 유사도 1건 반환.
  q_emb 이 None 이면 FTS5 score 만 사용 (1개 반환).
  후보 중 일부 임베딩이 누락된 경우: 누락된 후보는 그 자리에서 임베딩을 계산해
  레이스 상황에서도 priority/custom 매칭이 누락되지 않게 한다."""
  if not candidates:
    return None
  if q_emb is None:
    best = candidates[0]
    best['semantic_score'] = None
    return best

  scored: list[tuple[float, dict]] = []
  for c in candidates:
    c_emb = None
    emb_blob = c.get('embedding')
    if emb_blob:
      c_emb = blob_to_embedding(emb_blob)
    if c_emb is None:
      # 레이스 대응: 즉석 임베딩 계산 + 저장 (질문 + 키워드 합침)
      try:
        qt = c.get('question_text') or ''
        kw = c.get('keywords') or ''
        emb_input = f'{qt} {kw}'.strip() if kw else qt
        c_emb = await embed_text(emb_input)
        if c_emb is not None:
          async with db_connect() as db:
            await db.execute(
              'UPDATE qa_pairs SET embedding = ? WHERE id = ?',
              (embedding_to_blob(c_emb), c['id']),
            )
            await db.commit()
      except Exception as e:
        logger.warning(f'inline embed failed id={c.get("id")}: {e}')
    if c_emb is None:
      # 그래도 실패하면 FTS5 rank 만으로 점수 계산 (매우 관대한 값 0.5 대입)
      sim = 0.5
    else:
      sim = embed_cosine(q_emb, c_emb)
    scored.append((sim, c))
  if not scored:
    return None
  scored.sort(key=lambda x: -x[0])
  top_sim, top = scored[0]
  if top_sim < threshold:
    return None
  top['semantic_score'] = top_sim
  return top


async def _search_priority_qa(
  session_id: int, question_text: str, q_emb: Optional[np.ndarray]
) -> Optional[dict]:
  """Priority Q&A — 3단계 보수적 매칭:
  1) 임베딩 top-5 후보 추출
  2) top sim >= 0.72 AND 상위 2위 sim 과 차이 >= 0.08 → 직접 반환 (명백한 paraphrase)
  3) top sim ∈ [0.30, 0.72) → LLM 에게 엄격한 2차 검증, 확신 없으면 None
  4) top sim < 0.30 → None (너무 낮으면 애초에 관련 없음)

  정책: **잘못된 매칭은 누락보다 훨씬 해롭다**. 사용자 신뢰가 1순위.
  - 임베딩 top 이 부정확할 수 있으므로 (예: 키워드 overlap 만 있는 경우) 절대 우선 받지 않음
  - LLM 은 엄격 프롬프트로 의심 시 0 반환
  - 여기서 None 반환하면 다음 tier(custom → session reuse → generated → RAG → general)로 fallback"""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('''
      SELECT * FROM qa_pairs
      WHERE session_id = ? AND is_priority = 1
        AND answer_text IS NOT NULL AND answer_text != ''
      LIMIT 500
    ''', (session_id,))
    rows = await cursor.fetchall()
  candidates = [dict(r) for r in rows]
  logger.info(f'priority search session={session_id}: {len(candidates)} candidates')
  if not candidates:
    return None

  # 임베딩으로 sim 계산 + 정렬
  if q_emb is None:
    # 임베딩 실패 시 LLM 만으로 판단
    qs = [c.get('question_text') or '' for c in candidates]
    n = await llm_match_question(question_text, qs)
    if n > 0 and n <= len(candidates):
      result = candidates[n - 1]
      result['semantic_score'] = None
      logger.info(f'priority LLM-matched id={result.get("id")} (no emb)')
      return result
    return None

  scored: list[tuple[float, dict]] = []
  for c in candidates:
    emb = c.get('embedding')
    c_emb = blob_to_embedding(emb) if emb else None
    if c_emb is None:
      # 인라인 임베딩
      try:
        qt = c.get('question_text') or ''
        kw = c.get('keywords') or ''
        emb_input = f'{qt} {kw}'.strip() if kw else qt
        c_emb = await embed_text(emb_input)
        if c_emb is not None:
          async with db_connect() as db:
            await db.execute(
              'UPDATE qa_pairs SET embedding = ? WHERE id = ?',
              (embedding_to_blob(c_emb), c['id']),
            )
            await db.commit()
      except Exception:
        pass
    if c_emb is not None:
      scored.append((embed_cosine(q_emb, c_emb), c))
  if not scored:
    return None
  scored.sort(key=lambda x: -x[0])

  top_sim, top = scored[0]
  second_sim = scored[1][0] if len(scored) > 1 else 0.0
  logger.info(
    f'priority top sim={top_sim:.3f} (2nd={second_sim:.3f}) '
    f'id={top.get("id")} q={(top.get("question_text") or "")[:60]!r}'
  )

  # 하드 하한 — 너무 낮으면 완전 무관. 다음 tier 로.
  if top_sim < 0.30:
    logger.info(f'priority: sim below hard floor (0.30) → skip tier')
    return None

  # 명백한 매칭: top sim 이 매우 높고 + 2위와의 gap 도 충분 (ambiguity 없음)
  # 실측: 동일 질문 paraphrase → 0.75~0.95, 관련 없는 질문 → 0.2~0.5
  # 0.72 + gap 0.08 이면 "확실" 인정.
  if top_sim >= 0.72 and (top_sim - second_sim) >= 0.08:
    top['semantic_score'] = top_sim
    logger.info(f'priority: direct-accept (high sim, clear gap)')
    return top

  # 중간 구간 — LLM 엄격 검증 (top-5)
  top_candidates = [s[1] for s in scored[:5]]
  qs = [c.get('question_text') or '' for c in top_candidates]
  n = await llm_match_question(question_text, qs)
  logger.info(f'priority LLM verify: n={n} (of {len(qs)})')
  if n > 0 and n <= len(top_candidates):
    result = top_candidates[n - 1]
    for s, c in scored[:5]:
      if c is result:
        result['semantic_score'] = s
        break
    return result
  # LLM 도 no-match → 다음 tier 로 (절대 잘못된 답 반환 금지)
  return None


async def _search_custom_qa(
  session_id: int, question_text: str, q_emb: Optional[np.ndarray]
) -> Optional[dict]:
  candidates = await _fts5_candidates(
    session_id, question_text,
    "AND q.is_priority = 0 AND (q.source = 'custom' OR q.is_reviewed = 1)",
    (), limit=10,
  )
  return await _semantic_rerank(candidates, q_emb, SEMANTIC_THRESHOLD_CUSTOM)


async def _search_generated_qa(
  session_id: int, question_text: str, q_emb: Optional[np.ndarray]
) -> Optional[dict]:
  candidates = await _fts5_candidates(
    session_id, question_text,
    "AND q.is_priority = 0 AND q.source = 'generated' AND q.is_reviewed = 0",
    (), limit=10,
  )
  return await _semantic_rerank(candidates, q_emb, SEMANTIC_THRESHOLD_GENERATED)


async def _load_session_history(session_id: int, limit: int = 30) -> list[dict]:
  """같은 세션에서 이미 답변한 질문-답변 리스트 (최신 순)."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('''
      SELECT id, utterance_id, question_text, answer_text, answer_tier, answered_at
      FROM detected_questions
      WHERE session_id = ?
        AND answer_text IS NOT NULL
        AND answer_text != ''
      ORDER BY id DESC
      LIMIT ?
    ''', (session_id, limit))
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def _search_session_history(
  session_id: int, question_text: str, q_emb: Optional[np.ndarray]
) -> Optional[dict]:
  """같은 세션에서 이미 답변한 질문 중 시맨틱 유사도 매우 높은 것만 재사용.

  보수적 정책 (정확성 > 재사용):
  1) 임베딩 sim >= 0.93 (사실상 동일 질문의 paraphrase 만)
  2) 같은 주제 다른 aspect 는 재사용 금지 (예: "choose X" vs "what is X" → 다름)
  3) LLM 엄격 verify 로 2차 확인 — 확신 없으면 None → 다음 tier 로 fallback
  """
  if q_emb is None:
    return None
  history = await _load_session_history(session_id)
  if not history:
    return None
  from services.embedding_service import embed_batch
  texts = [h['question_text'] for h in history]
  embs = await embed_batch(texts)
  # 임베딩 기준 top 5 후보
  scored: list[tuple[float, dict]] = []
  for h, emb in zip(history, embs):
    if emb is None:
      continue
    sim = embed_cosine(q_emb, emb)
    scored.append((sim, h))
  if not scored:
    return None
  scored.sort(key=lambda x: -x[0])
  top_sim, top_item = scored[0]
  logger.info(f'session_reuse top sim={top_sim:.3f} q={(top_item.get("question_text") or "")[:60]!r}')

  # 하드 하한 — 진짜 거의 같은 질문만
  if top_sim < SEMANTIC_THRESHOLD_SESSION_HISTORY:
    return None

  # 여기서 LLM 한 번 더 검증 — session_reuse 는 데이터 오염이 전파되는 tier 이므로 엄격하게
  top_candidates = [s[1] for s in scored[:5] if s[0] >= 0.85]
  if top_candidates:
    qs = [c.get('question_text') or '' for c in top_candidates]
    n = await llm_match_question(question_text, qs)
    if n == 0:
      logger.info('session_reuse: LLM verify rejected — fallback to next tier')
      return None
    if 1 <= n <= len(top_candidates):
      top_item = top_candidates[n - 1]
      top_sim = next((s for s, c in scored if c is top_item), top_sim)
  best_sim = top_sim
  best_item = top_item
  return {
    'answer_text': best_item['answer_text'],
    'answer_translation': '',
    'confidence': 'high',
    'semantic_score': best_sim,
    'matched_qa_id': None,
    'reused_from_utterance_id': best_item.get('utterance_id'),
  }


async def _search_document_chunks(
  session_id: int, question_text: str, top_k: int = 5,
) -> list[dict]:
  """문서 청크 FTS5 검색. 실패 시 인덱싱된 문서가 있으면 fallback 으로 첫 N개 청크 반환."""
  query = _fts5_escape(question_text)

  # 먼저 세션에 indexed 문서가 있는지 확인
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cur = await db.execute(
      "SELECT COUNT(*) AS cnt FROM documents WHERE session_id = ? AND status = 'indexed'",
      (session_id,),
    )
    doc_count = (await cur.fetchone())['cnt']

  if doc_count == 0:
    return []

  logger.info(f'RAG search session={session_id}: {doc_count} indexed docs, fts_query={query!r}')

  if query and query != '""':
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
        rows = [dict(r) for r in await cursor.fetchall()]
        if rows:
          logger.info(f'RAG FTS5 matched {len(rows)} chunks')
          return rows
      except Exception as e:
        logger.warning(f'document_chunks FTS5 search failed: {e}')

  # FTS5 매칭 실패했지만 문서는 있음 → 전체 청크 중 앞부분을 컨텍스트로 사용 (fallback)
  # LLM 이 어쨌든 문서 내용을 볼 수 있도록
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('''
      SELECT c.id, c.document_id, c.content, c.chunk_index
      FROM document_chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE d.session_id = ? AND d.status = 'indexed'
      ORDER BY c.document_id, c.chunk_index
      LIMIT ?
    ''', (session_id, top_k))
    rows = [dict(r) for r in await cursor.fetchall()]
  logger.info(f'RAG fallback (no FTS5 match): returning first {len(rows)} chunks')
  return rows


async def _load_meeting_context(session_id: int) -> Optional[dict]:
  """세션의 회의 컨텍스트 + 사용자 프로필 + 스타일 설정 로드."""
  import json as _json
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute('''
      SELECT brief, participants, pasted_context,
             answer_language, translation_language, meeting_languages,
             user_name, user_bio, user_expertise, user_organization, user_job_title,
             user_language_levels, user_expertise_level,
             meeting_answer_style, meeting_answer_length
      FROM sessions WHERE id = ?
    ''', (session_id,))
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
    profile = {}
    if row['user_name']: profile['name'] = row['user_name']
    if row['user_bio']: profile['bio'] = row['user_bio']
    if row['user_expertise']: profile['expertise'] = row['user_expertise']
    if row['user_organization']: profile['organization'] = row['user_organization']
    if row['user_job_title']: profile['job_title'] = row['user_job_title']
    if profile:
      ctx['user_profile'] = profile
    # 스타일 설정
    if row['user_language_levels']:
      try:
        ctx['language_levels'] = _json.loads(row['user_language_levels'])
      except Exception:
        pass
    if row['user_expertise_level']:
      ctx['expertise_level'] = row['user_expertise_level']
    if row['meeting_answer_style']:
      ctx['meeting_style'] = row['meeting_answer_style']
    if row['meeting_answer_length']:
      ctx['meeting_length'] = row['meeting_answer_length']
    return ctx if ctx else None


async def _get_session_languages(session_id: int) -> tuple[Optional[str], Optional[str], Optional[str]]:
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


async def refresh_session_vocabulary(session_id: int, merge: bool = True) -> int:
  """세션의 어휘사전을 인덱싱된 문서 청크 기반으로 재추출.

  우선순위 (LLM 프롬프트 소스):
    1. 인덱싱된 문서 청크 (HIGHEST — 자료 그대로 복사)
    2. 붙여넣기 텍스트 (pasted_context)
    3. 브리프
    4. 참여자·사용자 프로필 (이름)

  merge=True: 기존 session.keywords 에 새 키워드를 병합 (사용자 수동 추가 보존).
  merge=False: 덮어쓰기.

  Returns: 최종 session.keywords 의 개수.
  """
  import json as _json
  import logging as _logging
  _log = _logging.getLogger('q-note.vocab')

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cur = await db.execute(
      '''SELECT brief, participants, pasted_context, meeting_languages, keywords,
                user_name, user_bio, user_expertise, user_organization, user_job_title
         FROM sessions WHERE id = ?''',
      (session_id,),
    )
    sess = await cur.fetchone()
    if not sess:
      return 0

    # 1. 인덱싱된 문서 청크 — 원자료 (청크 index 순서대로 상위 ~20개 병합)
    cur = await db.execute('''
      SELECT c.content FROM document_chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE d.session_id = ? AND d.status = 'indexed'
      ORDER BY c.document_id, c.chunk_index
      LIMIT 20
    ''', (session_id,))
    chunk_rows = await cur.fetchall()
    excerpts = [r['content'] for r in chunk_rows if r['content']]

  # 파라미터 준비
  participants = None
  if sess['participants']:
    try:
      participants = _json.loads(sess['participants'])
    except Exception:
      pass

  meeting_languages = None
  if sess['meeting_languages']:
    try:
      meeting_languages = _json.loads(sess['meeting_languages'])
    except Exception:
      pass

  user_profile = {}
  for k in ('user_name', 'user_bio', 'user_expertise', 'user_organization', 'user_job_title'):
    v = sess[k]
    if v:
      user_profile[k.replace('user_', '')] = v

  # LLM 호출 — 문서 excerpts 가 있으면 primary 소스
  extracted = await generate_vocabulary_list(
    brief=sess['brief'],
    pasted_context=sess['pasted_context'],
    participants=participants,
    user_profile=user_profile or None,
    meeting_languages=meeting_languages,
    document_excerpts=excerpts if excerpts else None,
  )

  _log.info(f'refresh_session_vocabulary session={session_id}: chunks={len(excerpts)} extracted={len(extracted)}')

  # 기존 keywords 와 병합
  final: list[str] = []
  seen: set[str] = set()
  if merge and sess['keywords']:
    try:
      existing = _json.loads(sess['keywords'])
      if isinstance(existing, list):
        for w in existing:
          if isinstance(w, str):
            k = w.strip().lower()
            if k and k not in seen:
              seen.add(k)
              final.append(w.strip())
    except Exception:
      pass

  for w in extracted:
    if not isinstance(w, str):
      continue
    k = w.strip().lower()
    if k and k not in seen:
      seen.add(k)
      final.append(w.strip())

  final = final[:200]

  # DB 저장
  async with db_connect() as db:
    await db.execute(
      'UPDATE sessions SET keywords = ?, updated_at = datetime("now") WHERE id = ?',
      (_json.dumps(final) if final else None, session_id),
    )
    await db.commit()

  return len(final)


async def ensure_qa_embedding(qa_id: int, text: str) -> None:
  """Q&A 임베딩이 없으면 계산해서 저장."""
  emb = await embed_text(text)
  if emb is None:
    return
  async with db_connect() as db:
    await db.execute(
      'UPDATE qa_pairs SET embedding = ? WHERE id = ?',
      (embedding_to_blob(emb), qa_id),
    )
    await db.commit()


async def backfill_qa_embeddings(session_id: int) -> int:
  """세션의 임베딩 누락된 Q&A 채움 (질문 + 키워드 합침). 반환: 채운 개수."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      'SELECT id, question_text, keywords FROM qa_pairs WHERE session_id = ? AND embedding IS NULL',
      (session_id,),
    )
    rows = await cursor.fetchall()
  count = 0
  for r in rows:
    emb_text = r['question_text']
    if r['keywords']:
      emb_text = f"{emb_text} {r['keywords']}"
    await ensure_qa_embedding(r['id'], emb_text)
    count += 1
  return count


async def find_answer(
  session_id: int,
  question_text: str,
  meeting_context: Optional[dict] = None,
) -> dict:
  """
  6단계 우선순위로 답변 탐색.
  Returns: {
    tier: 'priority'|'custom'|'session_reuse'|'generated'|'rag'|'general'|'none',
    answer, answer_translation, confidence, sources, matched_qa_id, _translation_lang
  }
  """
  answer_lang, translation_lang, meeting_lang = await _get_session_languages(session_id)
  effective_answer_lang = answer_lang or meeting_lang
  effective_translation_lang = translation_lang or ('en' if effective_answer_lang == 'ko' else 'ko')

  if not meeting_context:
    meeting_context = await _load_meeting_context(session_id)

  # 스타일 파라미터 추출 (generate_answer 로 전달)
  language_levels = (meeting_context or {}).get('language_levels')
  expertise_level = (meeting_context or {}).get('expertise_level')
  meeting_style = (meeting_context or {}).get('meeting_style')
  meeting_length = (meeting_context or {}).get('meeting_length') or 'medium'
  # length='short' 일 때 short_answer 가 있으면 본 답변 대신 사용
  prefer_short = (meeting_length == 'short')

  # 질문 임베딩 한 번만 계산 (모든 tier 공유)
  q_emb = await embed_text(question_text)

  # 누락된 임베딩 back-fill (백그라운드 호출 시 느리면 생략)
  try:
    await backfill_qa_embeddings(session_id)
  except Exception as e:
    logger.warning(f'backfill_qa_embeddings failed: {e}')

  async def _qa_result(match: dict, tier: str) -> dict:
    # length='short' 이고 short_answer 가 있으면 그것을 우선 반환
    ans = match['answer_text']
    if prefer_short and match.get('short_answer'):
      ans = match['short_answer']
    # 언어 강제 — Q&A 에 한글로 등록됐는데 answer_language='en' 이면 즉시 번역.
    if ans and effective_answer_lang:
      detected = _detect_simple_lang(ans)
      if detected and detected != effective_answer_lang:
        try:
          translated = await translate_text(ans, effective_answer_lang)
          if translated:
            ans = translated
        except Exception as e:
          logger.warning(f'priority answer translate failed: {e}')

    # ── RAG 보강 ──
    # 등록된 답변이 사용자 질문의 구체 정보 (숫자/날짜/이름 등) 를 빠뜨렸을 수 있음.
    # 문서 청크에서 보강 가능한 정보를 찾아 자연스럽게 추가.
    # LLM 이 스스로 판단: 보강 필요 → 답변 업데이트, 불필요 → 원문 그대로.
    # session_reuse 는 이미 다른 경로에서 augment 된 것일 수 있으므로 priority/custom/generated 에만 적용.
    augment_sources: list[dict] = []
    if ans and tier in ('priority', 'custom', 'generated'):
      try:
        chunks = await _search_document_chunks(session_id, question_text, top_k=5)
        if chunks:
          aug = await augment_answer_with_rag(
            question=question_text,
            registered_answer=ans,
            doc_chunks=[c['content'] for c in chunks],
            meeting_context=meeting_context,
            answer_language=effective_answer_lang,
            meeting_length=meeting_length,
          )
          if aug.get('augmented') and aug.get('answer'):
            logger.info(f'{tier} augmented: {aug.get("reason", "")[:60]}')
            ans = aug['answer']
            augment_sources = [
              {'chunk_id': c['id'], 'snippet': c['content'][:150]}
              for c in chunks[:3]
            ]
      except Exception as e:
        logger.warning(f'{tier} augment failed: {e}')

    # 길이 캡 — 사용자가 등록한 전체 답변이 길어도 회의별 length 설정에 맞춰 잘라냄.
    if ans and meeting_length:
      ans = _enforce_length_cap(ans, meeting_length)
    return {
      'tier': tier,
      'answer': ans,
      'answer_translation': match.get('answer_translation') or '',
      'confidence': match.get('confidence') or 'high',
      'sources': augment_sources,
      'matched_qa_id': match.get('id'),
      'semantic_score': match.get('semantic_score'),
      '_translation_lang': effective_translation_lang,
    }

  # ── Tier 1: Priority Q&A (최우선) ──
  m = await _search_priority_qa(session_id, question_text, q_emb)
  if m:
    return await _qa_result(m, 'priority')

  # ── Tier 2: Custom Q&A (사용자 직접 등록) ──
  m = await _search_custom_qa(session_id, question_text, q_emb)
  if m:
    return await _qa_result(m, 'custom')

  # ── Tier 3: Session history — 이미 답변한 유사 질문 재사용 ──
  hist = await _search_session_history(session_id, question_text, q_emb)
  if hist:
    hist_ans = hist['answer_text']
    # 언어 강제 (session history 는 과거 답변 재사용인데 언어가 바뀌었을 수 있음)
    if hist_ans and effective_answer_lang:
      detected = _detect_simple_lang(hist_ans)
      if detected and detected != effective_answer_lang:
        try:
          t = await translate_text(hist_ans, effective_answer_lang)
          if t:
            hist_ans = t
        except Exception:
          pass
    if hist_ans and meeting_length:
      hist_ans = _enforce_length_cap(hist_ans, meeting_length)
    return {
      'tier': 'session_reuse',
      'answer': hist_ans,
      'answer_translation': '',
      'confidence': hist['confidence'],
      'sources': [],
      'matched_qa_id': None,
      'semantic_score': hist.get('semantic_score'),
      '_translation_lang': effective_translation_lang,
    }

  # ── Tier 4: Generated Q&A (문서에서 사전 생성) ──
  m = await _search_generated_qa(session_id, question_text, q_emb)
  if m:
    return await _qa_result(m, 'generated')

  # 이력에서 최근 Q&A 3-5개 추출 (generate_answer 에 주입)
  history = await _load_session_history(session_id, limit=5)
  session_history_payload = [
    {'q': h['question_text'], 'a': h['answer_text']}
    for h in reversed(history)  # 오래된 것 → 최신 순
  ]

  # ── Tier 5: 문서 청크 RAG ──
  chunks = await _search_document_chunks(session_id, question_text)
  if chunks:
    result = await generate_answer(
      question_text, [c['content'] for c in chunks], meeting_context,
      answer_language=effective_answer_lang,
      language_levels=language_levels,
      expertise_level=expertise_level,
      meeting_style=meeting_style,
      meeting_length=meeting_length,
      session_history=session_history_payload,
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

  # ── Tier 6: 일반 AI (자료 없음, 프로필 기반) ──
  result = await generate_answer(
    question_text, [], meeting_context,
    answer_language=effective_answer_lang,
    language_levels=language_levels,
    expertise_level=expertise_level,
    meeting_style=meeting_style,
    meeting_length=meeting_length,
    session_history=session_history_payload,
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
  if not answer_text or not translation_lang:
    return ''
  return await translate_text(answer_text, translation_lang)
