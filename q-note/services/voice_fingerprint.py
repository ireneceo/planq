"""
음성 핑거프린트 — Resemblyzer 기반.

- PCM16 16kHz mono bytes → 256차원 L2-normalized float32 임베딩
- 유사도는 cosine (이미 L2 정규화되어 dot product = cosine)
- VoiceEncoder 는 모듈 로드 시점에 한 번만 생성 (CPU, ~50MB)
- 모든 블로킹 연산은 asyncio.to_thread 로 감쌈
"""
import asyncio
import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

_encoder = None
_encoder_lock = asyncio.Lock()


def _load_encoder_sync():
  """Lazy-load VoiceEncoder — torch 의존성 로드에 몇 초 걸릴 수 있음."""
  global _encoder
  if _encoder is None:
    from resemblyzer import VoiceEncoder
    _encoder = VoiceEncoder(verbose=False)
    logger.info('VoiceEncoder loaded (CPU)')
  return _encoder


async def get_encoder():
  async with _encoder_lock:
    if _encoder is None:
      return await asyncio.to_thread(_load_encoder_sync)
    return _encoder


def _pcm16_to_float32(pcm_bytes: bytes) -> np.ndarray:
  """PCM16 little-endian → float32 [-1, 1]."""
  return np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0


async def embed_pcm16(pcm_bytes: bytes) -> np.ndarray:
  """PCM16 16kHz mono → 256-d L2-normalized embedding. 비어있으면 ValueError."""
  if len(pcm_bytes) < 16000 * 2:  # 최소 1초
    raise ValueError('오디오가 너무 짧습니다 (최소 1초 필요)')
  samples = _pcm16_to_float32(pcm_bytes)
  encoder = await get_encoder()
  emb = await asyncio.to_thread(encoder.embed_utterance, samples)
  return emb.astype(np.float32)


def embedding_to_blob(emb: np.ndarray) -> bytes:
  """256 float32 → 1024 bytes."""
  if emb.shape != (256,) or emb.dtype != np.float32:
    emb = np.asarray(emb, dtype=np.float32).reshape(256)
  return emb.tobytes()


def blob_to_embedding(blob: bytes) -> np.ndarray:
  return np.frombuffer(blob, dtype=np.float32).reshape(256)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
  """두 임베딩 모두 L2 정규화되어 있다고 가정 (Resemblyzer 기본)."""
  na = np.linalg.norm(a) + 1e-9
  nb = np.linalg.norm(b) + 1e-9
  return float(np.dot(a, b) / (na * nb))


# 자기 자신 매칭 임계값.
# Resemblyzer 기본 권장은 0.75지만 실제 회의 환경(노이즈, 믹스드 채널, 코덱 차이)에서는
# 너무 엄격해서 true-positive 를 놓친다. 0.68 이 경험적으로 단일 사용자 self-verification
# 에 적절. (마이크 전용 사이드 채널을 사용하면 이 정도면 안전)
SELF_MATCH_THRESHOLD = 0.68

# 배치 화자 병합 임계값 — cosine similarity. 0.65 이상이면 같은 사람으로 간주 (약간 보수적)
CLUSTER_MERGE_THRESHOLD = 0.65
