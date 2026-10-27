// 프로젝트 > 업무 — 검색·필터·묶기·정렬 한 줄 (2026-10-27, Fable 설계 PASS-WITH-CHANGES)
//
// Irene: «보기 방식이 멀티로 적용되어서 보기탭이 있어도 소팅기능이 필요해 … 검색이랑 기본 필터들도 없다».
// 상태는 TasksTab 이 쥔다 — 네 보기(기본·리스트·타임라인·캘린더)가 같은 걸러진 배열을 받는다.
// 껍데기는 Q sale·Q task 와 같은 공용 filterBar(36px 한 줄 · 폰은 [필터] 접기). 새로 그리지 않는다.
// 묶기·정렬만 프로젝트별로 이 브라우저에 기억한다(보는 사람 편의). 검색·필터는 기억하지 않는다.
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SearchBox from '../../components/Common/SearchBox';
import { FilterBar, FilterSlot, FilterSearchSlot, CheckFilter, axisOption, FilterCollapsible, FilterMoreToggle, FilterRight } from '../../components/Common/filterBar';
import { STATUS_CODES } from '../../utils/taskLabel';
import { textMatches, toPlainText } from '../../utils/searchMatch';

export type TaskSortKey = 'priority_order' | 'title' | 'status' | 'progress_percent' | 'due_date' | 'start_date' | 'created_at';
export type TaskSortDir = 'asc' | 'desc';
export type TaskGroupMode = 'workstream' | 'none';

export interface TaskFilterState {
  search: string; status: string; assignee: string; hideDone: boolean;
}
export const EMPTY_FILTER: TaskFilterState = { search: '', status: '', assignee: '', hideDone: false };
export const filterActiveCount = (f: TaskFilterState) =>
  (f.search.trim() ? 1 : 0) + (f.status ? 1 : 0) + (f.assignee ? 1 : 0) + (f.hideDone ? 1 : 0);

interface FilterableTask {
  title: string; description?: string | null; status: string; assignee_id: number | null;
}
/** 거르는 규칙 한 곳 — 검색은 제목 + 설명 글자(서식 태그 제외, 목록 설명 칸과 같은 toPlainText). */
export function applyTaskFilter<T extends FilterableTask>(rows: T[], f: TaskFilterState): T[] {
  const q = f.search.trim();
  return rows.filter((r) => {
    if (f.hideDone && (r.status === 'completed' || r.status === 'canceled')) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.assignee && String(r.assignee_id ?? '') !== f.assignee) return false;
    if (q && !textMatches(`${r.title} ${toPlainText(r.description)}`, q)) return false;
    return true;
  });
}

