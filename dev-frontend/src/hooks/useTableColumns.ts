// 표 열 순서·폭·숨김 — 머리 칸 끌어 좌우 이동 · 경계 손잡이로 폭 · 목록 폭이 모자라면 정해진 순서로 자동으로 빠짐.
// 설계: Fable 2026-10-27 판정 GO (`.claude/plans/qmvqb86r2.md` 2단계 · docs/FABLE_GATE_QUEUE.md).
//
// ★ 숨김 기준은 **화면 폭이 아니라 목록 폭**이다 — 옛 `$hideBelow`(미디어쿼리)는 우측 패널이 열려 목록이 좁아져도
//   몰라서 제목 칸이 바닥까지 눌렸다(1440 + 패널 420). ResizeObserver 로 실제 목록 폭을 잰다.
// ★ 끌기는 HTML5 draggable 이 아니라 pointer 이벤트 — iPad 에서 draggable 이면 click 이 안 나간다(TabStrip 10-22 사고),
//   머리 칸 클릭(정렬)과도 갈라야 한다. 5px 넘게 움직여야 끌기, 그 뒤 click 은 삼킨다. 손가락 끌기는 하지 않는다(세로 스크롤).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  normalizeTablePrefs, defaultPrefs,
  type ColumnDef, type ResolvedColumn, type TablePrefs, type TablePrefsStore,
} from '../components/Common/DataTable/columns';

const PHONE_MQ = '(max-width: 640px)';
const DRAG_START_PX = 5;
const KEY_STEP_PX = 8;

type Opts<K extends string> = {
  /** 업무 칸 최소폭(전체 업무 180 / 그 외 240) */
  titleMinW: number;
  /** 행 좌우 padding 합 · 칸 사이 gap — 자동 빠짐 계산에 쓴다 */
  padX: number;
  gap: number;
  /** 조건부 열(주간·오늘 탭의 #, 전체 업무의 담당자) */
  active?: (key: K) => boolean;
  store: TablePrefsStore;
};

function readPhone() {
  try { return window.matchMedia(PHONE_MQ).matches; } catch { return false; }
}

