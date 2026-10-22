// 화상 업무설계·사용안내 신청 — 입력 칸 한 벌 (docs/ONBOARDING_CALL_DESIGN.md).
//   랜딩 문의 페이지(/contact?type=onboarding)와 앱 대시보드 신청 창이 같은 칸을 쓴다 — 두 곳이 갈라지면
//   한쪽에서만 받는 값이 생긴다. 서버 정규화는 dev-backend/services/onboardingCall.normalizeDetails 한 곳.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import SingleDateField from './SingleDateField';

export type CallPart = 'morning' | 'afternoon' | 'evening';
export type TeamSize = 'solo' | '2_5' | '6_20' | '21_plus';
export interface CallSlot { date: string; part: CallPart | '' }
export interface OnboardingCallValue {
  slots: CallSlot[];
  team_size: TeamSize | '';
  current_tools: string;
  focus: string;
}

export const PARTS: CallPart[] = ['morning', 'afternoon', 'evening'];
export const TEAM_SIZES: TeamSize[] = ['solo', '2_5', '6_20', '21_plus'];
export const MAX_SLOTS = 3;

export const emptyOnboardingCall = (): OnboardingCallValue => ({
  slots: [{ date: '', part: '' }], team_size: '', current_tools: '', focus: '',
});

/** 신청자 시간대(브라우저) — 서버가 IANA 이름을 다시 검사한다. */
export function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'; } catch { return 'Asia/Seoul'; }
}

