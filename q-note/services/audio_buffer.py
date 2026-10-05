"""
라이브 오디오 버퍼링.

두 가지 역할:
  1. RollingAudioBuffer — 전체 세션 오디오를 N초 윈도우로 rolling 유지.
     Deepgram 의 final utterance 가 도착하면 [start, end] 범위를 추출해 반환.

  2. SpeakerAudioCollector — dg_speaker_id 별로 누적 PCM 샘플을 모음.
     - live_trigger_sec (기본 5초) 에 도달하면 `trigger_live` 를 리턴 → 본인 매칭용 임베딩 계산
     - max_sec (기본 30초) 까지 계속 수집 (배치 클러스터링용 최종 임베딩에 사용)

메모리 가드:
  - RollingAudioBuffer: 60초 × 16kHz × 2바이트 = 약 1.9MB 상한
  - SpeakerAudioCollector: max_sec × speakers × 32kB/sec (5 speakers × 30초 ≈ 4.8MB)
  - 회의 종료 시 모두 drop (D-5 개인정보 가드)
"""
from typing import Optional


SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2  # PCM16


class RollingAudioBuffer:
  """세션 전체 오디오를 rolling window 로 유지. Deepgram final 의 start/end 로 추출."""

  def __init__(self, max_seconds: int = 60):
    self.max_bytes = max_seconds * SAMPLE_RATE * BYTES_PER_SAMPLE
    self.buffer = bytearray()
    self.start_byte = 0  # buffer[0] 에 해당하는 세션 절대 바이트 오프셋

  def append(self, pcm_bytes: bytes) -> None:
    self.buffer.extend(pcm_bytes)
    overflow = len(self.buffer) - self.max_bytes
    if overflow > 0:
      # 바이트 경계가 샘플 경계(2)에 맞도록
      overflow -= overflow % BYTES_PER_SAMPLE
      self.buffer = self.buffer[overflow:]
      self.start_byte += overflow

  def total_seconds_written(self) -> float:
    return (self.start_byte + len(self.buffer)) / (SAMPLE_RATE * BYTES_PER_SAMPLE)

  def extract(self, start_sec: float, end_sec: float) -> Optional[bytes]:
    """[start_sec, end_sec] 구간의 PCM 을 반환. 범위가 버퍼 밖이면 None."""
    if end_sec <= start_sec:
      return None
    start_byte = int(start_sec * SAMPLE_RATE) * BYTES_PER_SAMPLE
    end_byte = int(end_sec * SAMPLE_RATE) * BYTES_PER_SAMPLE
    rel_start = start_byte - self.start_byte
    rel_end = end_byte - self.start_byte
    if rel_start < 0 or rel_end > len(self.buffer):
      return None
    return bytes(self.buffer[rel_start:rel_end])

  def clear(self) -> None:
    self.buffer = bytearray()
    self.start_byte = 0


class SpeakerAudioCollector:
  """dg_speaker_id 별 PCM 누적. 라이브 트리거 + 배치용 최종 임베딩 재료.

  2026-10-05 — 트리거 지점을 여러 개 둔다(기본 3초·10초). 목소리 프로필 매칭(VOICE_PROFILE_DESIGN §3-2)은
  3초에 1차, 더 긴 10초에 2차로 본다 — 짧은 조각에서 못 붙인 이름을 긴 조각으로 다시 본다.
  """

  def __init__(self, live_trigger_sec: float = 5.0, max_sec: float = 30.0, extra_trigger_secs: tuple = ()):
    secs = sorted({float(live_trigger_sec), *[float(x) for x in extra_trigger_secs]})
    self.trigger_bytes = [int(x * SAMPLE_RATE) * BYTES_PER_SAMPLE for x in secs]
    self.max_bytes = int(max_sec * SAMPLE_RATE) * BYTES_PER_SAMPLE
    self.per_speaker: dict[int, bytearray] = {}
    self.fired: dict[int, int] = {}   # speaker → 이미 넘은 트리거 개수

  def add(self, dg_speaker_id: Optional[int], pcm_bytes: bytes) -> Optional[str]:
    """
    dg_speaker_id 에 pcm 누적.
    - 'trigger_live' 반환 → 이 speaker 가 다음 트리거 지점(3초·10초 …)을 처음 넘었다
    - None → 추가 작업 없음
    """
    if dg_speaker_id is None:
      return None
    buf = self.per_speaker.setdefault(dg_speaker_id, bytearray())
    if len(buf) >= self.max_bytes:
      return None  # 이미 충분 — 더 안 모음 (메모리 절약)
    remaining = self.max_bytes - len(buf)
    buf.extend(pcm_bytes[:remaining])
    n = self.fired.get(dg_speaker_id, 0)
    if n < len(self.trigger_bytes) and len(buf) >= self.trigger_bytes[n]:
      # 한 번에 여러 지점을 넘었으면 전부 넘은 것으로 친다(한 번만 판정)
      while n < len(self.trigger_bytes) and len(buf) >= self.trigger_bytes[n]:
        n += 1
      self.fired[dg_speaker_id] = n
      return 'trigger_live'
    return None

  def get(self, dg_speaker_id: int) -> bytes:
    return bytes(self.per_speaker.get(dg_speaker_id, b''))

  def speaker_ids(self) -> list[int]:
    return list(self.per_speaker.keys())

  def clear(self) -> None:
    self.per_speaker.clear()
    self.fired.clear()
