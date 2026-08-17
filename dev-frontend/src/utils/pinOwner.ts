// pinOwner — 메인 탭이 소유하는 PiP(항상 위) 핀 컨트롤러. **App 레벨 싱글턴**.
//
// 왜 모듈 스토어인가 (Fable 설계 게이트 C-1, 2026-08-13):
//   컨트롤러(pipRef·폴링·BroadcastChannel 리스너)를 RightDock 안에 두면 안 된다. 도크는 공개 표면·
//   `/memo` 경로·비멤버 조건에서 `return null` 로 **언마운트**되고, 그 순간 PiP 는 고아가 된다
//   (살아는 있는데 해제 요청 수신자도 폴링도 없다). 모듈 스토어는 애초에 언마운트가 없다.
//   → 도크에는 **버튼만** 둔다. 상태는 여기 있고, React 는 usePinOwner 로 구독만 한다.
//
// ★ 홀더 시대 부작용을 여기에 옮겨오지 말 것 (Fable C-2):
//   옛 `pinHost.releasePip` 은 해제 시 `window.resizeTo(520,780)` 을, `onPipGone` 은 `window.close()` 를 불렀다.
//   그때는 소유자가 팝아웃 창이라 옳았지만 지금 소유자는 **사용자의 메인 탭**이다 — 그대로 옮기면
//   해제할 때마다 사용자의 메인 창을 520×780 으로 줄이고, PiP 가 사라지면 메인 탭을 닫으려 든다.
//   그래서 이 파일에는 resize 도 close(자기 창) 도 **없다**. 우리가 닫는 것은 PiP 창뿐이다.
//
// F5 는 물리적으로 못 막는다(스파이크 S2: 메인 탭 새로고침 = PiP 사망). 대신 두 가지를 한다:
//   1. 자동 reload 차단 — `body.dataset.pipActive` 를 **메인 탭 body 에** 세운다. BuildVersionGuard 의
//      `isReloadSafe()` 가 이 플래그를 보고 신규 빌드 자동 갱신을 보류한다. 빠지면 배포마다 핀이 죽는다.
//   2. 복원 힌트 — sessionStorage 에 마지막 도구를 남겨 도크가 "복원" 칩을 띄운다. **자동 재열기는 불가능**하다
//      (requestWindow 는 사용자 제스처를 요구한다) — 자동 복원을 약속하는 문구를 쓰지 말 것.
import { useSyncExternalStore } from 'react';
import {
  PIN_CHANNEL, POPOUT_PATH, POPOUT_SIZE,
  type PinTool, type PinMsg, type PinIntentMsg, type PinAckMsg, type PinEngagedMsg,
} from './pinHost';

/** 선공지 ack 대기 상한. transient activation(약 5초) 안이라 requestWindow 는 그대로 성공한다. */
const ACK_TIMEOUT_MS = 250;
/** 축출은 pagehide 를 발화시키지 않는다 → 폴링이 유일한 감지 수단 */
const POLL_MS = 500;
const RESTORE_KEY = 'planq:pin:last';

const TOOLS: PinTool[] = ['qtalk', 'qtask', 'qnote', 'qhelper'];
function asPinTool(v: string | null): PinTool | null {
  return v && (TOOLS as string[]).includes(v) ? (v as PinTool) : null;
}

export interface PinOwnerState {
  /** 지금 이 탭이 PiP 로 띄우고 있는 도구 */
  pinned: PinTool | null;
  /** 마지막으로 핀했던 도구 — 새로고침으로 잃었을 때 도크가 "복원" 칩을 띄우는 근거 */
  restore: PinTool | null;
}

// ── 상태 ──────────────────────────────────────────
let state: PinOwnerState = { pinned: null, restore: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<PinOwnerState>) {
  const next = { ...state, ...patch };
  if (next.pinned === state.pinned && next.restore === state.restore) return;
  state = next;
  listeners.forEach((l) => { try { l(); } catch { /* 구독자 하나가 전체를 막지 않게 */ } });
}

// ── 내부 자원 (React 밖) ──────────────────────────
let pipWin: Window | null = null;
let poll: number | null = null;
let chan: BroadcastChannel | null = null;
/** 메인 탭 자신이 unload 중인가 — 이때의 PiP 사망은 "사용자가 닫은 것" 이 아니다(복원 힌트를 지우면 안 된다) */
let unloading = false;

if (typeof window !== 'undefined') {
  state = { pinned: null, restore: readRestore() };
  // pagehide 는 bfcache 진입에도 발화한다 → pageshow 에서 반드시 되돌린다(안 그러면 이후 감지가 영영 죽는다).
  window.addEventListener('pagehide', () => { unloading = true; });
  window.addEventListener('pageshow', () => { unloading = false; });
}

