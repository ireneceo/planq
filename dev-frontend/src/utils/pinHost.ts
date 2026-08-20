// 팝아웃 핀(항상 위) — **팝아웃 창이 자기 PiP 를 소유하는 홀더 방식**.
//
// [Irene 지시 2026-08-20] "그냥 열리는 건 그냥 열리는 거야. 핀 기능은 쓰고 싶은 사람만 일반 창에서 고른다."
//   → 도크에서 여는 클릭은 **일반 창일 뿐**이다(자동 고정 없음·확인 팝업 없음, RightDock.handlePick).
//   → 고정은 팝아웃 헤더의 핀 아이콘 **토글**이다. 켜면 고정창이 뜨고, 다시 누르면 **일반 창으로 돌아온다**.
//
// 브라우저 물리 3가지 (실측 확정, 재검증 불필요):
//   1. "항상 위" 창은 Document PiP 하나뿐이고 **브라우저 전역 1개**다.
//   2. PiP 는 **그것을 연 창이 살아 있는 동안만** 산다. 연 창이 닫히거나 새로고침되면 같이 죽는다.
//   3. requestWindow 는 **그 창 자신의 사용자 조작**을 요구한다. 팝아웃의 클릭은 메인 탭으로 전이되지
//      않는다(2026-08-19 실측: NotAllowedError "requires user activation" — 즉시 호출·협상 후 호출 모두).
//   2 + 3 → 팝아웃 안에서 핀을 누르려면 **그 팝아웃 창이 소유자로 남아야** 한다. 그래서 이 창은
//   사라지지 않고 작은 **홀더**로 줄어든다. 없앨 방법이 없다(없애면 고정창이 같이 죽는다).
//
// ★ 되돌리기(Irene 지시의 핵심): 고정을 끄면 **홀더가 원래 팝아웃 창 크기로 다시 커진다.**
//   옛 구현은 여기서 창을 닫아버렸다("취소했더니 창이 사라짐"). 어떤 경로로 고정이 풀리든
//   — 핀 토글 · PiP 를 X 로 닫음 · 다른 도구가 자리를 가져감 — 착지점은 **언제나 일반 창**이다.
//
// PiP 는 전역 1개라 다른 도구를 고정하면 우리 것이 축출되는데 그 죽음에는 아무 신호가 없다.
//   → 새로 고정하는 창이 BroadcastChannel 로 **선공지(pin-intent)** 하고, 붙잡고 있던 창이 스스로
//     놓고(=일반 창 복귀) ack 한다. 그래서 사용자가 고를 것이 없다 — 먼저 고정돼 있던 도구는
//     닫히지 않고 그냥 일반 창으로 돌아간다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type PinTool = 'qtalk' | 'qtask' | 'qnote' | 'qhelper';
/** normal = 평범한 팝아웃 창 / holder = PiP 를 소유한 작은 창 / pip-content = PiP 안 iframe */
export type PinMode = 'normal' | 'holder' | 'pip-content';

/** 핀·축출·해제 요청이 오가는 채널. 창(팝아웃·PiP iframe)을 가로지른다. */
export const PIN_CHANNEL = 'planq:pin';

// 홀더 창 크기 — **고정창 뒤에 완전히 숨기는 것이 목적**이라 최소로 줄인다.
//   Irene 2026-08-20: "이 창이 남잖아. 왜 남기는 거야? 너무 이상하다니까."
//   닫을 수는 없다(닫으면 고정창도 죽는다). 대신 고정창이 **항상 맨 위**라는 성질을 이용해
//   홀더를 고정창 좌상단 안쪽으로 옮겨 완전히 가려지게 한다 → 화면에는 고정창 하나만 보인다.
//   ★ 브라우저가 강제하는 최소 창 크기(플랫폼별 100~150px)보다 작게는 못 줄인다. 그래서
//     "작게" 가 아니라 "고정창 사각형 **안쪽**에" 두는 것이 숨김의 근거다.
export const HOLDER_W = 160;
export const HOLDER_H = 90;
/** 고정창 좌상단에서 안쪽으로 밀어 넣는 여백 — 좌표를 못 읽을 때의 폴백에서만 쓴다 */
const HIDE_INSET = 12;

/** 도구별 팝아웃 라우트 단일 원천 — 도크가 여는 일반 창이 이 경로를 쓴다. */
export const POPOUT_PATH: Record<PinTool, string> = {
  qtalk: '/talk-popout',
  qtask: '/task-popout',
  qnote: '/note-popout',
  qhelper: '/help-popout',
};

/** 도구별 창 크기 단일 원천 — 도크가 여는 일반 창 · PiP · 핀 해제 복귀 크기가 모두 이 값이다.
 *  (따로 적혀 있으면 해제할 때 창이 다른 크기로 돌아온다.) */
export const POPOUT_SIZE: Record<PinTool, { width: number; height: number }> = {
  qtalk: { width: 520, height: 780 },
  // qtask — 리스트 + 상세 드로어(오버레이)가 함께 뜨므로 Q Talk 와 같은 폭·높이
  qtask: { width: 520, height: 780 },
  qnote: { width: 480, height: 640 },
  qhelper: { width: 440, height: 720 },
};

