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

/**
 * 목록 행 **제목**의 글자 규격. styled 안에 그대로 보간해 쓴다.
 *
 * ★ 2026-09-08 (Irene: "모바일에서 q talk 리스트 제목이랑 q note 리스트 제목이 너무 글자가 작아.
 *   q mail이랑 q task가 좀 큰데 이게 적합한 것 같아. 통일해줘. 반응형도 왜 통일이 안되었어?")
 *   ─ 규격은 여기 하나였는데 화면마다 **숫자를 베껴 적어** 두어서, 폰 분기를 안 적은 곳만
 *     13px 로 남아 있었다(실측 390px: Q talk 13 · Q note 메모 13 · Q mail 15 · Q task 15).
 *     주석으로 "규격: LIST_ROW" 라고 적어 둔 것은 검증되지 않는다 — 값을 **가져다 써야** 한다.
 *   굵기를 따로 쓰는 곳(안 읽은 메일 700)은 이 조각 뒤에 `font-weight` 를 덮어쓴다.
 */
/**
 * 목록 행 **안**에 있는 작은 컨트롤의 누를 자리. 보이는 크기는 그대로 두고 타깃만 규격으로.
 *
 * ★ 2026-09-08 (Irene: "맞지 않는 사이즈 있으면 키워야지. 통일을 해. 디자인에 맞는 사이즈로.")
 *   행에는 상세를 여는 click 이 걸려 있어서, 폰에서 손가락이 조금만 빗나가면 **행이 먼저 먹는다**.
 *   실측(390px)으로 규격(36) 미달 4곳: Q info 삭제 28 · Q task 우선순위 24 · 태그 붙이기 20 ·
 *   Q mail 답변 불필요 24.
 *   ★ 겹쳐 덮는 방식(::after 오버레이·음수 여백)은 쓰지 않는다 — 이웃 컨트롤의 클릭을
 *     가로챌 수 있다. 버튼 **자체의 최소 크기**만 규격으로 올린다(그림은 안쪽에 가운데 정렬).
 *     행 높이는 30~160px 이라 36 은 그대로 들어가고, 가로도 행 끝이라 여유가 있다.
 *   규격 출처: CLAUDE.md 반응형 기본 원칙 2 (아이콘 버튼 최소 36×36, 폰은 40).
 */
export const tapTargetCss = `
  min-width: 36px;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  @media (max-width: 640px) { min-width: 40px; min-height: 40px; }
`;

export const listRowTitleCss = `
  font-size: ${LIST_ROW.titleSize.desktop / 16}rem;
  font-weight: ${LIST_ROW.titleWeight};
  @media (max-width: 640px) { font-size: ${LIST_ROW.titleSize.phone / 16}rem; }
`;

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
