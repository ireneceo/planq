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
/** 고정창 좌상단에서 안쪽으로 밀어 넣는 여백 — 창 테두리·그림자에 삐져나오지 않게 */
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

// ─── 팝아웃 자리 규칙 (Irene 2026-08-20: "첫번째 두번째 등등 기준이 있어야지") ───
//   ① 기준점은 **모니터 우측 상단**. 브라우저 창 위치와 무관하다(창이 화면 가운데 있으면
//      팝아웃도 가운데 뜨던 것이 옛 동작이었다 — 기준이 '현재 창' 이었다).
//   ② 도구마다 **자리가 고정**이다. Q Talk 은 늘 첫 자리, Q Task 는 그 왼쪽… 그래서 몇 번을 열어도
//      항상 같은 곳에서 열리고 서로 겹치지 않는다. 창 이름도 도구별로 고정이라 자리와 1:1 이다.
//   ③ 한 줄에 다 못 들어가면 아랫줄로 접는다.
//   ④ 같은 종류 창이 여러 개일 때(대화방별 채팅 창·메모 창)는 cascade 로 계단식으로 어긋난다.
//   ⑤ 마지막에 **작업 영역 안으로 클램프** — 어떤 경우에도 창이 화면 밖에서 열리지 않는다.
const SLOT_ORDER: PinTool[] = ['qtalk', 'qtask', 'qnote', 'qhelper'];
const EDGE = 24;      // 화면 가장자리 여백
const GAP = 12;       // 창 사이 간격
const CASCADE = 28;   // 같은 종류 창이 여러 개일 때 계단 간격

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

/** 창 전체가 작업 영역 안에 들어오도록 좌표를 민다. 폭·높이를 같이 봐야 오른쪽/아래로 삐져나오지 않는다. */
export function clampToScreen(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const a = workArea();
  return {
    x: Math.round(Math.min(Math.max(a.left, x), Math.max(a.left, a.left + a.width - w))),
    y: Math.round(Math.min(Math.max(a.top, y), Math.max(a.top, a.top + a.height - h))),
  };
}

/** 도구의 지정석 좌표. cascade > 0 이면 그만큼 왼쪽·아래로 계단식 이동(같은 종류 창이 여럿일 때).
 *
 *  규칙: **모니터 우측 상단부터 왼쪽으로 나란히**, 화면에 안 들어가는 것부터 **계단식**으로 어긋뜨린다.
 *  ★ 앞 슬롯들의 **실제 폭을 누적**해야 한다. 자기 폭 × 칸수로 계산하면 도구마다 폭이 달라
 *    (520/520/480/440) 뒤 창이 앞 창을 침범한다 — 실측 반증: qtask×qnote 68px, qnote×qhelper 108px 겹침.
 *  ★ 넘치는 창은 겹칠 수밖에 없다: 1920 화면에서 네 창 폭 합이 1996 이라 물리적으로 안 들어간다.
 *    줄을 바꿔 내리는 것도 답이 아니다(창 높이 780 + 720 > 1080). 그래서 겹치되 **계단식으로 어긋뜨려**
 *    제목줄과 왼쪽 모서리가 드러나게 한다 — 완전히 가려진 창이 없어야 집을 수 있다.
 */
export function popoutPosition(tool: PinTool, cascade = 0): { x: number; y: number } {
  const { width, height } = POPOUT_SIZE[tool];
  const a = workArea();
  const slot = Math.max(0, SLOT_ORDER.indexOf(tool));
  const usable = a.width - EDGE * 2;
  let used = 0;        // 이번 줄에서 이미 찬 폭(간격 포함)
  let overflow = 0;    // 나란히 놓을 자리가 없어 계단으로 밀린 순번
  for (let i = 0; i < slot; i += 1) {
    const w = POPOUT_SIZE[SLOT_ORDER[i]].width;
    if (overflow > 0) { overflow += 1; continue; }   // 이미 계단 구간 — 뒤는 전부 계단
    used += w + GAP;
    if (used + width > usable) { overflow = 1; used = 0; }
  }
  const stagger = (overflow + cascade) * CASCADE;
  const x = a.left + a.width - EDGE - used - width - stagger;
  const y = a.top + EDGE + stagger;
  return clampToScreen(x, y, width, height);
}

