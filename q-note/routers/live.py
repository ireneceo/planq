import asyncio
import json
import logging
import numpy as np
import aiosqlite
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from middleware.auth import ws_authenticate
from services.deepgram_service import DeepgramSession
from services.database import DB_PATH, connect as db_connect
from services.llm_service import translate_and_detect_question
from services.audio_buffer import RollingAudioBuffer, SpeakerAudioCollector
from services.voice_fingerprint import (
  embed_pcm16, blob_to_embedding, cosine_similarity, SELF_MATCH_THRESHOLD,
  embedding_to_blob,
)

router = APIRouter()
logger = logging.getLogger('q-note.live')


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
      await db.execute(
        'UPDATE speakers SET is_self = 1 WHERE id = ?', (speaker_row_id,)
      )
      # 과거 발화 소급: is_question 해제 + detected_questions 삭제
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


async def _enrich_and_persist(
  session_id: int,
  websocket: WebSocket,
  utterance_id: int,
  text: str,
  speaker_row_id: int | None,
  meeting_context: dict | None,
  allowed_languages: list[str] | None,
):
  """
  Background task: translate + question-detect, then update DB and notify client.

  allowed_languages: 세션의 meeting_languages. detected_language 가 이 리스트에 없으면
  out_of_scope=True 로 마킹하고 번역/질문감지를 생략한다 (프론트에서 흐리게 + 태그 표시).
  """
  try:
    enriched = await translate_and_detect_question(text, meeting_context=meeting_context)
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
  except Exception as e:
    logger.error(f'Enrichment failed for utterance {utterance_id}: {e}')


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

  # Authenticate
  try:
    user = await ws_authenticate(websocket)
  except Exception as e:
    logger.warning(f'WS auth failed: {e}')
    return

  # 라이브 오디오 버퍼 + 화자별 수집기 (핑거프린트 매칭 / 배치 클러스터링용)
  audio_buf = RollingAudioBuffer(max_seconds=60)
  speaker_collector = SpeakerAudioCollector(live_trigger_sec=5.0, max_sec=30.0)

  # 사용자의 저장된 핑거프린트 (라이브 매칭용). 없으면 라이브 매칭 스킵.
  user_fingerprints = await _load_user_fingerprints(user['user_id'])

  # Verify session ownership + load meeting_languages and context for Deepgram/LLM
  meeting_context: dict | None = None
  allowed_languages: list[str] | None = None
  try:
    async with db_connect() as db:
      db.row_factory = aiosqlite.Row
      cursor = await db.execute(
        'SELECT id, business_id, user_id, meeting_languages, brief, participants, pasted_context '
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
  except Exception as e:
    logger.error(f'Session check failed: {e}')
    await websocket.close(code=1011)
    return

  # Forward transcripts back to client and persist final ones
  async def on_transcript(result: dict):
    try:
      await websocket.send_json(result)
    except Exception:
      return

    # Deepgram 중복 방지:
    # - is_final=true 인 모든 final 이벤트 commit (speech_final 만 쓰면 앞부분 손실)
    # - 시간 오버랩 dedup: 직전 utterance 의 end 보다 앞에서 시작 → duplicate
    # - 텍스트 dedup: 직전 3개와 정규화 텍스트 비교 → 같으면 skip
    if result.get('type') == 'transcript' and result.get('is_final'):
      transcript_text = (result.get('transcript') or '').strip()
      if not transcript_text:
        return
      dg_speaker_id = result.get('deepgram_speaker_id')
      new_start = float(result.get('start') or 0)
      new_end = float(result.get('start') or 0) + float(result.get('duration') or 0)
      utterance_id = None
      speaker_row_id = None
      try:
        async with db_connect() as db:
          db.row_factory = aiosqlite.Row
          # 직전 3개 utterance 조회 (시간 + 텍스트 dedup 용)
          recent_rows = await (await db.execute(
            'SELECT start_time, end_time, original_text FROM utterances '
            'WHERE session_id = ? ORDER BY id DESC LIMIT 3',
            (session_id,)
          )).fetchall()

          # (a) 시간 오버랩 검사 — 직전 utterance 기준
          if recent_rows and recent_rows[0]['end_time'] is not None:
            OVERLAP_TOLERANCE = 0.1
            if new_start < float(recent_rows[0]['end_time']) - OVERLAP_TOLERANCE:
              logger.info(
                f'dedup: skip overlap session={session_id} '
                f'new=[{new_start:.2f}-{new_end:.2f}] last_end={recent_rows[0]["end_time"]:.2f} text={transcript_text[:40]!r}'
              )
              return

          # (b) 텍스트 dedup — 최근 3개 중 정확히 같은 text 면 skip
          norm_new = ''.join(transcript_text.split())
          for r in recent_rows:
            if r['original_text'] and ''.join(r['original_text'].split()) == norm_new:
              logger.info(
                f'dedup: skip text-match session={session_id} text={transcript_text[:40]!r}'
              )
              return

          speaker_row_id = await _upsert_speaker(db, session_id, dg_speaker_id)
          cursor = await db.execute(
            '''INSERT INTO utterances
               (session_id, original_text, original_language, is_final, start_time, end_time, confidence, speaker_id)
               VALUES (?, ?, ?, 1, ?, ?, ?, ?)''',
            (
              session_id,
              transcript_text,
              result.get('language'),
              result.get('start'),
              result.get('end'),
              result.get('confidence'),
              speaker_row_id,
            )
          )
          utterance_id = cursor.lastrowid
          await db.execute(
            "UPDATE sessions SET utterance_count = utterance_count + 1, updated_at = datetime('now') WHERE id = ?",
            (session_id,)
          )
          await db.commit()
      except Exception as e:
        logger.error(f'Failed to persist utterance: {e}')

      # Notify client of persisted row so it can correlate future enrichment events
      if utterance_id:
        try:
          await websocket.send_json({
            'type': 'finalized',
            'utterance_id': utterance_id,
            'transcript': transcript_text,
            'language': result.get('language'),
            'deepgram_speaker_id': dg_speaker_id,
            'speaker_id': speaker_row_id,
            'start': result.get('start'),
            'end': result.get('end'),
          })
        except Exception:
          pass

      # 화자별 오디오 수집: 이번 utterance 의 PCM 을 rolling buffer 에서 추출해 컬렉터에 추가
      u_start = result.get('start')
      u_end = result.get('end')
      if dg_speaker_id is not None and u_start is not None and u_end is not None:
        pcm_slice = audio_buf.extract(float(u_start), float(u_end))
        if pcm_slice:
          trigger = speaker_collector.add(dg_speaker_id, pcm_slice)
          # 첫 5초 누적 완료 → 본인 매칭 fire-and-forget (사용자 핑거프린트 있을 때만)
          if trigger == 'trigger_live' and user_fingerprints:
            collected = speaker_collector.get(dg_speaker_id)
            asyncio.create_task(
              _auto_match_self(
                session_id, user['user_id'], dg_speaker_id,
                collected, user_fingerprints, websocket,
              )
            )

      # Fire-and-forget enrichment (translation + question detection + language filter)
      if utterance_id and transcript_text.strip():
        asyncio.create_task(
          _enrich_and_persist(
            session_id, websocket, utterance_id, transcript_text, speaker_row_id,
            meeting_context, allowed_languages,
          )
        )

  # Connect to Deepgram with the resolved language
  dg = DeepgramSession(language=dg_language, on_transcript=on_transcript)
  try:
    await dg.connect()
  except Exception as e:
    logger.error(f'Failed to connect to Deepgram: {e}')
    await websocket.send_json({'type': 'error', 'message': f'STT connection failed: {str(e)}'})
    await websocket.close(code=1011)
    return

  await websocket.send_json({'type': 'ready', 'language': dg_language})

  # Pipe audio from client to Deepgram
  try:
    while True:
      message = await websocket.receive()

      if message.get('type') == 'websocket.disconnect':
        break

      if 'bytes' in message and message['bytes'] is not None:
        audio_buf.append(message['bytes'])
        await dg.send_audio(message['bytes'])
      elif 'text' in message and message['text'] is not None:
        try:
          control = json.loads(message['text'])
          if control.get('action') == 'stop':
            break
        except json.JSONDecodeError:
          pass
  except WebSocketDisconnect:
    logger.info(f'Client disconnected from session {session_id}')
  except Exception as e:
    logger.error(f'WS error: {e}')
  finally:
    await dg.close()
    # status 는 명시적 종료(PUT /api/sessions/:id status=completed)로만 변경.
    # WS 일시 중지/재시작을 허용하기 위해 여기서 자동 completed 처리하지 않음.

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
