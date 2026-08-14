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
import { useCallback, useMemo } from 'react';

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
  return `width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no`;
}

export interface PinIntentMsg { type: 'pin-intent'; id: string; tool: PinTool }
export interface PinAckMsg { type: 'pin-ack'; id: string }
/** PiP 안 iframe → **메인 탭**: 이 핀을 놓아 달라 (iframe 은 자기를 담은 PiP 창을 닫을 권한이 없다) */
export interface UnpinRequestMsg { type: 'unpin-request'; tool: PinTool }
export type PinMsg = PinIntentMsg | PinAckMsg | UnpinRequestMsg;

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
  const unpin = useCallback(() => {
    // 이 iframe 은 자기를 담은 PiP 창을 닫을 수 없다(그 창의 소유자는 메인 탭이다) → 방송으로 부탁한다.
    try {
      const ch = new BroadcastChannel(PIN_CHANNEL);
      ch.postMessage({ type: 'unpin-request', tool } as UnpinRequestMsg);
      ch.close();
    } catch { /* BroadcastChannel 미지원 — 사용자가 PiP 를 직접 닫으면 폴링이 정리한다 */ }
  }, [tool]);
  return { isPip, unpin };
}
