// 나가기 전에 저장 — docs/DRAFT_PERSISTENCE_DESIGN.md D-C3 flush 프로토콜
//
// 로그아웃·워크스페이스 전환·원격 재부팅은 화면을 통째로 버린다. 그 순간 자동저장 debounce 에 걸려 있던
// 입력은 타이머와 함께 사라진다 — 서버엔 안 갔고 화면은 없어진다.
// 버리기 전에 **대기 중인 저장만** 먼저 내보낸다.
//
// 저장이 걸린 컴포넌트는 `onFlushPendingSaves` 로 요청을 듣고, 보낼 것이 있을 때만 `waitUntil(promise)` 로
// 자기 저장을 등록한다(리스너는 마운트된 것만 — 순서 무관). 부르는 쪽은 **상한 안에서만** 기다린다.
// 상한을 넘기면 기다리지 않고 진행한다 — 네트워크 때문에 로그아웃·전환이 멈추면 안 된다.
export const PENDING_SAVES_FLUSH_EVENT = 'planq:drafts:flush';

export interface PendingSavesFlushDetail {
  waitUntil: (p: Promise<unknown>) => void;
}

export async function flushPendingSaves(timeoutMs = 3000): Promise<{ registered: number; timedOut: boolean }> {
  const waits: Promise<unknown>[] = [];
  try {
    window.dispatchEvent(new CustomEvent<PendingSavesFlushDetail>(PENDING_SAVES_FLUSH_EVENT, {
      detail: { waitUntil: (p) => { waits.push(Promise.resolve(p).catch(() => null)); } },
    }));
  } catch { /* noop */ }
  if (!waits.length) return { registered: 0, timedOut: false };
  let timer: number | undefined;
  const timeout = new Promise<'timeout'>((resolve) => { timer = window.setTimeout(() => resolve('timeout'), timeoutMs); });
  const outcome = await Promise.race([Promise.allSettled(waits).then(() => 'done' as const), timeout]);
  if (timer !== undefined) window.clearTimeout(timer);
  return { registered: waits.length, timedOut: outcome === 'timeout' };
}

/** 저장이 걸린 컴포넌트용 — 요청이 오면 handler 가 보낼 것이 있을 때만 waitUntil 을 부른다 */
export function onFlushPendingSaves(handler: (waitUntil: (p: Promise<unknown>) => void) => void): () => void {
  const on = (e: Event) => {
    const d = (e as CustomEvent<PendingSavesFlushDetail>).detail;
    if (d && typeof d.waitUntil === 'function') handler(d.waitUntil);
  };
  window.addEventListener(PENDING_SAVES_FLUSH_EVENT, on);
  return () => window.removeEventListener(PENDING_SAVES_FLUSH_EVENT, on);
}