// ─── 팝아웃 자리 규칙 (Irene 2026-08-20) ───
//   요구: "일반 팝아웃에서 핀 누르면 **그 자리 그대로** 고정창이 생기게 해달라."
//
//   어긋나던 이유: 두 창을 **다른 주체가** 배치한다. 일반 팝아웃은 우리가(우측 상단), 고정창은
//   **크롬이** 놓는다(작업영역 우하단 16px 여백). 그리고 고정창은 스크립트로 못 옮긴다(실측 확정).
//   → 그래서 **반대로** 맞춘다: 고정창이 뜨는 자리를 기준점으로 삼아 **일반 팝아웃을 거기서 연다.**
//
//   기준점(origin) 구하는 순서:
//     ① 지난번 고정창이 실제로 떴던 좌표(localStorage 기억) — 가장 정확
//     ② 없으면 크롬 기본 배치를 계산: 작업영역 **우하단 16px**
//   여러 창을 동시에 열면 그대로 포개지므로 **살아 있는 창 수만큼 28px 계단**으로 어긋뜨린다.
//   (도구별 지정석은 폐기 — 지정석을 쓰면 핀을 누르는 순간 반드시 어긋난다. 겹침을 감수하더라도
//    "핀 눌러도 안 움직인다" 를 택한 것이 Irene 의 결정이다.)
const EDGE = 16;      // 크롬이 고정창을 놓을 때 쓰는 화면 가장자리 여백 (실측)
const CASCADE = 28;   // 동시에 열린 창끼리 어긋나는 간격
/** 고정창의 테두리·제목줄 두께(실측). 첫 고정 자리를 예측할 때만 쓰고, 이후는 실좌표를 학습한다. */
const PIP_CHROME_W = 8;
const PIP_CHROME_H = 38;
const ORIGIN_KEY = 'planq:popout:origin';

/** 현재 모니터의 작업 영역(작업표시줄 제외). availLeft/availTop 은 비표준이라 없으면 0 으로 본다. */
function workArea(): { left: number; top: number; width: number; height: number } {
  const s = window.screen as Screen & { availLeft?: number; availTop?: number };
  return {
    left: typeof s.availLeft === 'number' ? s.availLeft : 0,
    top: typeof s.availTop === 'number' ? s.availTop : 0,
    width: s.availWidth || window.innerWidth,
    height: s.availHeight || window.innerHeight,
  };
}

/** 창 전체가 작업 영역 안에 들어오도록 좌표를 민다. 폭·높이를 같이 봐야 오른쪽/아래로 삐져나오지 않는다.
 *
 *  ★ **다른 모니터로 가는 좌표는 가두지 않는다.** `screen.*` 은 **이 창이 지금 있는 모니터**만 알려준다.
 *    그래서 옆 모니터 좌표(예: x=2400)를 이 화면 기준으로 클램프하면 제자리로 되돌려져
 *    **홀더가 고정창을 따라 모니터를 못 넘어간다**(Irene 2026-08-20 신고: "다른 모니터로 가는데
 *    안 따라가"). 목표가 이 화면 범위 밖이면 그대로 둔다 — 옆 모니터에도 화면은 있다.
 *    (이 화면 안의 좌표일 때만 가장자리 삐져나옴을 막는다. 해제 복원의 "창 유실 방지" 목적은 그대로.) */
export function clampToScreen(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const a = workArea();
  const onThisScreen = x >= a.left - 1 && x < a.left + a.width;
  if (!onThisScreen) return { x: Math.round(x), y: Math.round(y) };
  return {
    x: Math.round(Math.min(Math.max(a.left, x), Math.max(a.left, a.left + a.width - w))),
    y: Math.round(Math.min(Math.max(a.top, y), Math.max(a.top, a.top + a.height - h))),
  };
}

/** 지난번 고정창이 실제로 떴던 자리. 창 하나만 열었을 때 핀을 눌러도 안 움직이게 하는 근거. */
function readOrigin(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(ORIGIN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof v.x !== 'number' || typeof v.y !== 'number') return null;
    return { x: v.x, y: v.y };
  } catch { return null; }
}
/** 고정창이 뜬 좌표를 기억한다 — 다음부터 일반 팝아웃이 이 자리에서 열린다. */
export function rememberOrigin(x: number, y: number) {
  try { localStorage.setItem(ORIGIN_KEY, JSON.stringify({ x, y })); } catch { /* 시크릿 모드 등 */ }
}

