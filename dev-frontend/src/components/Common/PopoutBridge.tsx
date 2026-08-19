// PopoutBridge — 팝아웃/PiP 창이 **메인 탭에게** 부탁하는 것들을 받는 App 레벨 싱글턴.
//
// 왜 App 레벨인가 (Fable 설계 게이트 C-1, 2026-08-13):
//   RightDock 은 공개 표면·`/memo` 경로·비멤버 조건에서 `return null` 로 **언마운트**된다.
//   수신자를 도크 안에 두면 메인 탭이 그 경로로 이동하는 순간 팝아웃의 요청이 **아무에게도 안 닿는다**
//   (창은 살아 있는데 대화 상대가 사라진 상태). 그래서 chrome 가시성과 무관하게 항상 마운트한다.
//
// 왜 window.opener 가 아니라 BroadcastChannel 인가:
//   COOP 환경에서 opener 참조가 끊긴다(memory feedback_oauth_popup_coop_parent_closes 계열).
//   팝아웃이 PiP 안 iframe 으로 들어가면 opener 자체가 없다. 채널은 두 경우 모두 살아 있다.
//
// ★ 응답자는 **메인 탭 하나뿐**이어야 한다. 팝아웃 창에도 같은 App 이 도므로,
//   팝아웃/PiP 컨텍스트에서는 마운트하지 않는다(자기 자신이 이동해 버리면 요청의 의미가 없다).
//
// ★ 셸이 두 종류다 (Fable 구현 검증 FAIL-3, 2026-08-13):
//   `isTabsSpike()` 가 데스크탑 기본 ON 이라 **로그인 데스크탑의 주 사용 경로는 `TabAppShell`** 이다.
//   ShellApp 에만 마운트하면 실사용자에게는 수신자가 0 이라 이동 버튼이 조용히 죽는다.
//   그런데 TabAppShell 은 router-less zone 이라 `useNavigate` 를 그대로 못 쓴다 → chrome 은 tabStore 경유.
//   그래서 수신 로직은 훅 하나로 두고, **이동 수단만 다른** 얇은 컴포넌트 둘을 각 셸에 마운트한다.
//   두 셸은 ModeGate 에서 배타적으로 렌더되므로 수신자는 언제나 정확히 하나다(중복 navigate 없음).
//
// 핀(항상 위) 소유 상태는 같은 이유로 App 레벨이어야 하지만 여기 얹지 않았다 — 모듈 스토어
//   `utils/pinOwner.ts` 가 더 강한 보장을 준다(컴포넌트가 아니라 애초에 언마운트가 없다).
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isPopoutWindow, markPopoutWindow } from '../../utils/popout';
import { tabStore } from '../../stores/tabStore';

export const POPOUT_CHANNEL = 'planq:popout';

/** 팝아웃 → 메인 탭 요청 메시지 */
export interface PopoutNavigateMsg { type: 'navigate'; to: string }

/** PiP 문서 안 iframe 으로 로드된 인스턴스인가 (utils/pinHost.isPipContent 와 같은 판정) */
function inFrame(): boolean {
  try { return typeof window !== 'undefined' && window.parent !== window; } catch { return true; }
}

/** 팝아웃이 메인 탭에 이동을 부탁한다. 메인 탭이 없으면 false — 호출측이 폴백을 결정한다. */
export function requestMainNavigate(to: string): boolean {
  try {
    const ch = new BroadcastChannel(POPOUT_CHANNEL);
    ch.postMessage({ type: 'navigate', to } as PopoutNavigateMsg);
    ch.close();
    return true;
  } catch {
    return false;   // BroadcastChannel 미지원 — 호출측이 window.open 으로 간다
  }
}

/** 수신 로직 본체. `go` 만 셸별로 다르다(RR navigate / tabStore.navigateActive). */
function usePopoutNavigateListener(go: (to: string) => void) {
  useEffect(() => {
    // 팝아웃 창·PiP iframe 은 응답자가 아니다.
    // ★ markPopoutWindow() 를 먼저 부른다 — 표식은 이 함수가 심는데, **처음 열린 팝아웃 창에서는
    //   아직 심기 전**이라 isPopoutWindow() 가 false 였다. 그래서 팝아웃이 자기 요청을 자기가 받아
    //   **팝아웃이 이동해 버리고**(Irene: "왜 팝아웃이 바뀌고"), 메인 탭도 같이 이동해
    //   같은 화면이 두 곳에 뜨는 것처럼 보였다.
    //   (BroadcastChannel 은 **같은 창의 다른 채널 객체**에도 배달된다 — 보낸 창이라고 빠지지 않는다.)
    //   utils/pinHost 가 같은 함정을 이미 겪고 고친 곳이다. 판정 술어는 popout.ts 한 곳에 그대로 둔다.
    markPopoutWindow();
    if (isPopoutWindow() || inFrame()) return;
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(POPOUT_CHANNEL); } catch { return; }
    const onMsg = (ev: MessageEvent) => {
      const m = ev.data as PopoutNavigateMsg | null;
      if (!m || typeof m !== 'object' || m.type !== 'navigate') return;
      // ★ 경로 화이트리스트 — 채널로 들어온 임의 문자열을 그대로 navigate 하지 않는다.
      //   앱 내부 절대경로만 허용(`//host` 같은 프로토콜 상대 URL 은 외부로 나간다).
      const to = String(m.to || '');
      if (!/^\/[^/]/.test(to)) return;
      go(to);
      try { window.focus(); } catch { /* 사용자 제스처 밖이면 브라우저가 무시한다 */ }
    };
    ch.addEventListener('message', onMsg);
    return () => {
      try { ch?.removeEventListener('message', onMsg); ch?.close(); } catch { /* noop */ }
    };
  }, [go]);
}

/** ShellApp(BrowserRouter 아래)용 수신자. */
const PopoutBridge: React.FC = () => {
  const navigate = useNavigate();
  usePopoutNavigateListener(navigate);
  return null;
};

/** TabAppShell(router-less)용 수신자 — **새 탭으로 연다**.
 *  ★ 여태 활성 탭의 경로를 갈아치웠다(navigateActive). 그러면 사용자가 보던 화면이 사라진다 —
 *    팝아웃에서 "Q Task 열기" 를 누른 건 **거기로 가겠다는 뜻**이지 보던 탭을 버리겠다는 뜻이 아니다
 *    (Irene: "기존 열려있는 메인창에서 새 탭으로 열려야지"). */
export const PopoutBridgeChrome: React.FC = () => {
  usePopoutNavigateListener(chromeGo);
  return null;
};

// 훅 deps 안정성을 위해 모듈 스코프에 고정(매 렌더 새 함수 → 채널 재구독 방지).
function chromeGo(to: string) { tabStore.newTab(to); }

export default PopoutBridge;
