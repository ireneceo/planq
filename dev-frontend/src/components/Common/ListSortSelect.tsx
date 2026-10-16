// 목록 정렬 선택 — 문서·Q info 목록이 **한 벌**을 쓴다 (2026-10-06).
//
// 왜 뺐나: 같은 셀렉트가 Q docs(프로젝트)·Q info·프로젝트>정보 세 곳에 베껴져 있었고,
//   "최근 순" 이 곳마다 다른 뜻이었다(수정일 / 작성일). 그래서 글을 고치면 목록 맨 위로 튀었다
//   (Irene: "수정될 때 리스트 순서가 바뀌니까 이상해. 기본은 작성일로").
//   → 기본은 **작성일 최신순**. 수정일 순은 사람이 고를 때만.
import React from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PlanQSelect, { type PlanQSelectOption } from './PlanQSelect';
import OverflowMenu from './OverflowMenu';

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

/**
 * variant
 *  · 'select'(기본) — 글자 셀렉트. 페이지 폭 툴바(프로젝트 문서 탭·Q info·프로젝트 정보)처럼 자리가 있는 곳.
 *  · 'icon' — 정렬 아이콘 하나, 누르면 목록(고른 것에 체크). 좁은 목록 칸(Q docs 좌측 300px)용 —
 *    셀렉트 128px 가 검색칸을 88px 로 눌러 안내문이 잘렸다(2026-10-16, Irene «검색란이 너무 작아»).
 *    기본(최신 작성순)이 아니면 버튼이 민트 테두리 + 점으로 «정렬 바뀜» 을 말한다. 규칙(sortRows)은 같다.
 */
const ListSortSelect: React.FC<{
  value: ListSortKey; onChange: (v: ListSortKey) => void;
  variant?: 'select' | 'icon'; 'data-testid'?: string;
}> = ({ value, onChange, variant = 'select', ...rest }) => {
  const { t } = useTranslation('common');
  const label = (k: ListSortKey) => t(`listSort.${k}`) as string;
  if (variant === 'icon') {
    const title = `${t('listSort.title')} · ${label(value)}`;
    return (
      <IconWrap>
        <OverflowMenu
          label={title}
          data-testid={rest['data-testid']}
          triggerActive={value !== LIST_SORT_DEFAULT}
          triggerIcon={(
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 4v16" /><path d="M3 8l4-4 4 4" /><path d="M17 20V4" /><path d="M13 16l4 4 4-4" />
            </svg>
          )}
          items={KEYS.map((k, i) => ({
            key: k, label: label(k), checked: k === value, testId: `list-sort-${k}`,
            groupLabel: i === 0 ? (t('listSort.title') as string) : undefined,
            onClick: () => onChange(k),
          }))}
        />
      </IconWrap>
    );
  }
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

// 한 줄 안 옆 버튼(휴지통 36 · 폰 40)과 같은 크기 — 메뉴 트리거 기본(폰 44)보다 작게 맞춘다
const IconWrap = styled.div`
  display: inline-flex; flex-shrink: 0;
  @media (max-width: 640px) { & button[aria-haspopup] { min-width: 40px; width: 40px; height: 40px; } }
`;

export default ListSortSelect;
