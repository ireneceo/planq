// 업무 상세 «추진과제» 칸 (2026-10-27, Fable 설계 PASS-WITH-CHANGES)
//
// Irene: «추진과제(그룹)이 업무상세에 없는 것도 이상한데 … 프로젝트 다음에 나와야 하지 않을까? … 수정이 되게».
// - 자리: 프로젝트 칸 바로 다음. 프로젝트가 없거나 그 프로젝트에 그룹이 0개면 칸 자체를 그리지 않는다(빈 셀렉트 금지).
// - 권한: 목록의 그룹 이동과 같은 서버 판정(FIELD_RULES.workstream_id = 담당자·작성자·관리자 — project_id 와 같은 집합).
// - 저장: 같은 PUT(workstream_id). 같은 프로젝트 그룹만 서버가 받는다 · null = 빼기.
// 그룹 목록은 프로젝트 업무 탭·캔버스와 같은 정본(project_workstreams, listWorkstreams).
import React, { useEffect, useState } from 'react';
import PlanQSelect from '../Common/PlanQSelect';
import { listWorkstreams, wsColor, type Workstream } from '../../services/projectCanvas';

/** 이 프로젝트의 추진과제 — 순서대로. 프로젝트가 바뀌면 다시 읽는다. */
export function useProjectWorkstreams(projectId: number | null | undefined): Workstream[] {
  const [rows, setRows] = useState<Workstream[]>([]);
  useEffect(() => {
    if (!projectId) { setRows([]); return; }
    let cancelled = false;
    listWorkstreams(projectId)
      .then((ws) => { if (!cancelled) setRows([...ws].sort((a, b) => a.order_index - b.order_index)); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [projectId]);
  return rows;
}

const Dot: React.FC<{ color: string }> = ({ color }) => (
  <span aria-hidden style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
);

const TaskWorkstreamSelect: React.FC<{
  workstreams: Workstream[];
  value: number | null | undefined;
  disabled: boolean;
  noneLabel: string;
  onChange: (id: number | null) => void;
}> = ({ workstreams, value, disabled, noneLabel, onChange }) => {
  const options = [
    ...workstreams.map((w, i) => ({ value: String(w.id), label: w.title, icon: <Dot color={wsColor(w, i)} /> })),
    { value: '', label: noneLabel, icon: <Dot color="#CBD5E1" /> },
  ];
  const cur = value == null ? null : options.find((o) => o.value === String(value)) || null;
  return (
    <PlanQSelect size="sm" variant="inline" isSearchable={workstreams.length > 8}
      isDisabled={disabled}
      placeholder={noneLabel}
      value={cur}
      onChange={(v) => {
        const raw = (v as { value?: string } | null)?.value;
        onChange(raw ? Number(raw) : null);
      }}
      options={options} />
  );
};

export default TaskWorkstreamSelect;
