// 팝아웃 핀(항상 위) — Document Picture-in-Picture 단일 관리자 (Fable 설계 2026-07-28)
//
// 배경(왜 이렇게밖에 못 하나):
//   브라우저에서 진짜 always-on-top 은 Document PiP 가 유일하다. window.open 창은 OS z-order 를
//   제어할 수 없고, window.focus() 재호출은 focus-stealing 방지로 무력하다.
//   PiP 창은 URL 네비게이션이 불가 → 빈 PiP 문서에 같은 팝아웃 라우트를 iframe 으로 얹어 재사용한다.
//
// 2026-06-16 (#43/#44/#45) 에 핀이 걷힌 진짜 원인은 PiP 자체가 아니라 **핀이 기본 경로였던 것**이다.
//   Chrome 이면 무조건 PiP 로 열어서, 두 번째 도구를 열면 첫 번째가 죽었다(문서당 PiP 1개).
//   이번 설계의 규칙:
//     1. 기본은 일반 창(window.open) — 도구 3~4개가 동시에 떠 있는 현행 동작 유지
//     2. 핀은 명시적 opt-in, **동시에 하나만**. 다른 도구를 핀하면 이전 핀은 일반 창으로 강등한다
//     3. 핀 창이 예기치 않게 닫히면(화면공유 시작 등) 일반 창으로 자동 승격 시도 →
//        팝업 차단으로 막히면 호출부가 "다시 열기" 를 사용자 제스처로 받는다
//     4. 핀 활성 중에는 메인 창 자동 reload 를 막는다(핀 창은 opener 문서에 종속 — 같이 죽는다)
//   #44(입력 커서 포커스)는 2026-07-28 스파이크에서 현재 Chrome 재현 0 확인
//   (PiP 직접 / srcdoc iframe / 실제 /talk-popout iframe 3케이스 × 클릭포커스·캐럿·한글 IME·blur, headless+headful).

interface PipApi {
  requestWindow: (o: { width: number; height: number }) => Promise<Window>;
}

interface PinState {
  tool: string;
  win: Window;
  /** 우리가 의도적으로 닫는 중 — pagehide 를 "예기치 않은 닫힘" 으로 오인하지 않게 */
  intentional: boolean;
}

// 모듈 스코프 — 컴포넌트 재마운트에도 살아남아야 한다
// (#206 에서 인스턴스 state 가 재마운트로 소멸해 5차까지 헛돈 전례).
let active: PinState | null = null;

const LAST_PIN_KEY = 'pq_pin_last_tool';

function pipApi(): PipApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { documentPictureInPicture?: PipApi };
  return w.documentPictureInPicture || null;
}

/** 이 브라우저에서 핀이 가능한가 (Chrome/Edge 116+ 데스크탑). 모바일은 창 개념이 없어 제외. */
export function supportsPin(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(max-width: 768px)').matches) return false;
  return !!pipApi();
}

/** 현재 핀된 도구 (없으면 null) */
export function pinnedTool(): string | null {
  return active ? active.tool : null;
}

/** 지난번에 핀으로 열었던 도구 — 메뉴 아이콘 힌트에만 쓴다(자동으로 핀 열지 않는다) */
export function lastPinnedTool(): string | null {
  try { return localStorage.getItem(LAST_PIN_KEY); } catch { return null; }
}

function markPipActive(on: boolean) {
  try {
    if (on) document.body.dataset.pipActive = '1';
    else delete document.body.dataset.pipActive;
  } catch { /* noop */ }
}

/** 핀 해제 — 창을 닫는다. reopenAsWindow 면 같은 도구를 일반 창으로 다시 띄운다(사용자 제스처 안에서 호출할 것). */
export function closePin(opts: { reopenAsWindow?: { path: string; features: string } } = {}): void {
  const cur = active;
  if (!cur) return;
  cur.intentional = true;
  try { cur.win.close(); } catch { /* 이미 닫혔을 수 있다 */ }
  active = null;
  markPipActive(false);
  if (opts.reopenAsWindow) {
    const { path, features } = opts.reopenAsWindow;
    window.open(path, `pq-${cur.tool}`, features);
  }
}

