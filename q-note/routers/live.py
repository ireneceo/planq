import asyncio
import json
import logging
import re
import numpy as np
import aiosqlite
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from middleware.auth import ws_authenticate
from services.deepgram_service import DeepgramSession
from services.database import DB_PATH, connect as db_connect
from services.llm_service import translate_and_detect_question, detect_question_fast
from services.answer_service import find_answer as _find_answer, translate_answer_text
from services.audio_buffer import RollingAudioBuffer, SpeakerAudioCollector
from services.voice_fingerprint import (
  embed_pcm16, blob_to_embedding, cosine_similarity, SELF_MATCH_THRESHOLD,
  embedding_to_blob,
)

router = APIRouter()
logger = logging.getLogger('q-note.live')


def _extract_keywords(meeting_context: dict | None) -> list[str]:
  """회의 컨텍스트(브리프, 참여자, 붙여넣은 자료)에서 Deepgram keyword boosting 용 단어 추출.

  규칙:
    - 참여자 이름: 전부 (2~30자)
    - 브리프/자료: 대문자로 시작하는 영문 단어 3자 이상, 따옴표로 감싼 고유명사, 한글 2~15자 연속
    - 최대 50개 (Deepgram keyterm 가이드 권장치)
  """
  if not meeting_context:
    return []
  found: set[str] = set()

  for p in (meeting_context.get('participants') or []):
    if isinstance(p, dict):
      name = (p.get('name') or '').strip()
      if 1 < len(name) <= 30:
        found.add(name)

  texts = []
  if meeting_context.get('brief'):
    texts.append(meeting_context['brief'])
  if meeting_context.get('pasted_context'):
    # 상한 8000자 — 너무 큰 문서에서 모든 고유명사 뽑지 않도록
    texts.append(meeting_context['pasted_context'][:8000])

  for text in texts:
    # 영문: 대문자로 시작하는 연속 단어 (ex: Google Meet, Planq)
    for m in re.findall(r'\b[A-Z][A-Za-z0-9]{2,}(?:\s+[A-Z][A-Za-z0-9]{2,}){0,2}\b', text):
      if len(m) <= 60:
        found.add(m)
    # 따옴표로 감싼 고유명사
    for m in re.findall(r'["\u201c\u201d]([^"\u201c\u201d]{2,40})["\u201c\u201d]', text):
      found.add(m.strip())
    for m in re.findall(r"[\u2018\u2019']([^\u2018\u2019']{2,40})[\u2018\u2019']", text):
      found.add(m.strip())

  # 중복 + 공백 정리
  cleaned = []
  for kw in sorted(found, key=lambda s: (-len(s), s)):  # 긴 것 우선
    kw = ' '.join(kw.split())
    if kw and kw not in cleaned:
      cleaned.append(kw)
    if len(cleaned) >= 50:
      break
  return cleaned


async def _upsert_speaker(db, session_id: int, dg_speaker_id: int) -> int | None:
  """Insert speaker row if new, return speakers.id. None if dg_speaker_id is None."""
  if dg_speaker_id is None:
    return None
  db.row_factory = aiosqlite.Row
  await db.execute(
    '''INSERT OR IGNORE INTO speakers (session_id, deepgram_speaker_id)
       VALUES (?, ?)''',
    (session_id, dg_speaker_id)
  )
  cursor = await db.execute(
    'SELECT id FROM speakers WHERE session_id = ? AND deepgram_speaker_id = ?',
    (session_id, dg_speaker_id)
  )
  row = await cursor.fetchone()
  return row['id'] if row else None


async def _is_self_speaker(db, speaker_row_id: int | None) -> bool:
  if speaker_row_id is None:
    return False
  cursor = await db.execute('SELECT is_self FROM speakers WHERE id = ?', (speaker_row_id,))
  row = await cursor.fetchone()
  return bool(row and row[0])


async def _load_user_fingerprints(user_id: int) -> list[np.ndarray]:
  """사용자의 저장된 모든 언어별 임베딩 로드. max similarity 용."""
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    cursor = await db.execute(
      'SELECT embedding FROM voice_fingerprints WHERE user_id = ?', (user_id,)
    )
    rows = await cursor.fetchall()
  out = []
  for r in rows:
    try:
      out.append(blob_to_embedding(r['embedding']))
    except Exception:
      continue
  return out


