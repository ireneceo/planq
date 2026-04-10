import asyncio
import json
import logging
import aiosqlite
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from middleware.auth import ws_authenticate
from services.deepgram_service import DeepgramSession
from services.database import DB_PATH
from services.llm_service import translate_and_detect_question

router = APIRouter()
logger = logging.getLogger('q-note.live')


async def _enrich_and_persist(session_id: int, websocket: WebSocket, utterance_id: int, text: str):
  """Background task: translate + question-detect, then update DB and notify client."""
  try:
    enriched = await translate_and_detect_question(text)
    translation = enriched.get('translation', '')
    is_question = enriched.get('is_question', False)
    detected_language = enriched.get('detected_language')

    async with aiosqlite.connect(DB_PATH) as db:
      await db.execute(
        '''UPDATE utterances
           SET translated_text = ?, is_question = ?, original_language = COALESCE(?, original_language)
           WHERE id = ?''',
        (translation, 1 if is_question else 0, detected_language, utterance_id)
      )
      if is_question:
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
        'is_question': is_question,
        'detected_language': detected_language,
      })
    except Exception:
      pass
  except Exception as e:
    logger.error(f'Enrichment failed for utterance {utterance_id}: {e}')


@router.websocket('/ws/live')
async def websocket_live(websocket: WebSocket, session_id: int = Query(...)):
  """
  Real-time STT WebSocket endpoint.

  Client → Server: raw PCM16 audio chunks (binary frames)
  Server → Client: JSON transcript events
    { type: 'transcript', transcript, is_final, language, start, end, confidence }
    { type: 'utterance_end' }
    { type: 'error', message }
  """
  await websocket.accept()

  # Authenticate
  try:
    user = await ws_authenticate(websocket)
  except Exception as e:
    logger.warning(f'WS auth failed: {e}')
    return

  # Verify session ownership
  try:
    async with aiosqlite.connect(DB_PATH) as db:
      db.row_factory = aiosqlite.Row
      cursor = await db.execute(
        'SELECT id, business_id, user_id FROM sessions WHERE id = ?',
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
      utterance_id = None
      try:
        async with aiosqlite.connect(DB_PATH) as db:
          cursor = await db.execute(
            '''INSERT INTO utterances
               (session_id, original_text, original_language, is_final, start_time, end_time, confidence)
               VALUES (?, ?, ?, 1, ?, ?, ?)''',
            (
              session_id,
              transcript_text,
              result.get('language'),
              result.get('start'),
              result.get('end'),
              result.get('confidence'),
            )
          )
          utterance_id = cursor.lastrowid
          await db.execute(
            'UPDATE sessions SET utterance_count = utterance_count + 1, updated_at = datetime(\'now\') WHERE id = ?',
            (session_id,)
          )
          await db.commit()
      except Exception as e:
        logger.error(f'Failed to persist utterance: {e}')

      # Fire-and-forget enrichment (translation + question detection)
      if utterance_id and transcript_text.strip():
        asyncio.create_task(
          _enrich_and_persist(session_id, websocket, utterance_id, transcript_text)
        )

  # Connect to Deepgram
  dg = DeepgramSession(language='multi', on_transcript=on_transcript)
  try:
    await dg.connect()
  except Exception as e:
    logger.error(f'Failed to connect to Deepgram: {e}')
    await websocket.send_json({'type': 'error', 'message': f'STT connection failed: {str(e)}'})
    await websocket.close(code=1011)
    return

  await websocket.send_json({'type': 'ready'})

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
    try:
      async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
          'UPDATE sessions SET status = ?, updated_at = datetime(\'now\') WHERE id = ?',
          ('completed', session_id)
        )
        await db.commit()
    except Exception:
      pass
    try:
      await websocket.close()
    except Exception:
      pass