/** 팝아웃 좌표. cascade > 0 이면 그만큼 왼쪽·아래로 계단식 이동. */
export function popoutPosition(tool: PinTool, cascade = 0): { x: number; y: number } {
  const { width, height } = POPOUT_SIZE[tool];
  const a = workArea();
  // ★ 기억한 자리는 **지금 쓰는 모니터 안일 때만** 쓴다.
  //   고정창을 2번 모니터로 옮기면 그 좌표가 기억되는데, 그대로 쓰면 다음 팝아웃이 2번 모니터에서
  //   멀리 열린다. 반면 고정창은 크롬이 자기 규칙대로(대개 1번 모니터에) 다시 놓기 때문에
  //   **열 때와 고정할 때가 서로 다른 화면**이 된다 — Irene 2026-08-20: "다른 모니터에서 멀리
  //   열리더니 고정하니까 기존 모니터 우측 상단, 이랬다 저랬다 해."
  //   지금 화면 밖 좌표면 버리고 이 화면의 계산값으로 연다(그 화면에서 다시 고정하면 곧 재학습된다).
  const remembered = readOrigin();
  const learned = remembered
    && remembered.x >= a.left - 1 && remembered.x < a.left + a.width
    && remembered.y >= a.top - 1 && remembered.y < a.top + a.height
    ? remembered : null;
  // ② 폴백 — 크롬이 고정창을 놓는 방식과 **같은 계산**: 작업영역 우하단 EDGE(16) 여백.
  //   ★ 기준이 **바깥(outer) 크기**다. 안쪽(inner) 크기로 계산하면 첫 고정 때 창이 (-8,-20) 만큼
  //     튄다(Fable 실측: 예상 1384,266 vs 실제 1376,246). 고정창 테두리·제목줄 두께를 더해야 맞다.
  //     실측값(528-520=8, 818-780=38)을 상수로 둔다 — 브라우저가 바뀌어 어긋나도 **첫 고정 직후
  //     rememberOrigin 이 실좌표를 학습**해 다음부터는 정확해진다(이 상수는 첫 1회용 추정치다).
  const base = learned || {
    x: a.left + a.width - (width + PIP_CHROME_W) - EDGE,
    y: a.top + a.height - (height + PIP_CHROME_H) - EDGE,
  };
  return clampToScreen(base.x - cascade * CASCADE, base.y + cascade * CASCADE, width, height);
}

/** window.open 용 features 문자열 — 크기·자리 모두 여기서 나온다(여러 곳이 따로 적으면 갈라진다). */
export function popoutFeatures(tool: PinTool, cascade = 0): string {
  const { width, height } = POPOUT_SIZE[tool];
  let pos = '';
  try {
    if (typeof window !== 'undefined') {
      const { x, y } = popoutPosition(tool, cascade);
      pos = `,left=${x},top=${y}`;
    }
  } catch { pos = ''; }
  return `width=${width},height=${height}${pos},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`;
}

// ─── 팝아웃 여는 단일 진입점 ───
//   여는 곳이 여러 군데라(실행 버튼·채팅방 ⧉·메모 ⧉) 각자 window.open 하면 자리 규칙이 갈라진다.
//   여기 하나로 모아 **살아 있는 창 수**로 계단 번호를 정한다(닫힌 창은 자리를 비운다).
const livePopouts = new Map<string, { win: Window; cascade: number }>();

export function openPopout(tool: PinTool, opts?: { url?: string; name?: string }): Window | null {
  for (const [k, v] of livePopouts) {
    try { if (!v.win || v.win.closed) livePopouts.delete(k); } catch { livePopouts.delete(k); }
  }
  const name = opts?.name || `pq-${tool}`;
  const known = livePopouts.get(name);
  // 이미 열려 있는 창을 다시 여는 것이면 그 창의 계단 번호를 그대로 쓴다(자리가 튀지 않게).
  //   ★ 새 창의 번호는 창 **개수**가 아니라 **비어 있는 가장 작은 번호**다. 개수로 정하면
  //     가운데 창을 닫은 뒤 새로 열 때 생존 창과 **완전히 같은 좌표**로 겹친다(Fable 실측).
  const taken = new Set<number>();
  for (const v of livePopouts.values()) taken.add(v.cascade);
  let free = 0;
  while (taken.has(free)) free += 1;
  const cascade = known ? known.cascade : free;
  const win = window.open(opts?.url || POPOUT_PATH[tool], name, popoutFeatures(tool, cascade));
  if (win) livePopouts.set(name, { win, cascade });
  return win;
}

export interface PinIntentMsg { type: 'pin-intent'; id: string; tool: PinTool }
export interface PinAckMsg { type: 'pin-ack'; id: string }
/** PiP 안 iframe → **자기 홀더 창**: 이 핀을 놓아 달라 (iframe 은 자기를 담은 PiP 를 닫을 권한이 없다) */
export interface UnpinRequestMsg { type: 'unpin-request'; tool: PinTool }
/** 고정창 안 iframe → 자기 홀더: 고정창이 여기로 움직였다.
 *  ★ 왜 고정창이 알려주나: **가려진 창은 브라우저가 타이머를 늦춘다**. 홀더가 스스로 폴링하면
 *    아무리 주기를 줄여도 실제로는 늦게 돌아 움직일 때 삐져나온다(Irene: "움직일 때 보여").
 *    고정창은 항상 맨 위라 늦춰지지 않는다 — 그쪽에서 좌표를 밀어준다. 홀더 폴링은 backstop 으로만 남긴다. */
export interface PipMovedMsg { type: 'pip-moved'; tool: PinTool; x: number; y: number; w: number; h: number }
export type PinMsg = PinIntentMsg | PinAckMsg | UnpinRequestMsg | PipMovedMsg;

