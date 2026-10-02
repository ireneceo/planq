// useWorkspaceHolidays — 워크스페이스 휴일(쉬는 날만)을 날짜 키로 (#424 Q3 후속 — 캘린더 표시)
//
// ★ 휴일의 정본은 서버 `workspace_holidays`(설정 › 근태 관리) 하나다. 화면은 읽기만 한다.
//   꺼 둔 공휴일(is_off=false)은 쉬는 날이 아니므로 표시하지 않는다.
// ★ 고객(client)은 이 라우트가 403 이라 빈 맵으로 둔다(캘린더는 그대로 보인다).
// 휴일 설정이 바뀌면(holiday:updated) 새로고침 없이 다시 읽는다(CLAUDE.md §16).
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../services/socket';

export interface HolidayMark { name: string; name_en: string | null }

export function useWorkspaceHolidays(businessId: number | null, years: number[]): Record<string, HolidayMark> {
  const [map, setMap] = useState<Record<string, HolidayMark>>({});
  const key = [...new Set(years)].sort().join(',');
  const load = useCallback(async () => {
    if (!businessId || !key) { setMap({}); return; }
    const next: Record<string, HolidayMark> = {};
    for (const y of key.split(',')) {
      const r = await apiFetch(`/api/businesses/${businessId}/holidays?year=${y}`);
      if (!r.ok) continue;                         // apiFetch 는 throw 하지 않는다 — 실패하면 표시만 빠진다
      const j = await r.json().catch(() => null);
      for (const h of (j?.data?.holidays || []) as Array<{ date: string; name: string; name_en: string | null; is_off: boolean }>) {
        if (h.is_off) next[h.date] = { name: h.name, name_en: h.name_en };
      }
    }
    setMap(next);
  }, [businessId, key]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!businessId) return undefined;
    const room = `business:${businessId}`;
    joinRoom(room);
    const off = onSocket('holiday:updated', () => { void load(); });
    return () => { off(); leaveRoom(room); };
  }, [businessId, load]);
  return map;
}
