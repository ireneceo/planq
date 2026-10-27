// 프로젝트 업무 목록 열 정의 — Q task 목록과 같은 훅(hooks/useTableColumns)·같은 cellStyle().
// 기본 폭은 옛 `$w` 그대로(타임라인을 같이 펴면 좁은 값). 자동으로 빠지는 순서: 설명 → 진행률 → 담당자.
import type { CSSProperties } from 'react';
import type { ColumnDef } from '../../components/Common/DataTable/columns';

export type PtColKey = 'title' | 'assignee' | 'status' | 'progress' | 'dates' | 'desc' | 'gantt';

export function projectTaskColumnDefs(showTimeline: boolean): ColumnDef<PtColKey>[] {
  const tl = showTimeline;
  return [
    { key: 'title', labelKey: 'qtask:col.task', defaultValue: '업무', width: 0, minWidth: 240, maxWidth: 0, flex: 2, hideable: false },
    { key: 'assignee', labelKey: 'qtask:col.assignee', defaultValue: '담당자', width: tl ? 90 : 150, minWidth: 64, maxWidth: 240, hideable: true, dropOrder: 3, phoneHide: true },
    { key: 'status', labelKey: 'qtask:col.status', defaultValue: '상태', width: tl ? 60 : 100, minWidth: 56, maxWidth: 200, hideable: true, phoneHide: true },
    { key: 'progress', labelKey: 'qtask:col.progressPercent', defaultValue: '진행률', width: tl ? 110 : 180, minWidth: 60, maxWidth: 260, hideable: true, dropOrder: 2, phoneHide: true },
    { key: 'dates', labelKey: 'qtask:col.dates', defaultValue: '기간', width: 100, minWidth: 80, maxWidth: 200, hideable: true, phoneHide: true },
    // 타임라인을 펴면 설명 대신 간트가 선다(둘 중 하나만 active)
    { key: 'desc', labelKey: 'qtask:col.desc', defaultValue: '설명', width: 0, minWidth: 100, maxWidth: 0, flex: 1, hideable: true, dropOrder: 1, phoneHide: true },
    { key: 'gantt', labelKey: 'qtask:col.timeline', defaultValue: '타임라인', width: 0, minWidth: 240, maxWidth: 0, flex: 2, hideable: false, phoneHide: true },
  ];
}

export const PT_SORT: Partial<Record<PtColKey, string>> = { title: 'title', status: 'status', progress: 'progress_percent', dates: 'start_date' };
export const PT_CENTER = new Set<PtColKey>(['assignee', 'status', 'progress', 'dates']);
/** 설명 칸 padding 은 머리·행 둘 다 — border-box 에서 flex-basis:0 항목의 패딩이 남는 폭 배분을 바꾼다(11px 밀림 실측) */
export const PT_CELL_STYLE: Partial<Record<PtColKey, CSSProperties>> = {
  assignee: { position: 'relative', overflow: 'visible' },
  status: { position: 'relative', overflow: 'visible' },
  desc: { padding: '0 8px' },
  gantt: { overflow: 'visible' },
};