def _max_similarity(embeddings: list[np.ndarray], test_emb: np.ndarray) -> float:
  if not embeddings:
    return -1.0
  return max(cosine_similarity(e, test_emb) for e in embeddings)


async def _auto_match_self(
  session_id: int,
  user_id: int,
  dg_speaker_id: int,
  pcm_bytes: bytes,
  user_fingerprints: list[np.ndarray],
  websocket: WebSocket,
):
  """
  라이브 핑거프린트 매칭 — 여러 언어 등록 시 max similarity 사용.

  이중 방어: 세션당 "나"는 1명. 이미 is_self=1 인 speaker 가 있으면 스킵.
  (과거 버그: mixed stream 잘림 + 관대한 threshold 로 모든 speaker 에 is_self=1 이 찍혀
  SpeakerPopover 에 "나" 만 보이는 문제를 유발했다.)
  """
  try:
    emb = await embed_pcm16(pcm_bytes)
  except Exception as e:
    logger.warning(f'live fingerprint embed failed for dg_speaker {dg_speaker_id}: {e}')
    return

  sim = _max_similarity(user_fingerprints, emb)
  logger.info(f'self-match: session={session_id} dg_speaker={dg_speaker_id} max_sim={sim:.3f}')

  async with db_connect() as db:
    db.row_factory = aiosqlite.Row

    cursor = await db.execute(
      'SELECT id FROM speakers WHERE session_id = ? AND deepgram_speaker_id = ?',
      (session_id, dg_speaker_id)
    )
    row = await cursor.fetchone()
    if not row:
      return
    speaker_row_id = row['id']

    # speaker_embeddings 에 라이브 임베딩 캐싱 (upsert)
    await db.execute(
      '''INSERT INTO speaker_embeddings (speaker_id, embedding, sample_seconds)
         VALUES (?, ?, ?)
         ON CONFLICT(speaker_id) DO UPDATE SET
           embedding = excluded.embedding,
           sample_seconds = excluded.sample_seconds''',
      (speaker_row_id, embedding_to_blob(emb), len(pcm_bytes) / (2 * 16000))
    )

    if sim >= SELF_MATCH_THRESHOLD:
      # 이미 is_self인 다른 speaker가 있으면 → 같은 사람 (Deepgram이 다른 ID 부여)
      # 기존 is_self speaker에 현재 speaker의 utterances를 병합
      cursor = await db.execute(
        'SELECT id FROM speakers WHERE session_id = ? AND is_self = 1 AND id != ?',
        (session_id, speaker_row_id)
      )
      existing_self = await cursor.fetchone()
      if existing_self:
        # 현재 speaker의 utterances를 기존 is_self speaker로 이동
        await db.execute(
          'UPDATE utterances SET speaker_id = ? WHERE speaker_id = ?',
          (existing_self['id'], speaker_row_id)
        )
        # 현재 speaker 삭제
        await db.execute('DELETE FROM speaker_embeddings WHERE speaker_id = ?', (speaker_row_id,))
        await db.execute('DELETE FROM speakers WHERE id = ?', (speaker_row_id,))
        await db.commit()
        logger.info(f'self-match: session={session_id} merged speaker {speaker_row_id} into {existing_self["id"]} (same person, different dg_id)')
        try:
          await websocket.send_json({
            'type': 'self_matched',
            'speaker_id': existing_self['id'],
            'deepgram_speaker_id': dg_speaker_id,
            'similarity': round(sim, 3),
          })
        except Exception:
          pass
      else:
        # 첫 is_self 마킹
        await db.execute(
          'UPDATE speakers SET is_self = 1 WHERE id = ?', (speaker_row_id,)
        )
        await db.execute(
          '''DELETE FROM detected_questions
             WHERE session_id = ?
               AND utterance_id IN (SELECT id FROM utterances WHERE speaker_id = ?)''',
          (session_id, speaker_row_id)
        )
        await db.execute(
          'UPDATE utterances SET is_question = 0 WHERE speaker_id = ?', (speaker_row_id,)
        )
        await db.commit()
        logger.info(f'self-match: session={session_id} marked speaker {speaker_row_id} as self')
        try:
          await websocket.send_json({
            'type': 'self_matched',
            'speaker_id': speaker_row_id,
            'deepgram_speaker_id': dg_speaker_id,
            'similarity': round(sim, 3),
          })
        except Exception:
          pass
    else:
      await db.commit()


