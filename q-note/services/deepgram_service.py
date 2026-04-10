import os
import json
import asyncio
import logging
from websockets.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed

logger = logging.getLogger('q-note.deepgram')

DEEPGRAM_API_KEY = os.getenv('DEEPGRAM_API_KEY', '')
DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen'


class DeepgramSession:
  """Manages a single Deepgram WebSocket connection for real-time STT."""

  def __init__(self, language='multi', on_transcript=None):
    self.language = language
    self.on_transcript = on_transcript
    self._ws = None
    self._receive_task = None
    self._closed = False

  async def connect(self):
    params = (
      f'?model=nova-3'
      f'&language={self.language}'
      f'&punctuate=true'
      f'&interim_results=true'
      f'&utterance_end_ms=1000'
      f'&vad_events=true'
      f'&encoding=linear16'
      f'&sample_rate=16000'
      f'&channels=1'
    )
    url = DEEPGRAM_WS_URL + params
    extra_headers = {'Authorization': f'Token {DEEPGRAM_API_KEY}'}

    self._ws = await ws_connect(url, extra_headers=extra_headers)
    self._receive_task = asyncio.create_task(self._receive_loop())
    logger.info('Deepgram WebSocket connected')

  async def send_audio(self, audio_data: bytes):
    if self._ws and not self._closed:
      try:
        await self._ws.send(audio_data)
      except ConnectionClosed:
        logger.warning('Deepgram connection closed while sending audio')

  async def close(self):
    self._closed = True
    if self._ws:
      try:
        # Send close message to Deepgram
        await self._ws.send(json.dumps({'type': 'CloseStream'}))
        await self._ws.close()
      except Exception:
        pass
    if self._receive_task:
      self._receive_task.cancel()
      try:
        await self._receive_task
      except asyncio.CancelledError:
        pass
    logger.info('Deepgram session closed')

  async def _receive_loop(self):
    try:
      async for message in self._ws:
        if self._closed:
          break
        try:
          data = json.loads(message)
          await self._handle_message(data)
        except json.JSONDecodeError:
          logger.warning('Non-JSON message from Deepgram')
    except ConnectionClosed:
      logger.info('Deepgram WebSocket disconnected')
    except asyncio.CancelledError:
      pass

  async def _handle_message(self, data: dict):
    msg_type = data.get('type', '')

    if msg_type == 'Results':
      channel = data.get('channel', {})
      alternatives = channel.get('alternatives', [])
      if not alternatives:
        return

      best = alternatives[0]
      transcript = best.get('transcript', '').strip()
      if not transcript:
        return

      is_final = data.get('is_final', False)
      speech_final = data.get('speech_final', False)
      confidence = best.get('confidence', 0)
      start = data.get('start', 0)
      duration = data.get('duration', 0)
      detected_language = channel.get('detected_language', self.language)

      result = {
        'type': 'transcript',
        'transcript': transcript,
        'is_final': is_final,
        'speech_final': speech_final,
        'confidence': confidence,
        'start': start,
        'end': start + duration,
        'language': detected_language,
      }

      if self.on_transcript:
        await self.on_transcript(result)

    elif msg_type == 'UtteranceEnd':
      if self.on_transcript:
        await self.on_transcript({'type': 'utterance_end'})

    elif msg_type == 'Metadata':
      logger.info(f'Deepgram metadata: {data.get("request_id", "")}')

    elif msg_type == 'Error':
      logger.error(f'Deepgram error: {data}')
