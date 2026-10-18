import { css } from 'styled-components';

// theme/layout.ts — 레이아웃 상수 (매직넘버 금지, 단일 원천)
// ⑥ 멀티탭 탭 스트립 높이 — Sidebar/SecondaryPanel offset 이 같은 값을 소비.
export const TABSTRIP_H = 40;

// ── 오버레이 기준선 (단일 원천) ────────────────────────────────────────────
// 2026-09-06: 우측 패널 7곳이 각자 `top: 0` / `top: 56px` / `--pq-mobile-chrome` 로
// 갈라져 있었다(오버레이 101개 전수 조사). 베낀 것은 반드시 갈라진다 — 조각으로 뽑는다.
//
//  · belowTabs   = 탭바 아래 — 2026-10-18 부터 미러 모드(폰)에서도 앱 머리줄 아래(= panelTop 과 같은 값).
//                  옛 값(--chrome-top)은 폰에서 0 이라 Q task 우측 패널(z 50)이 앱 머리줄 **뒤로** 깔려 제목이 가렸다.
//  · popupTop    = 앱 머리줄 위층으로 뜨는 창(가운데 창·시트·어두운 막)의 기준선. 폰은 머리줄 아래, 탭 모드는 0.
//  · belowChrome = 상단 크롬 전체 아래. 모바일 헤더가 보이는 폭에서는 그 아래.
//                  헤더와 **함께 보여야 하는** 곁패널용(이력·3컬럼 패널).
export const belowTabs = css`
  top: var(--pq-panel-top, 0px);
`;

/** 위로 뜨는 창 기준선(index.css --pq-popup-top) — `inset: 0` 대신 이 조각 + `left:0; right:0; bottom:0`. */
export const popupTop = css`
  top: var(--pq-popup-top, 0px);
`;

export const belowChrome = css`
  top: var(--pq-chrome-bottom, 0px);
`;

/** 상세 패널 기준선 — 모든 폭에서 상단 크롬 아래(2026-10-17, 폰도 PlanQ 앱 머리줄을 남긴다 · index.css --pq-panel-top). */
export const panelTop = css`
  top: var(--pq-panel-top, 0px);
`;
