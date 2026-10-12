// FromTaskBanner — «이 업무에서 만들고 있어요» 띠 (2026-10-12, docs/TASK_ACTIONS_DESIGN.md §4.2)
//   업무 «결과물 액션» 에서 넘어온 문서·일정 만들기 폼 위에 뜬다. 비모달 안내라 role=status.
//   담당자가 아니면(can_perform=false) 연결되지 않는다는 것을 **미리** 말한다(서버 403 을 사용자가 뒤늦게 알지 않게).
import React from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { tabStore } from '../../stores/tabStore';
import type { FromActionHandoff } from '../../hooks/useFromActionHandoff';

interface Props {
  handoff: FromActionHandoff;
  /** 만들었지만 연결이 실패했을 때(서버 warnings) */
  linkFailed?: boolean;
}

const FromTaskBanner: React.FC<Props> = ({ handoff, linkFailed }) => {
  const { t } = useTranslation('common');
  const warn = linkFailed || !handoff.can_perform;
  return (
    <Band role="status" $warn={warn} data-testid="from-task-banner">
      <Text>
        {linkFailed
          ? t('fromTask.linkFailed')
          : handoff.can_perform
            ? t('fromTask.banner', { task: handoff.task.title, label: handoff.action.label })
            : t('fromTask.cannotLink')}
      </Text>
      <OpenBtn type="button" onClick={() => tabStore.openInNewTab(`/tasks?task=${handoff.task.id}`)} data-testid="from-task-open">
        {t('fromTask.openTask')}
      </OpenBtn>
    </Band>
  );
};

export default FromTaskBanner;

const Band = styled.div<{ $warn: boolean }>`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 12px; margin-bottom: 12px; border-radius: 8px;
  background: ${(p) => (p.$warn ? '#FFFBEB' : '#F0FDFA')};
  border: 1px solid ${(p) => (p.$warn ? '#FDE68A' : '#99F6E4')};
  color: ${(p) => (p.$warn ? '#92400E' : '#0F766E')};
  font-size: 0.8125rem; line-height: 1.45;
`;
const Text = styled.span`flex: 1 1 220px; min-width: 0;`;
const OpenBtn = styled.button`
  flex-shrink: 0; height: 32px; padding: 0 12px; border-radius: 6px;
  border: 1px solid currentColor; background: #fff; color: inherit;
  font-size: 0.75rem; font-weight: 600; cursor: pointer; font-family: inherit;
  &:hover { background: rgba(255,255,255,0.7); }
  @media (max-width: 640px) { height: 40px; }
`;
