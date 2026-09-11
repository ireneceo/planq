// 한 칸짜리 자유 텍스트 초안 — docs/DRAFT_PERSISTENCE_DESIGN.md D-C1a (정본 훅)
//
// Irene 2026-09-11: "업무상세에서 수정요청에 내용 남기거나 댓글에 내용 남기거나 하다가 나가면 다 날라가는데
//                    모든 입력란은 임시저장 되어 있게 못해?"
//
// ★ 같은 키를 든 인스턴스가 **동시에 여럿** 산다 — keep-alive 탭(display:none 마운트 유지)·팝아웃 창·PiP.
//   설계 게이트 4회에서 드러난 유실 경로를 규칙으로 막는다:
//   ① 저장본에는 **편집 시각(editedAt)** 을 박는다(쓴 시각이 아니다). 정본 = 편집 시각이 큰 쪽.
//   ② 편집 시각은 단조 증가 — 같은 ms·시계 역행에도 마지막 입력이 쓰인다.
//   ③ flush 는 dirty · 아직 안 쓴 편집 · 저장본보다 새 편집일 때만 쓴다(더 새 글을 옛 글로 덮지 않는다).
//   ④ 빈 값은 삭제 대신 툼스톤 — 남이 자기 글을 지운 순간 내 글이 비워지면 안 된다. 제출만 cleared.
//   ⑤ 더 새 저장본이 오면 **포커스와 무관하게** 즉시 반영(IME 조합 중에만 끝날 때까지 미룬다).
//      포커스로 보류하면 팝아웃에서 이어 쓴 글을 메인 창이 옛 글로 덮는다.
//   ⑥ 키가 null 로 바뀌어도 화면 글은 지우지 않는다(저장만 멈춘다).
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth, isImpersonatingNow } from '../contexts/AuthContext';
import {
  draftStorageKey, readDraftRecord, writeDraftRecord, clearDraftRecord, migrateLegacyDraft,
  parseDraftRecord, parseDraftKey, isDraftsSuppressed,
  DRAFT_EVENT, DRAFT_SUPPRESS_EVENT, type DraftRecord,
} from '../services/draftStore';
import type { DraftKind } from './draftKinds';

/** 초안 키 — 사용자·워크스페이스·대상. 사칭 중·정지 중·정보 부족이면 null(=보존 안 함). */
export function useDraftKey(kind: DraftKind, entityId: unknown, bizId?: unknown): string | null {
  const { user } = useAuth();
  const [, force] = useState(0);
  useEffect(() => {
    const on = () => force((n) => n + 1);
    window.addEventListener(DRAFT_SUPPRESS_EVENT, on);
    return () => window.removeEventListener(DRAFT_SUPPRESS_EVENT, on);
  }, []);
  if (!user?.id || isDraftsSuppressed() || isImpersonatingNow()) return null;
  if (entityId === null || entityId === undefined || entityId === '') return null;
  // 엔티티의 워크스페이스가 있으면 그것, 없을 때만 창의 워크스페이스
  const biz = bizId != null && bizId !== '' && Number(bizId) > 0 ? bizId : user.business_id;
  return draftStorageKey(kind, user.id, biz, entityId);
}

export interface DraftTextOptions {
  /** 옛 형식 키 — 새 키가 비었고 같은 사용자일 때 한 번 옮기고 지운다 */
  legacyKey?: string | null;
  debounceMs?: number;
  /** 수정형(edit) — 지금 서버 원문. 저장본 base 와 다르면 옛 초안을 버린다 */
  base?: string | null;
}

export interface DraftText {
  text: string;
  setText: (v: string) => void;
  /** 제출 성공·명시 취소 — 입력칸과 저장본을 함께 비우고 다른 창에도 알린다 */
  clear: () => void;
  /** 열 때 저장본을 불러왔다 */
  restored: boolean;
  /** 다른 창의 더 새 글로 바뀌었다 */
  replaced: boolean;
  /** 원문이 바뀌어 옛 초안을 버렸다 */
  baseChanged: boolean;
  dismissNotice: () => void;
  bind: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
    onBlur: () => void;
    'data-draft-kind'?: string;
  };
}

