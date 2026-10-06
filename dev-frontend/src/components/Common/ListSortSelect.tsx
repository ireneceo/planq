// 목록 정렬 선택 — 문서·Q info 목록이 **한 벌**을 쓴다 (2026-10-06).
//
// 왜 뺐나: 같은 셀렉트가 Q docs(프로젝트)·Q info·프로젝트>정보 세 곳에 베껴져 있었고,
//   "최근 순" 이 곳마다 다른 뜻이었다(수정일 / 작성일). 그래서 글을 고치면 목록 맨 위로 튀었다
//   (Irene: "수정될 때 리스트 순서가 바뀌니까 이상해. 기본은 작성일로").
//   → 기본은 **작성일 최신순**. 수정일 순은 사람이 고를 때만.
import React from 'react';
import { useTranslation } from 'react-i18next';
import PlanQSelect, { type PlanQSelectOption } from './PlanQSelect';

export type ListSortKey = 'newest' | 'oldest' | 'updated' | 'name';
export const LIST_SORT_DEFAULT: ListSortKey = 'newest';
const KEYS: ListSortKey[] = ['newest', 'oldest', 'updated', 'name'];

interface Row { title?: string | null; created_at?: string | null; updated_at?: string | null }

const ts = (s?: string | null) => (s ? new Date(s).getTime() || 0 : 0);

/** 정렬 규칙 단일 원천. 같은 시각이면 원래 순서를 유지한다(Array.sort 는 안정 정렬). */
export function sortRows<T extends Row>(rows: T[], key: ListSortKey): T[] {
  const arr = [...rows];
  if (key === 'name') arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  else if (key === 'oldest') arr.sort((a, b) => ts(a.created_at) - ts(b.created_at));
  else if (key === 'updated') arr.sort((a, b) => ts(b.updated_at || b.created_at) - ts(a.updated_at || a.created_at));
  else arr.sort((a, b) => ts(b.created_at) - ts(a.created_at));
  return arr;
}

const ListSortSelect: React.FC<{ value: ListSortKey; onChange: (v: ListSortKey) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation('common');
  const label = (k: ListSortKey) => t(`listSort.${k}`) as string;
  return (
    <PlanQSelect
      size="sm" isSearchable={false}
      value={{ value, label: label(value) }}
      onChange={(opt) => {
        const v = (opt as PlanQSelectOption | null)?.value as ListSortKey | undefined;
        if (v && KEYS.includes(v)) onChange(v);
      }}
      options={KEYS.map((k) => ({ value: k, label: label(k) }))}
    />
  );
};

export default ListSortSelect;