async def _load_recent_utterances(session_id: int, before_id: int, limit: int = 3) -> list[str]:
  """현재 utterance 이전의 최근 3개 발화 텍스트 조회 (주제 맥락 기반 STT 교정용)."""
  try:
    async with db_connect() as db:
      db.row_factory = aiosqlite.Row
      cursor = await db.execute(
        '''SELECT original_text FROM utterances
           WHERE session_id = ? AND id < ?
           ORDER BY id DESC LIMIT ?''',
        (session_id, before_id, limit),
      )
      rows = await cursor.fetchall()
    return [r['original_text'] for r in reversed(rows) if r['original_text']]
  except Exception:
    return []


async def _enrich_and_persist(
  session_id: int,
  websocket: WebSocket,
  utterance_id: int,
  text: str,
  speaker_row_id: int | None,
  meeting_context: dict | None,
  allowed_languages: list[str] | None,
  session_language: str | None = None,
  vocabulary: list[str] | None = None,
):
  """
  Background task: translate + question-detect, then update DB and notify client.

  vocabulary: 사용자 검토된 어휘 사전 (LLM 교정 시 1순위)
  """
  try:
    recent = await _load_recent_utterances(session_id, utterance_id)
    enriched = await translate_and_detect_question(
      text,
      meeting_context=meeting_context,
      language=session_language,
      vocabulary=vocabulary,
      recent_utterances=recent,
    )
    formatted_original = enriched.get('formatted_original') or text
    translation = enriched.get('translation', '')
    is_question = enriched.get('is_question', False)
    detected_language = enriched.get('detected_language')

    # 언어 필터: 감지 언어가 선택 언어 밖이면 번역/질문감지 결과 폐기
    out_of_scope = False
    if allowed_languages and detected_language and detected_language not in ('unknown', 'error', 'mixed'):
      if detected_language not in allowed_languages:
        out_of_scope = True
        translation = ''
        is_question = False

    async with db_connect() as db:
      is_self = await _is_self_speaker(db, speaker_row_id)

      final_is_question = bool(is_question and not is_self and not out_of_scope)
      # original_text 를 formatted_original 로 덮어씀 (한국어 띄어쓰기 교정 반영)
      await db.execute(
        '''UPDATE utterances
           SET original_text = ?, translated_text = ?, is_question = ?,
               original_language = COALESCE(?, original_language)
           WHERE id = ?''',
        (formatted_original, translation, 1 if final_is_question else 0, detected_language, utterance_id)
      )
      if final_is_question:
        await db.execute(
          '''INSERT INTO detected_questions (session_id, utterance_id, question_text)
             VALUES (?, ?, ?)''',
          (session_id, utterance_id, formatted_original)
        )
      await db.commit()

    # 질문 감지 즉시 → 백그라운드 답변 prefetch (fast path 에서 이미 답변이 왔다면 스킵)
    if final_is_question:
      already_answered = False
      try:
        async with db_connect() as dbx:
          dbx.row_factory = aiosqlite.Row
          cur = await dbx.execute(
            '''SELECT answer_text FROM detected_questions
               WHERE session_id = ? AND utterance_id = ?
               ORDER BY id DESC LIMIT 1''',
            (session_id, utterance_id),
          )
          row = await cur.fetchone()
          if row and (row['answer_text'] or '').strip():
            already_answered = True
      except Exception:
        pass
      if not already_answered:
        asyncio.create_task(
          _prefetch_answer(session_id, utterance_id, formatted_original, meeting_context, websocket)
        )

    try:
      await websocket.send_json({
        'type': 'enrichment',
        'utterance_id': utterance_id,
        'formatted_original': formatted_original,
        'translation': translation,
        'is_question': final_is_question,
        'detected_language': detected_language,
        'out_of_scope': out_of_scope,
      })
    except Exception:
      pass
  except asyncio.CancelledError:
    # 최신 태스크로 교체된 경우 — 정상 흐름
    raise
  except Exception as e:
    logger.error(f'Enrichment failed for utterance {utterance_id}: {e}')