/** 선공지 ack 대기 상한. transient activation(약 5초) 안이라 requestWindow 는 그대로 성립한다. */
const ACK_TIMEOUT_MS = 250;
// 축출은 pagehide 를 발화시키지 않는다 → 폴링이 유일한 감지 수단.
//   ★ 주기가 곧 **따라가기 지연**이다. 500ms 였을 때 고정창을 끌면 홀더가 뒤늦게 쫓아오며
//     그 틈에 삐져나왔다(Irene: "나왔다 들어갔다 해"). 좌표 비교는 값 하나 읽는 것이라 비용이 없고,
//     안 움직였으면 moveTo 를 아예 건너뛴다.
const POLL_MS = 120;
/** 고정창이 자리를 잡을 때까지 (0,0) 을 무시해 주는 시간. 이 뒤에는 (0,0) 도 진짜 좌표로 본다. */
const SETTLE_MS = 1500;

interface PipApi {
  requestWindow: (o: { width: number; height: number }) => Promise<Window>;
}

function pipApi(): PipApi | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { documentPictureInPicture?: PipApi };
  return w.documentPictureInPicture || null;
}

/** PiP 문서 안의 iframe 으로 로드된 인스턴스인가 (팝아웃 라우트는 이 경우에만 iframe 안에서 돈다) */
export function isPipContent(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return true; // cross-origin 접근 거부 = 우리는 프레임 안이다
  }
}

/** 이 브라우저에서 핀이 가능한가 (Chrome/Edge 116+ 데스크탑). 모바일은 창 개념이 없어 제외.
 *  ★ 모바일 판정에 뷰포트 폭(max-width:768px)을 쓰면 안 된다 — 팝아웃 창 자체가 520px 라
 *    데스크탑에서도 항상 참이 되어 핀 버튼이 영영 안 뜬다. 입력 방식으로 판정한다. */
export function supportsPin(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return false;
  return !!pipApi();
}

/** 다른 모니터로 창을 옮기려면 **창 관리 권한**이 필요하다.
 *  ★ 권한이 없으면 크롬은 `moveTo` 를 **현재 모니터 안으로 강제 클램프**한다 — 좌표를 아무리 정확히
 *    계산해도 홀더가 옆 모니터로 못 따라간다(Irene 2026-08-20: "모니터 이동할 때 안 따라가").
 *  ★ 반드시 **사용자 클릭 핸들러 안에서** 부른다(권한 요청은 제스처를 요구한다). 이미 허용돼 있으면
 *    창이 뜨지 않고 조용히 통과한다. 거부해도 기능은 그대로 — 같은 모니터 안에서만 숨는다.
 *  ★ 실패를 삼키되 로그는 남기지 않는다(거부는 정상 경로다). */
async function ensureWindowPlacement(): Promise<void> {
  try {
    const w = window as unknown as { getScreenDetails?: () => Promise<unknown> };
    if (typeof w.getScreenDetails !== 'function') return;      // 미지원 브라우저
    await w.getScreenDetails();
  } catch { /* 사용자가 거부했거나 미지원 — 단일 모니터 동작으로 남는다 */ }
}

function markPipActive(on: boolean) {
  try {
    if (on) document.body.dataset.pipActive = '1';
    else delete document.body.dataset.pipActive;
  } catch { /* noop */ }
}

/** 선공지 → ack 또는 250ms. 붙잡고 있는 창이 없으면 그냥 타임아웃으로 진행한다. */
function announceIntent(ch: BroadcastChannel | null, tool: PinTool): Promise<void> {
  return new Promise((resolve) => {
    if (!ch) { resolve(); return; }
    const id = `${tool}-${Math.random().toString(36).slice(2, 10)}`;
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ch.removeEventListener('message', onMsg); } catch { /* noop */ }
      resolve();
    };
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as PinMsg | null;
      if (m && m.type === 'pin-ack' && m.id === id) finish();
    };
    ch.addEventListener('message', onMsg);
    timer = window.setTimeout(finish, ACK_TIMEOUT_MS);
    try { ch.postMessage({ type: 'pin-intent', id, tool } as PinIntentMsg); } catch { finish(); }
  });
}

export interface PinHost {
  mode: PinMode;
  /** 핀 버튼을 그릴 것인가 (모바일·미지원 브라우저는 false) */
  canPin: boolean;
  /** ★ 반드시 사용자 클릭 핸들러 안에서 호출할 것 — requestWindow 는 transient activation 을 요구한다 */
  pin: () => Promise<void>;
  unpin: () => void;
  toggle: () => void;
}

export interface UsePinHostOptions {
  tool: PinTool;
  /** PiP 문서 제목 */
  title: string;
}

/**
 * 팝아웃 창 하나가 자기 핀 상태를 관리한다. **팝아웃 라우트 컴포넌트에서만** 호출할 것.
 * mode === 'holder' 면 호출부는 도구 본문 대신 PinHolderView 를 그린다.
 */
