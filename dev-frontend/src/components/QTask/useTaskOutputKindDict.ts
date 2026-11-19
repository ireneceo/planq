// 업무 «산출물» 고를 목록 — 워크스페이스 사전 + 아직 행이 없는 기본 항목을 하나로 (docs/TASK_DELIVERABLES_DESIGN.md §6.1)
//   고객이면 부르지 않는다(사전·기본 목록 API 는 고객 403 — 치지도 않는다).
//   다른 창·사람이 사전을 바꾸면(소켓 task_output_kind:updated) 다시 읽는다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import type { OutputKindLite, OutputPresetLite } from './outputKindLabel';

export function useTaskOutputKindDict(bizId: number | null, enabled = true) {
  const [rows, setRows] = useState<OutputKindLite[]>([]);
  const [presets, setPresets] = useState<OutputPresetLite[]>([]);

  const reload = useCallback(async () => {
    if (!bizId || !enabled) { setRows([]); setPresets([]); return; }
    const [r1, r2] = await Promise.all([
      apiFetch(`/api/tasks/output-kinds?business_id=${bizId}`),
      apiFetch(`/api/tasks/output-kinds/presets?business_id=${bizId}`),
    ]);
    // apiFetch 는 throw 하지 않는다 — res.ok 를 본다. 실패면 고를 목록만 비고 화면은 산다.
    if (r1.ok) { const j = await r1.json().catch(() => null); if (j?.success) setRows(Array.isArray(j.data) ? j.data : []); }
    if (r2.ok) { const j = await r2.json().catch(() => null); if (j?.success) setPresets(Array.isArray(j.data) ? j.data : []); }
  }, [bizId, enabled]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!bizId || !enabled) return undefined;
    return onSocket<{ business_id?: number }>('task_output_kind:updated', (d) => {
      if (!d?.business_id || Number(d.business_id) === bizId) void reload();
    });
  }, [bizId, enabled, reload]);

  const add = useCallback((row: OutputKindLite) => {
    setRows((prev) => (prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? { ...r, ...row } : r)) : [...prev, row]));
  }, []);

  /** 행이 아직 없는 기본 항목(코드 순) */
  const pendingPresets = useMemo(() => {
    const have = new Set(rows.map((r) => r.preset_key).filter(Boolean));
    return presets.filter((p) => !have.has(p.key));
  }, [rows, presets]);

  /** 사전 행의 순서 — 기본(코드 순) → 직접 입력(이름순). 서버 정렬과 같다. */
  const orderedRows = useMemo(() => {
    const order = new Map(presets.map((p, i) => [p.key, i]));
    return [...rows].sort((a, b) => {
      const pa = a.preset_key != null ? order.get(a.preset_key) : undefined;
      const pb = b.preset_key != null ? order.get(b.preset_key) : undefined;
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [rows, presets]);

  return { rows: orderedRows, presets, pendingPresets, reload, add };
}