async def _prefetch_answer(
  session_id: int,
  utterance_id: int,
  question_text: str,
  meeting_context: dict | None,
  websocket: WebSocket,
):
  """
  질문 감지 즉시 호출. 답변을 미리 찾아 detected_questions에 캐시.
  사용자가 "답변 찾기" 클릭 시 cached-answer API로 즉시 반환.
  """
  try:
    result = await _find_answer(session_id, question_text, meeting_context)
    if result['tier'] == 'none':
      return

    translation_lang = result.pop('_translation_lang', None)

    import json as _json
    # 답변 즉시 저장 (번역 없이)
    async with db_connect() as db:
      await db.execute('''
        UPDATE detected_questions
        SET answer_text = ?, answer_tier = ?, matched_qa_id = ?,
            answer_sources = ?, answered_at = datetime('now')
        WHERE session_id = ? AND utterance_id = ?
      ''', (
        result['answer'],
        result['tier'],
        result.get('matched_qa_id'),
        _json.dumps(result.get('sources', []), ensure_ascii=False) if result.get('sources') else None,
        session_id,
        utterance_id,
      ))
      await db.commit()

    # 프론트에 답변 준비 완료 알림
    try:
      await websocket.send_json({
        'type': 'answer_ready',
        'utterance_id': utterance_id,
        'tier': result['tier'],
      })
    except Exception:
      pass

    logger.info(f'prefetch: session={session_id} utt={utterance_id} tier={result["tier"]}')
  except Exception as e:
    logger.warning(f'prefetch_answer failed: session={session_id} utt={utterance_id} err={e}')


def _resolve_deepgram_language(meeting_languages_json: str | None) -> str:
  """
  meeting_languages 에 따라 Deepgram 언어 모드 결정.

  - 1개 언어: 해당 언어 single 모드 (해당 언어 정확도 최고)
  - 2개 이상: multi 모드 (정확도 약간 낮지만 code-switching 지원)
  - 선택 없음: multi (기본값)

  주의: single 모드에선 선택 언어만 인식. 다른 언어는 아예 잡지 못함.
  사용자가 회의 중 여러 언어를 섞을 예정이면 반드시 모달에서 모두 선택해야 함.
  """
  if not meeting_languages_json:
    return 'multi'
  try:
    langs = json.loads(meeting_languages_json)
  except (TypeError, ValueError):
    return 'multi'
  if isinstance(langs, list) and len(langs) == 1 and isinstance(langs[0], str):
    return langs[0]
  return 'multi'


