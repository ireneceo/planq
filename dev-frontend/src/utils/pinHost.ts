// 팝아웃 핀(항상 위) — 홀더 창 방식 (Fable 설계 2026-07-28 → 구현 2026-07-31)
//
// 왜 홀더 창인가 (실측으로 확정된 물리 제약, 재검증 불필요):
//   1. 팝아웃 창 안의 클릭은 opener(메인 창) 로 transient activation 이 **전이되지 않는다**.
//      → 팝아웃 헤더의 핀 버튼이 메인 창에 "PiP 를 열어달라" 고 위임하는 설계는 물리적으로 불가능하다.
//      (첫 스파이크의 "가능" 은 --disable-popup-blocking 플래그 + 직전 메인 클릭의 잔여 activation 이
//       만든 거짓 양성이었다. 클린 headful 3회 반복으로 뒤집었다.)
//   2. 반면 팝아웃 창은 **자기 자신의 PiP 는 열 수 있고**, 그 창을 닫으면 PiP 도 같이 죽는다.
//   3. PiP 소유 창이 SPA 네비게이션을 해도 PiP 는 생존한다. ← 팝아웃이 홀더로 "변신" 할 수 있는 근거.
//   따라서: 핀 클릭 → **그 팝아웃 창 자신이** PiP 를 열고, 자신은 작은 홀더 창으로 줄어든다.
//   window.open 을 한 번도 호출하지 않으므로 팝업 차단·activation 소모 순서 결함 계열이 통째로 사라진다.
//
// PiP 는 브라우저 전역 1개다. 다른 도구를 핀하면 우리 PiP 가 **축출**되는데,
//   그 죽음에는 pagehide 도 원인 정보도 없다(닫힘 신호는 pagehide 1회뿐이고 사용자 X 와 구별 불가).
//   → 새로 핀하는 창이 BroadcastChannel 로 **선공지(pin-intent)** 하고, 붙잡고 있던 창이 스스로 놓은 뒤
//     ack 한다. ack 또는 250ms 타임아웃 후에야 requestWindow 를 부른다.
//   → 선공지 없이 사라진 죽음은 사용자가 PiP 를 닫은 것으로 본다: **"닫으면 그냥 닫힌다"**(결정 2).
//     자동 승격도 "다시 열기" 카드도 없다. 홀더는 조용히 자살한다.
//
// 알려진 한계(Fable 기록): 화면공유 강제종료처럼 우리 프로토콜 밖에서 축출되면 도구가 통째로 사라진다.
//   이 환경에서 공유-kill 재현이 불가해 계측하지 못했다. 운영 호소가 오면 onPipGone 의 자살을
//   "일반 창 복귀" 로 바꾸는 1분기 수정으로 대응한다(절단면은 여기 한 곳).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type PinTool = 'qtalk' | 'qtask' | 'qnote' | 'qhelper';
/** normal = 평범한 팝아웃 창 / holder = PiP 를 소유한 작은 창 / pip-content = PiP 안 iframe */
export type PinMode = 'normal' | 'holder' | 'pip-content';

const CHANNEL = 'planq:pin';
/** 홀더 창 크기 — "이 도구는 항상 위에 떠 있다" 만 알리면 되는 최소 크기 */
export const HOLDER_W = 360;
export const HOLDER_H = 132;

/** 도구별 창 크기 단일 원천 — 도크가 여는 일반 창 · PiP · 핀 해제 시 복귀 크기가 모두 이 값이다.
 *  (RightDock 의 features 문자열과 팝아웃의 복귀 크기가 따로 적혀 있으면 해제 때 창이 다른 크기로 돌아온다.) */
export const POPOUT_SIZE: Record<PinTool, { width: number; height: number }> = {
  qtalk: { width: 520, height: 780 },
  // qtask — 리스트 + 상세 드로어(오버레이)가 함께 뜨므로 Q Talk 와 같은 폭·높이
  qtask: { width: 520, height: 780 },
  qnote: { width: 480, height: 640 },
  qhelper: { width: 440, height: 720 },
};

/** window.open 용 features 문자열 (같은 크기에서 파생) */
export function popoutFeatures(tool: PinTool): string {
  const { width, height } = POPOUT_SIZE[tool];
  return `width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no`;
}

/** 선공지 ack 대기 상한. transient activation(약 5초) 안이라 requestWindow 는 그대로 성공한다. */
const ACK_TIMEOUT_MS = 250;
/** 축출은 pagehide 를 발화시키지 않는다 → 폴링이 유일한 감지 수단 */
const POLL_MS = 500;

interface PipApi {
  requestWindow: (o: { width: number; height: number }) => Promise<Window>;
}

interface IntentMsg { type: 'pin-intent'; id: string; tool: PinTool }
interface AckMsg { type: 'pin-ack'; id: string }
interface UnpinMsg { type: 'unpin-request'; tool: PinTool }
type PinMsg = IntentMsg | AckMsg | UnpinMsg;

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
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as PinMsg | null;
      if (m && m.type === 'pin-ack' && m.id === id) finish();
    };
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ch.removeEventListener('message', onMsg); } catch { /* noop */ }
      resolve();
    };
    ch.addEventListener('message', onMsg);
    timer = window.setTimeout(finish, ACK_TIMEOUT_MS);
    try { ch.postMessage({ type: 'pin-intent', id, tool } as IntentMsg); } catch { finish(); }
  });
}

export interface PinHost {
  mode: PinMode;
  /** 버튼을 그릴 것인가 (모바일·미지원 브라우저는 false) */
  canPin: boolean;
  /** 반드시 사용자 제스처(클릭) 안에서 호출할 것 — requestWindow 는 transient activation 을 요구한다 */
  pin: () => Promise<void>;
  unpin: () => void;
  toggle: () => void;
}

