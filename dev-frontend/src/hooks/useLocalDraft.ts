// 한 번 열리고 닫히는 폼(객체 값)의 초안 — 저장은 services/draftStore 한 곳.
//   한 칸짜리 자유 텍스트(댓글·사유·메모)는 hooks/useDraftText 가 정본이다(여러 인스턴스 동기화 규칙).
//
// 사용:
//   const key = useDraftKey('mail-forward', msgId, businessId);
//   const draft = useLocalDraft({ key: key || '', value: {...}, enabled: !!key && open, isEmpty });
//   저장 성공 후 draft.clear()
//
// ★ 2026-09-11 (DRAFT_PERSISTENCE_DESIGN I6) — 옛 구현은 value effect cleanup 이 **타이머만 지워**
//   폼을 닫는 순간(enabled→false) 마지막 debounce 분이 사라졌다. 닫는 렌더에서 부모가 값을 비우므로
//   "마지막으로 enabled 였던 렌더의 값" 을 기억해 두었다가 그 값으로 확정 저장한다.
import { useEffect, useRef, useState } from 'react';
import { readDraftRecord, writeDraftRecord } from '../services/draftStore';

export { useDraftText, useDraftKey } from './useDraftText';
export type { DraftText } from './useDraftText';

export interface UseLocalDraftOptions<T> {
  key: string;
  value: T;
  debounceMs?: number;
  /** false 면 draft 저장 안 함 (예: edit 모드에서 서버 fetch 직후 즉시 저장되는 회귀 방지) */
  enabled?: boolean;
  /** 빈 값 판정 — 빈 값이면 localStorage 에서 제거 (스토리지 청소) */
  isEmpty?: (v: T) => boolean;
}

export interface LocalDraft<T> {
  /** 마운트 시 읽어들인 드래프트 */
  restored: { value: T; savedAt: number } | null;
  /** 명시적 clear — submit 성공 후 호출 */
  clear: () => void;
}

export function useLocalDraft<T>(opts: UseLocalDraftOptions<T>): LocalDraft<T> {
  const { key, value, debounceMs = 500, enabled = true, isEmpty } = opts;
  const [restored] = useState<{ value: T; savedAt: number } | null>(() => {
    const rec = key ? readDraftRecord<T>(key) : null;
    return rec && !rec.cleared ? { value: rec.value, savedAt: rec.editedAt } : null;
  });

  // 마지막으로 enabled 였던 렌더의 키·값 — 닫는 렌더에서 부모가 값을 비워도 이것으로 저장한다
  const lastRef = useRef<{ key: string; value: T } | null>(null);
  const dirtyRef = useRef(false);
  const firstRef = useRef(true);
  const timerRef = useRef<number | null>(null);
  const isEmptyRef = useRef(isEmpty);
  isEmptyRef.current = isEmpty;
  if (enabled && key) lastRef.current = { key, value };

  const writeNow = () => {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    const last = lastRef.current;
    if (!last || !dirtyRef.current) return;
    dirtyRef.current = false;
    try {
      if (isEmptyRef.current && isEmptyRef.current(last.value)) { localStorage.removeItem(last.key); return; }
    } catch { /* noop */ }
    writeDraftRecord(last.key, last.value, Date.now());
  };

  useEffect(() => {
    if (!enabled || !key) return;
    if (firstRef.current) { firstRef.current = false; return; }
    dirtyRef.current = true;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(writeNow, debounceMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, debounceMs, enabled]);

  // 닫힘(enabled true→false)·키 전환 — 기다리지 않고 확정 저장
  const prevEnabledRef = useRef(enabled);
  const prevKeyRef = useRef(key);
  useEffect(() => {
    if ((prevEnabledRef.current && !enabled) || (prevKeyRef.current && prevKeyRef.current !== key)) {
      writeNow();
      firstRef.current = true;
    }
    prevEnabledRef.current = enabled;
    prevKeyRef.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  // 언마운트·탭 이탈
  useEffect(() => {
    const onHide = () => writeNow();
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); writeNow(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = () => {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    dirtyRef.current = false;
    try { if (key) localStorage.removeItem(key); } catch { /* noop */ }
  };

  return { restored, clear };
}
