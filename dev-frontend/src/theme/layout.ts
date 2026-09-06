import { css } from 'styled-components';

// theme/layout.ts — 레이아웃 상수 (매직넘버 금지, 단일 원천)
// ⑥ 멀티탭 탭 스트립 높이 — Sidebar/SecondaryPanel offset 이 같은 값을 소비.
export const TABSTRIP_H = 40;

// ── 오버레이 기준선 (단일 원천) ────────────────────────────────────────────
// 2026-09-06: 우측 패널 7곳이 각자 `top: 0` / `top: 56px` / `--pq-mobile-chrome` 로
// 갈라져 있었다(오버레이 101개 전수 조사). 베낀 것은 반드시 갈라진다 — 조각으로 뽑는다.
//
//  · belowTabs   = 탭바 아래. 미러 모드에선 0 이라 **폰 동작은 그대로**(전면 드로어).
//                  전면으로 덮는 상세 드로어용.
//  · belowChrome = 상단 크롬 전체 아래. 모바일 헤더가 보이는 폭에서는 그 아래.
//                  헤더와 **함께 보여야 하는** 곁패널용(이력·3컬럼 패널).
export const belowTabs = css`
  top: var(--chrome-top, 0px);
`;

export const belowChrome = css`
  top: var(--pq-chrome-bottom, 0px);
`;
