"""ko_numbers 회귀 검사 — `venv/bin/python scripts/check_ko_numbers.py` (실패 시 exit 1).

고유어 수사(하나·한·두·세·열)와 한 글자 한자어 수(이 분·오 분)는 그대로, 십·백·천·만·억이 든 수 + 단위만 숫자로.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.ko_numbers import normalize_ko_numbers  # noqa: E402

CASES = [
  # 그대로 둔다 (2026-11-20 신고: «하나로 연결하냐» 가 «1로»)
  ('두 시스템을 하나로 연결하냐가 문제예요. 한 번 보고', '두 시스템을 하나로 연결하냐가 문제예요. 한 번 보고'),
  ('회의는 열 시 반에', '회의는 열 시 반에'),
  ('이 분이 담당이에요', '이 분이 담당이에요'),
  ('오 분만', '오 분만'),
  ('통일 원칙', '통일 원칙'),
  ('천천히 해요', '천천히 해요'),
  ('십 이 월', '십 이 월'),
  ('이번 주 삼 일', '이번 주 삼 일'),
  # 숫자로
  ('비용은 삼 만 이 천 원이에요.', '비용은 32,000원이에요.'),
  ('삼십 분 뒤에', '30분 뒤에'),
  ('삼십 일 동안', '30일 동안'),
  ('만 원짜리', '10,000원짜리'),
  ('백 퍼센트 확신', '100퍼센트 확신'),
  ('사십 대 고객', '40대 고객'),
  ('일 억 오천 만 원', '150,000,000원'),
  ('구십 구 퍼센트', '99퍼센트'),
  ('육십 페이지', '60페이지'),
  ('구 백 원', '900원'),
]

bad = 0
for src, want in CASES:
  got = normalize_ko_numbers(src)
  if got != want:
    bad += 1
    print(f'FAIL {src!r} → {got!r} (기대 {want!r})')
print(f'ko_numbers {len(CASES) - bad}/{len(CASES)}')
sys.exit(1 if bad else 0)
