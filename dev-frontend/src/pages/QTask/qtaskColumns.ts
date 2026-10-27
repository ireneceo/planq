// Q task 목록 열 정의 — 머리줄·행이 이 배열 하나로 순서·폭을 받는다(hooks/useTableColumns).
// 기본 폭·자동으로 빠지는 순서는 옛 `$w`/`$hideBelow` 값 그대로(진행 → 실제 → 예상 → 담당자 순으로 빠진다).
import type { CSSProperties } from 'react';
import type { ColumnDef } from '../../components/Common/DataTable/columns';

export type QtColKey = 'prio' | 'project' | 'title' | 'assignee' | 'status' | 'est' | 'act' | 'progress' | 'dates';

export function qtaskColumnDefs(showFocusCol: boolean): ColumnDef<QtColKey>[] {
  const statusW = showFocusCol ? 112 : 68;
  return [
    { key: 'prio', labelKey: 'qtask:col.priority', defaultValue: '우선순위', width: 30, minWidth: 30, maxWidth: 30, hideable: true },
    { key: 'project', labelKey: 'qtask:col.project', defaultValue: '프로젝트', width: 64, minWidth: 44, maxWidth: 240, hideable: true, phoneHide: true },
    { key: 'title', labelKey: 'qtask:col.task', defaultValue: '업무', width: 0, minWidth: 240, maxWidth: 0, flex: 1, hideable: false },
    { key: 'assignee', labelKey: 'qtask:col.assignee', defaultValue: '담당자', width: 90, minWidth: 64, maxWidth: 200, hideable: true, dropOrder: 4, phoneHide: true },
    // 지금 작업중 버튼이 붙으면 그 폭만큼 바닥을 올린다(저장 폭이 작아도 버튼이 잘리지 않게)
    { key: 'status', labelKey: 'qtask:col.status', defaultValue: '상태', width: statusW, minWidth: statusW - 8, maxWidth: 200, hideable: true, phoneHide: true },
    { key: 'est', labelKey: 'qtask:col.est', defaultValue: '예측(h)', width: 62, minWidth: 48, maxWidth: 120, hideable: true, dropOrder: 3, phoneHide: true },
    { key: 'act', labelKey: 'qtask:col.act', defaultValue: '실제(h)', width: 62, minWidth: 48, maxWidth: 120, hideable: true, dropOrder: 2, phoneHide: true },
    { key: 'progress', labelKey: 'qtask:col.progress', defaultValue: '진행율', width: 96, minWidth: 46, maxWidth: 220, hideable: true, dropOrder: 1, compactWidth: 46, phoneHide: true },
    { key: 'dates', labelKey: 'qtask:col.dates', defaultValue: '기간', width: 100, minWidth: 80, maxWidth: 200, hideable: true, phoneHide: true },
  ];
}

/** 머리 칸 클릭 정렬 키(옛 그대로 — 프로젝트 머리는 제목순이었다) */
export const QT_SORT: Partial<Record<QtColKey, string>> = {
  prio: 'priority_order', project: 'title', title: 'title', status: 'status',
  est: 'estimated_hours', act: 'actual_hours', progress: 'progress_percent', dates: 'due_date',
};
/** 정렬 화살표를 보이는 머리(프로젝트 머리는 옛날부터 화살표가 없었다) */
export const QT_SORT_ICON = new Set<QtColKey>(['prio', 'title', 'status', 'est', 'act', 'progress', 'dates']);
/** 행 칸 가운데 정렬 */
export const QT_CENTER = new Set<QtColKey>(['prio', 'status', 'est', 'act', 'dates']);
/** 행 칸 덧붙임 — 칸 밖으로 뜨는 셀렉트·드롭다운 */
export const QT_CELL_STYLE: Partial<Record<QtColKey, CSSProperties>> = {
  assignee: { overflow: 'visible' },
  status: { position: 'relative', overflow: 'visible', gap: 2 },
};