export interface UsePinHostOptions {
  tool: PinTool;
  /** PiP 문서 제목 */
  title: string;
  /** 핀 해제 시 되돌릴 원래 창 크기 = PiP 크기 */
  width: number;
  height: number;
}

/**
 * 팝아웃 창 하나가 자기 핀 상태를 관리한다. 팝아웃 라우트 컴포넌트에서만 호출할 것.
 * mode === 'holder' 면 호출부는 도구 본문 대신 PinHolderView 를 그린다.
 */
export function usePinHost({ tool, title, width, height }: UsePinHostOptions): PinHost {
  const pipContent = useMemo(() => isPipContent(), []);
  const canPin = useMemo(() => (pipContent ? true : supportsPin()), [pipContent]);
  const [mode, setMode] = useState<PinMode>(() => (pipContent ? 'pip-content' : 'normal'));

  const pipRef = useRef<Window | null>(null);
  /** 우리가 의도적으로 닫는 중 — 사용자의 X 닫기로 오인해 자살하지 않게 */
  const intentionalRef = useRef(false);
  const pollRef = useRef<number | null>(null);
  const chanRef = useRef<BroadcastChannel | null>(null);

  const stopPoll = useCallback(() => {
    if (pollRef.current != null) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  /** PiP 를 의도적으로 놓고 원래 크기의 팝아웃 창으로 복귀 (핀 해제 · 축출 선공지 수신) */
  const releasePip = useCallback(() => {
    const w = pipRef.current;
    if (!w) return;
    intentionalRef.current = true;
    stopPoll();
    pipRef.current = null;
    try { w.close(); } catch { /* 이미 닫혔을 수 있다 */ }
    markPipActive(false);
    try { window.resizeTo(width, height); } catch { /* 스크립트로 열린 창이 아니면 무시된다 */ }
    setMode('normal');
  }, [stopPoll, width, height]);

  /** PiP 가 사라졌다 — 선공지 없는 죽음은 사용자가 닫은 것으로 본다(결정 2) */
  const onPipGone = useCallback(() => {
    if (!pipRef.current) return; // releasePip 가 이미 처리했다
    stopPoll();
    pipRef.current = null;
    markPipActive(false);
    if (intentionalRef.current) return;
    try { window.close(); } catch { /* noop */ }
    // ★ close 는 거부될 수 있다 — 스크립트로 열지 않은 창(주소창에 /task-popout 을 직접 친 탭 등)에서는
    //   브라우저가 무시한다. 그대로 두면 홀더 화면이 "항상 위 창에서 보고 있습니다" 라는 거짓 안내로 남고,
    //   해제 버튼도 pipRef 가 이미 null 이라 releasePip 이 조기 return → **F5 말고는 탈출이 없다**
    //   (2026-07-31 Fable 게이트 FAIL 지적, 직접 연 탭에서 실측 재현).
    //   닫히지 않았으면 일반 창으로 되돌린다. (도크에서 연 창은 close 가 먹으므로 종전대로 조용히 소멸한다 —
    //   결정 2 는 그대로다. 이 분기가 구제하는 것은 close 가 거부되는 창뿐이다.)
    window.setTimeout(() => {
      if (window.closed) return;
      try { window.resizeTo(width, height); } catch { /* noop */ }
      setMode('normal');
    }, 200);
  }, [stopPoll, width, height]);

  // 축출 선공지 수신 + PiP 안에서 온 해제 요청 수신
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(CHANNEL); } catch { return; }
    chanRef.current = ch;
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as PinMsg | null;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'pin-intent') {
        // 붙잡고 있을 때만 놓고 ack 한다. 아무나 ack 하면 요청자가 진짜 홀더보다 먼저 출발한다.
        if (pipRef.current) {
          releasePip();
          try { ch?.postMessage({ type: 'pin-ack', id: m.id } as AckMsg); } catch { /* noop */ }
        }
        return;
      }
      if (m.type === 'unpin-request' && m.tool === tool) {
        // PiP 안 iframe 이 자기 홀더에게 보낸 해제 요청
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
      return; // 사용자가 취소했거나 브라우저가 거부 → 이 창은 그대로 일반 팝아웃으로 남는다
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
      iframe.src = window.location.pathname + window.location.search;
      iframe.setAttribute('allow', 'microphone; camera; display-capture; autoplay; clipboard-write');
      iframe.style.cssText = 'border:0;width:100%;height:100vh;display:block;';
      body.appendChild(iframe);
    } catch {
      try { win.close(); } catch { /* noop */ }
      return; // 빈 PiP 를 남기지 않는다
    }

    pipRef.current = win;
    intentionalRef.current = false;
    markPipActive(true);
    win.addEventListener('pagehide', onPipGone);
    // 축출은 pagehide 가 없다 → 폴링이 유일한 감지 수단
    pollRef.current = window.setInterval(() => {
      if (!pipRef.current || pipRef.current.closed) onPipGone();
    }, POLL_MS);

    // 2) 이 창은 홀더로 변신한다 (window.open 0회)
    try { window.resizeTo(HOLDER_W, HOLDER_H); } catch { /* noop */ }
    setMode('holder');
  }, [pipContent, tool, title, width, height, onPipGone]);

  const unpin = useCallback(() => {
    if (pipContent) {
      // PiP 안에서는 자기 창을 닫아도 홀더가 남는다 → 홀더에게 해제를 요청한다
      try { chanRef.current?.postMessage({ type: 'unpin-request', tool } as UnpinMsg); } catch { /* noop */ }
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
