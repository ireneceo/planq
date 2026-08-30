"""오디오 길이 측정 — 업로드 STT 의 **과금 전 사전 게이트** 단일 착지점 (#383, 2026-08-30).

왜 여기 한 곳인가: 길이는 돈이다. 화면마다·경로마다 다르게 재면 반드시 갈라지고,
갈라진 쪽이 과금 게이트를 무력화한다.

역할 분담 (Fable 설계 판정):
  · **로컬 측정 = 게이트용** — 한도 초과·과대 파일을 Deepgram 에 보내기 **전에** 막는다.
  · **과금 = Deepgram 실측**(`metadata.duration`) — 실비용의 원천 그 자체.
    그래서 헤더를 속인 파일이 게이트를 통과해도 과금은 실사용량대로 나가 악용 이득이 없다.

수단:
  1) mutagen (순수 파이썬, 시스템 의존성 0) — M4A/MP4·MP3(VBR 포함)·OGG·FLAC·WAV·AIFF
     ★ MP4 `mvhd` 를 손으로 파싱하지 않는다. mutagen 이 v0/v1·64bit·VBR 엣지를 이미 처리한 상위호환.
  2) soundfile(libsndfile) 폴백 — mutagen 이 못 여는 CAF·W64·RF64 등
  3) 둘 다 실패 → **거부(fail-closed)**. 크기 기반 추정으로 진행하지 않는다 —
     보수 추정은 정상 사용자를 오차단하고, 관대 추정은 게이트를 무력화한다.
     헤더가 깨진 파일은 STT 도 대개 실패하므로 거부가 정직하다.

ffprobe/ffmpeg 은 쓰지 않는다 — 운영 rsync 가 시스템 파일을 나르지 않아
"dev 에만 있는 시스템 의존성" 사고의 재발 경로다(memory feedback_prod_only_system_dependency).
"""
from __future__ import annotations

import logging
import os
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# 허용 확장자 — 아이폰 음성 메모(m4a·caf) 포함. raw .aac(ADTS, duration 헤더 없음)·
#   동영상 컨테이너(mp4/mov)·webm 은 이번 절단면 밖.
ALLOWED_AUDIO_EXT = {'m4a', 'mp3', 'wav', 'ogg', 'flac', 'aiff', 'aif', 'caf'}


def _try_mutagen(path: str) -> Optional[float]:
    try:
        from mutagen import File as MutagenFile
        f = MutagenFile(path)
        if f is None or not getattr(f, 'info', None):
            return None
        d = getattr(f.info, 'length', None)
        return float(d) if d and d > 0 else None
    except Exception as e:                      # 손상 파일·미지원 컨테이너
        logger.info('[audio_probe] mutagen 실패 %s: %s', os.path.basename(path), e)
        return None


def _try_soundfile(path: str) -> Optional[float]:
    try:
        import soundfile as sf
        info = sf.info(path)                    # 헤더만 읽는다 — 전체 디코드 아님
        d = getattr(info, 'duration', None)
        return float(d) if d and d > 0 else None
    except Exception as e:
        logger.info('[audio_probe] soundfile 실패 %s: %s', os.path.basename(path), e)
        return None


def probe_duration(path: str) -> Tuple[Optional[float], str]:
    """(초, 수단) 반환. 못 재면 (None, 'unknown') — 호출부는 **거부**해야 한다."""
    d = _try_mutagen(path)
    if d is not None:
        return d, 'mutagen'
    d = _try_soundfile(path)
    if d is not None:
        return d, 'soundfile'
    return None, 'unknown'


def is_allowed_ext(filename: str) -> bool:
    ext = (filename or '').rsplit('.', 1)[-1].lower() if '.' in (filename or '') else ''
    return ext in ALLOWED_AUDIO_EXT
