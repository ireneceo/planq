// InteractionFields — 고객 응대 내역(전화·미팅·방문·메모)을 적는 **입력칸 한 벌**.
//
// ★ 2026-09-13 (Irene: *"+문의추가는 고객응대내용 추가 이 팝업 뜨게 하고 이름도 이걸로 해.
//   이것 저것 비슷한 항목 자꾸 만들지 마."*)
//   같은 일을 적는 칸이 **두 벌**이었다 — `RecordModal`(종류·방향·시각·제목·내용·길이)과
//   문의 추가 모달(종류·내용 둘뿐). 이름도 다르고 칸도 달라서, 어디서 적느냐에 따라
//   남는 정보가 달랐다. 칸을 여기 한 곳으로 빼서 **둘이 같은 것을 쓴다.**
//   (CLAUDE.md "새로 만들지 않는다 — 기존 것을 찾아서 쓴다")
import styled from 'styled-components';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../Common/PlanQSelect';
import SingleDateField from '../Common/SingleDateField';
import { INTERACTION_KINDS, type InteractionKind } from '../../services/sale';

export interface InteractionValue {
  kind: InteractionKind;
  direction: 'inbound' | 'outbound' | '';
  date: string;
  time: string;
  title: string;
  minutes: string;
}

export function emptyInteraction(): InteractionValue {
  const now = new Date();
  return {
    kind: 'call', direction: '',
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
    title: '', minutes: '',
  };
}

/** 본문(body)은 **초안으로 남아야** 하므로 이 컴포넌트가 들고 있지 않는다 —
 *  부르는 쪽이 `useDraftText` 로 관리하고 `bodySlot` 으로 넣는다. */
export default function InteractionFields({ value, onChange, idPrefix, bodySlot }: {
  value: InteractionValue;
  onChange: (patch: Partial<InteractionValue>) => void;
  idPrefix: string;
  bodySlot: React.ReactNode;
}) {
  const { t } = useTranslation('qsale');
  const kindOptions = useMemo(
    () => INTERACTION_KINDS.map((k) => ({ value: k as string, label: t(`record.kind.${k}`) as string })), [t]);
  const dirOptions = useMemo(() => ([
    { value: '', label: '—' },
    { value: 'inbound', label: t('record.direction.inbound') as string },
    { value: 'outbound', label: t('record.direction.outbound') as string },
  ]), [t]);

  return (
    <>
      <TwoCol>
        <Field>
          <FieldLabel>{t('record.kind.label') as string}</FieldLabel>
          <PlanQSelect size="md" isSearchable={false} options={kindOptions}
            aria-label={t('record.kind.label') as string}
            value={kindOptions.find((o) => o.value === value.kind)}
            onChange={(opt: unknown) => onChange({ kind: (((opt as { value?: string } | null)?.value) || 'call') as InteractionKind })} />
        </Field>
        <Field>
          <FieldLabel>{t('record.direction.label') as string}</FieldLabel>
          <PlanQSelect size="md" isSearchable={false} options={dirOptions}
            aria-label={t('record.direction.label') as string}
            value={dirOptions.find((o) => o.value === value.direction)}
            onChange={(opt: unknown) => onChange({ direction: (((opt as { value?: string } | null)?.value) || '') as InteractionValue['direction'] })} />
        </Field>
      </TwoCol>
      <TwoCol>
        <Field>
          <FieldLabel>{t('record.occurredAt') as string}</FieldLabel>
          <SingleDateField value={value.date} onChange={(d: string) => onChange({ date: d })} size="md" />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${idPrefix}-time`}>{t('record.occurredAt') as string}</FieldLabel>
          <TextInput id={`${idPrefix}-time`} value={value.time}
            onChange={(e) => onChange({ time: e.target.value })} placeholder="14:20" />
        </Field>
      </TwoCol>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-title`}>{t('record.title') as string}</FieldLabel>
        <TextInput id={`${idPrefix}-title`} value={value.title}
          onChange={(e) => onChange({ title: e.target.value })} />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-body`}>{t('record.body') as string}</FieldLabel>
        {bodySlot}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-min`}>{t('record.duration') as string}</FieldLabel>
        <TextInput id={`${idPrefix}-min`} value={value.minutes} inputMode="numeric"
          onChange={(e) => onChange({ minutes: e.target.value.replace(/\D/g, '') })} />
      </Field>
    </>
  );
}

const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const TwoCol = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 10px; @media (max-width: 640px) { grid-template-columns: 1fr; }`;
const TextInput = styled.input`
  height: 40px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.8125rem; color: #0F172A; width: 100%; font-family: inherit;
  &:focus { outline: none; border-color: #5EEAD4; }
`;
