// pages/QProject/ProjectHeadCollapse.tsx — 문서 편집 중 프로젝트 머리 접기 (2026-10-25)
//
// Irene: "프로젝트>문서>편집에 가면 상단에 보이는게 너무 많아 … 프로젝트 정보 영역을 접을까?" → «권고대로».
// 편집 중에는 프로젝트 제목줄(60)·탭 막대(46)·폰 액션 줄이 문서 머리 위에 겹겹이 쌓여 쓰는 칸이 화면의 37~41% 였다.
// 문서를 쓰는 동안 프로젝트 탭을 오갈 일은 드물다 → 편집에 들어가면 그 둘을 «프로젝트 이름 · 문서 편집 중 [펼치기]» 한 줄(36)로 접는다.
// 편집을 끝내면(완료·되돌리기·다른 탭) 저절로 펴진다. 편집 중에 펼쳤으면 탭 막대 끝 [접기] 로 다시 접는다.
//
// 대상은 PostsPage 를 얹는 탭(문서·메뉴에 추가한 문서 doc-:id) — PostsPage 가 onEditingChange 로 알린다.
// 줄의 자리·여백은 탭 막대(TabBar)와 같은 숫자(-20 / 폰 -14, sticky)다. 바꾸면 둘을 같이 본다.
import { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { HEAD_COLLAPSED_H } from './QProjectDetailPage.styles';

export function useProjectHeadCollapse(tab: string) {
  const [docEditing, setDocEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // 편집에 새로 들어갈 때마다 접힌 채로 시작한다.
  useEffect(() => { if (docEditing) setExpanded(false); }, [docEditing]);
  const onDocTab = tab === 'docs' || /^doc-\d+$/.test(tab);
  const active = onDocTab && docEditing;
  return {
    collapsed: active && !expanded,
    /** 편집 중에 펼친 상태 — 탭 막대 끝에 [접기] 를 둔다 */
    canCollapse: active && expanded,
    onEditingChange: setDocEditing,
    expand: useCallback(() => setExpanded(true), []),
    collapse: useCallback(() => setExpanded(false), []),
  };
}

const Chevron = ({ up }: { up?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points={up ? '6 15 12 9 18 15' : '6 9 12 15 18 9'} />
  </svg>
);

export function ProjectHeadCollapsedBar({ projectName, onExpand }: { projectName: string; onExpand: () => void }) {
  const { t } = useTranslation('qproject');
  const label = t('headCollapse.expand', { defaultValue: '프로젝트 메뉴 펼치기' }) as string;
  return (
    <Bar data-testid="project-head-collapsed">
      <Name title={projectName}>{projectName}</Name>
      <Note>· {t('headCollapse.editingNote', { defaultValue: '문서 편집 중' })}</Note>
      <ExpandBtn type="button" data-testid="project-head-expand" onClick={onExpand} title={label} aria-label={label}>
        <ExpandText>{label}</ExpandText><Chevron />
      </ExpandBtn>
    </Bar>
  );
}

export function ProjectHeadCollapseBtn({ onCollapse }: { onCollapse: () => void }) {
  const { t } = useTranslation('qproject');
  const label = t('headCollapse.collapse', { defaultValue: '프로젝트 메뉴 접기' }) as string;
  return (
    <CollapseBtn type="button" data-testid="project-head-collapse" onClick={onCollapse} title={label} aria-label={label}>
      <Chevron up />
    </CollapseBtn>
  );
}

const Bar = styled.div`
  display: flex; align-items: center; gap: 6px; box-sizing: border-box;
  height: ${HEAD_COLLAPSED_H}; padding: 0 12px 0 20px;
  margin: -20px -20px 20px;
  position: sticky; top: -20px; z-index: 5;
  background: #fff; border-bottom: 1px solid #E2E8F0;
  @media (max-width: 640px) { padding: 0 6px 0 14px; margin: -14px -14px 14px; top: -14px; }
`;
const Name = styled.span`
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 0.8125rem; font-weight: 700; color: #0F172A;
`;
const Note = styled.span`
  flex-shrink: 0; font-size: 0.75rem; color: #94A3B8; white-space: nowrap;
`;
const ExpandBtn = styled.button`
  margin-left: auto; flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
  height: 32px; padding: 0 8px; border: none; border-radius: 6px; background: transparent;
  font: inherit; font-size: 0.75rem; font-weight: 600; color: #0F766E; cursor: pointer;
  &:hover { background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 1px; }
  @media (max-width: 640px) { height: 36px; min-width: 44px; justify-content: center; }
`;
const ExpandText = styled.span`
  @media (max-width: 640px) { display: none; }
`;
const CollapseBtn = styled.button`
  margin-left: auto; flex: 0 0 auto; align-self: center;
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: none; border-radius: 6px; background: transparent;
  color: #0F766E; cursor: pointer;
  &:hover { background: #F0FDFA; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 1px; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
