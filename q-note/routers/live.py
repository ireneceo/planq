import asyncio
import json
import logging
import aiosqlite
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from middleware.auth import ws_authenticate
from services.deepgram_service import DeepgramSession
from services.database import DB_PATH, connect as db_connect
from services.llm_service import translate_and_detect_question

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


async def _enrich_and_persist(
  session_id: int,
  websocket: WebSocket,
  utterance_id: int,
  text: str,
  speaker_row_id: int | None,
  meeting_context: dict | None,
):
  """Background task: translate + question-detect, then update DB and notify client."""
  try:
    enriched = await translate_and_detect_question(text, meeting_context=meeting_context)
    translation = enriched.get('translation', '')
    is_question = enriched.get('is_question', False)
    detected_language = enriched.get('detected_language')

    async with db_connect() as db:
      # Skip question insertion if speaker is marked is_self
      is_self = await _is_self_speaker(db, speaker_row_id)

      await db.execute(
        '''UPDATE utterances
           SET translated_text = ?, is_question = ?, original_language = COALESCE(?, original_language)
           WHERE id = ?''',
        (translation, 1 if (is_question and not is_self) else 0, detected_language, utterance_id)
      )
      if is_question and not is_self:
        await db.execute(
          '''INSERT INTO detected_questions (session_id, utterance_id, question_text)
             VALUES (?, ?, ?)''',
          (session_id, utterance_id, text)
        )
      await db.commit()

    try:
      await websocket.send_json({
        'type': 'enrichment',
        'utterance_id': utterance_id,
        'translation': translation,
        'is_question': is_question and not is_self,
        'detected_language': detected_language,
      })
    except Exception:
      pass
  except Exception as e:
    logger.error(f'Enrichment failed for utterance {utterance_id}: {e}')


def _resolve_deepgram_language(meeting_languages_json: str | None) -> str:
  """Map meeting_languages JSON array to Deepgram language param."""
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

  # Verify session ownership + load meeting_languages and context for Deepgram/LLM
  meeting_context: dict | None = None
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

    if result.get('type') == 'transcript' and result.get('is_final'):
      transcript_text = result.get('transcript', '')
      dg_speaker_id = result.get('deepgram_speaker_id')
      utterance_id = None
      speaker_row_id = None
      try:
        async with db_connect() as db:
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

      # Fire-and-forget enrichment (translation + question detection)
      if utterance_id and transcript_text.strip():
        asyncio.create_task(
          _enrich_and_persist(
            session_id, websocket, utterance_id, transcript_text, speaker_row_id, meeting_context
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
    try:
      await websocket.close()
    except Exception:
      pass
