"""한국어 받아쓰기의 수량 표기 — 한자어 수 + 단위만 숫자로 바꾼다.

왜 (2026-11-20, Irene «하나로 연결하냐 이런 말할 때 1로 라고 떠»):
  Deepgram `smart_format` 은 숫자 낱말을 문맥 없이 아라비아 숫자로 바꾼다. 한국어는 «한 번 보자»·«두 시스템»·
  «하나로 연결» 처럼 수가 아닌 말에도 고유어 수사가 쓰여 «1 번»·«2 시스템» 이 됐다(실측 — `numerals=false` 로는
  꺼지지 않는다). 그래서 한국어·multi 는 smart_format 을 끄고(`deepgram_service.format_params`), 진짜 수량만
  여기서 숫자로 되돌린다.

규칙 (좁게 — 과잉 변환이 «1로» 를 다시 만든다):
  - **한자어 수**(일이삼사오육칠팔구 + 십백천만억)만 본다. 고유어(하나·한·두·세·열…)는 절대 숫자로 안 바꾼다.
  - 바로 뒤에 **단위**(원·분·초·년·개월·퍼센트·명·개·층 …)가 와야 한다.
  - **십·백·천·만·억 중 하나가 들어 있어야** 한다 — «이 분»(이분)·«오 분»·«일 년» 같은 한 글자 수는 그대로 둔다.
  - 앞이 한글 글자에 붙어 있으면(«통일 원») 수로 보지 않는다.
"""
import re

_DIGIT = {'일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '륙': 6, '칠': 7, '팔': 8, '구': 9}
_SMALL = {'십': 10, '백': 100, '천': 1000}
_BIG = {'만': 10_000, '억': 100_000_000}

_UNITS = (
  '원', '달러', '불', '엔', '위안', '유로', '퍼센트', '프로', '%',
  '년', '개월', '주', '일', '시간', '분', '초',
  '명', '개', '건', '번', '회', '차', '층', '호', '장', '페이지', '쪽', '권', '대', '배', '점', '평', '세', '살',
  '킬로', '키로', '미터', '센티', '그램', '리터', '바이트', '기가', '메가',
)
_UNIT_RE = '|'.join(sorted((re.escape(u) for u in _UNITS), key=len, reverse=True))
_NUM_CH = '일이삼사오육륙칠팔구십백천만억'
# 수 덩어리(글자 사이 공백 1칸 허용) + 공백 0~1 + 단위. 앞은 한글이 아니어야 한다.
_PAT = re.compile(rf'(?<![가-힣])((?:[{_NUM_CH}] ?)*[{_NUM_CH}]) ?({_UNIT_RE})')


def _parse(chunk: str):
  """한자어 수 → int. 문법에 안 맞으면 None (예: «이 이», «십 십»)."""
  total = 0      # 만·억 단위로 끝난 부분
  section = 0    # 만 아래 부분
  digit = None   # 아직 자리 단위를 못 만난 한 자리 수
  last_small = 10_000  # 같은 구간 안에서 자리 단위는 내림차순이어야 한다
  last_big = 10 ** 12
  for ch in chunk:
    if ch in _DIGIT:
      if digit is not None:
        return None
      digit = _DIGIT[ch]
    elif ch in _SMALL:
      v = _SMALL[ch]
      if v >= last_small:
        return None
      section += (digit if digit is not None else 1) * v
      digit = None
      last_small = v
    elif ch in _BIG:
      v = _BIG[ch]
      if v >= last_big:
        return None
      part = section + (digit or 0)
      total += (part if part else 1) * v
      section, digit, last_small, last_big = 0, None, 10_000, v
    else:
      return None
  return total + section + (digit or 0)


def normalize_ko_numbers(text: str) -> str:
  if not text or not re.search(f'[{_NUM_CH}]', text):
    return text

  def repl(m: re.Match) -> str:
    raw, unit = m.group(1), m.group(2)
    chunk = raw.replace(' ', '')
    if not any(c in chunk for c in '십백천만억'):
      return m.group(0)
    n = _parse(chunk)
    if n is None:
      return m.group(0)
    return f'{n:,}{unit}'

  return _PAT.sub(repl, text)