/** 내일 'YYYY-MM-DD' (신청자 시간대 기준 — 오늘 이후만 고를 수 있다) */
export function tomorrowLocal(): string {
  const d = new Date(); d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 서버로 보낼 details — 다 채운 희망 시간만 싣는다. */
export function toDetails(v: OnboardingCallValue) {
  return {
    slots: v.slots.filter(s => s.date && s.part).map(s => ({ date: s.date, part: s.part })),
    team_size: v.team_size || null,
    current_tools: v.current_tools.trim() || null,
    focus: v.focus.trim() || null,
  };
}

export const hasValidSlot = (v: OnboardingCallValue) => v.slots.some(s => s.date && s.part);

interface Props {
  value: OnboardingCallValue;
  onChange: (v: OnboardingCallValue) => void;
  idPrefix: string;
}

const OnboardingCallFields: React.FC<Props> = ({ value, onChange, idPrefix }) => {
  const { t } = useTranslation('common');
  const minDate = tomorrowLocal();
  const setSlot = (i: number, patch: Partial<CallSlot>) =>
    onChange({ ...value, slots: value.slots.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  return (
    <>
      <Field>
        <Label>{t('onboardingCall.slotsLabel', '희망 시간 (최대 3개)')}</Label>
        <Hint>{t('onboardingCall.slotsHint', { tz: browserTimezone(), defaultValue: '30분 정도 걸려요. 시간대: {{tz}}' })}</Hint>
        {value.slots.map((s, i) => (
          <SlotRow key={i} data-testid={`${idPrefix}-slot-${i}`}>
            <SingleDateField value={s.date} minDate={minDate} size="md" width={150}
              placeholder={t('onboardingCall.datePlaceholder', '날짜') as string}
              onChange={(d) => setSlot(i, { date: d })} />
            <Chips role="radiogroup" aria-label={t('onboardingCall.partLabel', '시간대') as string}>
              {PARTS.map(p => (
                <Chip key={p} type="button" role="radio" aria-checked={s.part === p} $active={s.part === p}
                  onClick={() => setSlot(i, { part: p })}>
                  {t(`onboardingCall.part.${p}`)}
                </Chip>
              ))}
            </Chips>
            {value.slots.length > 1 && (
              <RemoveBtn type="button" aria-label={t('onboardingCall.removeSlot', '이 시간 빼기') as string}
                title={t('onboardingCall.removeSlot', '이 시간 빼기') as string}
                onClick={() => onChange({ ...value, slots: value.slots.filter((_, k) => k !== i) })}>×</RemoveBtn>
            )}
          </SlotRow>
        ))}
        {value.slots.length < MAX_SLOTS && (
          <AddBtn type="button" data-testid={`${idPrefix}-add-slot`}
            onClick={() => onChange({ ...value, slots: [...value.slots, { date: '', part: '' }] })}>
            {t('onboardingCall.addSlot', '+ 다른 시간 추가')}
          </AddBtn>
        )}
      </Field>
      <Field>
        <Label>{t('onboardingCall.teamLabel', '함께 쓸 인원')}</Label>
        <Chips role="radiogroup">
          {TEAM_SIZES.map(sz => (
            <Chip key={sz} type="button" role="radio" aria-checked={value.team_size === sz} $active={value.team_size === sz}
              onClick={() => onChange({ ...value, team_size: value.team_size === sz ? '' : sz })}>
              {t(`onboardingCall.team.${sz}`)}
            </Chip>
          ))}
        </Chips>
      </Field>
      <Field>
        <Label htmlFor={`${idPrefix}-tools`}>{t('onboardingCall.toolsLabel', '지금 쓰는 도구 (선택)')}</Label>
        {/* draft-exempt: 200자 이하 짧은 신청 칸 — 랜딩(비로그인)에서도 쓰여 초안 키가 없고, 칸 값은 부모 폼이 들고 있다 */}
        <Input id={`${idPrefix}-tools`} type="text" maxLength={200} value={value.current_tools}
          placeholder={t('onboardingCall.toolsPlaceholder', '예: 엑셀, 카카오톡, 노션') as string}
          onChange={e => onChange({ ...value, current_tools: e.target.value })} />
      </Field>
      <Field>
        <Label htmlFor={`${idPrefix}-focus`}>{t('onboardingCall.focusLabel', '먼저 맞추고 싶은 일 (선택)')}</Label>
        {/* draft-exempt: 200자 이하 짧은 신청 칸 — 위와 같다 */}
        <Input id={`${idPrefix}-focus`} type="text" maxLength={200} value={value.focus}
          placeholder={t('onboardingCall.focusPlaceholder', '예: 고객 요청을 업무로 나누는 흐름') as string}
          onChange={e => onChange({ ...value, focus: e.target.value })} />
      </Field>
    </>
  );
};

export default OnboardingCallFields;

const Field = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Label = styled.label`font-size: 0.8125rem; font-weight: 600; color: #475569;`;
const Hint = styled.div`font-size: 0.75rem; color: #94A3B8; margin-top: -4px;`;
const SlotRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
`;
const Chips = styled.div`display: flex; flex-wrap: wrap; gap: 6px;`;
const Chip = styled.button<{ $active: boolean }>`
  height: 36px; padding: 0 14px;
  background: ${p => p.$active ? '#F0FDFA' : '#FFFFFF'};
  color: ${p => p.$active ? '#0D9488' : '#475569'};
  border: 1px solid ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  border-radius: 999px;
  font-size: 0.8125rem; font-weight: ${p => p.$active ? 600 : 500};
  cursor: pointer;
  &:hover { border-color: ${p => p.$active ? '#14B8A6' : '#CBD5E1'}; }
  @media (max-width: 640px) { height: 40px; }
`;
const RemoveBtn = styled.button`
  width: 36px; height: 36px; border-radius: 8px;
  border: 1px solid #E2E8F0; background: #FFFFFF; color: #94A3B8;
  font-size: 1.125rem; cursor: pointer;
  &:hover { color: #475569; border-color: #CBD5E1; }
  @media (max-width: 640px) { width: 40px; height: 40px; }
`;
const AddBtn = styled.button`
  align-self: flex-start;
  background: none; border: none; padding: 4px 0;
  color: #0D9488; font-size: 0.8125rem; font-weight: 600; cursor: pointer;
  &:hover { text-decoration: underline; }
`;
const Input = styled.input`
  height: 40px; padding: 0 12px;
  font-size: 0.875rem; color: #0F172A; background: #FFFFFF;
  border: 1px solid #E2E8F0; border-radius: 8px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
  @media (max-width: 640px) { font-size: 1rem; }
`;
