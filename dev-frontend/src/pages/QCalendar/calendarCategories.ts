// 일정 분류 — 워크스페이스가 직접 추가·이름 바꾸기·삭제한다 (2026-11-27, docs/CALENDAR_CATEGORIES_DESIGN.md §8)
//   분류 목록을 화면 코드에 적지 않는다 — 서버 `/api/businesses/:id/calendar-categories` 가 정본이다.
//   라벨은 categoryLabel 한 규칙: 회사가 정한 이름 → 없으면 기본 분류 번역(qcalendar category.<code>).
//   권한: 추가 = 멤버 누구나 · 이름·색·켜고 끄기·순서·삭제 = 대표/관리자(서버 can_manage).
import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';

export interface CalendarCategoryRow {
  id: number;
  code: string | null;
  name: string | null;
  color: string | null;
  is_active: boolean;
  sort_order?: number;
  event_count?: number;
}
export type CalendarCategoryRef = Pick<CalendarCategoryRow, 'id' | 'code' | 'name' | 'color' | 'is_active'>;

/** 서버 스와치와 같은 10색(services/calendarCategories SWATCHES) */
export const CATEGORY_SWATCHES = ['#0D9488', '#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#475569'];
export const CATEGORY_NAME_MAX = 30;

export function categoryLabel(cat: Pick<CalendarCategoryRow, 'code' | 'name'> | null | undefined, t: TFunction, fallbackCode?: string | null): string {
  if (cat?.name) return cat.name;
  const code = cat?.code || fallbackCode || 'other';
  return t(`qcalendar:category.${code}`, { defaultValue: code }) as string;
}

export interface CallResult { ok: boolean; message?: string | null; data?: unknown }
async function call(url: string, init?: RequestInit): Promise<CallResult> {
  const r = await apiFetch(url, init);
  const j = await r.json().catch(() => null);
  return { ok: r.ok && !!j?.success, message: j?.message || null, data: j?.data };
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function useCalendarCategories(bizId: number | null | undefined, { manage = false } = {}) {
  const [categories, setCategories] = useState<CalendarCategoryRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const base = bizId ? `/api/businesses/${bizId}/calendar-categories` : null;
  const load = useCallback(async () => {
    if (!base) return;
    const r = await call(`${base}${manage ? '?include_inactive=1&with_usage=1' : ''}`);
    if (!r.ok) { setError(true); setLoaded(true); return; }
    const d = r.data as { categories: CalendarCategoryRow[]; can_manage: boolean };
    setError(false);
    setCategories(d.categories || []);
    setCanManage(!!d.can_manage);
    setLoaded(true);
  }, [base, manage]);
  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(load);
  useEffect(() => {
    if (!bizId) return undefined;
    const room = `business:${bizId}`;
    joinRoom(room);
    let timer: number | null = null;
    const off = onSocket('calendar_category:updated', () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void load(); }, 250);
    });
    return () => { if (timer) window.clearTimeout(timer); off(); leaveRoom(room); };
  }, [bizId, load]);

  const api = {
    create: (name: string, color?: string | null) => (base ? call(base, json('POST', { name, ...(color ? { color } : {}) })) : Promise.resolve({ ok: false } as CallResult)),
    update: (id: number, patch: { name?: string; color?: string | null; is_active?: boolean }) => (base ? call(`${base}/${id}`, json('PUT', patch)) : Promise.resolve({ ok: false } as CallResult)),
    reorder: (ids: number[]) => (bizId ? call(`/api/businesses/${bizId}/calendar-categories/order`, json('PUT', { ids })) : Promise.resolve({ ok: false } as CallResult)),
    remove: (id: number) => (base ? call(`${base}/${id}`, { method: 'DELETE' }) : Promise.resolve({ ok: false } as CallResult)),
  };
  return { categories, canManage, loaded, error, reload: load, api };
}
