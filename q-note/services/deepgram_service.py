import os
import json
import asyncio
import logging
from urllib.parse import quote
from websockets.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed

logger = logging.getLogger('q-note.deepgram')

DEEPGRAM_API_KEY = os.getenv('DEEPGRAM_API_KEY', '')
DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen'

# 모델 선택 정책:
#   - 기본: nova-3 (다국어 + 최신)
#   - 한국어 단독 시: 환경변수 DEEPGRAM_MODEL_KO 로 오버라이드 (실제 회의 A/B 후 결정)
#     예: DEEPGRAM_MODEL_KO=nova-2-general
#   - 언어별 오버라이드 패턴: DEEPGRAM_MODEL_<LANG>
DEFAULT_MODEL = os.getenv('DEEPGRAM_MODEL', 'nova-3')


def _resolve_model_for_language(language: str) -> str:
  if language and language != 'multi':
    env_key = f'DEEPGRAM_MODEL_{language.upper()}'
    override = os.getenv(env_key)
    if override:
      return override
  return DEFAULT_MODEL


class DeepgramSession:
  """Manages a single Deepgram WebSocket connection for real-time STT."""

  def __init__(self, language='multi', on_transcript=None, keywords=None, multichannel=False):
    self.language = language
    self.on_transcript = on_transcript
    self.keywords = keywords or []
    self.multichannel = multichannel  # True → 2ch stereo (web_conference)
    self._ws = None
    self._receive_task = None
    self._closed = False

  async def connect(self):
    model = _resolve_model_for_language(self.language)
    channels = 2 if self.multichannel else 1
    params_list = [
      f'model={model}',
      f'language={self.language}',
      'punctuate=true',
      'smart_format=true',
      'interim_results=true',
      'utterance_end_ms=2000',
      'endpointing=500',
      'vad_events=true',
      'encoding=linear16',
      'sample_rate=16000',
      f'channels={channels}',
    ]
    if self.multichannel:
      params_list.append('multichannel=true')
    else:
      params_list.append('diarize=true')

    # Keyword boosting — 회의 컨텍스트(참여자 이름, 브리프에 등장한 고유명사 등)를 힌트로 주입.
    # - nova-3: `keyterm` (Keyterm Prompting, 다중 지원)
    # - nova-2 이하: `keywords` (colon intensifier 2)
    if self.keywords:
      use_keyterm = model.startswith('nova-3')
      for kw in self.keywords[:50]:  # 상한
        if not kw or len(kw) > 60:
          continue
        if use_keyterm:
          params_list.append(f'keyterm={quote(kw)}')
        else:
          params_list.append(f'keywords={quote(kw)}:2')

    url = DEEPGRAM_WS_URL + '?' + '&'.join(params_list)
    extra_headers = {'Authorization': f'Token {DEEPGRAM_API_KEY}'}

    self._ws = await ws_connect(url, extra_headers=extra_headers)
    self._receive_task = asyncio.create_task(self._receive_loop())
    logger.info(f'Deepgram WebSocket connected (model={model}, keywords={len(self.keywords)})')

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
        except Exception as e:
          logger.error(f'Deepgram handle_message error: {e}', exc_info=True)
    except ConnectionClosed as e:
      logger.warning(f'Deepgram WebSocket disconnected: code={e.code} reason={e.reason}')
    except asyncio.CancelledError:
      pass
    except Exception as e:
      logger.error(f'Deepgram receive loop error: {e}')

  async def _handle_message(self, data: dict):
    msg_type = data.get('type', '')

    if msg_type == 'Results':
      # Deepgram multichannel: channel_index = [채널번호, 총채널수] (예: [0,2] = ch0, [1,2] = ch1)
      raw_ch = data.get('channel_index', 0)
      if isinstance(raw_ch, list) and len(raw_ch) >= 1:
        channel_index = int(raw_ch[0])
      elif isinstance(raw_ch, (int, float)):
        channel_index = int(raw_ch)
      else:
        channel_index = 0
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

      # Diarization speaker (mono only — multichannel 에서는 channel_index 가 화자)
      words = best.get('words', []) or []
      speaker_id = None
      if not self.multichannel and words:
        counts: dict[int, int] = {}
        for w in words:
          sp = w.get('speaker')
          if sp is not None and isinstance(sp, (int, float)):
            sp_int = int(sp)
            counts[sp_int] = counts.get(sp_int, 0) + 1
        if counts:
          speaker_id = max(counts.items(), key=lambda x: x[1])[0]

      result = {
        'type': 'transcript',
        'transcript': transcript,
        'is_final': is_final,
        'speech_final': speech_final,
        'confidence': confidence,
        'start': start,
        'end': start + duration,
        'language': detected_language,
        'deepgram_speaker_id': speaker_id,
        'channel_index': channel_index,  # multichannel: 0=mic(나), 1=tab(상대)
      }

      if self.on_transcript:
        await self.on_transcript(result)

    elif msg_type == 'UtteranceEnd':
      if self.on_transcript:
        raw_ch2 = data.get('channel_index', 0)
        if isinstance(raw_ch2, list) and len(raw_ch2) >= 1:
          ch2 = int(raw_ch2[0])
        elif isinstance(raw_ch2, (int, float)):
          ch2 = int(raw_ch2)
        else:
          ch2 = 0
        await self.on_transcript({'type': 'utterance_end', 'channel_index': ch2})

    elif msg_type == 'Metadata':
      logger.info(f'Deepgram metadata: {data.get("request_id", "")}')

    elif msg_type == 'Error':
      logger.error(f'Deepgram error: {data}')
