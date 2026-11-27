// 업무 «중요도»(priority_level) 칸 — 업무 추가 폼용. 업무 상세(TaskDetailDrawer «중요도»)와 같은 옵션 순서·라벨(qtask importance.*).
//   ★ «우선순위 N»(주간 랭킹 priority_order)과 다른 것 — 그건 목록에서 정하는 순서라 추가 폼에 두지 않는다.
//   TaskCreateForm 이 800줄을 넘지 않게 분리(god-file 래칫, 2026-11-27).
import type { ComponentType, HTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import PlanQSelect from '../Common/PlanQSelect';
import { PRIORITY_LEVELS, asPriorityLevel, type TaskPriorityLevel } from '../../utils/taskPriority';


interface Props {
  value: TaskPriorityLevel | null;
  onChange: (next: TaskPriorityLevel | null) => void;
  /** 남에게 맡기며 «긴급» 이면 강조 알림·마감 오늘 안내를 칸 아래 한 줄로 */
  showUrgentHint: boolean;
  Field: ComponentType<HTMLAttributes<HTMLDivElement> & { 'data-field'?: string; 'data-testid'?: string }>;
  Label: ComponentType<{ children?: ReactNode }>;
}

export default function TaskImportanceField({ value, onChange, showUrgentHint, Field, Label }: Props) {
  const { t } = useTranslation('qtask');
  return (
    <Field data-field="importance" data-testid="task-add-importance" style={{ flex: '0 1 150px' }}>
      <Label>{t('importance.label', '중요도')}</Label>
      <PlanQSelect size="sm" isClearable
        placeholder={t('importance.unset', '미지정') as string}
        value={value ? { value, label: t(`importance.${value}`) as string } : null}
        onChange={(v) => onChange(asPriorityLevel((v as { value?: string })?.value))}
        options={PRIORITY_LEVELS.map((k) => ({ value: k, label: t(`importance.${k}`) as string }))} />
      {value === 'urgent' && showUrgentHint && (
        <Hint data-testid="task-add-urgent-hint">
          {t('add.urgentHint', '담당자에게 강조 알림이 가고, 확인할 때까지 업무리스트 맨 위에 남습니다. 마감은 오늘로 먼저 정해집니다')}
        </Hint>
      )}
    </Field>
  );
}

const Hint = styled.div`font-size:0.625rem;color:#BE123C;line-height:1.35;margin-top:2px;`;