@router.websocket('/ws/live')
async def websocket_live(websocket: WebSocket, session_id: int = Query(...)):
  """
  Real-time STT WebSocket endpoint.

  Client → Server: raw PCM16 audio chunks (binary frames)
  Server → Client: JSON transcript events
    { type: 'transcript', transcript, is_final, language, start, end, confidence, deepgram_speaker_id }
    { type: 'utterance_end' }
    { type: 'enrichment', utterance_id, translation, is_question, detected_language }
    { type: 'error', message }
  """
  await websocket.accept()
  logger.info(f'WS live: accepted session_id={session_id}')

  # Authenticate
  try:
    user = await ws_authenticate(websocket)
    logger.info(f'WS live: auth OK user={user.get("user_id")} session={session_id}')
  except Exception as e:
    logger.warning(f'WS auth failed: {e}')
    return

  # 라이브 오디오 버퍼 + 화자별 수집기 (배치 클러스터링용)
  audio_buf = RollingAudioBuffer(max_seconds=60)
  speaker_collector = SpeakerAudioCollector(live_trigger_sec=3.0, max_sec=30.0)

  # utterance_id 별 enrichment 태스크 singleton — 동일 utterance 에 대해 중복 enrichment 가
  # 발생하면 직전 태스크를 cancel 하고 최신 태스크만 유지.
  enrichment_tasks: dict[int, asyncio.Task] = {}

  def _make_pending():
    return {
      'text_parts': [],
      'start_time': None,
      'end_time': None,
      'language': None,
      'speaker_counts': {},
      'confidence_sum': 0.0,
      'confidence_count': 0,
      'channel_index': 0,
    }

  # channel_index → pending buffer (is_multichannel 은 세션 로드 후 설정)
  pending_buffers: dict[int, dict] = {0: _make_pending()}

  def _reset_pending(ch: int = 0):
    pending_buffers[ch] = _make_pending()
    pending_buffers[ch]['channel_index'] = ch

  # Verify session ownership + load meeting_languages and context for Deepgram/LLM
  meeting_context: dict | None = None
  allowed_languages: list[str] | None = None
  capture_mode: str = 'microphone'
  try:
    async with db_connect() as db:
      db.row_factory = aiosqlite.Row
      cursor = await db.execute(
        'SELECT id, business_id, user_id, meeting_languages, brief, participants, pasted_context, capture_mode, keywords '
        'FROM sessions WHERE id = ?',
        (session_id,)
      )
      session = await cursor.fetchone()
      if not session:
        await websocket.send_json({'type': 'error', 'message': 'Session not found'})
        await websocket.close(code=4004)
        return
      if session['user_id'] != user['user_id']:
        await websocket.send_json({'type': 'error', 'message': 'Forbidden'})
        await websocket.close(code=4003)
        return
      dg_language = _resolve_deepgram_language(session['meeting_languages'])
      capture_mode = session['capture_mode'] or 'microphone'

      # 세션의 allowed languages 파싱 (언어 필터용)
      allowed_languages: list[str] | None = None
      if session['meeting_languages']:
        try:
          parsed = json.loads(session['meeting_languages'])
          if isinstance(parsed, list) and parsed:
            allowed_languages = [str(x) for x in parsed if isinstance(x, str)]
        except (TypeError, ValueError):
          pass

      # Build meeting context for LLM calls
      ctx = {}
      if session['brief']:
        ctx['brief'] = session['brief']
      if session['participants']:
        try:
          ctx['participants'] = json.loads(session['participants'])
        except (TypeError, ValueError):
          pass
      if session['pasted_context']:
        ctx['pasted_context'] = session['pasted_context']
      meeting_context = ctx or None

      # 세션의 사전 어휘 사전 (사용자 검토된 STT 보정 키워드 리스트)
      session_keywords: list[str] = []
      if session['keywords']:
        try:
          raw = json.loads(session['keywords'])
          if isinstance(raw, list):
            session_keywords = [str(x) for x in raw if isinstance(x, str)]
        except (TypeError, ValueError):
          pass
  except Exception as e:
    logger.error(f'Session check failed: {e}')
    await websocket.close(code=1011)
    return

  # multichannel (web_conference): 채널별 독립 버퍼 — Deepgram 이 ch0/ch1 결과를 인터리브로
  # 보내므로 하나의 버퍼에 합치면 두 화자의 텍스트가 섞인다.
  is_multichannel = capture_mode == 'web_conference'
  if is_multichannel:
    pending_buffers[1] = _make_pending()
    pending_buffers[1]['channel_index'] = 1

  # 회의 컨텍스트 기반 Deepgram keyword boosting.
  # 사용자가 검토한 session.keywords 를 우선 + _extract_keywords(브리프 고유명사) 로 보강.
  auto_extracted = _extract_keywords(meeting_context)
  # 사용자 키워드 먼저, 자동 추출은 중복 제거 후 뒤에 (Deepgram 한계 50개)
  dg_keywords: list[str] = []
  seen_kw: set[str] = set()
  for kw in session_keywords + auto_extracted:
    k = kw.lower().strip()
    if k and k not in seen_kw:
      seen_kw.add(k)
      dg_keywords.append(kw)
    if len(dg_keywords) >= 50:
      break
  if dg_keywords:
    logger.info(f'session={session_id} deepgram keywords={len(dg_keywords)} (user={len(session_keywords)}, auto={len(auto_extracted)})')

  async def _commit_pending_utterance(ch: int = 0):
    """누적 버퍼의 조각들을 하나의 row 로 insert + enrichment 태스크 스케줄."""
    buf = pending_buffers.get(ch)
    if not buf:
      return
    parts = buf['text_parts']
    if not parts:
      return
    transcript_text = ' '.join(p for p in parts if p).strip()
    # Deepgram 이 같은 조각을 재전송하는 경우 (정규화 후) 중복 제거
    seen = set()
    dedup_parts = []
    for p in parts:
      key = ''.join(p.split())
      if key and key not in seen:
        seen.add(key)
        dedup_parts.append(p)
    transcript_text = ' '.join(dedup_parts).strip()
    if not transcript_text:
      _reset_pending(ch)
      return

    # 화자 다수결 (mono/diarize 용). multichannel 에서는 channel 이 화자.
    counts = buf['speaker_counts']
    dg_speaker_id = None
    if counts:
      dg_speaker_id = max(counts.items(), key=lambda x: x[1])[0]

    start_time = buf['start_time']
    end_time = buf['end_time']
    language = buf['language']
    channel_index = buf['channel_index']
    avg_conf = (
      buf['confidence_sum'] / buf['confidence_count']
      if buf['confidence_count'] > 0 else None
    )

    _reset_pending(ch)

    utterance_id = None
    speaker_row_id = None
    try:
      async with db_connect() as db:
        db.row_factory = aiosqlite.Row
        # 텍스트 dedup — 직전 utterance 와 같으면 skip (retransmit 방어)
        cursor = await db.execute(
          'SELECT original_text FROM utterances WHERE session_id = ? ORDER BY id DESC LIMIT 1',
          (session_id,)
        )
        last = await cursor.fetchone()
        if last and last['original_text']:
          if ''.join(last['original_text'].split()) == ''.join(transcript_text.split()):
            logger.info(f'dedup: skip text-match session={session_id} text={transcript_text[:40]!r}')
            return

        if is_multichannel:
          # multichannel: channel 기반 speaker. channel 0 = 나(mic), channel 1 = 상대(tab)
          # dg_speaker_id 대신 channel_index 를 speaker 식별자로 사용
          speaker_row_id = await _upsert_speaker(db, session_id, channel_index)
          if speaker_row_id and channel_index == 0:
            # channel 0 = mic = 나 → is_self 자동 마킹
            await db.execute(
              'UPDATE speakers SET is_self = 1 WHERE id = ? AND is_self = 0',
              (speaker_row_id,)
            )
        else:
          speaker_row_id = await _upsert_speaker(db, session_id, dg_speaker_id)

        cursor = await db.execute(
          '''INSERT INTO utterances
             (session_id, original_text, original_language, is_final, start_time, end_time, confidence, speaker_id)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?)''',
          (session_id, transcript_text, language, start_time, end_time, avg_conf, speaker_row_id)
        )
        utterance_id = cursor.lastrowid
        # 상태 생명주기: 첫 utterance 가 commit 되는 순간 prepared → recording 으로 전이.
        # 이로써 프론트가 새로고침 시 status 로 phase 를 판단할 때 올바른 paused 경로로 진입.
        # 이미 recording/paused/completed 면 그대로 둠 (명시적 completed 는 PUT 으로만 변경).
        await db.execute(
          """UPDATE sessions
             SET utterance_count = utterance_count + 1,
                 status = CASE WHEN status = 'prepared' THEN 'recording' ELSE status END,
                 updated_at = datetime('now')
             WHERE id = ?""",
          (session_id,)
        )
        await db.commit()
    except Exception as e:
      logger.error(f'Failed to persist utterance: {e}')
      return

    if not utterance_id:
      return

    # 화자 PCM 수집 (배치 클러스터링용)
    if dg_speaker_id is not None and start_time is not None and end_time is not None:
      pcm_slice = audio_buf.extract(float(start_time), float(end_time))
      if pcm_slice:
        speaker_collector.add(dg_speaker_id, pcm_slice)

    # 프론트에 finalized 이벤트 + enrichment 스케줄
    # is_self 플래그 조회 (프론트가 즉시 "나"/"상대" 라벨에 반영)
    finalized_is_self = False
    if speaker_row_id:
      try:
        async with db_connect() as db2:
          db2.row_factory = aiosqlite.Row
          cur2 = await db2.execute('SELECT is_self FROM speakers WHERE id = ?', (speaker_row_id,))
          row2 = await cur2.fetchone()
          if row2:
            finalized_is_self = bool(row2['is_self'])
      except Exception:
        pass

    try:
      await websocket.send_json({
        'type': 'finalized',
        'utterance_id': utterance_id,
        'transcript': transcript_text,
        'language': language,
        'deepgram_speaker_id': dg_speaker_id,
        'speaker_id': speaker_row_id,
        'is_self': finalized_is_self,
        'start': start_time,
        'end': end_time,
        'channel_index': channel_index,
      })
    except Exception:
      pass

    # Enrichment singleton — 질문 우선 처리
    prev_task = enrichment_tasks.get(utterance_id)
    if prev_task and not prev_task.done():
      prev_task.cancel()

    # ── 빠른 질문 판정 병렬 경로 (gpt-4.1-nano, ~300ms) ──
    # 본인 발화는 즉시 스킵 (prefetch 대상 아님 — 내 질문은 상대가 답해야 함).
    # 상대 발화는 finalized 와 동시에 fast-path 실행 → 질문이면 즉시 prefetch_answer.
    # 그 뒤 enrichment(정제+번역+정확 판정)는 병렬로 돌며 나중에 덮어쓴다.
    fast_started = False
    try:
      # 실제 is_self 는 _commit 에서 이미 finalized_is_self 로 계산됨
      if not finalized_is_self:
        async def _fast_question_path():
          try:
            is_q = await detect_question_fast(transcript_text, language=dg_language)
            if is_q:
              # DB 에 임시 is_question 마킹 + detected_questions row 생성
              async with db_connect() as dbx:
                await dbx.execute(
                  'UPDATE utterances SET is_question = 1 WHERE id = ? AND is_question = 0',
                  (utterance_id,),
                )
                # detected_questions 에 중복 방지 INSERT
                await dbx.execute('''
                  INSERT INTO detected_questions (session_id, utterance_id, question_text)
                  SELECT ?, ?, ?
                  WHERE NOT EXISTS (
                    SELECT 1 FROM detected_questions
                    WHERE session_id = ? AND utterance_id = ?
                  )
                ''', (session_id, utterance_id, transcript_text, session_id, utterance_id))
                await dbx.commit()
              # 프론트에 빠른 질문 카드 표시
              try:
                await websocket.send_json({
                  'type': 'quick_question',
                  'utterance_id': utterance_id,
                  'transcript': transcript_text,
                })
              except Exception:
                pass
              # 즉시 답변 prefetch
              asyncio.create_task(
                _prefetch_answer(session_id, utterance_id, transcript_text, meeting_context, websocket)
              )
          except Exception as e:
            logger.warning(f'fast_question_path failed utt={utterance_id}: {e}')
        asyncio.create_task(_fast_question_path())
        fast_started = True
    except Exception as e:
      logger.warning(f'fast path schedule failed: {e}')

    async def _delayed_enrich():
      await _enrich_and_persist(
        session_id, websocket, utterance_id, transcript_text, speaker_row_id,
        meeting_context, allowed_languages, session_language=dg_language,
        vocabulary=session_keywords,
      )

    new_task = asyncio.create_task(_delayed_enrich())
    enrichment_tasks[utterance_id] = new_task
    def _cleanup(t: asyncio.Task, uid: int = utterance_id):
      enrichment_tasks.pop(uid, None)
    new_task.add_done_callback(_cleanup)

  # Forward transcripts back to client and accumulate/commit utterances
  async def on_transcript(result: dict):
    try:
      await websocket.send_json(result)
    except Exception:
      return

    ch = result.get('channel_index', 0)

    # Deepgram UtteranceEnd 이벤트 — VAD 가 utterance 종료를 감지한 시점.
    # 누적 버퍼를 commit 한다 (speech_final 누락 상황 안전장치).
    if result.get('type') == 'utterance_end':
      await _commit_pending_utterance(ch)
      return

    # is_final=true 조각은 전부 누적 (speech_final 무관).
    # 이전 버그 재발 방지: speech_final 만 쓰면 문장 앞부분 조각이 drop 된다.
    if result.get('type') == 'transcript' and result.get('is_final'):
      transcript_text = (result.get('transcript') or '').strip()
      if transcript_text:
        buf = pending_buffers.get(ch)
        if buf is None:
          pending_buffers[ch] = _make_pending()
          pending_buffers[ch]['channel_index'] = ch
          buf = pending_buffers[ch]
        buf['text_parts'].append(transcript_text)
        if buf['start_time'] is None:
          buf['start_time'] = result.get('start')
        if result.get('end') is not None:
          buf['end_time'] = result.get('end')
        if result.get('language') and not buf['language']:
          buf['language'] = result.get('language')
        dg_sp = result.get('deepgram_speaker_id')
        if dg_sp is not None:
          buf['speaker_counts'][dg_sp] = buf['speaker_counts'].get(dg_sp, 0) + 1
        conf = result.get('confidence')
        if conf is not None:
          buf['confidence_sum'] += float(conf)
          buf['confidence_count'] += 1

      # speech_final=true → utterance 경계. 누적된 조각 전체를 단일 row 로 commit.
      if result.get('speech_final'):
        await _commit_pending_utterance(ch)
      return

    # 그 외 이벤트 (interim transcript, metadata 등) 는 위에서 프론트로 전달만 하고 종료.

  # Connect to Deepgram with keyword boosting → 실패 시 키워드 없이 재시도
  dg = DeepgramSession(
    language=dg_language, on_transcript=on_transcript,
    keywords=dg_keywords, multichannel=is_multichannel,
  )
  logger.info(f'WS live: connecting Deepgram lang={dg_language} multichannel={is_multichannel} keywords={len(dg_keywords)}')
  try:
    await dg.connect()
    logger.info(f'WS live: Deepgram connected OK session={session_id}')
  except Exception as e:
    logger.warning(f'Deepgram connect failed with keywords ({len(dg_keywords)}), retrying without: {e}')
    dg = DeepgramSession(
      language=dg_language, on_transcript=on_transcript,
      keywords=[], multichannel=is_multichannel,
    )
    try:
      await dg.connect()
      logger.info(f'WS live: Deepgram connected OK session={session_id} (retry without keywords)')
    except Exception as e2:
      logger.error(f'Failed to connect to Deepgram (retry without keywords): {e2}')
      try:
        await websocket.send_json({'type': 'error', 'message': f'STT connection failed: {str(e2)}'})
      except Exception:
        pass
      try:
        await websocket.close(code=1011)
      except Exception:
        pass
      return

  await websocket.send_json({'type': 'ready', 'language': dg_language})

  # Pipe audio from client to Deepgram
  bytes_received = 0
  chunks_received = 0
  last_log_time = asyncio.get_event_loop().time()
  try:
    while True:
      message = await websocket.receive()

      if message.get('type') == 'websocket.disconnect':
        break

      if 'bytes' in message and message['bytes'] is not None:
        chunk = message['bytes']
        bytes_received += len(chunk)
        chunks_received += 1
        # 5초마다 오디오 유입량 로깅 (디버깅용, 매 청크 로깅하면 시끄러움)
        now = asyncio.get_event_loop().time()
        if now - last_log_time >= 5.0:
          logger.info(
            f'session={session_id} audio: chunks={chunks_received} '
            f'bytes={bytes_received} (~{bytes_received / 32000:.1f}s mono16k)'
          )
          last_log_time = now
        audio_buf.append(chunk)
        await dg.send_audio(chunk)
      elif 'text' in message and message['text'] is not None:
        try:
          control = json.loads(message['text'])
          if control.get('action') == 'stop':
            break
        except json.JSONDecodeError:
          pass
  except WebSocketDisconnect:
    logger.info(f'Client disconnected from session {session_id} (received {bytes_received} bytes)')
  except Exception as e:
    logger.error(f'WS error: {e}')
  finally:
    # WS 종료 시 모든 채널 버퍼 강제 flush — 사용자가 문장 중간에 일시중지/종료한 경우 drop 방지
    for ch_key in list(pending_buffers.keys()):
      try:
        await _commit_pending_utterance(ch_key)
      except Exception as e:
        logger.warning(f'final flush ch={ch_key} failed: {e}')

    await dg.close()
    # WS 종료 시 상태 전이: recording → paused (pause/중단/탭닫힘 어떤 경우든 재개 가능 상태로).
    # completed 는 명시적 PUT status='completed' 로만 전이 → 여기서 건드리지 않음.
    # 이로써 사용자가 녹음 중 브라우저를 닫거나 네트워크가 끊겨도 다음 접속 시 올바른 상태 복원.
    try:
      async with db_connect() as dbx:
        await dbx.execute(
          """UPDATE sessions
             SET status = CASE WHEN status = 'recording' THEN 'paused' ELSE status END,
                 updated_at = datetime('now')
             WHERE id = ?""",
          (session_id,),
        )
        await dbx.commit()
    except Exception as e:
      logger.warning(f'status transition on WS close failed: {e}')

    # 회의 종료 시점에 수집한 화자별 최종 오디오로 임베딩 생성 후 캐싱
    # (배치 클러스터링 함수가 이 캐시를 사용)
    try:
      from services.speaker_clustering import persist_speaker_embeddings
      await persist_speaker_embeddings(session_id, speaker_collector)
    except Exception as e:
      logger.warning(f'persist_speaker_embeddings failed: {e}')

    # 개인정보 가드: 회의 종료 시 모든 PCM 버퍼 즉시 drop (D-5)
    audio_buf.clear()
    speaker_collector.clear()

    try:
      await websocket.close()
    except Exception:
      pass