function readRestore(): PinTool | null {
  try { return asPinTool(sessionStorage.getItem(RESTORE_KEY)); } catch { return null; }
}
function writeRestore(tool: PinTool | null) {
  try {
    if (tool) sessionStorage.setItem(RESTORE_KEY, tool);
    else sessionStorage.removeItem(RESTORE_KEY);
  } catch { /* 시크릿 모드 등 — 복원 칩만 못 뜬다 */ }
}

function pipApi(): { requestWindow: (o: { width: number; height: number }) => Promise<Window> } | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } };
  return w.documentPictureInPicture || null;
}

function markPipActive(on: boolean) {
  try {
    if (on) document.body.dataset.pipActive = '1';
    else delete document.body.dataset.pipActive;
  } catch { /* noop */ }
}

function stopPoll() {
  if (poll != null) { clearInterval(poll); poll = null; }
}

/** 붙잡고 있는 동안에만 채널을 연다 — 우리가 응답해야 할 메시지(축출 선공지·해제 요청)가 그때뿐이다. */
function openChannel() {
  if (chan) return;
  try { chan = new BroadcastChannel(PIN_CHANNEL); } catch { chan = null; return; }
  chan.addEventListener('message', onChannelMsg);
}
function closeChannel() {
  if (!chan) return;
  try { chan.removeEventListener('message', onChannelMsg); chan.close(); } catch { /* noop */ }
  chan = null;
}

function onChannelMsg(ev: MessageEvent) {
  const m = ev.data as PinMsg | null;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'pin-intent') {
    // 다른 창이 PiP 를 가져가려 한다. 붙잡고 있을 때만 놓고 ack 한다
    // (아무나 ack 하면 요청자가 진짜 소유자보다 먼저 출발한다).
    if (!pipWin) return;
    teardown(true);
    // ★ 복원 힌트는 지우지 않는다 — 사용자가 우리 도구를 닫은 게 아니라 다른 창이 자리를 가져갔다.
    setState({ pinned: null });
    // ★ ack 는 **놓은 뒤에** 보낸다(요청자는 ack 를 자리가 비었다는 신호로 읽는다). 그런데 teardown 이
    //   우리 채널을 닫아 버리므로 여기서는 단발 채널로 보낸다 — 닫힌 채널로 보내면 조용히 사라진다.
    try {
      const ack = new BroadcastChannel(PIN_CHANNEL);
      ack.postMessage({ type: 'pin-ack', id: m.id } as PinAckMsg);
      ack.close();
    } catch { /* 미지원 — 요청자는 250ms 타임아웃으로 진행한다 */ }
    return;
  }
  if (m.type === 'unpin-request' && m.tool === state.pinned) {
    // PiP 안 iframe 의 해제 버튼
    unpin();
  }
}

/** PiP 를 놓고 자원을 정리한다. closeWin=true 면 우리가 직접 닫는다(이미 죽었으면 false). */
function teardown(closeWin: boolean) {
  stopPoll();
  const w = pipWin;
  pipWin = null;
  if (closeWin && w) { try { w.close(); } catch { /* 이미 닫혔을 수 있다 */ } }
  markPipActive(false);
  closeChannel();
}

/** PiP 가 우리 뜻과 무관하게 사라졌다 — 폴링 또는 pagehide.
 *  ★ 우리가 놓은 경우엔 여기 오지 않는다: teardown 이 pipWin 을 **가장 먼저** 비우고 폴링을 끄며,
 *    pagehide 핸들러는 자기가 붙은 창의 동일성을 확인한 뒤에만 부른다(도구 교체 시 옛 창의 뒤늦은
 *    pagehide 가 방금 연 새 PiP 를 철거하는 경합을 막는다). */
function onPipGone() {
  if (!pipWin) return;            // teardown 이 이미 처리했다
  if (unloading) return;          // 메인 탭이 죽는 중 — 복원 힌트를 남겨야 새로고침 후 칩이 뜬다
  teardown(false);
  // 선공지 없는 죽음 = 사용자가 PiP 를 닫았다 → **"닫으면 그냥 닫힌다"**. 복원 칩으로 되묻지 않는다.
  writeRestore(null);
  setState({ pinned: null, restore: null });
}

