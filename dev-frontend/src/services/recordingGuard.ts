// services/recordingGuard.ts — Q note 녹음 중 이탈 보호의 **한 지점** (2026-11-19 · Fable 설계 DESIGN-READY)
//
//   Irene: «노트에서 녹음이나 녹화할 때 갑자기 나가게 되는 일이 생기곤 해. 나가지 못하게 하고 안내하고 나서 원하면 나가게 …»
//   설계 정본 docs/QNOTE_RECORDING_LEAVE_GUARD_DESIGN.md
//
//   녹음을 죽이는 길은 화면 하나가 다 볼 수 없다 — 메뉴 이동(tabStore)·화면 안 이동(라우터)·탭 닫기·탭 정지(LRU)·
//   새로고침·로그아웃·워크스페이스 전환. 그래서 «지금 녹음 중인가» 를 여기 한 곳에 두고, 그 길들이 전부 여기에 묻는다.
//   - 녹음하는 화면(QNotePage)은 녹음이 **실제로 도는 동안만** register — paused 는 이미 마이크·잠금을 놓았다(지킬 것 없음).
//   - 확인창은 App 루트 `RecordingLeaveGuard` 한 벌(탭·셸 두 트리 공통).
//   - `body.dataset.recordingActive` 는 여기서만 세운다(읽는 쪽: utils/reloadSafety · PopoutPinButton).
//   - React 를 import 하지 않는다 — tabStore 가 이 파일을 import 한다(잎).

export type LeaveReason = 'navigate' | 'close' | 'logout' | 'workspace' | 'account';

interface Owner {
  /** 이 녹음이 사는 앱 탭(탭 모드). 미러 모드·단일 창이면 null */
  tabId: string | null;
  /** 확인 뒤 녹음을 멈춘다(종료가 아니라 멈춤 — 나중에 «녹음 이어하기») */
  stop: () => void;
}

export interface LeaveRequest {
  reason: LeaveReason;
  run: () => void;
  /** [녹음 계속하기] — 기다리던 쪽(로그아웃·전환의 Promise)에 «안 함» 을 알린다 */
  onCancel?: () => void;
  /** 멈출 녹음들(이 요청과 관계있는 것만) */
  keys: string[];
}

const owners = new Map<string, Owner>();
let pending: LeaveRequest | null = null;
/** 탭 모드에서 이동을 새 탭으로 돌린 것을 녹음 1회당 한 번 알린다 */
let divertNotice: { at: number } | null = null;
const noticedKeys = new Set<string>();
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) { try { l(); } catch { /* 듣는 쪽 오류가 다른 쪽을 막지 않게 */ } } }

