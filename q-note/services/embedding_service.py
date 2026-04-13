"""
Embedding service — OpenAI text-embedding-3-small.

질문과 Q&A를 벡터화해 시맨틱 유사도로 paraphrase 매칭과 세션 내
질문 이력 재사용을 지원한다. FTS5(렉시컬)는 1차 필터, 임베딩이 2차 재랭킹.

비용: text-embedding-3-small = $0.02/1M tokens. 질문 한 번 = 수십 토큰.
차원: 1536.
"""
import os
import logging
import struct
from typing import Optional

import numpy as np
from openai import AsyncOpenAI

logger = logging.getLogger('q-note.embedding')

EMBED_MODEL = os.getenv('EMBED_MODEL', 'text-embedding-3-small')
EMBED_DIM = 1536
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')

_client: Optional[AsyncOpenAI] = None


def _get_client() -> AsyncOpenAI:
  global _client
  if _client is None:
    if not OPENAI_API_KEY:
      raise RuntimeError('OPENAI_API_KEY not configured for embeddings')
    _client = AsyncOpenAI(api_key=OPENAI_API_KEY)
  return _client


async def embed_text(text: str) -> Optional[np.ndarray]:
  """단일 텍스트 → 1536차원 벡터. 실패 시 None."""
  if not text or not text.strip():
    return None
  try:
    client = _get_client()
    resp = await client.embeddings.create(model=EMBED_MODEL, input=text[:8000])
    vec = np.array(resp.data[0].embedding, dtype=np.float32)
    return vec
  except Exception as e:
    logger.warning(f'embed_text failed: {e}')
    return None


async def embed_batch(texts: list[str]) -> list[Optional[np.ndarray]]:
  """여러 텍스트 일괄 임베딩. 길이 맞춰 반환 (실패 항목은 None)."""
  if not texts:
    return []
  # 빈 텍스트는 건너뛰되 위치 유지
  idx_map = [(i, t) for i, t in enumerate(texts) if t and t.strip()]
  out: list[Optional[np.ndarray]] = [None] * len(texts)
  if not idx_map:
    return out
  try:
    client = _get_client()
    resp = await client.embeddings.create(
      model=EMBED_MODEL,
      input=[t[:8000] for _, t in idx_map],
    )
    for (pos, _), item in zip(idx_map, resp.data):
      out[pos] = np.array(item.embedding, dtype=np.float32)
  except Exception as e:
    logger.warning(f'embed_batch failed: {e}')
  return out


def embedding_to_blob(vec: np.ndarray) -> bytes:
  """np.float32 → SQLite BLOB (little-endian)."""
  if vec.dtype != np.float32:
    vec = vec.astype(np.float32)
  return vec.tobytes()


def blob_to_embedding(blob: bytes) -> Optional[np.ndarray]:
  """SQLite BLOB → np.float32 array. 길이 불일치면 None."""
  if not blob:
    return None
  try:
    vec = np.frombuffer(blob, dtype=np.float32)
    if len(vec) != EMBED_DIM:
      return None
    return vec
  except Exception:
    return None


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
  """코사인 유사도 [-1, 1]. 높을수록 가까움."""
  if a is None or b is None:
    return 0.0
  denom = float(np.linalg.norm(a) * np.linalg.norm(b))
  if denom == 0:
    return 0.0
  return float(np.dot(a, b) / denom)
