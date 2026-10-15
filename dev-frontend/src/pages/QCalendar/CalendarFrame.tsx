// Q calendar 껍데기 — 단독 페이지는 PageShell, 프로젝트 탭에 얹을 때는 머리줄 없이 도구줄만(#461).
//   프로젝트 상세는 이미 제목·탭 밴드가 있어 PageShell 을 또 그리면 머리줄이 두 번 생긴다.
//   (QCalendarPage 가 800줄을 넘지 않게 보기·범위 선택지도 여기 둔다.)
import React, { useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import PlanQSelect from '../../components/Common/PlanQSelect';
import type { CalendarViewMode } from './types';

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
  return { viewOptions };
}

/** 보기(아젠다·월·주·일) — 데스크탑·태블릿은 머리줄, 폰은 년/월 줄 오른쪽(2026-10-13). */
export const CalendarViewSelect: React.FC<{ view: CalendarViewMode; onChange: (v: CalendarViewMode) => void }> = ({ view, onChange }) => {
  const { viewOptions } = useCalendarOptions();
  return (
    <PlanQSelect size="sm"
      value={viewOptions.find((o) => o.value === view)}
      onChange={(opt: unknown) => {
        const v = (opt as { value?: CalendarViewMode } | null)?.value;
        if (v) onChange(v);
      }}
      options={viewOptions}
      isSearchable={false}
      menuPlacement="bottom"
    />
  );
};

const Embedded = styled.div`
  display: flex; flex-direction: column; min-height: 0; position: relative;
`;
const EmbeddedBar = styled.div`
  display: flex; justify-content: flex-end; padding-bottom: 12px;
`;

export default CalendarFrame;
