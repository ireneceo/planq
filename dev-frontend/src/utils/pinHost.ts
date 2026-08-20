// 팝아웃 핀(항상 위) — **공유 프리미티브**. 소유 로직은 utils/pinOwner.ts 에 있다.
//
// [옛 구조 · 2026-07-31] 도크 → window.open(팝아웃 창) → 팝아웃 헤더의 핀 → 팝아웃이 자기 PiP 를 열고
//   자신은 360×132 홀더 창으로 축소. 결과적으로 **창이 2개** 남아 사용자가 호소했다(#258).
// [현 구조 · 2026-08-14] 도크의 핀 버튼 → **메인 탭이** PiP 를 열고 그 안 iframe 에 팝아웃 라우트를 싣는다.
//   창은 1개. 홀더 없음. 해제 버튼은 PiP 안 헤더에 있다.
//
// ★ 옛 주석이 "팝아웃의 클릭은 메인 창으로 transient activation 이 전이되지 않는다" 고 못박아 뒀는데,
//   그 물리는 지금도 참이다. 다만 그것이 막는 것은 **팝아웃이 메인에게 PiP 를 열어달라고 부탁하는** 방향이다.
//   새 구조에는 그 부탁이 없다 — 도크 클릭은 메인 탭 자신의 제스처라 requestWindow 가 그대로 성립한다.
//   (S1 실측: PiP 소유 창이 SPA 네비게이션을 해도 PiP 는 생존한다 → 메인 탭이 소유자가 될 수 있는 근거.)
//
// PiP 는 브라우저 전역 1개다 → 축출 선공지(pin-intent/pin-ack) 프로토콜은 그대로 유지한다(pinOwner.ts).
import { useCallback, useEffect, useMemo } from 'react';
import { isPopoutWindow, markPopoutWindow } from './popout';

export type PinTool = 'qtalk' | 'qtask' | 'qnote' | 'qhelper';

/** 핀·축출·해제 요청이 오가는 채널. 창(탭·PiP iframe)을 가로지른다. */
export const PIN_CHANNEL = 'planq:pin';

/** 도구별 팝아웃 라우트 단일 원천 — 도크의 일반 창과 PiP 안 iframe 이 같은 경로를 쓴다. */
export const POPOUT_PATH: Record<PinTool, string> = {
  qtalk: '/talk-popout',
  qtask: '/task-popout',
  qnote: '/note-popout',
  qhelper: '/help-popout',
};

/** 도구별 창 크기 단일 원천 — 도크가 여는 일반 창과 PiP 크기가 모두 이 값이다. */
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
  // ★ 위치를 안 주면 브라우저가 **좌측 상단**에 띄운다 — 작업 중인 PlanQ 창을 가린다
  //   (Irene: "팝아웃 열리는 위치가 우측 상단으로 하던가 해야지 좌측 상단은 이상해").
  //   ★ screen.* 이 아니라 **현재 창 기준**(screenX + outerWidth)으로 잡는다 —
  //     듀얼 모니터에서 screen 기준으로 잡으면 엉뚱한 화면에 뜬다.
  //   화면 밖으로 나가지 않게 하한 0 으로 클램프한다.
  let pos = '';
  try {
    if (typeof window !== 'undefined') {
      const MARGIN = 24;
      const baseX = window.screenX ?? window.screenLeft ?? 0;
      const baseY = window.screenY ?? window.screenTop ?? 0;
      const ownW = window.outerWidth || window.innerWidth || width;
      const left = Math.max(0, Math.round(baseX + ownW - width - MARGIN));
      const top = Math.max(0, Math.round(baseY + MARGIN));
      pos = `,left=${left},top=${top}`;
    }
  } catch { pos = ''; }
  return `width=${width},height=${height}${pos},menubar=no,toolbar=no,location=no,status=no`;
}

export interface PinIntentMsg { type: 'pin-intent'; id: string; tool: PinTool }
export interface PinAckMsg { type: 'pin-ack'; id: string }
/** PiP 안 iframe → **메인 탭**: 이 핀을 놓아 달라 (iframe 은 자기를 담은 PiP 창을 닫을 권한이 없다) */
export interface UnpinRequestMsg { type: 'unpin-request'; tool: PinTool }
/** 메인 탭 → 열려 있는 **일반 팝아웃 창**: 이 도구가 방금 고정됐으니 너는 닫혀라 (#286).
 *  ★ requestWindow **성공 후**에만 보낸다 — 사용자가 고정을 취소했는데 팝아웃만 사라지면 도구를 통째로 잃는다.
 *  창 핸들을 보관하는 대신 방송을 쓰는 이유: 메인 탭이 새로고침되면 핸들은 사라지지만 방송은 그대로 닿는다. */