/** window.open 용 features 문자열 — 크기·자리 모두 여기서 나온다(세 곳이 따로 적으면 갈라진다). */
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

export interface PinIntentMsg { type: 'pin-intent'; id: string; tool: PinTool }
export interface PinAckMsg { type: 'pin-ack'; id: string }
/** PiP 안 iframe → **자기 홀더 창**: 이 핀을 놓아 달라 (iframe 은 자기를 담은 PiP 를 닫을 권한이 없다) */
export interface UnpinRequestMsg { type: 'unpin-request'; tool: PinTool }
export type PinMsg = PinIntentMsg | PinAckMsg | UnpinRequestMsg;

/** 선공지 ack 대기 상한. transient activation(약 5초) 안이라 requestWindow 는 그대로 성립한다. */
const ACK_TIMEOUT_MS = 250;
/** 축출은 pagehide 를 발화시키지 않는다 → 폴링이 유일한 감지 수단 */
const POLL_MS = 500;

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

  /** PiP 가 우리 뜻과 무관하게 사라졌다 (사용자가 X 로 닫음 · 선공지 없는 축출).
   *  ★ 옛 구현은 여기서 홀더를 자살시켰다 → "고정 취소했더니 창이 통째로 사라짐". 이제는 일반 창으로 돌아온다. */
  const onPipGone = useCallback(() => {
    if (!pipRef.current) return;  // releasePip 이 이미 처리했다
    backToNormal();
  }, [backToNormal]);

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

  /** 홀더를 고정창 사각형 **안쪽**으로 옮겨 가린다. 고정창은 항상 맨 위라 그대로 안 보이게 된다.
   *  ★ 좌표를 못 읽거나 moveTo 가 거부되는 창이면 조용히 포기한다 — 그때는 홀더가 보이지만
   *    화면에 그대로 남는 편이 창이 화면 밖으로 사라지는 것보다 낫다(PinHolderView 가 자기를 설명한다). */
  const hideBehind = useCallback((pip: Window) => {
    try {
      const x = pip.screenX ?? pip.screenLeft;
      const y = pip.screenY ?? pip.screenTop;
      if (typeof x !== 'number' || typeof y !== 'number') return;
      // ★ 갓 열린 고정창은 좌표가 (0,0) 으로 읽히는 순간이 있다. 그대로 믿으면 숨은 창이 **좌측 상단으로
      //   튀었다가** 다음 폴링에 돌아온다 — 사용자에게 그 왕복이 보인다(Irene 2026-08-20 신고).
      //   자리를 잡기 전에는 건드리지 않는다. 진짜 (0,0) 에 놓인 창이면 다음 틱에 정상 처리된다.
      if (x === 0 && y === 0) return;
      const last = lastPipPosRef.current;
      if (last && last.x === x && last.y === y) return;   // 안 움직였으면 건드리지 않는다(깜빡임 방지)
      lastPipPosRef.current = { x, y };
      const at = clampToScreen(x + HIDE_INSET, y + HIDE_INSET, HOLDER_W, HOLDER_H);
      window.moveTo(at.x, at.y);
    } catch { /* 좌표 접근 거부 — 숨기기는 포기하고 기능은 그대로 */ }
  }, []);

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
      iframe.src = window.location.pathname + window.location.search;
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
    try {
      window.resizeTo(HOLDER_W, HOLDER_H);
      const at = clampToScreen(anchor.x + HIDE_INSET, anchor.y + HIDE_INSET, HOLDER_W, HOLDER_H);
      window.moveTo(at.x, at.y);
    } catch { /* noop */ }
    setMode('holder');
  }, [pipContent, tool, title, width, height, onPipGone, pipAnchor]);

  const unpin = useCallback(() => {
    if (pipContent) {
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
