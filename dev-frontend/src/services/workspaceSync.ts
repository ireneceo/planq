// 워크스페이스 전환 전파 — docs/WORKSPACE_SCOPE_DESIGN.md C4 (2026-09-11)
//
// Irene: "팝아웃에서 업무리스트가 워크스페이스 바꾸니까 다 없어졌는데 다시 바꿔도 돌아가지 않아.
//         워크스페이스 바뀌는게 팝아웃에도 연결되어서 저장되어야지. 모든 페이지가 하나의 워크스페이스로만 연결되어야지."
//
// 정본은 서버 users.active_business_id(사람당 하나 — Q4: 모든 기기 같이). 창은 부팅 때 복사한 사본을 들고 있다.
// 여태 전환은 **누른 창만** 리로드했고 다른 창에 알리는 수단이 0 이었다. 이 모듈이 그 수단이다.
//
//   보내기: 누른 창 → BroadcastChannel('planq:workspace')  (같은 브라우저 — 소켓이 없거나 끊긴 팝아웃·핀도 받는다)
//           서버 → io.to('user:N') 'workspace:switched'    (다른 기기 · 같은 브라우저 중복 수신은 멱등으로 걸러짐)
//   받기:   WorkspaceSyncGuard 가 멱등 판정 후 이 창을 다시 부팅한다.
//
// ★ 멱등 규칙 (Fable 설계 게이트)
//   · user_id 가 내 것이 아니면 버린다 — 사칭 창과 관리자 창이 같은 브라우저에 있다
//   · business_id 가 이미 이 창의 값이면 버린다 — 자기 수신(BroadcastChannel 은 보낸 창에도 배달된다)
//   · 전환을 누른 창은 잠깐 동안(switching) 받지 않는다 — 스스로 /talk 로 리로드하는 중이다

export const WORKSPACE_CHANNEL = 'planq:workspace';

export interface WorkspaceSwitchMsg { type: 'workspace:switched'; user_id: number; business_id: number }

let switchingUntil = 0;

/** 이 창이 전환을 시작했다 — 잠깐 동안 수신을 무시한다(스스로 리로드 중). */
export function markSwitching(ms = 8000): void {
  switchingUntil = Date.now() + ms;
}

export function isSwitching(): boolean {
  return Date.now() < switchingUntil;
}

/** 같은 브라우저의 다른 창에 알린다. 실패해도 조용히 — 서버 소켓 emit 이 같은 일을 한다. */
export function broadcastWorkspaceSwitch(userId: number, businessId: number): void {
  try {
    const ch = new BroadcastChannel(WORKSPACE_CHANNEL);
    ch.postMessage({ type: 'workspace:switched', user_id: Number(userId), business_id: Number(businessId) } as WorkspaceSwitchMsg);
    ch.close();
  } catch { /* BroadcastChannel 미지원 — 소켓 경로만 */ }
}

// 루프 안전망 — 판정이 어긋나 재부팅이 반복돼도 사람이 멈출 수 있게. 막으면 줄(“지금 전환”)로 떨어진다.
//   ★ "10초 안에 두 번 금지" 로 두면 **정상적인 빠른 왕복(A→B→A)** 을 막는다 — 팝아웃이 B 에 남는다
//     (2026-09-11 카나리 ② 실측). 루프의 신호는 "방금 X 로 재부팅했는데 또 X 로 가라" 이지 "빨리 두 번" 이 아니다.
//   · 같은 대상으로 10초 안에 다시 → 막는다(부팅 사본이 아직 옛값이라 같은 메시지를 또 받는 루프)
//   · 다른 대상 → 허용하되 30초에 4번까지(어떤 경로로든 핑퐁이 생기면 끊는다)
const REBOOT_LOG_KEY = 'pq_ws_reboots';
type RebootMark = { at: number; biz: number };
function readReboots(): RebootMark[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(REBOOT_LOG_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.at === 'number') : [];
  } catch { return []; }
}
export function canRebootNow(targetBizId: number): boolean {
  const now = Date.now();
  const recent = readReboots().filter((r) => now - r.at < 30_000);
  if (recent.some((r) => r.biz === Number(targetBizId) && now - r.at < 10_000)) return false;
  return recent.length < 4;
}
function stampReboot(targetBizId: number): void {
  try {
    const now = Date.now();
    const next = [...readReboots().filter((r) => now - r.at < 30_000), { at: now, biz: Number(targetBizId) }];
    sessionStorage.setItem(REBOOT_LOG_KEY, JSON.stringify(next));
  } catch { /* noop */ }
}

function inFrame(): boolean {
  try { return window.parent !== window; } catch { return true; }
}

/**
 * 이 창을 새 워크스페이스로 다시 부팅한다.
 *   메인 창 → 워크스페이스 첫 화면(`/talk` — 전환기와 같은 착지)
 *   팝아웃·핀(PiP iframe)·플랫폼 관리자 화면 → **제자리**(보던 도구·관리 화면을 잃지 않는다)
 */
export function rebootForWorkspace(isPopout: boolean, targetBizId: number): void {
  stampReboot(targetBizId);
  const path = window.location.pathname;
  if (isPopout || inFrame() || path.startsWith('/admin')) {
    window.location.reload();
    return;
  }
  window.location.href = '/talk';
}
