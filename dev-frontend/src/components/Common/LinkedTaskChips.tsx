// LinkedTaskChips — 대상(문서 등) 상세 밴드2 왼쪽 메타의 «업무: 제목» 칩 (2026-10-12, docs/TASK_ACTIONS_DESIGN.md §4.2)
//   값은 서버 linked_tasks(services/taskActionItems.linkedTasksOf — 보는 사람 기준) 그대로. 화면이 따로 모으지 않는다.
//   3개 넘으면 «+n». 누르면 업무를 새 탭으로(하던 일 위에 얹히는 진입점).
//   onRemove 를 주면(문서 편집 — 2026-10-15) 다 보여 주고, 서버가 can_unlink 로 허락한 칩에만 × 를 붙인다.
import React from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { tabStore } from '../../stores/tabStore';

export interface LinkedTaskRef { id: number; title: string; status: string; project_id: number | null; via?: string; attachment_id?: number; can_unlink?: boolean }

const MAX = 3;

const LinkedTaskChips: React.FC<{ tasks?: LinkedTaskRef[] | null; onRemove?: (task: LinkedTaskRef) => void }> = ({ tasks, onRemove }) => {
  const { t } = useTranslation('common');
  if (!tasks || tasks.length === 0) return null;
  const shown = onRemove ? tasks : tasks.slice(0, MAX);
  const more = tasks.length - shown.length;
  return (
    <>
      {shown.map((tk) => {
        const chip = (
          <Chip key={tk.id} type="button" data-testid={`linked-task-chip-${tk.id}`}
            title={onRemove && tk.via === 'action' ? `${tk.title} — ${t('taskLink.viaAction')}` : tk.title}
            $joined={!!onRemove && !!tk.can_unlink}
            onClick={() => tabStore.openInNewTab(`/tasks?task=${tk.id}`)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
            <ChipText>{t('linkedTasks.chip', { title: tk.title })}</ChipText>
          </Chip>
        );
        if (!onRemove || !tk.can_unlink) return chip;
        // 열기와 떼기는 다른 버튼이다 — 칩 안에 버튼을 넣지 않는다(button 안 button 금지)
        return (
          <ChipPair key={tk.id}>
            {chip}
            <RemoveBtn type="button" data-testid={`linked-task-remove-${tk.id}`}
              aria-label={t('taskLink.remove', { title: tk.title }) as string} title={t('taskLink.remove', { title: tk.title }) as string}
              onClick={() => onRemove(tk)}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
            </RemoveBtn>
          </ChipPair>
        );
      })}
      {more > 0 && <More title={tasks.slice(MAX).map((x) => x.title).join(', ')}>{t('linkedTasks.more', { n: more })}</More>}
    </>
  );
};

export default LinkedTaskChips;

const Chip = styled.button<{ $joined?: boolean }>`
  display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; max-width: 220px; padding: 2px 8px; line-height: 1.45;
  border-radius: 6px; border: 1px solid #CCFBF1; background: #F0FDFA; color: #0F766E;
  font-size: 0.75rem; font-weight: 500; cursor: pointer; font-family: inherit;
  ${(p) => p.$joined ? 'border-top-right-radius: 0; border-bottom-right-radius: 0; border-right: none;' : ''}
  &:hover { background: #CCFBF1; }
`;
const ChipPair = styled.span`display: inline-flex; align-items: stretch; flex-shrink: 0; min-width: 0;`;
const RemoveBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center; width: 22px; padding: 0;
  border: 1px solid #CCFBF1; border-left: 1px solid #99F6E4; border-radius: 0 6px 6px 0;
  background: #F0FDFA; color: #0F766E; cursor: pointer;
  &:hover { background: #FEE2E2; color: #B91C1C; border-color: #FECACA; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
const ChipText = styled.span`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;`;
const More = styled.span`flex-shrink: 0; font-size: 0.75rem; color: #64748B;`;