export function subscribeRecordingGuard(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function getPendingLeave(): LeaveRequest | null { return pending; }
export function getDivertNotice(): { at: number } | null { return divertNotice; }
export function clearDivertNotice() { if (divertNotice) { divertNotice = null; emit(); } }

// ── 등록 ────────────────────────────────────────────────────
export function registerRecording(key: string, owner: Owner) {
  owners.set(key, owner);
  sync();
}
export function unregisterRecording(key: string) {
  if (!owners.delete(key)) return;
  noticedKeys.delete(key);
  if (pending) {
    pending = { ...pending, keys: pending.keys.filter((k) => k !== key) };
    // 기다리던 녹음이 스스로 멈췄다(사용자가 일시정지 등) — 더 물을 것이 없으면 바로 이어 간다
    if (!pending.keys.length) {
      const p = pending;
      pending = null;
      emit();
      // 화면 안 이동·탭 닫기는 이어 간다(지킬 녹음이 없어졌다). 로그아웃·전환은 사용자가 고르지 않았으니 «안 함» 으로 끝낸다
      //   (다른 기기가 잠금을 가져가 녹음이 끝났는데 로그아웃이 저절로 되면 안 된다 — Fable 완료 검증 비차단 1).
      const quiet = p.reason === 'logout' || p.reason === 'workspace' || p.reason === 'account';
      const popping = sync();
      if (quiet) { if (p.onCancel) { try { p.onCancel(); } catch { /* noop */ } } return; }
      if (popping) afterMarkPop(p.run); else p.run();
      return;
    }
  }
  sync();
}

export function isRecordingActive(): boolean { return owners.size > 0; }
/** 이 앱 탭(null = 미러/단일 창)에서 녹음이 도는가 */
export function tabIsRecording(tabId: string | null): boolean {
  for (const o of owners.values()) if (o.tabId === tabId) return true;
  return false;
}
export function recordingTabIds(): Set<string> {
  const s = new Set<string>();
  for (const o of owners.values()) if (o.tabId) s.add(o.tabId);
  return s;
}

// ── 묻기 ────────────────────────────────────────────────────
/**
 * 녹음을 끊을 수 있는 동작 앞에서 부른다. 관계있는 녹음이 없으면 즉시 run().
 * @param scope 'all' = 창 전체(로그아웃·전환·새로고침) · 그 밖 = 그 앱 탭(null 이면 미러/단일 창)
 */
export function requestLeave(reason: LeaveReason, run: () => void, scope: 'all' | string | null = 'all', onCancel?: () => void): boolean {
  const keys: string[] = [];
  for (const [k, o] of owners) if (scope === 'all' || o.tabId === scope) keys.push(k);
  if (!keys.length) { run(); return true; }
  // 이미 묻는 중이면 마지막 요청이 이긴다(같은 버튼 두 번 누름 등) — 밀려난 요청은 «안 함» 으로 끝낸다
  const prev = pending;
  pending = { reason, run, onCancel, keys };
  if (prev?.onCancel) { try { prev.onCancel(); } catch { /* noop */ } }
  emit();
  return false;
}

/** [녹음 계속하기] */
export function cancelLeave() {
  const p = pending;
  if (!p) return;
  pending = null;
  emit();
  if (p.onCancel) { try { p.onCancel(); } catch { /* noop */ } }
}

/** await 하는 쪽(로그아웃·워크스페이스 전환)용 — 녹음이 없거나 [멈추고 …] 면 true, [녹음 계속하기] 면 false */
export function confirmLeaveAsync(reason: LeaveReason): Promise<boolean> {
  return new Promise((resolve) => { requestLeave(reason, () => resolve(true), 'all', () => resolve(false)); });
}

/** [녹음 멈추고 …] — 관계있는 녹음을 멈추고 원래 동작을 잇는다 */
export function confirmLeave() {
  const p = pending;
  if (!p) return;
  pending = null;
  for (const k of p.keys) {
    const o = owners.get(k);
    owners.delete(k);
    noticedKeys.delete(k);
    try { o?.stop(); } catch { /* 멈춤 실패가 이동을 막지 않게 — 언마운트 cleanup 이 최후 안전망 */ }
  }
  const popping = sync();
  emit();
  // ★ 미러 모드 표식 칸을 걷는 «뒤로» 는 비동기다. 그 사이 이동(push)을 하면 걷는 뒤로가 **새 화면에서** 한 칸 물러나
  //   원래 화면으로 되돌아온다(카나리 P2 실측: [멈추고 이동] 뒤 /notes 그대로). 표식이 걷힌 뒤에 잇는다.
  if (popping) afterMarkPop(p.run);
  else p.run();
}

/** 탭 모드 — 녹음 탭 대신 새 탭으로 돌렸다. 녹음 1회당 한 번만 알린다 */
export function noteDiverted(tabId: string) {
  for (const [k, o] of owners) {
    if (o.tabId !== tabId || noticedKeys.has(k)) continue;
    noticedKeys.add(k);
    divertNotice = { at: Date.now() };
    emit();
    return;
  }
}

// ── 창 밖으로 나가는 길(새로고침·창 닫기) ─────────────────────
//   브라우저 기본 확인창만 쓸 수 있다(문구는 브라우저가 정한다).
//   ★ 데스크탑 앱(Electron)은 막히면 대화창 없이 **조용히 닫기를 취소한다** — main 이 대화창을 띄우는 앱
//     (capabilities.unloadPrompt)에서만 건다. 옛 앱에서 «종료가 안 됨» 을 만들지 않는다.
function unloadPromptAllowed(): boolean {
  try {
    const b = (window as unknown as { planqDesktop?: { capabilities?: { unloadPrompt?: boolean } } }).planqDesktop;
    if (b) return !!b.capabilities?.unloadPrompt;
  } catch { /* noop */ }
  return true;
}
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!owners.size || !unloadPromptAllowed()) return;
  e.preventDefault();
  // 옛 브라우저는 returnValue 가 있어야 묻는다
  e.returnValue = '';
}