const norm = (s: string) => s.replace(/<p>\s*<\/p>/gi, '').trim();

interface Loaded { text: string; editedAt: number; written: number | null; restored: boolean; baseChanged: boolean }

function load(key: string | null, base: string | null | undefined, legacyKey: string | null | undefined): Loaded {
  const empty: Loaded = { text: base ?? '', editedAt: 0, written: null, restored: false, baseChanged: false };
  if (!key) return empty;
  migrateLegacyDraft(legacyKey, key, parseDraftKey(key)?.uid);
  const rec = readDraftRecord<string>(key);
  if (!rec || rec.cleared || typeof rec.value !== 'string') return empty;
  if (base != null) {
    if (norm(rec.value) === norm(base)) {
      // 원문과 같다 — 남길 것이 없다(조용히 지운다, 다른 창에 알리지 않는다)
      try { localStorage.removeItem(key); } catch { /* noop */ }
      return empty;
    }
    if (rec.base !== undefined && rec.base !== base) {
      try { localStorage.removeItem(key); } catch { /* noop */ }
      return { ...empty, baseChanged: true };
    }
  }
  return { text: rec.value, editedAt: rec.editedAt, written: rec.editedAt, restored: rec.value.trim().length > 0, baseChanged: false };
}

export function useDraftText(key: string | null, opts: DraftTextOptions = {}): DraftText {
  const debounceMs = opts.debounceMs ?? 400;
  const baseRef = useRef(opts.base);
  baseRef.current = opts.base;
  const legacyRef = useRef(opts.legacyKey);
  legacyRef.current = opts.legacyKey;

  const [initial] = useState<Loaded>(() => load(key, opts.base, opts.legacyKey));
  const [text, setTextState] = useState<string>(initial.text);
  const [restored, setRestored] = useState(initial.restored);
  const [replaced, setReplaced] = useState(false);
  const [baseChanged, setBaseChanged] = useState(initial.baseChanged);

  const keyRef = useRef<string | null>(key);
  const textRef = useRef(initial.text);
  const dirtyRef = useRef(false);
  const lastEditAtRef = useRef(initial.editedAt);
  const writtenRef = useRef<number | null>(initial.written);
  const composingRef = useRef(false);
  const pendingRecheckRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    const k = keyRef.current;
    if (!k || !dirtyRef.current) return;
    if (writtenRef.current === lastEditAtRef.current) return;       // 같은 편집을 다시 쓰지 않는다
    const stored = readDraftRecord<string>(k);
    if (stored && !stored.cleared && stored.editedAt >= lastEditAtRef.current) return;   // 더 새 글이 이미 있다
    const base = baseRef.current;
    if (writeDraftRecord(k, textRef.current, lastEditAtRef.current, base != null ? { base } : undefined)) {
      writtenRef.current = lastEditAtRef.current;
    }
  }, []);

  const applyRecord = useCallback((rec: DraftRecord) => {
    const v = typeof rec.value === 'string' ? rec.value : '';
    const changed = v !== textRef.current;
    textRef.current = v;
    lastEditAtRef.current = rec.editedAt;
    writtenRef.current = rec.editedAt;
    dirtyRef.current = false;
    setTextState(v);
    if (changed) setReplaced(true);
  }, []);

  // 키 전환 — 옛 키로 확정 저장한 뒤 새 키를 읽는다. null 이면 저장만 멈추고 화면 글은 둔다.
  const lastRealKeyRef = useRef<string | null>(key);
  useEffect(() => {
    if (keyRef.current === key) return;
    flush();
    keyRef.current = key;
    if (!key) return;
    // ★ **같은 키가 정지(null)에서 돌아왔다** — 다른 창이 로그아웃했다가 같은 사람이 다시 로그인한 경우(⑩5).
    //   그 사이 저장본은 로그아웃이 지웠고 화면 글은 그대로 두었다. 여기서 load 하면 빈 저장본이 화면 글을 지운다
    //   (카나리 첫 실행: 'L1S' 가 사라지고 재로그인 뒤 친 'R' 만 남았다).
    //   → 저장본이 더 새 글이면 그것을, 아니면 화면 글을 다시 쓴다.
    //   ★ **다른 키**로 바뀐 것이면 이 분기를 타지 않는다 — 앞 대상의 글을 새 대상 키에 쓰면 섞인다(③).
    if (key === lastRealKeyRef.current) {
      const rec = readDraftRecord<string>(key);
      if (rec && !rec.cleared && rec.editedAt > lastEditAtRef.current) { applyRecord(rec); return; }
      const storedText = rec && !rec.cleared && typeof rec.value === 'string' ? rec.value : '';
      if (textRef.current !== storedText) {
        dirtyRef.current = true;
        writtenRef.current = null;
        flush();
      }
      return;
    }
    lastRealKeyRef.current = key;
    const l = load(key, baseRef.current, legacyRef.current);
    textRef.current = l.text;
    lastEditAtRef.current = l.editedAt;
    writtenRef.current = l.written;
    dirtyRef.current = false;
    setTextState(l.text);
    setRestored(l.restored);
    setReplaced(false);
    setBaseChanged(l.baseChanged);
  }, [key, flush, applyRecord]);

  // 다른 인스턴스의 쓰기 — 같은 창(CustomEvent) · 다른 창(storage)
  useEffect(() => {
    const onRecord = (k: string | null, rec: DraftRecord | null) => {
      if (!k || k !== keyRef.current) return;
      if (!rec) { writtenRef.current = null; return; }            // 삭제(로그아웃·TTL) — 다음 flush 가 다시 쓸 수 있게
      if (rec.cleared) {
        textRef.current = '';
        dirtyRef.current = false;
        lastEditAtRef.current = Math.max(lastEditAtRef.current, rec.editedAt);
        writtenRef.current = lastEditAtRef.current;
        setTextState('');
        setRestored(false);
        setReplaced(false);
        return;
      }
      if (rec.editedAt <= lastEditAtRef.current) return;            // 내 쓰기이거나 옛 글
      if (composingRef.current) { pendingRecheckRef.current = true; return; }
      applyRecord(rec);
    };
    const onCustom = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; record: DraftRecord | null }>).detail;
      if (d) onRecord(d.key, d.record);
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      onRecord(e.key, e.newValue == null ? null : parseDraftRecord(e.newValue));
    };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    const onPageHide = () => flush();
    const onWinBlur = () => flush();
    window.addEventListener(DRAFT_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('blur', onWinBlur);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener(DRAFT_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('blur', onWinBlur);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush, applyRecord]);

  const setText = useCallback((v: string) => {
    textRef.current = v;
    dirtyRef.current = true;
    lastEditAtRef.current = Math.max(Date.now(), lastEditAtRef.current + 1);
    setTextState(v);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; flush(); }, debounceMs);
  }, [debounceMs, flush]);

  const clear = useCallback(() => {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    textRef.current = '';
    dirtyRef.current = false;
    lastEditAtRef.current = Math.max(Date.now(), lastEditAtRef.current + 1);
    writtenRef.current = lastEditAtRef.current;
    setTextState('');
    setRestored(false);
    setReplaced(false);
    setBaseChanged(false);
    clearDraftRecord(keyRef.current);
  }, []);

  const dismissNotice = useCallback(() => { setRestored(false); setReplaced(false); setBaseChanged(false); }, []);

  const onCompositionStart = useCallback(() => { composingRef.current = true; }, []);
  const onCompositionEnd = useCallback(() => {
    composingRef.current = false;
    if (!pendingRecheckRef.current) return;
    pendingRecheckRef.current = false;
    const rec = readDraftRecord<string>(keyRef.current);
    if (rec && !rec.cleared && rec.editedAt > lastEditAtRef.current) applyRecord(rec);
  }, [applyRecord]);

  const kind = key ? parseDraftKey(key)?.kind : undefined;
  return {
    text, setText, clear, restored, replaced, baseChanged, dismissNotice,
    bind: {
      value: text,
      onChange: (e) => setText(e.target.value),
      onCompositionStart,
      onCompositionEnd,
      onBlur: flush,
      ...(kind ? { 'data-draft-kind': kind } : {}),
    },
  };
}
