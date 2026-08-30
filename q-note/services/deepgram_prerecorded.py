"""Deepgram pre-recorded STT — 업로드한 녹음 파일을 한 번에 텍스트로 (#383, 2026-08-30).

실시간(WS) 경로와 왜 나누는가 (Fable 설계 판정):
  · **컨테이너를 Deepgram 이 서버측에서 디코드**한다 — m4a/caf 를 우리가 풀 필요가 없다.
    (로컬 audio_probe 는 **과금 게이트용**으로만 길이를 잰다. STT 입력은 원본 그대로.)
  · WS 로 파일을 흘리려면 실시간 페이싱을 흉내내야 해 2시간 파일이 2시간을 점유한다 — 오답.
  · 응답의 `metadata.duration` 이 **실비용의 원천** — 과금은 이 값으로 한다.

반환 duration 은 반드시 호출부가 과금에 쓴다. 로컬 측정치를 과금에 쓰지 말 것 —
헤더를 속인 파일이 게이트를 통과해도 과금은 실사용량대로 나가야 악용 이득이 0 이 된다.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

DEEPGRAM_API_KEY = os.getenv('DEEPGRAM_API_KEY', '')
PRERECORDED_URL = 'https://api.deepgram.com/v1/listen'
DEFAULT_MODEL = os.getenv('DEEPGRAM_MODEL', 'nova-3')

# 4시간 오디오도 수 분 내 처리되지만, 네트워크·큐 지연을 감안해 넉넉히 잡는다.
REQUEST_TIMEOUT = httpx.Timeout(connect=30.0, read=900.0, write=900.0, pool=30.0)


class PrerecordedError(Exception):
  """STT 실패 — 호출부는 세션을 'failed' 로 두고 **과금하지 않는다**."""


def _resolve_model(language: str) -> str:
  if language and language != 'multi':
    override = os.getenv(f'DEEPGRAM_MODEL_{language.upper()}')
    if override:
      return override
  return DEFAULT_MODEL


async def transcribe_file(path: str, language: str = 'multi',
                          keywords: Optional[List[str]] = None) -> Dict[str, Any]:
  """파일 하나를 통째로 STT. 반환: {duration, utterances[], detected_language}

  utterances 는 화자 분리(diarize)된 발화 목록 — 실시간 경로가 utterances 테이블에
  적재하는 것과 같은 모양이라 요약·번역 파이프라인이 **무변경으로** 이어진다.
  """
  if not DEEPGRAM_API_KEY:
    raise PrerecordedError('deepgram_not_configured')

  params = {
    'model': _resolve_model(language),
    'language': language,
    'punctuate': 'true',
    'smart_format': 'true',
    'diarize': 'true',        # 화자 분리 — 회의 녹음의 핵심
    'utterances': 'true',     # 발화 단위 분할 (start/end/confidence 포함)
    'paragraphs': 'true',
  }
  if keywords:
    # 어휘 사전 — 실시간 경로와 같은 정책 (원어 그대로, 환각 금지)
    params['keyterm'] = keywords[:100]

  headers = {'Authorization': f'Token {DEEPGRAM_API_KEY}'}

  try:
    with open(path, 'rb') as f:
      async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        # Content-Type 을 지정하지 않는다 — Deepgram 이 컨테이너를 스스로 판별한다.
        resp = await client.post(PRERECORDED_URL, params=params, headers=headers, content=f.read())
  except httpx.TimeoutException as e:
    raise PrerecordedError(f'timeout: {e}') from e
  except Exception as e:
    raise PrerecordedError(f'request_failed: {e}') from e

  if resp.status_code != 200:
    body = (resp.text or '')[:300]
    raise PrerecordedError(f'http_{resp.status_code}: {body}')

  try:
    data = resp.json()
  except Exception as e:
    raise PrerecordedError(f'bad_json: {e}') from e

  return _parse(data)


def _parse(data: Dict[str, Any]) -> Dict[str, Any]:
  meta = data.get('metadata') or {}
  duration = float(meta.get('duration') or 0)

  results = data.get('results') or {}
  channels = results.get('channels') or []
  alt0 = (channels[0].get('alternatives') or [{}])[0] if channels else {}
  detected = (channels[0].get('detected_language') if channels else None) or meta.get('language')

  out: List[Dict[str, Any]] = []
  for u in (results.get('utterances') or []):
    text = (u.get('transcript') or '').strip()
    if not text:
      continue
    spk = u.get('speaker')
    out.append({
      'speaker': f'Speaker {spk + 1}' if isinstance(spk, int) else 'Speaker 1',
      'text': text,
      'start': float(u.get('start') or 0),
      'end': float(u.get('end') or 0),
      'confidence': float(u.get('confidence') or 0),
    })

  # utterances 가 비었는데 전사 본문은 있는 경우 — 통째로 한 발화로 담아 **빈 노트를 만들지 않는다**.
  #   (짧은 파일·단일 화자에서 Deepgram 이 utterances 를 안 주는 경우가 있다)
  if not out:
    whole = (alt0.get('transcript') or '').strip()
    if whole:
      out.append({'speaker': 'Speaker 1', 'text': whole, 'start': 0.0,
                  'end': duration, 'confidence': float(alt0.get('confidence') or 0)})

  return {'duration': duration, 'utterances': out, 'detected_language': detected}
