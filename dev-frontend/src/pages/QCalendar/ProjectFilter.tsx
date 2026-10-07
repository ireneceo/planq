// Q calendar 프로젝트 필터 (#461, 2026-10-07 — Irene: "프로젝트랑 관련된 일정 표시되게 아니면 Q calendar 필터에 프로젝트도")
//   일정·업무 모두 project_id 로 거른다. 개인 구글 일정은 프로젝트가 없으므로 프로젝트를 고르면 빠진다.
//   QCalendarPage 가 800줄을 넘지 않게 따로 둔다(god-file 기준).
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { isPersonalEvent } from './taskToEvent';
import type { CalendarItem } from './types';

export function byProject<T extends CalendarItem>(items: T[], projectId: number | null): T[] {
  if (!projectId) return items;
  return items.filter((e) => !isPersonalEvent(e) && Number((e as { project_id?: number | null }).project_id) === projectId);
}

interface Props {
  projects: Array<{ id: number; name: string }>;
  value: number | null;
  onChange: (id: number | null) => void;
}

const CalendarProjectFilter: React.FC<Props> = ({ projects, value, onChange }) => {
  const { t } = useTranslation('qcalendar');
  const options = useMemo(() => [
    { value: 0, label: t('filter.allProjects', { defaultValue: '모든 프로젝트' }) as string },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ], [projects, t]);
  if (!projects.length) return null;
  return (
    <Slot data-testid="calendar-project-filter">
    <PlanQSelect size="sm"
      aria-label={t('filter.project', { defaultValue: '프로젝트' }) as string}
      value={options.find((o) => o.value === (value || 0)) || options[0]}
      onChange={(opt: unknown) => {
        const v = (opt as { value?: number } | null)?.value;
        onChange(v ? Number(v) : null);
      }}
      options={options}
      isSearchable={options.length > 8}
      menuPlacement="bottom"
    />
    </Slot>
  );
};

// 폰에서는 머리줄에 [범위][프로젝트][보기][+] 넷이 들어가야 한다 — 이 칸만 줄여 새 일정 버튼이 화면 밖으로 밀리지 않게.
const Slot = styled.div`
  min-width: 0; max-width: 180px;
  & > * { width: 100%; }
  @media (max-width: 640px) { max-width: 96px; }
`;

export default CalendarProjectFilter;