export interface OpenPinnedOptions {
  tool: string;
  /** PiP 문서 안 iframe 이 로드할 팝아웃 라우트 (/talk-popout 등) */
  path: string;
  width: number;
  height: number;
  /** 창 제목 (PiP 문서 title) */
  title: string;
  /** 이전 핀을 일반 창으로 강등할 때 쓸 window.open features (도구별) */
  featuresOf: (tool: string) => string;
  pathOf: (tool: string) => string;
  /**
   * 예기치 않은 닫힘(화면공유 시작 등) 통지.
   * promoted=true 면 일반 창으로 자동 승격까지 끝난 상태, false 면 팝업 차단으로 막힌 상태
   * (호출부가 사용자 제스처로 "다시 열기" 를 받아야 한다).
   */
  onUnexpectedClose?: (info: { tool: string; promoted: boolean }) => void;
}

/**
 * 핀으로 연다. 반드시 **사용자 제스처(클릭) 안에서** 호출할 것 — requestWindow 는 transient activation 이 필요하다.
 * 성공하면 true, 미지원·사용자 취소·실패면 false (호출부가 일반 창으로 폴백).
 */
export async function openPinned(opts: OpenPinnedOptions): Promise<boolean> {
  const api = pipApi();
  if (!api) return false;

  // 규칙 2 — 동시에 하나만. 다른 도구가 핀돼 있으면 그 도구를 일반 창으로 강등한 뒤 자리를 넘긴다.
  //   (브라우저가 새 PiP 를 열며 옛 PiP 를 자동으로 닫으므로, 강등을 우리가 먼저 해두지 않으면
  //    사용자는 열려 있던 도구를 통째로 잃는다.)
  if (active && active.tool !== opts.tool) {
    const prev = active;
    prev.intentional = true;
    try { prev.win.close(); } catch { /* noop */ }
    active = null;
    markPipActive(false);
    window.open(opts.pathOf(prev.tool), `pq-${prev.tool}`, opts.featuresOf(prev.tool));
  }

  try {
    const win = await api.requestWindow({ width: opts.width, height: opts.height });
    const state: PinState = { tool: opts.tool, win, intentional: false };
    active = state;
    markPipActive(true);
    try { localStorage.setItem(LAST_PIN_KEY, opts.tool); } catch { /* noop */ }

    win.document.title = opts.title;
    const body = win.document.body;
    body.style.margin = '0';
    body.style.overflow = 'hidden';

    const iframe = win.document.createElement('iframe');
    // ★ name 필수 — utils/popout.ts markPopoutWindow() 의 realPopout 가드가
    //   window.opener || /^pq-/.test(window.name) 를 요구한다. PiP iframe 은 opener 가 없어서
    //   name 을 안 주면 팝아웃 마킹이 실패하고, 그 창 안에서 라우트를 옮기면 우하단 FAB 가 되살아난다.
    iframe.name = `pq-${opts.tool}-pip`;
    iframe.src = opts.path;
    iframe.setAttribute('allow', 'microphone; camera; display-capture; autoplay; clipboard-write');
    iframe.style.cssText = 'border:0;width:100%;height:100vh;display:block;';
    body.appendChild(iframe);

    // 규칙 3 — 닫힘 감지. 사용자가 핀을 해제한 경우(intentional)가 아니면 일반 창으로 승격 시도.
    win.addEventListener('pagehide', () => {
      if (active !== state) return;
      const wasIntentional = state.intentional;
      active = null;
      markPipActive(false);
      if (wasIntentional) return;
      // pagehide 시점엔 사용자 제스처가 없어 window.open 이 팝업 차단될 수 있다 →
      // 차단되면(null) 호출부가 "다시 열기" 버튼으로 사용자 제스처를 받는다.
      let promoted = false;
      try {
        promoted = !!window.open(opts.pathOf(state.tool), `pq-${state.tool}`, opts.featuresOf(state.tool));
      } catch { promoted = false; }
      opts.onUnexpectedClose?.({ tool: state.tool, promoted });
    });

    return true;
  } catch {
    // 사용자가 PiP 를 취소했거나 브라우저가 거부 → 호출부에서 일반 창 폴백
    markPipActive(!!active);
    return false;
  }
}