export function usePinHost({ tool, title }: UsePinHostOptions): PinHost {
  const pipContent = useMemo(() => isPipContent(), []);
  const canPin = useMemo(() => (pipContent ? true : supportsPin()), [pipContent]);
  const [mode, setMode] = useState<PinMode>(() => (pipContent ? 'pip-content' : 'normal'));
  const { width, height } = POPOUT_SIZE[tool];

  const pipRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);
  const chanRef = useRef<BroadcastChannel | null>(null);
  /** 고정창의 마지막 위치 — 해제할 때 원래 창을 그 자리에 되돌려 놓는다(엉뚱한 곳에서 튀어나오지 않게) */
  const lastPipPosRef = useRef<{ x: number; y: number } | null>(null);
  /** 이번 고정에서 (0,0) 을 "아직 자리 안 잡음" 으로 봐줄 마감 시각. 지나면 진짜 좌표로 인정한다. */
  const settleUntilRef = useRef(0);

  const stopPoll = useCallback(() => {
    if (pollRef.current != null) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  /** 일반 창으로 되돌린다 — **모든 해제 경로의 유일한 착지점**.
   *  ★ 여기서 window.close() 를 부르지 말 것. 고정을 끄면 도구가 사라지는 것이 아니라
   *    원래 팝아웃 창으로 돌아와야 한다(Irene 2026-08-20). 창을 닫는 것은 사용자만 한다. */
  const backToNormal = useCallback(() => {
    stopPoll();
    pipRef.current = null;
    markPipActive(false);
    // 스크립트로 열린 창이 아니면(주소창에 직접 친 탭) 브라우저가 무시한다 — 그래도 mode 는 돌아온다.
    //   ★ 되돌아오는 창은 **고정창이 있던 자리**에 놓는다. 숨어 있던 좌표(고정창 안쪽)에서 그대로
    //     커지면 화면 밖으로 밀려 보이지 않는 사고가 난다.
    try {
      const pos = lastPipPosRef.current;
      // ★ window.open 의 features width/height 는 **콘텐츠(inner)** 크기인데 resizeTo 는 **창(outer)** 크기다.
      //   그대로 넣으면 복원된 창이 브라우저 크롬 높이만큼(≈34px) 작아진다(실측). 차이를 더해 맞춘다.
      const chromeW = Math.max(0, window.outerWidth - window.innerWidth);
      const chromeH = Math.max(0, window.outerHeight - window.innerHeight);
      window.resizeTo(width + chromeW, height + chromeH);
      // ★ 폭·높이까지 보고 클램프한다. 좌표만 0 으로 막으면 고정창이 화면 **오른쪽 끝**에 있었을 때
      //   복원된 520px 창이 화면 밖으로 밀려 사용자가 창을 잃는다.
      const at = pos ? clampToScreen(pos.x, pos.y, width, height) : popoutPosition(tool, 0);
      window.moveTo(at.x, at.y);
      // ★ 반드시 앞으로 끌어온다. 홀더는 고정창 뒤에 **숨어 있던 창**이라 한 번도 앞에 선 적이 없다.
      //   크기·자리를 되돌려도 다른 창(메인 브라우저) 뒤에 깔린 채라 사용자에게는 **창이 안 열린 것**으로
      //   보인다 — Irene 2026-08-20 신고: "핀을 다시 누르면 고정창이 닫혀버리는데 일반창이 안 열려."
      window.focus();
    } catch { /* noop */ }
    lastPipPosRef.current = null;
    setMode('normal');
  }, [stopPoll, width, height, tool]);

  /** 우리가 PiP 를 놓는다 (핀 토글 해제 · 축출 선공지 수신). 우리 손으로 닫고 일반 창으로 복귀. */
  const releasePip = useCallback(() => {
    const w = pipRef.current;
    pipRef.current = null;      // ★ 가장 먼저 비운다 — 폴링/pagehide 가 이 해제를 〈사용자가 닫음〉 으로 재진입하지 않게
    if (w) { try { w.close(); } catch { /* 이미 닫혔을 수 있다 */ } }
    backToNormal();
  }, [backToNormal]);

  /** 고정창이 우리 뜻과 무관하게 사라졌다 = **사용자가 X 로 닫았다**.
   *  ★ 이때는 도구를 통째로 닫는다 (Irene 2026-08-20: "핀을 취소하면 일반창이 나오는 거지만,
   *    우측 X 를 누르면 그냥 다 닫혀야지"). X 는 "닫겠다" 는 뜻이지 "일반 창으로 돌리겠다" 가 아니다.
   *  ★ 핀 토글 해제(releasePip)와 다른 도구에 자리를 뺏기는 축출(pin-intent)은 **여기로 오지 않는다** —
   *    둘 다 releasePip 이 pipRef 를 먼저 비우고 일반 창으로 되돌린다. 구분은 그 경로 차이로 성립한다.
   *  ★ close 가 거부되는 창(주소창에 직접 친 탭)도 있다 — 그때는 갇히지 않도록 일반 창으로 되돌린다. */
  const onPipGone = useCallback(() => {
    if (!pipRef.current) return;  // releasePip 이 이미 처리했다
    stopPoll();
    pipRef.current = null;
    markPipActive(false);
    try { window.close(); } catch { /* 거부될 수 있다 */ }
    window.setTimeout(() => {
      if (window.closed) return;
      backToNormal();
    }, 200);
  }, [backToNormal, stopPoll]);

  // 축출 선공지 수신 + PiP 안에서 온 해제 요청 수신
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(PIN_CHANNEL); } catch { return; }
    chanRef.current = ch;
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as PinMsg | null;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'pin-intent') {
        // 다른 창이 자리를 가져간다. 붙잡고 있을 때만 놓고 ack 한다
        // (아무나 ack 하면 요청자가 진짜 소유자보다 먼저 출발한다).
        if (pipRef.current) {
          releasePip();       // ← 우리 도구는 닫히지 않는다. 일반 창으로 돌아갈 뿐이다.
          try { ch?.postMessage({ type: 'pin-ack', id: m.id } as PinAckMsg); } catch { /* noop */ }
        }
        return;
      }
      if (m.type === 'pip-moved' && m.tool === tool) {
        // 고정창이 밀어준 좌표 — 폴링을 기다리지 않고 곧바로 붙는다.
        if (!pipRef.current) return;
        const last = lastPipPosRef.current;
        if (last && last.x === m.x && last.y === m.y) return;
        lastPipPosRef.current = { x: m.x, y: m.y };
        rememberOrigin(m.x, m.y);
        try {
          const at = clampToScreen(
            m.x + Math.round((m.w - HOLDER_W) / 2),
            m.y + Math.round((m.h - HOLDER_H) / 2),
            HOLDER_W, HOLDER_H,
          );
          window.moveTo(at.x, at.y);
        } catch { /* noop */ }
        return;
      }
      if (m.type === 'unpin-request' && m.tool === tool) {
        // PiP 안 iframe 의 핀 토글이 자기 홀더에게 보낸 해제 요청
        releasePip();
      }
    };
    ch.addEventListener('message', onMsg);
    return () => {
      try { ch?.removeEventListener('message', onMsg); ch?.close(); } catch { /* noop */ }
      chanRef.current = null;
    };
  }, [tool, releasePip]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  // ── 홀더 잔재 자가 치유 (Irene 2026-08-20 신고) ──
  //   "앱을 닫았다가 다시 열었더니 쪼그만한 게 팝아웃 여니까 같이 열려. 고정창도 없는데."
  //   고정 중이던 창(160×90 홀더)을 브라우저가 **세션 복원**으로 되살리면, 고정창은 이미 죽었는데
  //   창만 홀더 크기로 남는다. 게다가 복원된 창은 window.name 을 잃는 경우가 있어 새로 여는 팝아웃과
  //   합쳐지지도 않는다 → 쓸모없는 작은 창이 하나 더 뜬 것처럼 보인다.
  //   ★ 그래서 **고정 상태가 아닌데 창이 홀더 크기이면** 스스로 원래 팝아웃 크기로 되돌린다.
  //     (닫지는 않는다 — 사용자 창을 우리가 닫는 것은 이 파일의 금지 사항이다.)
  useEffect(() => {
    if (pipContent) return;                       // 고정창 안 iframe 은 대상 아님
    if (pipRef.current) return;                   // 지금 우리가 고정 중이면 홀더가 맞다
    // ★ 이름을 되찾아 준다. 세션 복원된 창은 window.name 을 잃는 경우가 있고, 이름이 없으면
    //   도크에서 같은 도구를 열 때 **이 창을 재사용하지 못해 창이 둘로 늘어난다**(신고의 "같이 열려").
    //   대화방별·메모별 창은 고유 이름이 따로 있으므로 **기본 팝아웃 경로일 때만** 붙인다.
    try {
      const bare = window.location.pathname === POPOUT_PATH[tool]
        && !new URLSearchParams(window.location.search).get('conv');
      if (!window.name && bare) window.name = `pq-${tool}`;
    } catch { /* noop */ }
    try {
      if (window.innerWidth > HOLDER_W + 40) return;   // 이미 정상 크기
      const chromeW = Math.max(0, window.outerWidth - window.innerWidth);
      const chromeH = Math.max(0, window.outerHeight - window.innerHeight);
      window.resizeTo(width + chromeW, height + chromeH);
      const at = popoutPosition(tool, 0);
      window.moveTo(at.x, at.y);
    } catch { /* 스크립트로 열린 창이 아니면 무시된다 */ }
    // 마운트 1회 — 이후 크기 변경은 사용자 몫이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 홀더를 고정창 사각형 **안쪽**으로 옮겨 가린다. 고정창은 항상 맨 위라 그대로 안 보이게 된다.
   *  ★ 좌표를 못 읽거나 moveTo 가 거부되는 창이면 조용히 포기한다 — 그때는 홀더가 보이지만
   *    화면에 그대로 남는 편이 창이 화면 밖으로 사라지는 것보다 낫다(PinHolderView 가 자기를 설명한다). */
  /** 홀더가 숨을 목표 좌표 — 고정창의 **한가운데**.
   *  ★ 모서리(+12,+12)에 두면 고정창이 조금만 움직여도 반대쪽으로 삐져나온다. 가운데에 두면
   *    고정창 폭·높이의 절반 가까이(≈180px) 움직여도 여전히 덮인다 — 따라가기 지연이 눈에 안 띈다. */
  const hideTarget = useCallback((pip: Window, x: number, y: number): { x: number; y: number } => {
    let w = 0; let h = 0;
    try { w = pip.outerWidth || 0; h = pip.outerHeight || 0; } catch { /* 접근 거부 */ }
    if (!w || !h) return clampToScreen(x + HIDE_INSET, y + HIDE_INSET, HOLDER_W, HOLDER_H);
    return clampToScreen(
      x + Math.round((w - HOLDER_W) / 2),
      y + Math.round((h - HOLDER_H) / 2),
      HOLDER_W, HOLDER_H,
    );
  }, []);

  const hideBehind = useCallback((pip: Window) => {
    try {
      const x = pip.screenX ?? pip.screenLeft;
      const y = pip.screenY ?? pip.screenTop;
      if (typeof x !== 'number' || typeof y !== 'number') return;
      // ★ 갓 열린 고정창은 좌표가 (0,0) 으로 읽히는 순간이 있다. 그대로 믿으면 숨은 창이 **좌측 상단으로
      //   튀었다가** 다음 폴링에 돌아온다 — 사용자에게 그 왕복이 보인다(Irene 2026-08-20 신고).
      //   ★ 단 **열린 직후 잠깐만** 봐준다. 무기한 무시하면, 고정창이 계속 (0,0) 으로 읽히는 상황에서
      //     따라가기가 영영 멈춰 숨어야 할 창이 그대로 보인다(Irene 재신고: "일반창 했다 다시 고정창
      //     하면 위에 있는게 안 따라다녀"). 가드가 기능을 죽이는 쪽이 더 나쁘다.
      if (x === 0 && y === 0 && Date.now() < settleUntilRef.current) return;
      const last = lastPipPosRef.current;
      if (last && last.x === x && last.y === y) return;   // 안 움직였으면 건드리지 않는다(깜빡임 방지)
      lastPipPosRef.current = { x, y };
      // ★ 고정창이 옮겨지면 **그 자리를 기준점으로 갱신**한다. 안 하면 다음에 여는 팝아웃이 옛 자리에서
      //   열려 핀을 누를 때 창이 튄다(Irene: "핀을 눌렀다 취소했다 할 때 위치가 동일하지 않아").
      rememberOrigin(x, y);
      const at = hideTarget(pip, x, y);
      window.moveTo(at.x, at.y);
    } catch { /* 좌표 접근 거부 — 숨기기는 포기하고 기능은 그대로 */ }
  }, [hideTarget]);

  /** 고정창의 현재 좌표. 아직 자리를 안 잡아 (0,0) 으로 읽히면 이 창(팝아웃) 위치로 폴백한다. */
  const pipAnchor = useCallback((pip: Window): { x: number; y: number } => {
    try {
      const x = pip.screenX ?? pip.screenLeft;
      const y = pip.screenY ?? pip.screenTop;
      if (typeof x === 'number' && typeof y === 'number' && !(x === 0 && y === 0)) return { x, y };
    } catch { /* 좌표 접근 거부 */ }
    return { x: window.screenX ?? 0, y: window.screenY ?? 0 };
  }, []);

  const pin = useCallback(async () => {
    if (pipContent || pipRef.current) return;
    const api = pipApi();
    if (!api) return;

    // 0) 창 관리 권한 — 없으면 홀더가 옆 모니터로 못 따라간다(크롬이 moveTo 를 현재 화면에 가둔다).
    //    ★ requestWindow 보다 **먼저** 부른다. 뒤에 두면 PiP 가 뜬 뒤 권한창이 겹쳐 뜬다.
    await ensureWindowPlacement();

    // 1) 선공지 — 다른 창이 붙잡고 있으면 먼저 자리를 비우게 한다(축출은 감지 불가한 죽음이다).
    await announceIntent(chanRef.current, tool);

    let win: Window;
    try {
      win = await api.requestWindow({ width, height });
    } catch {
      return; // 사용자가 취소했거나 브라우저가 거부 → 이 창은 그대로 **일반 팝아웃으로 남는다**
    }

    try {
      win.document.title = title;
      const body = win.document.body;
      body.style.margin = '0';
      body.style.overflow = 'hidden';
      const iframe = win.document.createElement('iframe');
      // ★ name 필수 — utils/popout.ts markPopoutWindow() 의 realPopout 가드가
      //   window.opener || /^pq-/.test(window.name) 를 요구한다. PiP iframe 은 opener 가 없어
      //   name 을 안 주면 팝아웃 마킹이 실패하고 그 안에서 우하단 FAB 가 되살아난다.
      iframe.name = `pq-${tool}-pip`;
      // ★ 라우트 상수가 아니라 **지금 이 창의 URL** 을 싣는다 — Q Talk 에서 대화를 바꾼 뒤 고정하면
      //   고정창도 그 대화로 열려야 한다(최초 진입 대화로 되돌아가면 안 된다).
      // ★ 홀더(이 창)의 이름을 같이 실어 보낸다. 해제할 때 **고정창 쪽에서** 이 이름으로 홀더를
      //   앞으로 끌어올려야 한다 — 홀더 자신은 사용자 조작이 없어 focus() 가 무시될 수 있다.
      const sep = window.location.search ? '&' : '?';
      const holderName = window.name ? `${sep}_holder=${encodeURIComponent(window.name)}` : '';
      iframe.src = window.location.pathname + window.location.search + holderName;
      iframe.setAttribute('allow', 'microphone; camera; display-capture; autoplay; clipboard-write');
      iframe.style.cssText = 'border:0;width:100%;height:100vh;display:block;';
      body.appendChild(iframe);
    } catch {
      try { win.close(); } catch { /* noop */ }
      return; // 빈 PiP 를 남기지 않는다
    }

    // ★ 고정창의 **자리는 우리가 못 정한다** (2026-08-20 실측 확정).
    //   `win.moveTo(...)` 는 에러도 없이 무시된다 — 크롬이 PiP 창의 스크립트 이동을 차단한다
    //   (같은 환경에서 일반 window.open 팝업은 moveTo 가 정상 동작하는 것으로 대조 확인).
    //   그래서 "고정창을 팝아웃이 있던 자리에 띄운다" 는 어떤 코드로도 불가능하다. 시도하지 말 것.
    //   대신 **홀더를 고정창 실좌표로 곧장 보낸다** — PiP 좌표는 requestWindow 직후 t=0 에 이미
    //   정확히 읽힌다(실측 3회). 팝아웃 자리를 기준으로 잡으면 홀더가 옛 자리에 0.5초 노출됐다가
    //   폴링 첫 틱에 점프하는 것이 사용자에게 보인다.
    const anchor = pipAnchor(win);
    // ★ 고정창이 실제로 뜬 자리를 기억한다 — 다음부터 **일반 팝아웃이 이 자리에서** 열려서
    //   핀을 눌러도 창이 움직이지 않는다(Irene: "그 자리 그대로 고정팝아웃 생기게 해달라고 했잖아").
    rememberOrigin(anchor.x, anchor.y);

    pipRef.current = win;
    markPipActive(true);
    // 창 동일성 확인 후에만 — 옛 창의 뒤늦은 pagehide 가 방금 연 PiP 를 철거하지 못하게 한다.
    win.addEventListener('pagehide', () => { if (pipRef.current === win) onPipGone(); });
    // 축출(다른 도구가 자리를 가져감)은 pagehide 가 없다 → 폴링이 유일한 감지 수단.
    //   같은 틱에서 홀더를 고정창 뒤로 따라 옮긴다(사용자가 고정창을 옮겨도 계속 숨어 있게).
    pollRef.current = window.setInterval(() => {
      if (!pipRef.current || pipRef.current.closed) { onPipGone(); return; }
      hideBehind(pipRef.current);
    }, POLL_MS);

    // 2) 이 창은 홀더로 변신해 **고정창 뒤에 숨는다** (window.open 0회 → 팝업 차단 계열 결함이 없다)
    //    ★ 줄이기 **전에** 목표 좌표를 정해 두고 한 번에 옮긴다 — 줄인 뒤 좌표를 다시 읽으면
    //      그 사이 상태가 화면에 한 프레임 노출된다.
    lastPipPosRef.current = anchor;
    settleUntilRef.current = Date.now() + SETTLE_MS;
    try {
      window.resizeTo(HOLDER_W, HOLDER_H);
      const at = hideTarget(win, anchor.x, anchor.y);
      window.moveTo(at.x, at.y);
    } catch { /* noop */ }
    setMode('holder');
  }, [pipContent, tool, title, width, height, onPipGone, pipAnchor, hideTarget]);

  // ── 고정창 안에서: 자기 창이 움직이면 홀더에게 좌표를 밀어준다 (위 PipMovedMsg 주석 참조) ──
  useEffect(() => {
    if (!pipContent) return;
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(PIN_CHANNEL); } catch { return; }
    let lastX = NaN; let lastY = NaN;
    let raf = 0;
    const tick = () => {
      try {
        const x = window.screenX ?? 0;
        const y = window.screenY ?? 0;
        if (x !== lastX || y !== lastY) {
          lastX = x; lastY = y;
          const w = window.outerWidth || window.innerWidth || 0;
          const h = window.outerHeight || window.innerHeight || 0;
          ch?.postMessage({ type: 'pip-moved', tool, x, y, w, h } as PipMovedMsg);
        }
      } catch { /* noop */ }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      try { ch?.close(); } catch { /* noop */ }
    };
  }, [pipContent, tool]);

  const unpin = useCallback(() => {
    if (pipContent) {
      // ★ 이 클릭은 **고정창 안의 사용자 조작**이다. 여기서 홀더 창을 이름으로 지목해 앞으로 끌어온다.
      //   (빈 URL 로 여는 window.open 은 같은 이름의 창이 있으면 **그 창을 그대로 앞세운다**.)
      //   홀더 쪽 focus() 만으로는 조작 없는 창이라 브라우저가 무시할 수 있다 — 그러면 사용자에게는
      //   "고정창은 닫혔는데 일반창이 안 열린다" 로 보인다(Irene 2026-08-20 신고).
      try {
        const holder = new URLSearchParams(window.location.search).get('_holder');
        if (holder) window.open('', holder);
      } catch { /* 실패해도 아래 방송은 그대로 나간다 */ }
      // 이 iframe 은 자기를 담은 PiP 창을 닫을 수 없다(소유자는 홀더 창이다) → 방송으로 부탁한다.
      try {
        const ch = chanRef.current || new BroadcastChannel(PIN_CHANNEL);
        ch.postMessage({ type: 'unpin-request', tool } as UnpinRequestMsg);
      } catch { /* 미지원 — 사용자가 PiP 를 직접 닫으면 폴링이 홀더를 일반 창으로 되돌린다 */ }
      return;
    }
    releasePip();
  }, [pipContent, tool, releasePip]);

  const toggle = useCallback(() => {
    if (mode === 'normal') { void pin(); return; }
    unpin();
  }, [mode, pin, unpin]);

  return { mode, canPin, pin, unpin, toggle };
}
