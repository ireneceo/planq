// LinkedTaskChips — 대상(문서 등) 상세 밴드2 왼쪽 메타의 «업무: 제목» 칩 (2026-10-12, docs/TASK_ACTIONS_DESIGN.md §4.2)
//   값은 서버 linked_tasks(services/taskActionItems.linkedTasksOf — 보는 사람 기준) 그대로. 화면이 따로 모으지 않는다.
//   3개 넘으면 «+n». 누르면 업무를 새 탭으로(하던 일 위에 얹히는 진입점).
import React from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { tabStore } from '../../stores/tabStore';

export interface LinkedTaskRef { id: number; title: string; status: string; project_id: number | null; via?: string }

const MAX = 3;

const LinkedTaskChips: React.FC<{ tasks?: LinkedTaskRef[] | null }> = ({ tasks }) => {
  const { t } = useTranslation('common');
  if (!tasks || tasks.length === 0) return null;
  const shown = tasks.slice(0, MAX);
  const more = tasks.length - shown.length;
  return (
    <>
      {shown.map((tk) => (
        <Chip key={tk.id} type="button" data-testid={`linked-task-chip-${tk.id}`} title={tk.title}
          onClick={() => tabStore.openInNewTab(`/tasks?task=${tk.id}`)}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
          <ChipText>{t('linkedTasks.chip', { title: tk.title })}</ChipText>
        </Chip>
      ))}
      {more > 0 && <More title={tasks.slice(MAX).map((x) => x.title).join(', ')}>{t('linkedTasks.more', { n: more })}</More>}
    </>
  );
};

export default LinkedTaskChips;

const Chip = styled.button`
  display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; max-width: 220px; padding: 2px 8px; line-height: 1.45;
  border-radius: 6px; border: 1px solid #CCFBF1; background: #F0FDFA; color: #0F766E;
  font-size: 0.75rem; font-weight: 500; cursor: pointer; font-family: inherit;
  &:hover { background: #CCFBF1; }
`;
const ChipText = styled.span`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;`;
const More = styled.span`flex-shrink: 0; font-size: 0.75rem; color: #64748B;`;
