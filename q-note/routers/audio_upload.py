"""녹음 파일 업로드 → STT → 노트 (#383, 2026-08-30. Fable 설계 게이트 조건부 승인 이행)

Irene: "Q note 에 녹음파일 업로드해서 텍스트화하는 것도 추가해줘."

흐름:
  ① 확장자·크기 검사 → 디스크에 **스트리밍 저장**(전량 RAM 적재 금지)
  ② 로컬 길이 측정(audio_probe) — 못 재면 **거부**. 길이 상한 검사.
  ③ 과금 사전 게이트 `qnote/can` — ★업로드는 **fail-closed**
  ④ 세션 생성(status='processing') 후 **즉시 응답** — STT 는 백그라운드
  ⑤ Deepgram pre-recorded → utterances 적재 → 과금 기록 → status='ended' → 원본 삭제

왜 사전 게이트가 실시간과 다르게 fail-closed 인가 (Fable 판정):
  실시간의 fail-open 근거는 "진행 중인 회의를 끊지 않는다 + 5분마다 flush 백스톱" 이다.
  업로드는 일회성 요청이라 "잠시 후 다시" 가 정당하고, **파일 하나로 월 한도를 통째로
  넘길 수 있다**. 단 로컬 dev(키 미설정)는 기존 시맨틱대로 통과시킨다.

과금은 로컬 측정치가 아니라 **Deepgram 실측(metadata.duration)** 으로 한다 —
헤더를 속인 파일이 게이트를 통과해도 과금은 실사용량대로 나가 악용 이득이 0 이 된다.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from middleware.auth import get_current_user
from services.audio_probe import ALLOWED_AUDIO_EXT, is_allowed_ext, probe_duration
from services.billing_client import check_membership, check_quota, record_usage, alert_flush_failure
from services.database import connect as db_connect
from services.deepgram_prerecorded import PrerecordedError, transcribe_file
from services.rate_limit import _hit as _rate_hit

logger = logging.getLogger(__name__)
router = APIRouter(prefix='/api/sessions', tags=['audio-upload'])

UPLOADS_ROOT = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'uploads')

# 가드 (Fable 판정) — 실제 한도축은 분 쿼터다. 아래는 디스크·CPU 남용 차단용.
MAX_UPLOAD_BYTES = 200 * 1024 * 1024      # 200MB — WAV 1시간이 115MB+ 라 플랜별 10/30/50MB 는 주 시나리오를 죽인다
MAX_DURATION_SECONDS = 4 * 3600           # 4시간 — 라이브 세션 캡 미러
CHUNK = 1024 * 1024

# user 당 동시 1건 — 같은 workspace 내 사용자 간 race 의 overshoot 는 파일 1개 길이로 유계(수용)
_active_uploads: set[int] = set()


def _now() -> str:
  return datetime.now(timezone.utc).isoformat()


async def _save_streaming(file: UploadFile, dest: str) -> int:
  """전량 RAM 적재 금지 — 청크로 받아 쓰면서 상한을 넘으면 즉시 끊고 지운다."""
  total = 0
  os.makedirs(os.path.dirname(dest), exist_ok=True)
  with open(dest, 'wb') as out:
    while True:
      chunk = await file.read(CHUNK)
      if not chunk:
        break
      total += len(chunk)
      if total > MAX_UPLOAD_BYTES:
        out.close()
        try: os.unlink(dest)
        except OSError: pass
        raise HTTPException(status_code=413,
                            detail=f'file too large (max {MAX_UPLOAD_BYTES // (1024*1024)}MB)')
      out.write(chunk)
  return total


@router.post('/upload-audio')
async def upload_audio(
  file: UploadFile = File(...),
  business_id: int = Form(...),
  title: str = Form(''),
  language: str = Form('multi'),
  user: dict = Depends(get_current_user),
):
  uid = int(user['user_id'])

  # ── 소유권 — 남 워크스페이스로 과금·오염 차단 (create_session 과 같은 시맨틱) ──
  member = await check_membership(uid, business_id)
  if member is False:
    raise HTTPException(status_code=403, detail='not a member of this workspace')

  if not is_allowed_ext(file.filename or ''):
    raise HTTPException(status_code=400,
                        detail=f'unsupported format (allowed: {", ".join(sorted(ALLOWED_AUDIO_EXT))})')

  if uid in _active_uploads:
    raise HTTPException(status_code=409, detail='another upload is still processing')

  # ── rate limit — ★값은 Fable 사양(2/분·30/일) 그대로지만 **세는 지점을 옮겼다.**
  #   의존성으로 걸면 확장자만 틀려도 카운트돼 파일 종류 두 번 헷갈린 사용자가 1분 잠긴다
  #   (실제로 이 검증 중에 내가 그렇게 잠겼다). 거절은 디스크·Deepgram 을 쓰지 않으므로
  #   보호할 자원이 없다. 여기부터가 **실제로 비싼 구간**(디스크 기록 → STT)이라 여기서 센다.
  #   같은 값이므로 폭주 방어력은 그대로다 — 유효한 요청은 여전히 분당 2건이 상한이다.
  if not _rate_hit('qnote-upload-m', uid, 60.0, 2):
    raise HTTPException(status_code=429, detail='rate_limited')
  if not _rate_hit('qnote-upload-d', uid, 86400.0, 30):
    raise HTTPException(status_code=429, detail='rate_limited_daily')

  job_id = str(uuid.uuid4())
  tmp_dir = os.path.join(UPLOADS_ROOT, str(business_id), 'audio-jobs')
  ext = (file.filename or 'a.m4a').rsplit('.', 1)[-1].lower()
  dest = os.path.join(tmp_dir, f'{job_id}.{ext}')

  size = await _save_streaming(file, dest)

  def _cleanup():
    try: os.unlink(dest)
    except OSError: pass

  # ── 길이 측정 — 못 재면 거부(fail-closed). 크기 기반 추정 안 한다 ──
  duration, how = probe_duration(dest)
  if duration is None:
    _cleanup()
    raise HTTPException(status_code=400, detail='cannot read audio duration (corrupt or unsupported file)')
  if duration > MAX_DURATION_SECONDS:
    _cleanup()
    raise HTTPException(status_code=400,
                        detail=f'audio too long ({int(duration//60)}min, max {MAX_DURATION_SECONDS//3600}h)')

  # ── 과금 사전 게이트 — ★업로드는 fail-closed ──
  quota = await check_quota(business_id, int(duration))
  if quota is None:
    # None = Node 미도달 또는 키 미설정. 키가 있는데 못 갔으면 거부한다.
    if os.getenv('INTERNAL_API_KEY'):
      _cleanup()
      raise HTTPException(status_code=503, detail='quota service unavailable, try again shortly')
    logger.warning('[upload-audio] INTERNAL_API_KEY 미설정 — 로컬 dev 로 보고 통과')
  elif not quota.get('ok'):
    _cleanup()
    raise HTTPException(status_code=402, detail=json.dumps({
      'reason': quota.get('reason') or 'qnote_quota_exceeded',
      'limit': quota.get('limit'), 'current': quota.get('current'),
    }))

  # ── 세션 생성 (processing) — job_id 를 박아 둔다(과금 원장 stream_id) ──
  base = os.path.basename(file.filename or 'recording')
  auto_title = title.strip() or os.path.splitext(base)[0][:120] or 'recording'
  async with db_connect() as db:
    cur = await db.execute(
      '''INSERT INTO sessions
           (business_id, user_id, title, language, status, capture_mode, input_type,
            duration_seconds, utterance_count, upload_job_id, upload_source_name)
         VALUES (?, ?, ?, ?, 'processing', 'upload', 'voice', 0, 0, ?, ?)''',
      (business_id, uid, auto_title, language, job_id, base[:200]),
    )
    session_id = cur.lastrowid
    await db.commit()

  _active_uploads.add(uid)
  task = asyncio.create_task(_process(session_id, business_id, uid, dest, language, job_id))
  task.add_done_callback(lambda t: _log_task_exception(t, session_id))

  logger.info('[upload-audio] 접수 session=%s job=%s %.1fs(%s) %.1fMB',
              session_id, job_id, duration, how, size / 1024 / 1024)
  return {'success': True, 'data': {
    'session_id': session_id, 'status': 'processing',
    'duration_seconds': int(duration), 'measured_by': how,
  }}


def _log_task_exception(task: asyncio.Task, session_id: int) -> None:
  try:
    exc = task.exception()
  except asyncio.CancelledError:
    exc = None
  if exc:
    logger.error('[upload-audio] session=%s 처리 태스크 예외: %s', session_id, exc, exc_info=exc)


async def _fail(session_id: int, message: str) -> None:
  async with db_connect() as db:
    await db.execute("UPDATE sessions SET status='failed', updated_at=? WHERE id=?", (_now(), session_id))
    await db.commit()
  logger.error('[upload-audio] session=%s 실패: %s', session_id, message)


async def _process(session_id: int, business_id: int, user_id: int,
                   path: str, language: str, job_id: str) -> None:
  """백그라운드 — STT → 적재 → 과금 → ended. 실패해도 과금하지 않는다."""
  try:
    try:
      result = await transcribe_file(path, language=language)
    except PrerecordedError as e:
      await _fail(session_id, f'stt: {e}')
      return

    utts = result['utterances']
    billed = int(round(result['duration'] or 0))

    async with db_connect() as db:
      for u in utts:
        await db.execute(
          '''INSERT INTO utterances
               (session_id, speaker, original_text, original_language, is_final,
                start_time, end_time, confidence, created_at)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)''',
          (session_id, u['speaker'], u['text'], result.get('detected_language'),
           u['start'], u['end'], u['confidence'], _now()),
        )
      await db.execute(
        "UPDATE sessions SET status='ended', duration_seconds=?, utterance_count=?, updated_at=? WHERE id=?",
        (billed, len(utts), _now(), session_id),
      )
      await db.commit()

    # ── 과금 기록 — stream_id=job_id(영속), segment_seq=0. 재시도해도 UNIQUE 로 멱등 흡수 ──
    ok = False
    for attempt in range(3):
      ok = await record_usage(job_id, 0, session_id, business_id, user_id, billed, False)
      if ok:
        break
      await asyncio.sleep(2 ** attempt)
    if not ok:
      # 트랜스크립트는 그대로 제공한다 — 고객에게 유리한 방향의 유계 손실(라이브 경로 철학과 동일).
      #   job_id 를 남겨 두면 나중에 수동 재전송이 가능하다(멱등).
      logger.error('[upload-audio] ★과금 기록 실패 session=%s job=%s seconds=%s — 수동 재전송 필요',
                   session_id, job_id, billed)
      await alert_flush_failure(user_id, business_id,
                                f'업로드 STT 과금 기록 실패 (session {session_id}, {billed}s)')

    logger.info('[upload-audio] 완료 session=%s 발화 %d건 %.1fs', session_id, len(utts), billed)
  finally:
    _active_uploads.discard(user_id)
    try: os.unlink(path)          # 원본은 터미널 상태 도달 시 삭제 (#383 요구는 "텍스트화")
    except OSError: pass
