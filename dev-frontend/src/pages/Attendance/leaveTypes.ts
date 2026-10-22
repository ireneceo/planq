// 휴가 종류 — 워크스페이스가 직접 관리한다(2026-10-22, docs/LEAVE_TYPES_DESIGN.md §6.4).
//   종류 목록을 화면 코드에 적지 않는다 — 서버 `/api/businesses/:id/leave-types` 가 정본이다.
//   라벨은 labelOf 한 규칙: 회사가 정한 이름 → 없으면 기본 종류의 번역(leave.category.<code>).
//   ★ 유급/무급은 종류가 정한다(신청자가 고르지 않는다). 신청 행의 leave_type 은 신청 시점 박제다.
import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';

export interface LeaveTypeRow {
  id: number; code: string | null; name: string | null; pay: 'paid' | 'unpaid';
  default_days: number | null; is_active: boolean; sort_order: number; in_use?: boolean;
}
export type LeaveTypeBrief = Pick<LeaveTypeRow, 'id' | 'code' | 'name' | 'pay'>;

export function labelOf(type: Pick<LeaveTypeRow, 'code' | 'name'> | null | undefined, t: TFunction): string {
  if (!type) return '';
  if (type.name) return type.name;
  return type.code ? (t(`attendance:leave.category.${type.code}`, { defaultValue: type.code }) as string) : '';
}

export function useLeaveTypes(bizId: number | null | undefined, { includeInactive = false } = {}) {
  const [types, setTypes] = useState<LeaveTypeRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    if (!bizId) return;
    const r = await apiFetch(`/api/businesses/${bizId}/leave-types${includeInactive ? '?include_inactive=1' : ''}`);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) { setError(true); setLoaded(true); return; }
    setError(false);
    setTypes(j.data.types || []);
    setCanEdit(!!j.data.can_edit);
    setLoaded(true);
  }, [bizId, includeInactive]);
  useEffect(() => { void load(); }, [load]);
  useVisibilityRefresh(load);
  useEffect(() => {
    if (!bizId) return undefined;
    const room = `business:${bizId}`;
    joinRoom(room);
    let timer: number | null = null;
    const off = onSocket('leave_type:updated', () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void load(); }, 250);
    });
    return () => { if (timer) window.clearTimeout(timer); off(); leaveRoom(room); };
  }, [bizId, load]);
  return { types, canEdit, loaded, error, reload: load };
}