export interface PinEngagedMsg { type: 'pin-engaged'; tool: PinTool }
export type PinMsg = PinIntentMsg | PinAckMsg | UnpinRequestMsg | PinEngagedMsg;

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
  const w = window as unknown as { documentPictureInPicture?: unknown };
  return !!w.documentPictureInPicture;
}

export interface PinContent {
  /** 어느 도구인가 — 팝아웃에서 메인 창에 고정을 요청할 때 실어 보낸다 */
  tool: PinTool;
  /** 이 마운트가 PiP 안 iframe 인가 — 해제 버튼은 이때만 그린다 */
  isPip: boolean;
  /** 메인 탭에 해제를 요청한다. PiP 가 닫히고 이 마운트는 사라진다. */
  unpin: () => void;
}

/**
 * **팝아웃 라우트 쪽** 훅. 소유 상태를 갖지 않는다 — 알아야 할 것은 "내가 PiP 안인가" 뿐이다.
 * 핀 진입(소유)은 메인 탭의 도크가 담당한다(utils/pinOwner.ts).
 */
export function usePinContent(tool: PinTool): PinContent {
  const isPip = useMemo(() => isPipContent(), []);

  // #286 "팝아웃이 2개가 열려서" — 일반 팝아웃 창이 떠 있는데 도크에서 핀을 켜면 고정 창이
  //   따로 열려 둘이 됐다. 고정이 성사되는 순간 **일반 창 쪽이 스스로 물러난다**.
  //   (팝아웃은 script-opened 창이라 자기 자신을 닫을 수 있다. PiP 안 iframe 은 대상이 아니다.)
  useEffect(() => {
    if (isPip) return;                        // PiP 내용물은 자기-닫기 대상 아님 (자기가 자길 닫는 사고 차단)
    // ★ 여기서 markPopoutWindow() 를 먼저 부른다 — 순서 레이스 때문이다(Fable 반증).
    //   이 훅의 effect 는 standalone 페이지가 markPopoutWindow() 를 부르는 effect **보다 먼저** 돈다.
    //   그래서 sessionStorage 표식만 보면 **처음 연 창에서는 항상 false** 라 구독이 영영 안 생겼다
    //   (새로고침한 창에서만 동작 — "되는 것처럼 보이는" 가장 나쁜 형태).
    //   markPopoutWindow 는 opener/window.name 가드가 내장된 멱등 함수라 여기서 불러도 안전하고,
    //   판정 술어는 그대로 popout.ts 한 곳에 남는다(술어를 복사하면 두 벌이 된다).
    markPopoutWindow();
    if (!isPopoutWindow()) return;            // 일반 탭 — 자기-닫기 대상 아님
    let ch: BroadcastChannel;
    try { ch = new BroadcastChannel(PIN_CHANNEL); } catch { return; }
    const onMsg = (e: MessageEvent<PinMsg>) => {
      const m = e.data;
      if (!m || m.type !== 'pin-engaged' || m.tool !== tool) return;
      // Q Note 녹음 중이면 닫지 않는다 — 창 하나 더 뜨는 것보다 녹음 소실이 훨씬 나쁘다.
      //   (PopoutPinButton 의 해제 확인과 같은 계약: body.dataset.recordingActive)
      try { if (document.body.dataset.recordingActive === '1') return; } catch { /* noop */ }
      try { window.close(); } catch { /* 사용자가 직접 닫으면 된다 */ }
    };
    ch.addEventListener('message', onMsg);
    return () => { try { ch.removeEventListener('message', onMsg); ch.close(); } catch { /* noop */ } };
  }, [isPip, tool]);

  const unpin = useCallback(() => {
    // 이 iframe 은 자기를 담은 PiP 창을 닫을 수 없다(그 창의 소유자는 메인 탭이다) → 방송으로 부탁한다.
    try {
      const ch = new BroadcastChannel(PIN_CHANNEL);
      ch.postMessage({ type: 'unpin-request', tool } as UnpinRequestMsg);
      ch.close();
    } catch { /* BroadcastChannel 미지원 — 사용자가 PiP 를 직접 닫으면 폴링이 정리한다 */ }
  }, [tool]);
  return { tool, isPip, unpin };
}