/** 정렬 규칙 한 곳 — 열 머리 클릭과 정렬 셀렉트가 같은 상태를 쓴다. 빈 값은 방향과 무관하게 맨 뒤. */
export function sortTaskRows<T>(rows: T[], key: TaskSortKey, dir: TaskSortDir): T[] {
  return [...rows].sort((a, b) => {
    const va = (a as Record<string, unknown>)[key];
    const vb = (b as Record<string, unknown>)[key];
    const aNull = va == null || va === '';
    const bNull = vb == null || vb === '';
    if (aNull && bNull) return 0;
    if (aNull) return 1;
    if (bNull) return -1;
    if (typeof va === 'string' && typeof vb === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return dir === 'asc' ? Number(va) - Number(vb) : Number(vb) - Number(va);
  });
}

// 정렬 셀렉트 항목 — 진행률은 열 머리로만(Fable). 최근 작성은 최신이 위.
const SORT_CHOICES: { key: TaskSortKey; dir: TaskSortDir }[] = [
  { key: 'start_date', dir: 'asc' }, { key: 'due_date', dir: 'asc' }, { key: 'status', dir: 'asc' },
  { key: 'title', dir: 'asc' }, { key: 'created_at', dir: 'desc' },
];
export const defaultSortDir = (k: TaskSortKey): TaskSortDir => SORT_CHOICES.find((c) => c.key === k)?.dir ?? 'asc';

/** 묶기·정렬 기억 — 프로젝트별, 이 브라우저만. 읽기 실패(사생활 창 등)면 기본값. */
const prefKey = (projectId: number) => `planq:projtasks:view:${projectId}`;
export function readViewPrefs(projectId: number): { group: TaskGroupMode; sortKey: TaskSortKey; sortDir: TaskSortDir } {
  const def = { group: 'workstream' as TaskGroupMode, sortKey: 'start_date' as TaskSortKey, sortDir: 'asc' as TaskSortDir };
  try {
    const v = JSON.parse(localStorage.getItem(prefKey(projectId)) || 'null');
    if (!v || typeof v !== 'object') return def;
    return {
      group: v.group === 'none' ? 'none' : 'workstream',
      sortKey: ['priority_order', 'title', 'status', 'progress_percent', 'due_date', 'start_date', 'created_at'].includes(v.sortKey) ? v.sortKey : def.sortKey,
      sortDir: v.sortDir === 'desc' ? 'desc' : 'asc',
    };
  } catch { return def; }
}
export function writeViewPrefs(projectId: number, v: { group: TaskGroupMode; sortKey: TaskSortKey; sortDir: TaskSortDir }) {
  try { localStorage.setItem(prefKey(projectId), JSON.stringify(v)); } catch { /* 저장 못 해도 화면은 그대로 */ }
}

type Props = {
  filter: TaskFilterState; onFilter: (f: TaskFilterState) => void;
  members: { user_id: number; name: string }[];
  /** 묶기 셀렉트 — 기본·리스트 보기에서만. 정렬 셀렉트 — 캘린더에서는 숨김. */
  showGroup: boolean; showSort: boolean;
  group: TaskGroupMode; onGroup: (g: TaskGroupMode) => void;
  sortKey: TaskSortKey; onSort: (k: TaskSortKey) => void;
  /** 오른쪽 끝 [+ 추진과제] — 목록 맨 위에 새 그룹(기본·리스트 + 묶기일 때만 넘긴다) */
  onAddGroupTop?: () => void;
};

const ProjectTaskFilters: React.FC<Props> = ({ filter, onFilter, members, showGroup, showSort, group, onGroup, sortKey, onSort, onAddGroupTop }) => {
  const { t } = useTranslation('qproject');
  const { t: tq } = useTranslation('qtask');
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<TaskFilterState>) => onFilter({ ...filter, ...patch });

  const statusOptions = useMemo(() => [
    axisOption(t('taskFilter.status', '상태') as string),
    ...STATUS_CODES.filter((k) => k !== 'task_requested').map((k) => ({ value: k, label: tq(`status.${k}.observer`, k) as string })),
  ], [t, tq]);
  const assigneeOptions = useMemo(() => [
    axisOption(t('taskFilter.assignee', '담당자') as string),
    ...members.map((m) => ({ value: String(m.user_id), label: m.name })),
  ], [t, members]);
  const groupOptions = [
    { value: 'workstream', label: t('taskFilter.groupByWs', '추진과제별') as string },
    { value: 'none', label: t('taskFilter.groupNone', '묶지 않음') as string },
  ];
  const sortOptions = SORT_CHOICES.map((c) => ({ value: c.key, label: t(`taskFilter.sort.${c.key}`) as string }));
  // 열 머리로 진행률을 고르면 셀렉트에는 그 이름을 보여 준다(목록에 없는 값이라 비어 보이지 않게)
  const sortValue = sortOptions.find((o) => o.value === sortKey)
    || { value: sortKey, label: t(`taskFilter.sort.${sortKey}`, t('taskFilter.sortLabel', '정렬')) as string };

  return (
    <FilterBar data-testid="project-task-filters" style={{ marginTop: 0 }}>
      <FilterSearchSlot data-testid="project-task-search">
        <SearchBox value={filter.search} onChange={(v: string) => set({ search: v })} width="100%"
          placeholder={t('taskFilter.searchPh', '업무 제목·설명 검색') as string}
          ariaLabel={t('taskFilter.searchPh', '업무 제목·설명 검색') as string} />
      </FilterSearchSlot>
      <FilterMoreToggle testId="project-task-filter-toggle" open={open} onToggle={() => setOpen((v) => !v)}
        activeCount={(filter.status ? 1 : 0) + (filter.assignee ? 1 : 0) + (filter.hideDone ? 1 : 0)}
        label={tq('filter.toggle', '필터') as string} />
      <FilterCollapsible $open={open}>
        <FilterSlot width={130} testId="project-task-status-filter">
          <PlanQSelect size="sm" isSearchable={false} options={statusOptions}
            aria-label={t('taskFilter.status', '상태') as string}
            value={statusOptions.find((o) => o.value === filter.status) || statusOptions[0]}
            onChange={(o: unknown) => set({ status: String((o as { value?: string } | null)?.value ?? '') })} />
        </FilterSlot>
        <FilterSlot width={140} testId="project-task-assignee-filter">
          <PlanQSelect size="sm" options={assigneeOptions}
            aria-label={t('taskFilter.assignee', '담당자') as string}
            value={assigneeOptions.find((o) => o.value === filter.assignee) || assigneeOptions[0]}
            onChange={(o: unknown) => set({ assignee: String((o as { value?: string } | null)?.value ?? '') })} />
        </FilterSlot>
        <CheckFilter>
          <input type="checkbox" checked={filter.hideDone} onChange={(e) => set({ hideDone: e.target.checked })} />
          {tq('filter.hideCompleted', '완료 가리기')}
        </CheckFilter>
        {showGroup && (
          <FilterSlot width={130} testId="project-task-group-mode">
            <PlanQSelect size="sm" isSearchable={false} options={groupOptions}
              aria-label={t('taskFilter.groupLabel', '묶기') as string}
              value={groupOptions.find((o) => o.value === group) || groupOptions[0]}
              onChange={(o: unknown) => onGroup(((o as { value?: string } | null)?.value === 'none') ? 'none' : 'workstream')} />
          </FilterSlot>
        )}
        {showSort && (
          <FilterSlot width={130} testId="project-task-sort">
            <PlanQSelect size="sm" isSearchable={false} options={sortOptions}
              aria-label={t('taskFilter.sortLabel', '정렬') as string}
              value={sortValue}
              onChange={(o: unknown) => { const v = (o as { value?: string } | null)?.value; if (v) onSort(v as TaskSortKey); }} />
          </FilterSlot>
        )}
      </FilterCollapsible>
      {onAddGroupTop && (
        <FilterRight>
          <AddGroupTopBtn type="button" data-testid="project-group-add-top" onClick={onAddGroupTop}
            title={t('taskFilter.addGroupTopHint', '목록 맨 위에 추진과제를 추가해요 (걸어 둔 검색·필터는 풀려요)') as string}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t('taskFilter.addGroupTop', '추진과제')}
          </AddGroupTopBtn>
        </FilterRight>
      )}
    </FilterBar>
  );
};

export default ProjectTaskFilters;

// 보조 버튼(Secondary 톤) — 36px 줄 높이 계약
const AddGroupTopBtn = styled.button`
  display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;flex-shrink:0;
  background:#FFF;color:#0F766E;border:1px solid #CBD5E1;border-radius:8px;
  font-family:inherit;font-size:0.75rem;font-weight:600;cursor:pointer;white-space:nowrap;
  &:hover{border-color:#14B8A6;background:#F0FDFA;}
`;
