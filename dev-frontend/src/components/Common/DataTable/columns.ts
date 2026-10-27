// 표 열 정의 한 벌 — 머리줄과 행이 **같은 배열**에서 순서·폭을 받는다 (2026-10-27, Fable 설계 판정 GO).
// Irene: «모든 표들 다 열을 좌우로 이동할 수 있어야 하는 거 아니야? … 제목이 잘려보이는게 제일 속터져.»
//
// ★ 왜 한 벌인가 — 머리 칸(Col)과 행 칸(TCell)에 폭·숨김 폭을 손으로 두 번 적었더니 세 번 갈라졌다
//   (#249 · 2026-09-08 · 2026-10-14). 폭은 cellStyle() 한 함수에서만 나온다. styled 에 폭 prop 을 되살리지 말 것.
import type { CSSProperties } from 'react';

export type ColumnDef<K extends string> = {
  key: K;
  labelKey: string;
  defaultValue: string;
  /** 고정 열 기본 폭(px). flex 열이면 무시 */
  width: number;
  minWidth: number;
  maxWidth: number;
  /** 남는 폭을 나눠 갖는 열(업무·설명·간트). 값 = flex-grow. 손잡이 없음 */
  flex?: number;
  /** false = 숨길 수 없다(업무 칸) */
  hideable: boolean;
  /** 목록 폭이 모자랄 때 먼저 빠지는 순서(작을수록 먼저). 없으면 자동으로 빠지지 않는다 */
  dropOrder?: number;
  /** 빠지기 전에 먼저 줄어드는 폭(진행 46처럼) */
  compactWidth?: number;
  /** 폰(≤640) 카드형 행에서 숨는 열 — 저장값과 무관 */
  phoneHide?: boolean;
};

export type TablePrefs<K extends string> = { v: 1; order: K[]; widths: Partial<Record<K, number>>; hidden: K[] };

/** 저장 위치 어댑터 — 훅은 저장 위치를 모른다(기기별/계정별을 바꿀 때 이것만 바꾼다) */
export interface TablePrefsStore {
  load(tableId: string): unknown;
  save(tableId: string, prefs: TablePrefs<string> | null): void;
}

// 기기별(이 브라우저) 저장. 개인 화면 설정이라 실패해도 기본 배치로 그린다.
export const localTablePrefsStore: TablePrefsStore = {
  load(tableId) {
    try { const raw = localStorage.getItem(`pq_table_${tableId}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
  },
  save(tableId, prefs) {
    try {
      if (prefs) localStorage.setItem(`pq_table_${tableId}`, JSON.stringify(prefs));
      else localStorage.removeItem(`pq_table_${tableId}`);
    } catch { /* 저장소 막힘 — 이번 화면에서만 유지 */ }
  },
};

export function defaultPrefs<K extends string>(defs: ColumnDef<K>[]): TablePrefs<K> {
  return { v: 1, order: defs.map(d => d.key), widths: {}, hidden: [] };
}

/** 읽은 값은 믿지 않는다 — 모르는 키는 버리고, 새 열은 기본 자리에 끼우고, 폭은 범위 안으로 자른다. 깨졌으면 기본. */
export function normalizeTablePrefs<K extends string>(defs: ColumnDef<K>[], raw: unknown): TablePrefs<K> {
  const base = defaultPrefs(defs);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as { order?: unknown; widths?: unknown; hidden?: unknown };
  const byKey = new Map(defs.map(d => [d.key as string, d]));
  const order: K[] = [];
  if (Array.isArray(r.order)) {
    for (const k of r.order) if (typeof k === 'string' && byKey.has(k) && !order.includes(k as K)) order.push(k as K);
  }
  // 저장 뒤에 새로 생긴 열 — 기본 순서에서 바로 앞 열 뒤에 끼운다
  defs.forEach((d, i) => {
    if (order.includes(d.key)) return;
    const prev = defs.slice(0, i).reverse().find(p => order.includes(p.key));
    const at = prev ? order.indexOf(prev.key) + 1 : 0;
    order.splice(at, 0, d.key);
  });
  const widths: Partial<Record<K, number>> = {};
  if (r.widths && typeof r.widths === 'object') {
    for (const [k, v] of Object.entries(r.widths as Record<string, unknown>)) {
      const d = byKey.get(k);
      if (!d || d.flex || typeof v !== 'number' || !Number.isFinite(v)) continue;
      widths[k as K] = Math.round(Math.min(d.maxWidth, Math.max(d.minWidth, v)));
    }
  }
  const hidden: K[] = [];
  if (Array.isArray(r.hidden)) {
    for (const k of r.hidden) {
      const d = typeof k === 'string' ? byKey.get(k) : undefined;
      if (d && d.hideable && !hidden.includes(d.key)) hidden.push(d.key);
    }
  }
  return { v: 1, order, widths, hidden };
}

export type ResolvedColumn<K extends string> = ColumnDef<K> & { effWidth: number; compact: boolean };

/** 머리 칸·행 칸이 폭을 받는 **유일한** 함수 */
export function cellStyle<K extends string>(col: ResolvedColumn<K>, opts: { phone: boolean; titleMinW?: number }): CSSProperties {
  if (col.flex) {
    const min = opts.phone ? 0 : (col.hideable ? col.minWidth : (opts.titleMinW ?? col.minWidth));
    return { flex: `${col.flex} 1 0`, minWidth: min };
  }
  return { flex: `0 0 ${col.effWidth}px`, width: col.effWidth };
}
