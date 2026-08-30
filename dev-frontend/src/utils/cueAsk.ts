// Cue 에게 물어보기 — **창 경계를 넘는 단일 진입점**.
//
// 왜 필요한가 (Irene 신고 2026-08-30: "누르면 질문이나 단어가 전달 안되고 그냥 창이 열려"):
//   통합검색의 "Cue 에게 물어보기" 는 `cue:ask` **window 이벤트**만 쐈다. window 이벤트는
//   그 창 안에서만 산다. 그런데 Q helper 는 데스크탑에서 **별도 창**(/help-popout)으로 띄워 두고
//   쓰는 도구다 — 그래서 사용자가 보고 있는 창에는 아무것도 안 담기고, 검색어는 뒤에 가려진
//   본 창 드로어로 들어갔다. 사용자 눈에는 "빈 창이 열린 것" 과 구별되지 않는다.
//   (실측: 팝아웃 입력칸 "" / 본 창 입력칸 "부가세 신고 일정 알려줘")
//
// 설계:
//   - 전달은 BroadcastChannel(`planq:popout`) 로 한다. COOP 에서 opener 가 끊기고 PiP 안 iframe 은
//     opener 자체가 없다 — PopoutBridge 가 같은 이유로 이미 이 채널을 쓴다(그 판단을 그대로 따른다).
//   - 팝아웃이 **살아 있으면** 본 창 드로어는 열지 않는다. 두 곳이 동시에 열리면 사용자는
//     어느 쪽이 자기 질문을 들고 있는지 알 수 없다. 생존 판정은 팝아웃이 직접 찍는 심박이다.
//   - 심박이 없으면(팝아웃을 안 쓰는 사용자) 종전대로 본 창 드로어를 연다 — 무회귀.
import { POPOUT_CHANNEL } from '../components/Common/PopoutBridge';

export const CUE_ASK_EVENT = 'cue:ask';
const HEARTBEAT_KEY = 'planq:qhelper-live';
/** 심박 간격보다 넉넉히 — 창이 죽었는데 살아 있다고 읽으면 질문이 아무 데도 안 간다. */
const ALIVE_WINDOW_MS = 9000;
const BEAT_MS = 3000;

export interface CueAskMsg { type: 'cue-ask'; prefill: string; tab: 'wiki' | 'cue' }

/** 팝아웃 Q helper 가 살아 있다고 알린다(창이 닫히면 스스로 지운다). */
export function beatQhelperAlive(): void {
  try { localStorage.setItem(HEARTBEAT_KEY, String(Date.now())); } catch { /* 시크릿 모드 등 */ }
}
export function clearQhelperAlive(): void {
  try { localStorage.removeItem(HEARTBEAT_KEY); } catch { /* noop */ }
}
export function isQhelperPopoutAlive(): boolean {
  try {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < ALIVE_WINDOW_MS;
  } catch { return false; }
}

/** 팝아웃 쪽에서 부르는 심박 루프. 정리 함수를 돌려준다. */
export function startQhelperHeartbeat(): () => void {
  beatQhelperAlive();
  const id = window.setInterval(beatQhelperAlive, BEAT_MS);
  const bye = () => clearQhelperAlive();
  window.addEventListener('pagehide', bye);
  window.addEventListener('beforeunload', bye);
  return () => {
    window.clearInterval(id);
    window.removeEventListener('pagehide', bye);
    window.removeEventListener('beforeunload', bye);
    clearQhelperAlive();
  };
}

/**
 * Cue 에게 물어보기 — 어디서 부르든 **사용자가 보고 있는 Q helper** 에 질문이 담긴다.
 * @param prefill 입력칸에 담을 질문(보내기까지는 하지 않는다 — 사용자가 고쳐 보낼 수 있어야 한다)
 */
export function askCue(prefill: string, tab: 'wiki' | 'cue' = 'cue'): void {
  const q = String(prefill || '');
  let delivered = false;
  if (isQhelperPopoutAlive()) {
    try {
      const ch = new BroadcastChannel(POPOUT_CHANNEL);
      ch.postMessage({ type: 'cue-ask', prefill: q, tab } as CueAskMsg);
      ch.close();
      delivered = true;
    } catch { delivered = false; }   // 채널 미지원 — 아래 폴백으로 본 창에서 연다
  }
  if (!delivered) {
    window.dispatchEvent(new CustomEvent(CUE_ASK_EVENT, { detail: { prefill: q, tab } }));
  }
}