export function useTableColumns<K extends string>(tableId: string, defs: ColumnDef<K>[], opts: Opts<K>) {
  const { titleMinW, padX, gap, active, store } = opts;
  const [prefs, setPrefs] = useState<TablePrefs<K>>(() => normalizeTablePrefs(defs, store.load(tableId)));
  const [phone, setPhone] = useState(readPhone);
  const [boxW, setBoxW] = useState(0);
  const [drag, setDrag] = useState<{ key: K; overKey: K | null; side: 'before' | 'after' } | null>(null);
  const suppressClick = useRef(false);

  // 저장 — 기본과 같으면 지운다(새 기본값이 나중에 바뀌어도 따라가게).
  //   폭 손잡이를 끄는 동안 값이 계속 바뀌므로 손을 뗀 뒤 300ms 에 한 번만 보낸다(계정별 저장은 서버 왕복이다).
  const firstSave = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (firstSave.current) { firstSave.current = false; return; }
    const d = defaultPrefs(defs);
    const same = JSON.stringify(d.order) === JSON.stringify(prefs.order) && !prefs.hidden.length && !Object.keys(prefs.widths).length;
    const id = tableId;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; store.save(id, same ? null : prefs); }, 300);
  }, [prefs]); // eslint-disable-line react-hooks/exhaustive-deps
  // 화면을 떠나도 마지막 바꾼 값은 보낸다
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current); saveTimer.current = null;
    const d = defaultPrefs(defs);
    const same = JSON.stringify(d.order) === JSON.stringify(prefs.order) && !prefs.hidden.length && !Object.keys(prefs.widths).length;
    store.save(tableId, same ? null : prefs);
  };
  useEffect(() => () => flushRef.current(), []);

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia(PHONE_MQ); } catch { return; }
    const on = () => setPhone(mq!.matches);
    mq.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);

  // 목록 상자 — 콜백 ref 라 늦게 그려지는 표(보기 전환)도 잰다
  const [box, setBox] = useState<HTMLElement | null>(null);
  const containerRef = useCallback((el: HTMLElement | null) => setBox(el), []);
  useLayoutEffect(() => {
    const el = box;
    if (!el) return;
    setBoxW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [box]);

  // 표 id 가 바뀌면(보기 전환 등) 그 표의 저장값으로 갈아 끼운다
  const loadedId = useRef(tableId);
  useEffect(() => {
    if (loadedId.current === tableId) return;
    flushRef.current();
    loadedId.current = tableId;
    firstSave.current = true;
    setPrefs(normalizeTablePrefs(defs, store.load(tableId)));
  }, [tableId]); // eslint-disable-line react-hooks/exhaustive-deps

  const defByKey = useMemo(() => new Map(defs.map(d => [d.key, d])), [defs]);

  const { columns, autoHidden } = useMemo(() => {
    const isOn = (k: K) => (active ? active(k) : true);
    // 폰은 카드형 행 — 저장한 순서·폭을 쓰지 않는다
    if (phone) {
      const cols = defs.filter(d => isOn(d.key) && !d.phoneHide).map(d => ({ ...d, effWidth: d.width, compact: false }));
      return { columns: cols as ResolvedColumn<K>[], autoHidden: [] as K[] };
    }
    let cols: ResolvedColumn<K>[] = prefs.order
      .map(k => defByKey.get(k)!)
      .filter(d => d && isOn(d.key) && !prefs.hidden.includes(d.key))
      .map(d => ({ ...d, effWidth: Math.min(d.maxWidth || Infinity, Math.max(d.minWidth, prefs.widths[d.key] ?? d.width)), compact: false }));
    const dropped: K[] = [];
    if (boxW > 0) {
      const need = (cs: ResolvedColumn<K>[]) => padX + gap * Math.max(0, cs.length - 1)
        + cs.reduce((s, c) => s + (c.flex ? (c.hideable ? c.minWidth : titleMinW) : c.effWidth), 0);
      if (need(cols) > boxW) cols = cols.map(c => (c.compactWidth ? { ...c, effWidth: c.compactWidth, compact: true } : c));
      const order = cols.filter(c => c.dropOrder != null).sort((a, b) => a.dropOrder! - b.dropOrder!);
      for (const c of order) {
        if (need(cols) <= boxW) break;
        cols = cols.filter(x => x.key !== c.key);
        dropped.push(c.key);
      }
    }
    return { columns: cols, autoHidden: dropped };
  }, [phone, defs, defByKey, prefs, active, boxW, padX, gap, titleMinW]);

  const move = useCallback((key: K, toIndex: number) => {
    setPrefs(p => {
      const order = p.order.filter(k => k !== key);
      order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, key);
      return { ...p, order };
    });
  }, []);
  /** 보이는 열 기준으로 한 칸 왼쪽/오른쪽 */
  const step = useCallback((key: K, dir: -1 | 1) => {
    const vis = columns.map(c => c.key);
    const i = vis.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= vis.length) return;
    setPrefs(p => {
      const order = p.order.filter(k => k !== key);
      const anchor = vis[j];
      const at = order.indexOf(anchor) + (dir > 0 ? 1 : 0);
      order.splice(at, 0, key);
      return { ...p, order };
    });
  }, [columns]);
  const setWidth = useCallback((key: K, px: number) => {
    const d = defByKey.get(key);
    if (!d || d.flex) return;
    const w = Math.round(Math.min(d.maxWidth, Math.max(d.minWidth, px)));
    setPrefs(p => {
      const widths = { ...p.widths };
      if (w === d.width) delete widths[key]; else widths[key] = w;
      return { ...p, widths };
    });
  }, [defByKey]);
  const toggleHidden = useCallback((key: K) => {
    const d = defByKey.get(key);
    if (!d?.hideable) return;
    setPrefs(p => ({ ...p, hidden: p.hidden.includes(key) ? p.hidden.filter(k => k !== key) : [...p.hidden, key] }));
  }, [defByKey]);
  const reset = useCallback(() => setPrefs(defaultPrefs(defs)), [defs]);
  const isCustomized = prefs.hidden.length > 0 || Object.keys(prefs.widths).length > 0
    || prefs.order.join() !== defs.map(d => d.key).join();

  // ─── 머리 칸 끌기 ───
  const dragRef = useRef<{ key: K; x0: number; started: boolean; row: HTMLElement } | null>(null);
  const targetOf = (row: HTMLElement, x: number, key: K) => {
    const cells = Array.from(row.querySelectorAll<HTMLElement>('[data-col-key]'));
    let over: K | null = null; let side: 'before' | 'after' = 'before';
    for (const el of cells) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right) { over = el.dataset.colKey as K; side = x < r.left + r.width / 2 ? 'before' : 'after'; break; }
    }
    if (!over && cells.length) {
      const first = cells[0].getBoundingClientRect();
      if (x < first.left) { over = cells[0].dataset.colKey as K; side = 'before'; }
      else { over = cells[cells.length - 1].dataset.colKey as K; side = 'after'; }
    }
    return over === key ? null : { over, side };
  };
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.started) {
        if (Math.abs(e.clientX - d.x0) < DRAG_START_PX) return;
        d.started = true;
        document.body.style.cursor = 'grabbing';
      }
      const t = targetOf(d.row, e.clientX, d.key);
      setDrag({ key: d.key, overKey: t?.over ?? null, side: t?.side ?? 'before' });
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.started) {
        document.body.style.cursor = '';
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
        const t = targetOf(d.row, e.clientX, d.key);
        if (t?.over) {
          setPrefs(p => {
            const order = p.order.filter(k => k !== d.key);
            const at = order.indexOf(t.over as K) + (t.side === 'after' ? 1 : 0);
            order.splice(at, 0, d.key);
            return { ...p, order };
          });
        }
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  /** 머리 칸에 펼쳐 넣는 속성 — 폭(style)·끌기·Alt+←/→ */
  const headerProps = (key: K, cell: React.CSSProperties) => {
    const style: React.CSSProperties = { ...cell, position: 'relative' };
    const over = drag && drag.overKey === key;
    return {
      'data-col-key': key,
      style: over
        ? { ...style, boxShadow: drag!.side === 'before' ? 'inset 2px 0 0 #14B8A6' : 'inset -2px 0 0 #14B8A6' }
        : (drag && drag.key === key ? { ...style, opacity: 0.45 } : style),
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (phone || e.button !== 0 || e.pointerType === 'touch') return;
        if ((e.target as HTMLElement).closest('[data-col-resize]')) return;
        const row = e.currentTarget.parentElement;
        if (!row) return;
        dragRef.current = { key, x0: e.clientX, started: false, row };
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); }
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (!e.altKey) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(key, -1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); step(key, 1); }
      },
    };
  };

  // 손잡이 끌기 시작점 — 끄는 동안 폭이 바뀌어 다시 그려져도 남아야 하므로 ref
  const resizeRef = useRef<{ key: K; x: number; w: number } | null>(null);
  /** 고정 열 오른쪽 끝 폭 손잡이 — 손가락도 된다(pointer capture) */
  const resizeProps = (key: K, label: string) => {
    const d = defByKey.get(key)!;
    const cur = columns.find(c => c.key === key)?.effWidth ?? d.width;
    return {
      'data-col-resize': key,
      role: 'separator',
      'aria-orientation': 'vertical' as const,
      'aria-label': label,
      'aria-valuenow': cur,
      'aria-valuemin': d.minWidth,
      'aria-valuemax': d.maxWidth,
      tabIndex: 0,
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        e.stopPropagation(); e.preventDefault();
        resizeRef.current = { key, x: e.clientX, w: cur };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 캡처 못 해도 이동은 받는다 */ }
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        const s = resizeRef.current;
        if (!s || s.key !== key) return;
        setWidth(key, s.w + (e.clientX - s.x));
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        resizeRef.current = null;
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 이미 풀림 */ }
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
      onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); setWidth(key, d.width); },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(key, cur - KEY_STEP_PX); }
        if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(key, cur + KEY_STEP_PX); }
        if (e.key === 'Home') { e.preventDefault(); setWidth(key, d.width); }
      },
    };
  };

  return { containerRef, columns, autoHidden, phone, prefs, defs, move, step, setWidth, toggleHidden, reset, isCustomized, headerProps, resizeProps, isActive: (k: K) => (active ? active(k) : true) };
}

export type TableColumnsApi<K extends string> = ReturnType<typeof useTableColumns<K>>;