// ── 미러 모드(폰·좁은 폭) 뒤로 가기 ───────────────────────────
//   탭 모드의 히스토리 주인은 UrlMirror 다(건드리지 않는다). 미러 모드에서만 녹음 중 같은 주소의 표식 칸을 하나 쌓고,
//   뒤로 가기로 그 칸이 빠지면 다시 쌓고 묻는다. 확인하면 녹음을 멈추고 한 칸 더 뒤로 간다.
//   «미러 모드의 녹음» = 탭 id 가 없는 녹음(tabIsRecording(null)) — 탭 모드의 녹음은 언제나 pane 의 탭 id 를 갖는다.
const MARK = 'pqRecGuard';
let markPushed = false;
let ignorePops = 0;
let pendingAfterPop: (() => void) | null = null;
let afterPopTimer: number | null = null;
function afterMarkPop(fn: () => void) {
  pendingAfterPop = fn;
  // popstate 가 오지 않는 환경(이미 다른 칸)에서도 멈춰 있지 않게
  if (afterPopTimer) window.clearTimeout(afterPopTimer);
  afterPopTimer = window.setTimeout(flushAfterPop, 600);
}
function flushAfterPop() {
  if (afterPopTimer) { window.clearTimeout(afterPopTimer); afterPopTimer = null; }
  const fn = pendingAfterPop;
  pendingAfterPop = null;
  if (fn) fn();
}
function hasMark(): boolean {
  try { return !!(window.history.state && (window.history.state as Record<string, unknown>)[MARK]); } catch { return false; }
}
function pushMark() {
  try {
    const st = { ...(window.history.state || {}), [MARK]: 1 };
    window.history.pushState(st, '', window.location.pathname + window.location.search + window.location.hash);
    markPushed = true;
  } catch { /* noop */ }
}
/** @returns 표식 칸을 걷으려고 «뒤로» 를 보냈는가(그 popstate 가 오기 전에는 이동하지 않는다) */
function syncMark(): boolean {
  const want = tabIsRecording(null);
  if (want && !markPushed) { pushMark(); return false; }
  if (!want && markPushed) {
    markPushed = false;
    // 표식 칸이 아직 맨 위면 걷는다(자기 popstate 는 무시)
    if (hasMark()) {
      ignorePops += 1;
      try { window.history.back(); return true; } catch { ignorePops -= 1; }
    }
  }
  return false;
}
function onPopState() {
  if (ignorePops > 0) { ignorePops -= 1; if (pendingAfterPop) setTimeout(flushAfterPop, 0); return; }
  if (!markPushed) return;
  if (hasMark()) return;                    // 표식 칸으로 «앞으로» 온 것 — 그대로
  // 표식 칸이 빠졌다 = 사용자가 뒤로 갔다. 주소는 이미 한 칸 전이지만 화면(BrowserRouter)은 곧 따라간다 →
  //   즉시 다시 쌓아 화면을 붙잡고 묻는다.
  markPushed = false;
  pushMark();
  requestLeave('navigate', () => {
    // 녹음을 멈춘 뒤(syncMark 가 표식을 걷는다) 사용자가 원래 하려던 «뒤로» 를 한다
    setTimeout(() => { try { window.history.back(); } catch { /* noop */ } }, 0);
  }, null);
}

let installed = false;
function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('popstate', onPopState);
}

function sync(): boolean {
  install();
  try {
    if (owners.size) document.body.dataset.recordingActive = '1';
    else delete document.body.dataset.recordingActive;
  } catch { /* noop */ }
  return syncMark();
}
