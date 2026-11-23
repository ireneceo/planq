// 첫 방문 업무설계 컨설팅 신청 칸 (/contact?type=visit) — 2026-11-23.
//   접수는 기존 문의 원장 그대로(kind 'enterprise' = 견적·서비스 문의, source 'landing_visit_consult').
//   서버에 새 칸을 만들지 않고, 관리자가 그대로 읽게 고른 값을 본문으로 엮는다(견적 모드의 «관심 범위» 줄과 같은 방식).
//   희망 시간 칸 모양·시간대 라벨은 «시작 안내 30분» 칸(OnboardingCallFields)과 같은 것을 쓴다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import SingleDateField from '../Common/SingleDateField';
import {
  PARTS, TEAM_SIZES, MAX_SLOTS, tomorrowLocal, browserTimezone,
  type CallPart, type CallSlot, type TeamSize,
} from '../Common/OnboardingCallFields';

export interface VisitConsultValue {
  address: string;
  slots: CallSlot[];
  team_size: TeamSize | '';
  pain: string;
}

export const emptyVisitConsult = (): VisitConsultValue => ({
  address: '', slots: [{ date: '', part: '' }], team_size: '', pain: '',
});

export const visitConsultReady = (v: VisitConsultValue) =>
  !!v.address.trim() && v.slots.some(s => s.date && s.part);

/** 관리자가 읽을 본문 — 신청자의 언어로 엮는다. 첫 줄이 상품·가격을 말한다(알림 제목 아래 첫 줄로 보인다). */
export function visitConsultMessage(v: VisitConsultValue, tLanding: TFunction, tCommon: TFunction): string {
  const lines = [
    tLanding('visitConsult.msg.head') as string,
    `${tLanding('visitConsult.msg.address')}: ${v.address.trim()}`,
    `${tLanding('visitConsult.msg.slots')} (${browserTimezone()})`,
    ...v.slots.filter(s => s.date && s.part)
      .map((s, i) => `  ${i + 1}. ${s.date} ${tCommon(`onboardingCall.part.${s.part}`)}`),
  ];
  if (v.team_size) lines.push(`${tLanding('visitConsult.msg.team')}: ${tCommon(`onboardingCall.team.${v.team_size}`)}`);
  if (v.pain.trim()) lines.push(`${tLanding('visitConsult.msg.pain')}: ${v.pain.trim()}`);
  return lines.join('\n');
}

interface Props { value: VisitConsultValue; onChange: (v: VisitConsultValue) => void; }

const VisitConsultFields: React.FC<Props> = ({ value, onChange }) => {
  const { t } = useTranslation('landing');
  const { t: tc } = useTranslation('common');
  const minDate = tomorrowLocal();
  const setSlot = (i: number, patch: Partial<CallSlot>) =>
    onChange({ ...value, slots: value.slots.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  return (
    <>
      <Field>
        <Label htmlFor="visit-address">{t('visitConsult.form.address')}</Label>
        {/* draft-exempt: 200자 이하 짧은 신청 칸 — 비로그인 랜딩이라 초안 키가 없고, 값은 부모 폼이 들고 있다 */}
        <Input id="visit-address" type="text" maxLength={200} value={value.address} required
          data-testid="visit-address"
          placeholder={t('visitConsult.form.addressPlaceholder') as string}
          onChange={e => onChange({ ...value, address: e.target.value })} />
      </Field>
      <Field>
        <Label>{t('visitConsult.form.slots')}</Label>
        <Hint>{t('visitConsult.form.slotsHint', { tz: browserTimezone() })}</Hint>
        {value.slots.map((s, i) => (
          <SlotRow key={i} data-testid={`visit-slot-${i}`}>
            <SingleDateField value={s.date} minDate={minDate} size="md" width={150}
              placeholder={tc('onboardingCall.datePlaceholder', '날짜') as string}
              onChange={(d) => setSlot(i, { date: d })} />
            <Chips role="radiogroup" aria-label={tc('onboardingCall.partLabel', '시간대') as string}>
              {PARTS.map((p: CallPart) => (
                <Chip key={p} type="button" role="radio" aria-checked={s.part === p} $active={s.part === p}
                  onClick={() => setSlot(i, { part: p })}>
                  {tc(`onboardingCall.part.${p}`)}
                </Chip>
              ))}
            </Chips>
            {value.slots.length > 1 && (
              <RemoveBtn type="button" aria-label={tc('onboardingCall.removeSlot', '이 시간 빼기') as string}
                title={tc('onboardingCall.removeSlot', '이 시간 빼기') as string}
                onClick={() => onChange({ ...value, slots: value.slots.filter((_, k) => k !== i) })}>×</RemoveBtn>
            )}
          </SlotRow>
        ))}
        {value.slots.length < MAX_SLOTS && (
          <AddBtn type="button" data-testid="visit-add-slot"
            onClick={() => onChange({ ...value, slots: [...value.slots, { date: '', part: '' }] })}>
            {tc('onboardingCall.addSlot', '+ 다른 시간 추가')}
          </AddBtn>
        )}
      </Field>
      <Field>
        <Label>{tc('onboardingCall.teamLabel', '함께 쓸 인원')}</Label>
        <Chips role="radiogroup">
          {TEAM_SIZES.map(sz => (
            <Chip key={sz} type="button" role="radio" aria-checked={value.team_size === sz} $active={value.team_size === sz}
              onClick={() => onChange({ ...value, team_size: value.team_size === sz ? '' : sz })}>
              {tc(`onboardingCall.team.${sz}`)}
            </Chip>
          ))}
        </Chips>
      </Field>
      <Field>
        <Label htmlFor="visit-pain">{t('visitConsult.form.pain')}</Label>
        {/* draft-exempt: 비로그인 랜딩 신청 칸 — 위와 같다 */}
        <Textarea id="visit-pain" rows={4} maxLength={1000} value={value.pain}
          placeholder={t('visitConsult.form.painPlaceholder') as string}
          onChange={e => onChange({ ...value, pain: e.target.value })} />
      </Field>
    </>
  );
};

export default VisitConsultFields;

const Field = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Label = styled.label`font-size: 0.8125rem; font-weight: 600; color: #475569;`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; line-height: 1.5;`;
const Input = styled.input`
  height: 44px; padding: 0 14px; font-size: 0.875rem; color: #0F172A; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 8px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const Textarea = styled.textarea`
  padding: 12px 14px; font-size: 0.875rem; color: #0F172A; font-family: inherit; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 8px; resize: vertical; min-height: 96px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const SlotRow = styled.div`display: flex; align-items: center; flex-wrap: wrap; gap: 8px;`;
const Chips = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const Chip = styled.button<{ $active: boolean }>`
  height: 36px; padding: 0 14px; border-radius: 999px; cursor: pointer;
  background: ${p => (p.$active ? '#F0FDFA' : '#FFFFFF')};
  color: ${p => (p.$active ? '#0D9488' : '#475569')};
  border: 1px solid ${p => (p.$active ? '#14B8A6' : '#E2E8F0')};
  font-size: 0.8125rem; font-weight: ${p => (p.$active ? 600 : 500)};
`;
const RemoveBtn = styled.button`
  width: 36px; height: 36px; border-radius: 8px; border: 1px solid #E2E8F0; background: #FFFFFF;
  color: #94A3B8; font-size: 1.125rem; cursor: pointer;
  &:hover { color: #475569; border-color: #CBD5E1; }
`;
const AddBtn = styled.button`
  align-self: flex-start; padding: 0; border: none; background: none; cursor: pointer;
  font-size: 0.8125rem; font-weight: 600; color: #0D9488;
`;
