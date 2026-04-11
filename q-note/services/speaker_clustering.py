"""
배치 화자 병합 — 회의 종료 시 1회 실행.

1. 라이브 중 누적된 SpeakerAudioCollector 의 각 dg_speaker_id 별 PCM 으로
   최종 임베딩을 계산해 speaker_embeddings 테이블에 upsert.

2. 해당 세션의 모든 speaker_embeddings 를 로드 → sklearn AgglomerativeClustering
   (cosine distance, threshold = 1 - CLUSTER_MERGE_THRESHOLD) 으로 군집화.

3. 같은 클러스터에 속하는 dg_speaker 들 중 가장 많은 발화를 가진 하나를 대표로 선택,
   나머지 speakers.id 를 가리키던 utterances.speaker_id 를 대표로 UPDATE,
   병합된 speakers 행 + 관련 detected_questions 처리.

4. 병합된 speaker 가 is_self 였으면 대표 speaker 에도 is_self 상속, 발화 소급 is_question=0.
"""
import logging
from typing import Optional

import aiosqlite
import numpy as np

from services.database import connect as db_connect
from services.audio_buffer import SpeakerAudioCollector
from services.voice_fingerprint import (
  embed_pcm16, embedding_to_blob, blob_to_embedding,
  CLUSTER_MERGE_THRESHOLD,
)

logger = logging.getLogger(__name__)


async def persist_speaker_embeddings(session_id: int, collector: SpeakerAudioCollector) -> None:
  """
  컬렉터에 누적된 각 dg_speaker 오디오로 임베딩을 계산해 DB 에 저장.
  라이브 핑거프린트 매칭이 이미 저장한 값은 덮어쓴다 (더 긴 샘플 기반이 보통 더 정확).
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row
    for dg_speaker_id in collector.speaker_ids():
      pcm = collector.get(dg_speaker_id)
      if len(pcm) < 16000 * 2 * 2:  # 최소 2초
        continue
      try:
        emb = await embed_pcm16(pcm)
      except Exception as e:
        logger.warning(f'batch embed failed: dg_speaker={dg_speaker_id}: {e}')
        continue

      cursor = await db.execute(
        'SELECT id FROM speakers WHERE session_id = ? AND deepgram_speaker_id = ?',
        (session_id, dg_speaker_id)
      )
      row = await cursor.fetchone()
      if not row:
        continue
      speaker_row_id = row['id']
      await db.execute(
        '''INSERT INTO speaker_embeddings (speaker_id, embedding, sample_seconds)
           VALUES (?, ?, ?)
           ON CONFLICT(speaker_id) DO UPDATE SET
             embedding = excluded.embedding,
             sample_seconds = excluded.sample_seconds''',
        (speaker_row_id, embedding_to_blob(emb), len(pcm) / (2 * 16000))
      )
    await db.commit()


async def cluster_and_merge_speakers(session_id: int) -> dict:
  """
  세션 종료 시 호출. 같은 사람으로 판단되는 화자들을 병합.
  Returns: {merged: [{into: speaker_id, from: [speaker_ids]}], remaining: n}
  """
  async with db_connect() as db:
    db.row_factory = aiosqlite.Row

    # 1) 세션의 모든 speaker_embeddings 로드
    cursor = await db.execute(
      '''SELECT se.speaker_id, se.embedding, s.is_self
         FROM speaker_embeddings se
         JOIN speakers s ON s.id = se.speaker_id
         WHERE s.session_id = ?''',
      (session_id,)
    )
    rows = await cursor.fetchall()
    if len(rows) < 2:
      return {'merged': [], 'remaining': len(rows), 'reason': 'insufficient_embeddings'}

    speaker_ids = [r['speaker_id'] for r in rows]
    embeddings = np.stack([blob_to_embedding(r['embedding']) for r in rows])
    is_self_flags = {r['speaker_id']: bool(r['is_self']) for r in rows}

    # 2) 계층 클러스터링 (cosine distance)
    try:
      from sklearn.cluster import AgglomerativeClustering
    except ImportError:
      logger.error('sklearn not installed')
      return {'merged': [], 'remaining': len(rows), 'reason': 'sklearn_missing'}

    distance_threshold = 1.0 - CLUSTER_MERGE_THRESHOLD  # cosine sim ≥ 0.65 → distance ≤ 0.35
    clustering = AgglomerativeClustering(
      n_clusters=None,
      distance_threshold=distance_threshold,
      metric='cosine',
      linkage='average',
    )
    labels = clustering.fit_predict(embeddings)

    # 3) 라벨별로 그룹화, 각 그룹에서 대표 선택 (발화 수가 가장 많은 speaker)
    groups: dict[int, list[int]] = {}
    for label, sid in zip(labels, speaker_ids):
      groups.setdefault(int(label), []).append(sid)

    merged_info = []
    for label, sids in groups.items():
      if len(sids) < 2:
        continue  # 단일 화자 — 병합할 것 없음

      # 발화 수 기준으로 대표 결정
      cursor = await db.execute(
        f"SELECT speaker_id, COUNT(*) AS cnt FROM utterances "
        f"WHERE speaker_id IN ({','.join('?' * len(sids))}) GROUP BY speaker_id",
        sids
      )
      counts = {r['speaker_id']: r['cnt'] for r in await cursor.fetchall()}
      representative = max(sids, key=lambda s: counts.get(s, 0))
      to_merge = [s for s in sids if s != representative]

      # 대표에 is_self 상속
      any_self = any(is_self_flags.get(s, False) for s in sids)
      if any_self:
        await db.execute('UPDATE speakers SET is_self = 1 WHERE id = ?', (representative,))

      # utterances.speaker_id 업데이트
      for s in to_merge:
        await db.execute(
          'UPDATE utterances SET speaker_id = ? WHERE speaker_id = ?',
          (representative, s)
        )

      # detected_questions 는 utterance 와 엮여있으므로 유지됨. is_self 상속 시 소급 클리어.
      if any_self:
        await db.execute(
          '''DELETE FROM detected_questions
             WHERE session_id = ?
               AND utterance_id IN (SELECT id FROM utterances WHERE speaker_id = ?)''',
          (session_id, representative)
        )
        await db.execute(
          'UPDATE utterances SET is_question = 0 WHERE speaker_id = ?', (representative,)
        )

      # 병합된 speakers 행 삭제 (speaker_embeddings 는 CASCADE)
      for s in to_merge:
        await db.execute('DELETE FROM speakers WHERE id = ?', (s,))

      merged_info.append({'into': representative, 'from': to_merge, 'size': len(sids)})

    await db.commit()

    # 남은 고유 화자 수
    cursor = await db.execute(
      'SELECT COUNT(*) AS cnt FROM speakers WHERE session_id = ?', (session_id,)
    )
    remaining = (await cursor.fetchone())['cnt']

  return {'merged': merged_info, 'remaining': remaining}
