// 나갈 때 확정 저장 — 한 번에 하나(single-flight) + 언마운트·패널 닫힘·pagehide·flush 프로토콜
//   docs/DRAFT_PERSISTENCE_DESIGN.md D-C3. 서버에 debounce 로 저장하는 편집기(Q Note 메모 등)가 쓴다.
//
// ★ 여태 이런 편집기들은 언마운트 cleanup 이 **타이머만 지웠다** — 다른 메모를 누르거나 팝업이 닫히거나
//   로그아웃·워크스페이스 전환을 하면 마지막 입력(debounce 창)이 서버에 안 갔는데 화면은 사라졌다.
// ★ 저장은 한 번에 하나 — 새 문서 생성 중에 나가며 저장이 또 나가면 **문서가 두 개 생긴다.**
//   기다린 뒤 방금 저장으로 이미 깨끗해졌으면 다시 보내지 않는다.
// ★ 나가며 저장(`leaving: true`)은 화면 콜백(활성 문서·주소 바꾸기)을 부르지 않게 호출부가 본다 —
//   부르면 사용자가 방금 간 곳에서 떠난 문서로 끌려온다.
// ★ 새 문서 생성 뒤 id 는 호출부가 **ref 를 직접** 맞춘다 — 언마운트 뒤에는 렌더가 다시 오지 않아
//   `ref.current = state` 동기화에 기대면 다음 저장이 또 만든다.
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { onFlushPendingSaves } from '../services/pendingSaves';

export interface LeaveSaveOptions {
  /** true → false 로 바뀌는 순간(패널 닫힘) 대기분을 보낸다. 생략하면 언마운트·pagehide·flush 만 */
  active?: boolean;
  /** 실패 로그에 붙일 이름 */
  label: string;
}

export function useLeaveSave<T>(
  save: (opts: { leaving: boolean }) => Promise<T>,
  dirtyRef: MutableRefObject<boolean>,
  debounceRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  { active, label }: LeaveSaveOptions,
) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const inflightRef = useRef<Promise<unknown> | null>(null);

  const persist = useCallback(async (opts?: { leaving?: boolean }): Promise<T | undefined> => {
    let waited = false;
    while (inflightRef.current) { waited = true; await inflightRef.current.catch(() => null); }
    if (waited && !dirtyRef.current) return undefined;
    const run = saveRef.current({ leaving: !!opts?.leaving });
    inflightRef.current = run;
    try { return await run; } finally { if (inflightRef.current === run) inflightRef.current = null; }
  }, [dirtyRef]);

  const leave = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    return persist({ leaving: true });
  }, [persist, debounceRef]);

  useEffect(() => {
    if (active !== false) return;
    if (dirtyRef.current) void leave().catch(() => null);
  }, [active, leave, dirtyRef]);

  useEffect(() => {
    const onPageHide = () => { if (dirtyRef.current) void leave().catch(() => null); };
    window.addEventListener('pagehide', onPageHide);
    const off = onFlushPendingSaves((waitUntil) => { if (dirtyRef.current || inflightRef.current) waitUntil(leave()); });
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      off();
      if (dirtyRef.current) void leave().catch((e) => console.warn(`[${label}] 나가며 저장 실패`, e));
    };
  }, [leave, dirtyRef, label]);

  return { persist, leave };
}
