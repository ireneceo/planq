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

// ─────────────────────────────────────────────────────────────────────────────
// 운영 #367 — "댓글이나 채팅 같은 거 쓰다가 다른 곳 가면 저장되어 있을 수 없어? 돌아가면 다시 나오게"
//
// 위 useLocalDraft 는 **한 번 열리고 닫히는 폼**(새 문서 작성 등)을 위한 것이라, 복원값을 마운트
// 시점에 한 번만 읽는다. 댓글·메모는 다르다 — 컴포넌트는 계속 떠 있고 **대상만 바뀐다**
// (다른 업무 클릭 / 다른 스레드 클릭). 그래서 key 가 바뀔 때마다 다시 읽어야 하고,
// 더 중요하게는 **바뀌기 직전 값을 옛 key 로 먼저 확정 저장**해야 한다.
// 안 그러면 "쓰다가 debounce 안에 다른 업무를 누르면 그 글이 사라지는" 원래 증상이 그대로 남는다.
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function readDraftText(key: string): string {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== 'number') return '';
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) { localStorage.removeItem(key); return ''; }
    return typeof parsed.value === 'string' ? parsed.value : '';
  } catch { return ''; }
}

function writeDraftText(key: string, text: string) {
  try {
    if (!text.trim()) { localStorage.removeItem(key); return; }
    localStorage.setItem(key, JSON.stringify({ value: text, savedAt: Date.now() }));
  } catch { /* quota — 무시 */ }
}

export interface DraftText {
  text: string;
  setText: (v: string) => void;
  /** 발송·저장 성공 후 호출 — 입력칸과 저장본을 함께 비운다 */
  clear: () => void;
}

/**
 * 대상이 전환되는 한 칸짜리 입력(댓글·메모·채팅)의 초안 보존.
 * @param key   null 이면 보존하지 않는다 (대상 미선택 등)
 * @param debounceMs 기본 400ms
 */
export function useDraftText(key: string | null, debounceMs = 400): DraftText {
  const [text, setTextState] = useState<string>(() => (key ? readDraftText(key) : ''));
  const keyRef = useRef(key);
  const textRef = useRef(text);
  const timerRef = useRef<number | null>(null);

  const flush = () => {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    if (keyRef.current) writeDraftText(keyRef.current, textRef.current);
  };

  // key 전환 — 옛 key 로 확정 저장한 뒤 새 key 의 초안을 읽어 넣는다.
  useEffect(() => {
    if (keyRef.current === key) return;
    flush();
    keyRef.current = key;
    const next = key ? readDraftText(key) : '';
    textRef.current = next;
    setTextState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 입력 debounce 저장
  useEffect(() => {
    if (!key) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      writeDraftText(key, textRef.current);
    }, debounceMs);
    return () => { if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; } };
  }, [key, text, debounceMs]);

  // 언마운트·탭 이탈 — debounce 를 기다리지 않고 확정 저장한다.
  //   (드로어를 닫거나 페이지를 떠나는 것이 바로 이 기능이 구제해야 할 순간이다)
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setText = (v: string) => { textRef.current = v; setTextState(v); };
  const clear = () => {
    textRef.current = '';
    setTextState('');
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    if (key) { try { localStorage.removeItem(key); } catch { /* ignore */ } }
  };

  return { text, setText, clear };
}
