// PlanQ UI 정본 규격 (2026-08-25).
//
// 왜 만들었나: 같은 성격의 요소가 페이지마다 다른 값을 쓰고 있었다 — 실측:
//   · 페이지 헤더 구현 3종(PageShell 44곳 / PanelHeader 2곳 / 자체 제작 13곳)
//   · 리스트 글자 10·11·12·13·14px 이 2,000곳 이상 뒤섞임
//   · 버튼 높이 8종(20·22·24·28·30·32·36·44)
//   좁은 화면에서 이 차이가 전부 드러나 "메뉴마다 다르다" 로 보인다(Irene, 2026-08-25).
//
// 이 파일이 **단일 원천**이다. 새 컴포넌트는 여기 값을 쓰고, 하드코딩하지 않는다.
// 기존 코드는 점진 이관한다(가드가 신규 위반만 막는 래칫 방식).

/** 컨트롤(버튼·인풋·셀렉트) 높이. 폰에서는 터치 타깃 44 이상으로 올린다. */
export const CONTROL = {
  sm: 36,
  md: 40,
  lg: 44,
  /** 폰 최소 터치 타깃 — WCAG 2.5.5 및 iOS HIG 권장 */
  touchMin: 44,
} as const;

/** 헤더 — PageShell(단일 컬럼)·PanelHeader(패널) 공통. 좌우 패널의 밑줄이 수평으로 이어지는 계약. */
export const HEADER = {
  desktop: 60,
  phone: 56,
  padX: { desktop: 20, phone: 14 },
} as const;

/** 리스트 행 — 목록형 화면(업무·메일·노트·파일·고객) 공통 */
export const LIST_ROW = {
  /** 행 세로 여백 (상하) */
  padY: { desktop: 10, phone: 12 },
  padX: { desktop: 14, phone: 12 },
  /** 제목 — 한 줄, 말줄임 */
  titleSize: { desktop: 14, phone: 15 },
  titleWeight: 600,
  /** 보조 정보(날짜·작성자·요약) */
  metaSize: { desktop: 12.5, phone: 12.5 },
  divider: '#F1F5F9',
  hoverBg: '#FAFBFC',
  selectedBg: '#F0FDFA',
} as const;

/** 본문 여백 — PageShell Body 와 그것을 상쇄하는 자식(탭바 등)이 같은 값을 써야 한다. */
export const BODY_PAD = { desktop: 20, phone: 14 } as const;

/** 모서리 */
export const RADIUS = { control: 8, card: 10, sheet: 14, pill: 999 } as const;

/**
 * 패널 레이아웃 분기점 — 2·3단 화면의 단일 계약.
 *   ≥ threeCol : 3단 동시 노출
 *   ≥ twoCol   : 2단 (보조 패널은 접힘, 핸들로 토글)
 *   그 미만    : 드릴다운 — 한 번에 하나. 뒤로 가기로 목록 복귀
 */
export const PANEL_BP = { threeCol: 1280, twoCol: 1025, drilldown: 1024 } as const;

/**
 * 타이포 스케일 — 신규 코드는 여기 값을 쓴다 (2026-08-30).
 *
 * 실측으로 드러난 부채: 화면에 렌더된 글자 크기가 **20종 이상**이었고, 모바일에서
 * ≤11px 가 26.9% · ≤13px 가 62.5% 였다. B2B 업무 도구 기준으로 낮다.
 * 기존 4,022곳을 일괄 상향하는 것은 뱃지·칩·표가 1px 에도 줄바꿈이 깨져 위험하므로
 * **동결**하고(래칫), 신규 코드만 이 스케일로 모은다.
 *
 * 단위는 rem 이다 — 앱 전체가 rem 이고 루트 배율(services/fontScale)이 글자만 키운다.
 * px 로 쓰면 그 요소만 배율을 안 따라가 "일부 글자만 안 커지는" 반쪽이 된다.
 */
export const TYPE = {
  /** 뱃지 숫자·미세 라벨 — 이 아래로는 내려가지 않는다 */
  caption: '0.6875rem',   // 11px
  /** 날짜·작성자 등 보조 정보 */
  meta: '0.75rem',        // 12px
  /** 본문 기본 */
  body: '0.8125rem',      // 13px
  /** 목록 제목·강조 본문 */
  bodyLg: '0.875rem',     // 14px
  /** 상세 제목 */
  title: '1rem',          // 16px
  /** 페이지·패널 제목 */
  pageTitle: '1.125rem',  // 18px
} as const;
