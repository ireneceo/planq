// MemoPopup — Q Note Quick Capture floating popup (사이클 N+17 리팩토링)
//
// 정책 (Irene 결정 박제):
//  - **항상 floating** — backdrop 없음, 페이지와 동시 인터랙션 가능 (Notion Quick Add 패턴)
//  - **드래그 이동** — 헤더 잡고 위치 자유 변경 (위치 localStorage 보존)
//  - **리사이즈** — 우하단 corner handle (width/height 자유, localStorage 보존)
//  - **세션 지속** — 처음 열림 시 가장 최근 작성 중인 text 메모 자동 로드 (active 우선)
//  - **자동 제목** — 본문 첫 줄에서 자동 추출. 별도 title input 없음 (미니멀)
//  - **상단 검색바 + 드롭다운** — 본인 메모 목록 클릭 전환 + 키워드 검색
//  - **자동저장** 1초 debounce — saving / saved / error 미니 dot 표시
//  - 모바일 (≤640px): 풀스크린 + 드래그/리사이즈 비활성
//
// 사용:
//   <MemoPopup open={open} onClose={close} businessId={biz} existingSessionId={id?} />
import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import styled, { keyframes, css } from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import VisibilityBadge from '../Common/VisibilityBadge';
import { createSession, updateSession, getSession, listMyRecentMemos } from '../../services/qnote';
import type { QNoteSession } from '../../services/qnote';
import {
  parseBodyToDoc, deriveTitleFromDoc, deriveMemoPreview, isDocEmpty,
} from '../../utils/qnoteBody';

// 사이클 N+17 — RichEditor 도입 (TipTap). lazy 로 첫 메모 작성 시점에만 받음.
// vendor-tiptap (417KB) + vendor-highlight (162KB) 가 lazy chunk 로 떨어져 첫 로드 부담 0.
const PostEditor = lazy(() => import('../Docs/PostEditor'));

interface Props {
  open: boolean;
  onClose: () => void;
  businessId: number;
  existingSessionId?: number | null;
  onCreated?: (session: QNoteSession) => void;
  // 사이클 N+17 hotfix — 분리 창 (Document PiP / window.open) 안에서 fullscreen popup 으로.
  // floating 위치/드래그/리사이즈 비활성, ⧉ 분리 버튼 hide, close=window.close().
  standalone?: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_DEBOUNCE_MS = 1000;
const SEARCH_DEBOUNCE_MS = 250;
const STORAGE_KEY = 'planq.memoPopup.layout';
const DEFAULT_W = 440;
const DEFAULT_H = 520;
const MIN_W = 320;
const MIN_H = 280;

interface PopupLayout {
  x: number; y: number; w: number; h: number;
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

function loadLayout(): PopupLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === 'number' && typeof p?.y === 'number' && typeof p?.w === 'number' && typeof p?.h === 'number') return p;
  } catch { /* ignore */ }
  return null;
}

function saveLayout(p: PopupLayout) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

// helpers — utils/qnoteBody.ts 로 분리됨 (list 미리보기 / 검색 / dropdown 도 같은 helper 사용)

function timeAgo(t: (k: string, opts?: any) => string, savedAt: number | null): string {
  if (!savedAt) return '';
  const sec = Math.floor((Date.now() - savedAt) / 1000);
  if (sec < 5) return t('memoPopup.savedJustNow');
  if (sec < 60) return t('memoPopup.savedAt', { ago: `${sec}s` });
  const min = Math.floor(sec / 60);
  if (min < 60) return t('memoPopup.savedAt', { ago: `${min}m` });
  return t('memoPopup.savedAt', { ago: `${Math.floor(min / 60)}h` });
}

