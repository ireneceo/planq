// 우측 패널 폭 — 단일 소스 (Fable 감사 2026-07-15: 폭이 6종 default + 4종 clamp 로 난립하던 것 수렴).
//
// PlanQ 우측 영역은 성격상 두 부류뿐이다:
//   1) 컬럼형 워크벤치 — 본문 옆에 상주하는 리스트/맥락 컬럼 (Q Talk 작업대, Q Task 인사이트, Q mail 맥락,
//      좌측 리스트 Talk/Mail/Note/docs). flex 컬럼, 폭은 화면별 localStorage 저장.
//   2) 오버레이 상세/편집 드로어 — position:fixed 로 본문 위를 덮는 상세/생성 폼
//      (공통 DetailDrawer, TaskDetailDrawer, Clients, 업무추가 등).
//
// 신규 우측 패널/드로어는 반드시 아래 토큰을 참조한다. 개별 화면이 하드코딩 폭을 새로 도입하지 말 것.

// ── 컬럼형 워크벤치 (usePanelWidth 계열) ──
export const COLUMN_PANEL = {
  default: 300,   // 좌측 리스트 기본
  min: 240,
  max: 560,       // 인사이트/맥락 컬럼이 넓어질 여지 (구 520 → 560 상향, 콘텐츠 클리핑 방지)
} as const;

// ── 오버레이 상세/편집 드로어 (DetailDrawer / responsiveDrawer 계열) ──
export const OVERLAY_DRAWER = {
  default: 480,          // 표준 상세/편집 드로어 폭 (구 460/480/520/560 난립 → 480 수렴)
  min: 380,              // 반응형 시작 하한
  max: 560,              // 반응형 시작 상한 (viewport×0.35 clamp)
  savedMin: 360,         // 사용자 수동 리사이즈 저장값 하한
  savedMax: 1000,        // 사용자 수동 리사이즈 저장값 상한
  wide: 560,             // 복합 폼(메일계정·인보이스 등) 명시 override 시 표준 넓은 폭
} as const;
