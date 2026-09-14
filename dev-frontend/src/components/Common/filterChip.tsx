// 목록 위의 **알약 필터 줄** — 상담 탭·고객 탭이 같이 쓴다. (2026-09-14)
//
// Irene: *"세일에서 고객탭은 필터랑 버튼 디자인들 위치 맞추라고 한거야."*
//
// 무엇이 갈라져 있었나 — 두 탭이 같은 모양의 알약을 **각자 선언**하고 있었다(1440px 실측):
//   | 축 | 상담 탭 `Chip` | 고객 탭 `StageChip` |
//   |---|---|---|
//   | 줄 시작 y | 318 | **308** (줄 위 padding 이 없었다) |
//   | 켜진 테두리 | `#0D9488` | **`#5EEAD4`** |
//   | 켜진 hover | 배경 `#F8FAFC` | 테두리만 |
//   | 숫자(`b`) | 상속색 · `margin-left:4px` | **`#0F172A` · 0.8125rem** |
//   탭을 오갈 때 줄이 10px 튀고, 켜진 칩의 초록이 서로 달랐다.
//
// ★ 값을 **상담 탭 쪽으로** 모았다 — 그 탭이 기준 화면이고, 같은 줄에 서는
//   `filterBar.ToggleFilter` 와 톤이 가깝다. 색을 새로 만들지 않았다(배치만 맞춘다).
// ★ 우측 정렬은 **`ChipRight`(margin-left:auto)** 다. 빈 칸막이(spacer)로 밀면 줄이 바뀔 때
//   그 요소가 **새 줄의 왼쪽**으로 떨어진다 — `filterBar` 에서 이미 겪은 것과 같은 함정.
import styled from 'styled-components';

/** 알약 한 줄. 넘치면 줄이 바뀐다(가로 스크롤로 숨기지 않는다). */
export const ChipRow = styled.div`
  display: flex; align-items: center; flex-wrap: wrap;
  column-gap: 6px; row-gap: 6px;
  padding: 10px 0 4px;
`;

/** 고르는 알약. `$accent` 는 주의를 끄는 축(대응 필요 등). */
export const FilterChip = styled.button<{ $on?: boolean; $accent?: boolean }>`
  display: inline-flex; align-items: center; flex-shrink: 0;
  height: 36px; padding: 0 12px; border-radius: 999px; cursor: pointer;
  font-size: 0.75rem; font-weight: 600; white-space: nowrap; font-family: inherit;
  border: 1px solid ${(p) => (p.$on ? (p.$accent ? '#F43F5E' : '#0D9488') : '#E2E8F0')};
  background: ${(p) => (p.$on ? (p.$accent ? '#FFF1F2' : '#F0FDFA') : '#FFFFFF')};
  color: ${(p) => (p.$on ? (p.$accent ? '#BE123C' : '#0F766E') : '#475569')};
  b { margin-left: 4px; font-weight: 700; }
  &:hover { background: ${(p) => (p.$on ? undefined : '#F8FAFC')}; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;

/** 뜻이 다른 묶음 사이의 칸막이(예: 진행 중 / 끝난 것 / 없음). */
export const ChipDivider = styled.span`
  width: 1px; height: 18px; background: #E2E8F0; flex-shrink: 0;
`;

/** 여기서부터 줄의 **오른쪽 끝**. 감싸서 쓴다(빈 칸막이로 밀지 않는다). */
export const ChipRight = styled.div`
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;
`;
