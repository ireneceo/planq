// 사이클 N+16 — 드래프트 자동저장 (localStorage).
// "문서 작성중에 날아가면 무서워서" — 사용자 입력 즉시 localStorage 저장.
// 백엔드 저장이 안 된 상태에서 새로고침·브라우저 크래시·실수 닫기 모두 살아남음.
//
// 사용:
//   const draft = useLocalDraft({
//     key: `qproject-post-new-${projectId}`,
//     value: { title, category, content },
//     debounceMs: 500,
//   });
//   // 마운트 시 draft.restored 가 있으면 setState 로 복원
//   // 저장 성공 후 draft.clear() 호출
import { useEffect, useRef, useState } from 'react';

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
  /** 마운트 시 localStorage 에서 읽어들인 드래프트 (있으면 복원에 사용) */
  restored: { value: T; savedAt: number } | null;
  /** 명시적 clear — submit 성공 후 호출 */
  clear: () => void;
}

export function useLocalDraft<T>(opts: UseLocalDraftOptions<T>): LocalDraft<T> {
  const { key, value, debounceMs = 500, enabled = true, isEmpty } = opts;
  const [restored] = useState<{ value: T; savedAt: number } | null>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.savedAt !== 'number') return null;
      // 7일 이상 된 드래프트는 무시 (오래된 garbage 정리)
      if (Date.now() - parsed.savedAt > 7 * 24 * 60 * 60 * 1000) {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
        return null;
      }
      return { value: parsed.value as T, savedAt: parsed.savedAt };
    } catch { return null; }
  });

  const timerRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      try {
        if (isEmpty && isEmpty(value)) {
          localStorage.removeItem(key);
          return;
        }
        localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now() }));
      } catch { /* quota or serialize fail — 무시 */ }
    }, debounceMs);
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [key, value, debounceMs, enabled, isEmpty]);

  const clear = () => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  };

  return { restored, clear };
}
