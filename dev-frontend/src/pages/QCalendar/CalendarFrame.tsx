// Q calendar 껍데기 — 단독 페이지는 PageShell, 프로젝트 탭에 얹을 때는 머리줄 없이 도구줄만(#461).
//   프로젝트 상세는 이미 제목·탭 밴드가 있어 PageShell 을 또 그리면 머리줄이 두 번 생긴다.
//   (QCalendarPage 가 800줄을 넘지 않게 보기·범위 선택지도 여기 둔다.)
import React, { useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';

interface Props {
  embedded: boolean;
  title: string;
  actions: React.ReactNode;
  children: React.ReactNode;
}

const CalendarFrame: React.FC<Props> = ({ embedded, title, actions, children }) => {
  if (!embedded) return <PageShell title={title} actions={actions}>{children}</PageShell>;
  return (
    <Embedded data-testid="calendar-embedded">
      <EmbeddedBar>{actions}</EmbeddedBar>
      {children}
    </Embedded>
  );
};

export function useCalendarOptions() {
  const { t } = useTranslation('qcalendar');
  const viewOptions = useMemo(() => [
    { value: 'agenda', label: t('view.agenda', '아젠다') },
    { value: 'month', label: t('view.month') },
    { value: 'week', label: t('view.week') },
    { value: 'day', label: t('view.day') },
  ], [t]);
  const scopeOptions = useMemo(() => [
    { value: 'all', label: t('filter.all') },
    { value: 'mine', label: t('filter.mine') },
    { value: 'tasks', label: t('filter.tasks') },
    { value: 'events', label: t('filter.events') },
  ], [t]);
  return { viewOptions, scopeOptions };
}

const Embedded = styled.div`
  display: flex; flex-direction: column; min-height: 0; position: relative;
`;
const EmbeddedBar = styled.div`
  display: flex; justify-content: flex-end; padding-bottom: 12px;
`;

export default CalendarFrame;