// ─── styled ───
const fadeIn = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); }`;

const Container = styled.div<{ $x: number; $y: number; $w: number; $h: number; $dragging: boolean; $standalone?: boolean }>`
  position: fixed;
  left: ${(p) => p.$standalone ? '0' : `${p.$x}px`};
  top: ${(p) => p.$standalone ? '0' : `${p.$y}px`};
  width: ${(p) => p.$standalone ? '100vw' : `${p.$w}px`};
  height: ${(p) => p.$standalone ? '100vh' : `${p.$h}px`};
  z-index: 2301;
  background: #FFFFFF;
  border-radius: ${(p) => p.$standalone ? '0' : '14px'};
  box-shadow: ${(p) => p.$standalone ? 'none' : '0 20px 50px -12px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(15, 23, 42, 0.06)'};
  display: flex; flex-direction: column;
  animation: ${fadeIn} 0.16s ease;
  ${(p) => p.$dragging && !p.$standalone && css`user-select: none; cursor: grabbing;`}

  /* 모바일 — 풀스크린 (standalone 도 동일). 키보드 대응(#113): height 를 --vvh 바운드 →
     키보드 up 시 팝업이 줄고 내부 Body 스크롤 + 입력(에디터 캐럿)이 키보드 위에 유지. */
  @media (max-width: 640px) {
    left: 0 !important; top: 0 !important;
    width: 100vw !important; height: var(--vvh, 100dvh) !important;
    border-radius: 0;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
`;

const Header = styled.div<{ $standalone?: boolean }>`
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px 8px;
  cursor: ${(p) => p.$standalone ? 'default' : 'grab'};
  user-select: none;
  flex-shrink: 0;

  @media (max-width: 640px) { cursor: default; }
`;

const SearchWrap = styled.div`
  position: relative;
  flex: 1;
`;
const SearchInput = styled.input`
  width: 100%;
  height: 32px;
  padding: 0 12px 0 30px;
  font-size: 13px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  color: #334155;
  outline: none;
  transition: border-color 0.15s, background 0.15s;
  &:focus { border-color: #0F766E; background: #FFFFFF; }
  &::placeholder { color: #94A3B8; }
`;
const SearchIcon = styled.div`
  position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
  color: #94A3B8; pointer-events: none; display: inline-flex;
`;

const Dropdown = styled.div`
  position: absolute; left: 0; right: 0; top: 100%;
  margin-top: 4px;
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  box-shadow: 0 10px 24px -6px rgba(15, 23, 42, 0.18);
  max-height: 280px;
  overflow-y: auto;
  z-index: 5;
`;
const DropdownItem = styled.button.attrs({ type: 'button' as const })<{ $active?: boolean }>`
  display: block;
  width: 100%; text-align: left;
  padding: 8px 12px;
  background: ${(p) => p.$active ? '#F0FDFA' : 'transparent'};
  border: none; cursor: pointer;
  font-family: inherit;
  &:hover { background: #F1F5F9; }
`;
const DropdownTitle = styled.div`
  font-size: 13px; font-weight: 600; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const DropdownMeta = styled.div`
  font-size: 11px; color: #94A3B8; margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const DropdownEmpty = styled.div`
  padding: 14px 12px; font-size: 12px; color: #94A3B8; text-align: center;
`;

const HeaderBtn = styled.button.attrs({ type: 'button' as const })<{ $active?: boolean }>`
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${(p) => p.$active ? '#F0FDFA' : 'transparent'};
  color: ${(p) => p.$active ? '#0F766E' : '#64748B'};
  border: none; border-radius: 8px; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
  &:hover:not(:disabled) { background: #F1F5F9; color: #0F172A; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`;

const StatusRow = styled.div`
  padding: 0 14px 8px;
  font-size: 11px; color: #94A3B8;
  display: flex; align-items: center; gap: 6px;
  min-height: 16px;
  flex-shrink: 0;
`;
const StatusDot = styled.span<{ $tone: SaveState }>`
  display: inline-block;
  width: 6px; height: 6px; border-radius: 50%;
  background: ${(p) =>
    p.$tone === 'saved' ? '#22C55E' :
    p.$tone === 'saving' ? '#F59E0B' :
    p.$tone === 'error' ? '#EF4444' :
    '#CBD5E1'};
`;

const Body = styled.div`
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  padding: 0 16px 16px;
  overflow-y: auto;
`;
// 사이클 N+17 — BodyTextarea 제거, PostEditor (TipTap) 로 대체.
// PostEditor 가 lazy 로 받아지는 동안 표시할 placeholder.
const EditorLoading = styled.div`
  display: flex; align-items: center; justify-content: center;
  height: 100%; min-height: 200px;
  font-size: 13px; color: #94A3B8;
`;
// Body 안에서 PostEditor 의 .ProseMirror 가 자체 padding 가져서 별도 wrap padding 0.
// PostEditor borderless=true → 외곽 박스 X, popup 안에 자연스럽게 fit.

// 8방향 리사이즈 핸들 — corner 8px × 8px, edge 는 띠
const ResizeEdge = styled.div<{ $dir: ResizeDir }>`
  position: absolute;
  ${(p) => {
    const e = 6; // edge thickness
    const c = 12; // corner size
    switch (p.$dir) {
      case 'n':  return `top: -${e/2}px; left: ${c}px; right: ${c}px; height: ${e}px; cursor: ns-resize;`;
      case 's':  return `bottom: -${e/2}px; left: ${c}px; right: ${c}px; height: ${e}px; cursor: ns-resize;`;
      case 'e':  return `top: ${c}px; bottom: ${c}px; right: -${e/2}px; width: ${e}px; cursor: ew-resize;`;
      case 'w':  return `top: ${c}px; bottom: ${c}px; left: -${e/2}px; width: ${e}px; cursor: ew-resize;`;
      case 'nw': return `top: -${e/2}px; left: -${e/2}px; width: ${c}px; height: ${c}px; cursor: nwse-resize;`;
      case 'ne': return `top: -${e/2}px; right: -${e/2}px; width: ${c}px; height: ${c}px; cursor: nesw-resize;`;
      case 'sw': return `bottom: -${e/2}px; left: -${e/2}px; width: ${c}px; height: ${c}px; cursor: nesw-resize;`;
      case 'se': return `bottom: -${e/2}px; right: -${e/2}px; width: ${c}px; height: ${c}px; cursor: nwse-resize;`;
    }
  }}
  z-index: 2;

  @media (max-width: 640px) { display: none; }
`;
const ResizeCornerHint = styled.div`
  position: absolute; right: 2px; bottom: 2px;
  width: 14px; height: 14px;
  color: #CBD5E1;
  display: inline-flex; align-items: flex-end; justify-content: flex-end;
  pointer-events: none;

  @media (max-width: 640px) { display: none; }
`;
const SearchClearBtn = styled.button.attrs({ type: 'button' as const })`
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  color: #94A3B8;
  border: none; border-radius: 50%; cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;

// ─── icons ───
const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconDetach = () => (
  // 분리 창 (브라우저 밖 floating) 아이콘 — 화면 + 분리 화살표
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);
const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const IconSearch = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconResize = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="20" y1="10" x2="10" y2="20"/><line x1="20" y1="16" x2="16" y2="20"/>
  </svg>
);

// ─── 컴포넌트 ───
const MemoPopup: React.FC<Props> = ({ open, onClose, businessId, existingSessionId, onCreated, standalone = false }) => {
  const { t } = useTranslation('qnote');

  // ─── layout (drag/resize) ───
  const [layout, setLayout] = useState<PopupLayout>(() => {
    const saved = loadLayout();
    if (saved) return saved;
    // 사이클 N+17 (Irene 결정) — default 위치 우측 상단 (헤더 아래 ≈ 76px).
    // 본문 콘텐츠와 안 겹침 + 헤더와 시각 정합. 사용자가 드래그 이동 시 localStorage 보존.
    const w = DEFAULT_W, h = DEFAULT_H;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const HEADER_OFFSET = 76;   // PageShell/MainLayout 헤더 60px + 여유 16px
    return {
      w, h,
      x: Math.max(16, vw - w - 16),
      y: HEADER_OFFSET,
    };
  });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ dir: ResizeDir; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);

  // ─── 메모 state ───
  // doc 은 TipTap JSON. body 컬럼 (TEXT) 에는 JSON.stringify 로 저장.
  const [sessionId, setSessionId] = useState<number | null>(existingSessionId ?? null);
  const [doc, setDoc] = useState<unknown>(() => parseBodyToDoc(null));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  // ─── 검색 / 드롭다운 ───
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recent, setRecent] = useState<QNoteSession[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef<number | null>(sessionId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  sessionIdRef.current = sessionId;

  // #113 — Esc 닫기도 pending 저장 flush 경유 (handleClose). handleClose 는 아래에서 정의되므로
  //   최신 클로저를 ref 로 참조 (미저장 마지막 입력 유실 방지).
  const closeRef = useRef<() => void>(() => onClose());
  useEscapeStack(open && !searchOpen, useCallback(() => closeRef.current(), []));

  // ─── layout persist ───
  useEffect(() => { saveLayout(layout); }, [layout]);

  // ─── 드래그 ───
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (dragging && dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 100, dragRef.current.origX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 60, dragRef.current.origY + dy));
      setLayout((p) => ({ ...p, x: newX, y: newY }));
    }
    if (resizing && resizeRef.current) {
      const r = resizeRef.current;
      const dx = e.clientX - r.startX;
      const dy = e.clientY - r.startY;
      const maxW = window.innerWidth * 0.9;
      const maxH = window.innerHeight * 0.85;
      let { x, y, w, h } = { x: r.origX, y: r.origY, w: r.origW, h: r.origH };

      // East / South: 우/하 방향 = width/height 증가
      if (r.dir.includes('e')) {
        w = Math.max(MIN_W, Math.min(maxW, r.origW + dx));
      }
      if (r.dir.includes('s')) {
        h = Math.max(MIN_H, Math.min(maxH, r.origH + dy));
      }
      // West / North: 좌/상 방향 = width/height 감소 + x/y 증가 (지정 한계 적용)
      if (r.dir.includes('w')) {
        const proposedW = Math.max(MIN_W, Math.min(maxW, r.origW - dx));
        const widthDelta = r.origW - proposedW;
        w = proposedW;
        x = Math.max(0, r.origX + widthDelta);
      }
      if (r.dir.includes('n')) {
        const proposedH = Math.max(MIN_H, Math.min(maxH, r.origH - dy));
        const heightDelta = r.origH - proposedH;
        h = proposedH;
        y = Math.max(0, r.origY + heightDelta);
      }
      setLayout({ x, y, w, h });
    }
  }, [dragging, resizing]);

  const onMouseUp = useCallback(() => {
    setDragging(false); setResizing(false);
    dragRef.current = null; resizeRef.current = null;
  }, []);

  useEffect(() => {
    if (!dragging && !resizing) return;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, resizing, onMouseMove, onMouseUp]);

  const startDrag = (e: React.MouseEvent) => {
    if (window.innerWidth <= 640) return;
    // 헤더 안의 button/input 위에서는 드래그 비활성
    const target = e.target as HTMLElement;
    if (target.closest('input, button')) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: layout.x, origY: layout.y };
    setDragging(true);
    e.preventDefault();
  };
  const startResize = (dir: ResizeDir) => (e: React.MouseEvent) => {
    if (window.innerWidth <= 640) return;
    resizeRef.current = {
      dir,
      startX: e.clientX, startY: e.clientY,
      origX: layout.x, origY: layout.y,
      origW: layout.w, origH: layout.h,
    };
    setResizing(true);
    e.preventDefault();
    e.stopPropagation();
  };

  // ─── 자동저장 ───
  const persist = useCallback(async () => {
    if (isDocEmpty(doc)) return;
    const title = deriveTitleFromDoc(doc);
    const bodyJson = JSON.stringify(doc);
    setSaveState('saving');
    try {
      if (sessionIdRef.current) {
        const updated = await updateSession(sessionIdRef.current, { title, body: bodyJson } as any);
        setSavedAt(Date.now()); setSaveState('saved');
        dirtyRef.current = false;
        // N+35 — 글로벌 sync 이벤트. 다른 탭/페이지의 QNotePage 가 listen → list 즉시 갱신.
        // backend Q note 가 별도 FastAPI service 라 socket.io 없음 → window CustomEvent 패턴.
        try { window.dispatchEvent(new CustomEvent('qnote-session-updated', { detail: { id: updated.id } })); } catch { /* noop */ }
        return updated;
      }
      const created = await createSession({
        business_id: businessId, title, input_type: 'text', body: bodyJson,
      });
      setSessionId(created.id);
      setSavedAt(Date.now()); setSaveState('saved');
      dirtyRef.current = false;
      onCreated?.(created);
      // N+35 — 신규 메모 생성 시 글로벌 sync (다른 페이지/탭의 QNotePage 자동 reload)
      try { window.dispatchEvent(new CustomEvent('qnote-session-created', { detail: { id: created.id } })); } catch { /* noop */ }
      return created;
    } catch (e) {
      setSaveState('error'); throw e;
    }
  }, [doc, businessId, onCreated]);

  useEffect(() => {
    if (!open) return;
    if (!dirtyRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { persist().catch(() => { /* surfaced via saveState */ }); }, SAVE_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, doc, persist]);

  // ─── 메모 로드 (open 시점: existingSessionId or 자동 이어쓰기) ───
  const loadMemo = useCallback(async (id: number | null) => {
    if (id === null) {
      setSessionId(null); setDoc(parseBodyToDoc(null)); setSavedAt(null); setSaveState('idle');
      dirtyRef.current = false;
      return;
    }
    setLoading(true);
    try {
      const s = await getSession(id);
      setSessionId(s.id);
      setDoc(parseBodyToDoc(s.body));
      setSavedAt(Date.now()); setSaveState('saved');
      dirtyRef.current = false;
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      // 1. existingSessionId 가 명시되면 그걸 로드
      if (existingSessionId) {
        await loadMemo(existingSessionId);
        return;
      }
      // 2. 가장 최근 작성 중인 본인 text 메모 자동 로드 (Notion quick-add 패턴)
      try {
        const list = await listMyRecentMemos(businessId, { limit: 1 });
        if (cancelled) return;
        if (list.length > 0 && list[0].status === 'active') {
          await loadMemo(list[0].id);
        } else {
          // 빈 페이지로 시작
          await loadMemo(null);
        }
      } catch { await loadMemo(null); }
    })();
    return () => { cancelled = true; };
  }, [open, existingSessionId, businessId, loadMemo]);

  // ─── focus 처리 (PostEditor 가 mount 후 ProseMirror DOM 자동 focus — 별도 ref 불필요) ───
  // 단 popup 진입 시 ProseMirror 가 lazy 로드 되므로 ContentEditable element 찾아서 focus.
  useEffect(() => {
    if (!open || loading) return;
    const tm = window.setTimeout(() => {
      const el = containerRef.current?.querySelector<HTMLElement>('.ProseMirror');
      el?.focus();
    }, 120);
    return () => window.clearTimeout(tm);
  }, [open, loading]);

  // ─── 검색 (debounce + drop fetch) ───
  useEffect(() => {
    if (!searchOpen) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const list = await listMyRecentMemos(businessId, { q: searchQuery, limit: 15 });
        setRecent(list);
      } catch { setRecent([]); }
      finally { setSearchLoading(false); }
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchOpen, searchQuery, businessId]);

  // ─── 검색 dropdown 외부 클릭 닫기 ───
  // SearchWrap (input + dropdown) 밖 click 이면 닫기. popup 안의 body textarea / 헤더 다른 버튼도 dismiss
  useEffect(() => {
    if (!searchOpen) return;
    const onDoc = (e: MouseEvent) => {
      const w = searchWrapRef.current;
      if (!w) return;
      if (!w.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [searchOpen]);

  // ─── savedAt label 갱신 ───
  useEffect(() => {
    if (!open || saveState !== 'saved') return;
    const id = setInterval(() => setTick((x) => x + 1), 10_000);
    return () => clearInterval(id);
  }, [open, saveState]);
  void tick;

  // ─── 메모 전환 / 새 메모 ───
  const switchTo = async (id: number) => {
    // 현재 dirty 면 먼저 flush
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (dirtyRef.current) await persist().catch(() => null);
    setSearchOpen(false);
    setSearchQuery('');
    await loadMemo(id);
  };
  const startNew = async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (dirtyRef.current) await persist().catch(() => null);
    setSearchOpen(false);
    setSearchQuery('');
    await loadMemo(null);
  };

  const handleClose = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (dirtyRef.current) {
      persist().finally(() => onClose());
    } else {
      onClose();
    }
  };
  closeRef.current = handleClose;  // #113 — Esc 핸들러가 항상 최신 flush 로직 참조

  // 사이클 N+17 — 메모 분리 창. 우선순위:
  //  1. Document Picture-in-Picture API (Chrome 116+ 데스크탑) — 진짜 브라우저 밖 floating, always-on-top
  //  2. fallback window.open — 모든 brower 표준 새 창. 일부 brower 는 새 탭으로 처리됨
  // 미저장 dirty 가 있으면 먼저 flush → 새 창에서 같은 메모 이어쓰기 가능 (sessions.body 동기).
  const detachToWindow = async () => {
    // 신규 메모면 먼저 저장해서 sessionId 확보
    if (!sessionIdRef.current && dirtyRef.current) {
      try { await persist(); } catch { /* skip if save failed */ }
    }
    const id = sessionIdRef.current;
    if (!id) return;  // 빈 상태에서 분리 의미 없음
    // 사이클 N+17 hotfix — 분리 창 전용 minimal route (MainLayout 우회, popup 디자인).
    // 옛 /notes/{id}?detached=1 은 풀 페이지로 떴음. /memo/{id} 가 사이드바 없이 popup 형태.
    const url = `${window.location.origin}/memo/${id}`;

    // Chrome Document PiP — 진짜 브라우저 밖 floating window
    const dpip = (window as any).documentPictureInPicture;
    if (dpip?.requestWindow) {
      try {
        const pipWin = await dpip.requestWindow({ width: layout.w, height: layout.h });
        // PiP 창 안에 same-origin iframe 으로 /notes/{id} 로딩
        const doc = pipWin.document;
        doc.title = t('memoPopup.title') as string;
        const iframe = doc.createElement('iframe');
        iframe.src = url;
        iframe.style.cssText = 'border:0;width:100%;height:100%;display:block;';
        doc.body.style.cssText = 'margin:0;padding:0;height:100vh;';
        doc.body.appendChild(iframe);
        onClose();
        return;
      } catch { /* fallback to window.open */ }
    }

    // 일반 brower — popup window. 위치/크기 hint (일부 brower 는 무시하고 새 탭)
    const features = `width=${layout.w},height=${layout.h},left=200,top=120,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`;
    const opened = window.open(url, `planq-memo-${id}`, features);
    if (opened) onClose();
  };

  if (!open) return null;

  const fmtDate = (s: string) => {
    try { return new Date(s).toLocaleDateString(); } catch { return ''; }
  };

  return createPortal(
    <Container
      ref={containerRef}
      $x={layout.x} $y={layout.y} $w={layout.w} $h={layout.h}
      $dragging={dragging || resizing}
      $standalone={standalone}
      role="dialog"
      aria-label={t('memoPopup.title')}
    >
      <Header $standalone={standalone} onMouseDown={standalone ? undefined : startDrag}>
        <SearchWrap ref={searchWrapRef}>
          <SearchIcon><IconSearch /></SearchIcon>
          <SearchInput
            value={searchQuery}
            placeholder={t('memoPopup.searchPlaceholder') as string}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearchOpen(false); (e.target as HTMLInputElement).blur(); } }}
            style={searchQuery ? { paddingRight: 30 } : undefined}
          />
          {searchQuery && (
            <SearchClearBtn
              onClick={() => { setSearchQuery(''); setSearchOpen(true); }}
              title={t('memoPopup.searchClear') as string}
              aria-label={t('memoPopup.searchClear') as string}
            >
              <IconClose />
            </SearchClearBtn>
          )}
          {searchOpen && (
            <Dropdown>
              {searchLoading ? (
                <DropdownEmpty>{t('memoPopup.searchLoading') as string}</DropdownEmpty>
              ) : recent.length === 0 ? (
                <DropdownEmpty>{t('memoPopup.searchEmpty') as string}</DropdownEmpty>
              ) : (
                recent.map((m) => (
                  <DropdownItem
                    key={m.id}
                    $active={m.id === sessionId}
                    onClick={() => switchTo(m.id)}
                  >
                    <DropdownTitle>{m.title || 'Untitled'}</DropdownTitle>
                    <DropdownMeta>
                      {fmtDate(m.updated_at)}
                      {m.body && ` · ${deriveMemoPreview(m.body, 60)}`}
                    </DropdownMeta>
                  </DropdownItem>
                ))
              )}
            </Dropdown>
          )}
        </SearchWrap>
        <VisibilityBadge level="L1" compact />
        <HeaderBtn
          onClick={startNew}
          title={t('memoPopup.newMemo') as string}
          aria-label={t('memoPopup.newMemo') as string}
        >
          <IconPlus />
        </HeaderBtn>
        {!standalone && (
          <HeaderBtn
            onClick={detachToWindow}
            title={t('memoPopup.detach') as string}
            aria-label={t('memoPopup.detach') as string}
            disabled={!sessionId}
          >
            <IconDetach />
          </HeaderBtn>
        )}
        <HeaderBtn
          onClick={handleClose}
          title={t('memoPopup.close') as string}
          aria-label={t('memoPopup.close') as string}
        >
          <IconClose />
        </HeaderBtn>
      </Header>

      <StatusRow>
        <StatusDot $tone={saveState} />
        <span>
          {saveState === 'saving' && t('memoPopup.savingNow')}
          {saveState === 'saved' && timeAgo(t as any, savedAt)}
          {saveState === 'error' && t('memoPopup.errorRetry')}
          {saveState === 'idle' && !sessionId && (t('memoPopup.idleNew') as string)}
        </span>
      </StatusRow>

      <Body>
        <Suspense fallback={<EditorLoading>{t('memoPopup.searchLoading') as string}</EditorLoading>}>
          <PostEditor
            value={doc}
            onChange={(next) => { dirtyRef.current = true; setDoc(next); }}
            placeholder={t('memoPopup.bodyPlaceholder') as string}
            editable={!loading}
            businessId={businessId}
            borderless
            compact
          />
        </Suspense>
      </Body>

      {/* 8방향 리사이즈 핸들 — standalone (분리 창) 에선 hide (OS window 자체가 resize) */}
      {!standalone && (['n','s','e','w','nw','ne','sw','se'] as const).map((d) => (
        <ResizeEdge
          key={d}
          $dir={d}
          onMouseDown={startResize(d)}
          aria-label={t('memoPopup.resize') as string}
        />
      ))}
      {!standalone && <ResizeCornerHint><IconResize /></ResizeCornerHint>}
    </Container>,
    document.body
  );
};

export default MemoPopup;
