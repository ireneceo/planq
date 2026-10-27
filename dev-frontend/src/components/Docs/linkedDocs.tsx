// 프로젝트 문서 탭의 «연결됨» — 다른 프로젝트 소속인데 이 프로젝트에 «연결» 한 문서 (2026-10-27, docs/PROJECT_REFS_DESIGN.md)
//   거르기(좌측 분류 «연결됨» 칸)와 행 표시 «연결됨 · 소속 프로젝트» 를 여기 한 곳에 둔다(목록 행·카드가 같이 쓴다).
import React from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

export type RefFilter = 'all' | 'home' | 'linked';

export function applyRefFilter<T extends { linked?: boolean }>(rows: T[], f: RefFilter): T[] {
  if (f === 'home') return rows.filter((r) => !r.linked);
  if (f === 'linked') return rows.filter((r) => !!r.linked);
  return rows;
}


// 행 표시 — 소속 프로젝트 이름은 서버가 보는 사람이 볼 수 있을 때만 준다(없으면 «연결됨» 만)
export const LinkedMini: React.FC<{ project?: { name: string } | null }> = ({ project }) => {
  const { t } = useTranslation('common');
  return (
    <Mini data-testid="docs-row-linked" title={t('projectRefs.linkedHint') as string}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
      {project ? t('projectRefs.linkedFrom', { name: project.name }) : t('projectRefs.linkedBadge')}
    </Mini>
  );
};

const Mini = styled.span`
  display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; max-width: 180px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 1px 6px; border-radius: 4px; background: #F1F5F9; color: #475569; font-size: 0.6875rem; font-weight: 600;
`;