function buildFrame(win: Window, tool: PinTool, title: string) {
  win.document.title = title;
  const body = win.document.body;
  body.style.margin = '0';
  body.style.overflow = 'hidden';
  const iframe = win.document.createElement('iframe');
  // ★ name 필수 — utils/popout.ts markPopoutWindow() 의 realPopout 가드가
  //   window.opener || /^pq-/.test(window.name) 를 요구한다. PiP iframe 은 opener 가 없어
  //   name 을 안 주면 팝아웃 마킹이 실패하고 그 안에서 우하단 FAB 가 되살아난다.
  iframe.name = `pq-${tool}-pip`;
  iframe.src = POPOUT_PATH[tool];
  iframe.setAttribute('allow', 'microphone; camera; display-capture; autoplay; clipboard-write');
  iframe.style.cssText = 'border:0;width:100%;height:100vh;display:block;';
  body.appendChild(iframe);
}

/** 선공지 → ack 또는 250ms. 붙잡고 있는 창이 없으면 그냥 타임아웃으로 진행한다. */
function announceIntent(tool: PinTool): Promise<void> {
  return new Promise((resolve) => {
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(PIN_CHANNEL); } catch { resolve(); return; }
    const id = `${tool}-${Math.random().toString(36).slice(2, 10)}`;
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ch?.removeEventListener('message', onMsg); ch?.close(); } catch { /* noop */ }
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

/** 핀 진입. ★ 반드시 사용자 클릭 핸들러 안에서 부를 것 — requestWindow 는 transient activation 을 요구한다.
 *  (선공지 250ms 대기가 끼지만 activation 수명 약 5초 안이라 그대로 성립한다.) */
async function pin(tool: PinTool, title: string): Promise<void> {
  const api = pipApi();
  if (!api) return;
  if (pipWin) {
    // 도구 교체 — 우리 것부터 놓는다(PiP 는 브라우저 전역 1개).
    teardown(true);
    setState({ pinned: null });
  }
  await announceIntent(tool);

  let win: Window;
  try {
    win = await api.requestWindow(POPOUT_SIZE[tool]);
  } catch {
    return;   // 사용자가 취소했거나 브라우저가 거부 — 아무것도 바뀌지 않는다
  }
  try {
    buildFrame(win, tool, title);
  } catch {
    try { win.close(); } catch { /* noop */ }
    return;   // 빈 PiP 를 남기지 않는다
  }

  pipWin = win;
  markPipActive(true);
  openChannel();
  // #286 — 고정이 **성사된 뒤에만** 알린다. 열려 있던 같은 도구의 일반 팝아웃 창이 스스로 닫혀
  //   "창 2개" 가 되지 않는다. requestWindow 실패·취소 시에는 여기 도달하지 않으므로 팝아웃도 그대로 산다.
  try {
    const ch = new BroadcastChannel(PIN_CHANNEL);
    ch.postMessage({ type: 'pin-engaged', tool } as PinEngagedMsg);
    ch.close();
  } catch { /* 미지원 — 사용자가 팝아웃을 직접 닫으면 된다 */ }
  // 창 동일성 확인 후에만 — 옛 창의 뒤늦은 pagehide 가 새 PiP 를 철거하지 못하게 한다.
  win.addEventListener('pagehide', () => { if (pipWin === win) onPipGone(); });
  // 축출(다른 도구가 PiP 를 가져감)은 pagehide 가 없다 → 폴링이 유일한 감지 수단
  poll = window.setInterval(() => {
    if (!pipWin || pipWin.closed) onPipGone();
  }, POLL_MS);
  writeRestore(tool);
  setState({ pinned: tool, restore: tool });
}

/** 사용자가 해제를 눌렀다 (도크의 핀 토글 · PiP 안 헤더의 해제 버튼).
 *  ★ 해제하면 그 도구는 닫힌다 — 일반 창으로 되돌리지 않는다. 되돌리려면 window.open 이 필요한데
 *    그 제스처의 출처가 PiP 안 iframe 이라 메인 탭에서는 activation 이 없다(pinHost.ts 상단 물리).
 *    도크에서 1클릭으로 다시 열 수 있으므로 창을 몰래 띄우는 쪽보다 이쪽이 정직하다. */
function unpin() {
  if (!pipWin) return;
  teardown(true);
  writeRestore(null);   // 사용자의 명시적 해제 = 복원 칩으로 되묻지 않는다
  setState({ pinned: null, restore: null });
}

export const pinOwner = {
  pin,
  unpin,
  getSnapshot: (): PinOwnerState => state,
  subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
};

/** React 구독 — 도크가 버튼 상태를 그린다. 이 훅이 언마운트돼도 위 상태는 살아 있다(C-1). */
export function usePinOwner(): PinOwnerState {
  return useSyncExternalStore(pinOwner.subscribe, pinOwner.getSnapshot, pinOwner.getSnapshot);
}
