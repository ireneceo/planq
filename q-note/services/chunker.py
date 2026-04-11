"""
단락 + 문장 hybrid 청크.

전략:
1. 먼저 텍스트를 단락(\n\n) 단위로 분할.
2. 단락이 max_len 을 넘으면 문장 단위로 재분할.
3. 문장 단위로 누적해 target_len 근처에서 청크 확정.
4. 청크 간 overlap 은 "마지막 N자에 걸친 문장들"을 다음 청크 앞에 prepend.

문장 분리:
- 한국어/영어 혼용. 단순 `.?!` split 은 약어(주식회사., U.S., 등)에서 망가지므로
  문장 경계 뒤에 공백 + 대문자/한글 시작인 경우만 진짜 경계로 인정.
- 줄바꿈도 약한 경계로 취급.

Note: 완벽한 문장 분리기(kss 등) 없이도 RAG BM25 검색에는 충분.
"""
import re
from typing import List

CHUNK_TARGET = 500        # 청크 목표 길이 (문자)
CHUNK_MAX = 700           # 단일 단락이 이보다 길면 문장 분할로 진입
CHUNK_OVERLAP = 50        # 인접 청크 간 overlap (문자)
MIN_CHUNK = 50            # 이보다 작은 조각은 인접 청크에 흡수

# 문장 경계: . ? ! 또는 한국어 종결어미 뒤 공백
# 약어 예외: 대문자 1~2글자 + 마침표 패턴은 경계로 안 봄 (예: U.S., A.D.)
_SENT_SPLIT_RE = re.compile(
  r'(?<=[\.!?。!?])\s+(?=[A-Z가-힣0-9])'
)


def _split_sentences(text: str) -> List[str]:
  """단락 하나를 문장 리스트로 분할."""
  text = text.strip()
  if not text:
    return []
  parts = _SENT_SPLIT_RE.split(text)
  # 개행 기반 추가 분할 (리스트/항목 지원)
  out = []
  for p in parts:
    for line in p.split('\n'):
      line = line.strip()
      if line:
        out.append(line)
  return out


def _split_paragraphs(text: str) -> List[str]:
  return [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]


def _hard_split(text: str, max_len: int) -> List[str]:
  """단일 조각이 max_len 을 초과하면 길이 기준으로 강제 분할 (최후 수단)."""
  return [text[i:i + max_len] for i in range(0, len(text), max_len)]


def chunk_text(text: str) -> List[str]:
  """
  텍스트 → 청크 리스트.

  - 각 청크는 대략 CHUNK_TARGET 자 내외
  - 문장 경계에서 자르려 노력
  - 인접 청크 간 CHUNK_OVERLAP 자 분량의 문장을 겹침
  """
  if not text or not text.strip():
    return []

  # 1) 단락 단위로 분할한 뒤 각 단락을 문장 리스트로 변환
  atoms: List[str] = []
  for para in _split_paragraphs(text):
    if len(para) <= CHUNK_MAX:
      atoms.append(para)
      continue
    # 긴 단락 → 문장 단위
    sentences = _split_sentences(para)
    for s in sentences:
      if len(s) <= CHUNK_MAX:
        atoms.append(s)
      else:
        # 문장 하나가 MAX 를 넘는 극단적 케이스 → hard split
        atoms.extend(_hard_split(s, CHUNK_MAX))

  # 2) 원자(문장/단락)들을 CHUNK_TARGET 기준으로 누적
  chunks: List[str] = []
  buf: List[str] = []
  buf_len = 0

  def flush():
    nonlocal buf, buf_len
    if buf:
      joined = '\n'.join(buf).strip()
      if joined:
        chunks.append(joined)
      buf = []
      buf_len = 0

  for atom in atoms:
    atom_len = len(atom)
    if buf_len + atom_len + 1 > CHUNK_TARGET and buf_len >= MIN_CHUNK:
      flush()
    buf.append(atom)
    buf_len += atom_len + 1

  flush()

  if not chunks:
    return []

  # 3) overlap 적용: 이전 청크의 꼬리를 다음 청크 앞에 붙임
  if CHUNK_OVERLAP > 0 and len(chunks) > 1:
    with_overlap = [chunks[0]]
    for i in range(1, len(chunks)):
      prev = chunks[i - 1]
      tail = prev[-CHUNK_OVERLAP:]
      # 가능한 문장/공백 경계에서 시작하도록 스냅
      snap = max(tail.rfind('. '), tail.rfind('。 '), tail.rfind('\n'), tail.rfind(' '))
      if snap > 0:
        tail = tail[snap + 1:]
      overlapped = (tail.strip() + ' ' + chunks[i]).strip() if tail.strip() else chunks[i]
      with_overlap.append(overlapped)
    chunks = with_overlap

  return chunks
