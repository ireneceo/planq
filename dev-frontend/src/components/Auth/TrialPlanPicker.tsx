// TrialPlanPicker — 새 워크스페이스를 «어떻게 쓸지» 고르는 라디오 3개(혼자 Starter · 팀 Basic · 큰 팀 Pro).
//
// 2026-10-09 Irene: *"처음에 혼자 쓸지 말지 선택 가능한거 아니야? 플랜마다 다른 거잖아."*
//   가입은 늘 Starter(멤버 1명) 체험이라 새 팀이 첫날 «팀원 초대» 에서 막혔다.
//
// ★ 한 벌이다 — 회원가입 화면과 «새 워크스페이스 만들기» 창이 같이 쓴다(따로 그리면 선택지·문구가 갈린다).
// ★ 고른 값은 서버가 다시 거른다(config/plans.resolveTrialPlan — 모르는 값은 starter). 여기는 표시만.
// ★ 플랜 이름·가격 글자는 요금제 화면과 같은 키(landing pricingPage.plans.*)를 읽는다 — 두 곳이 다른 가격을 말하면 안 된다.
// ★ 체험 중 AI·녹음 한도는 플랜과 무관하게 같다(TRIAL_COST_CAPS) — 그래서 그 한 줄을 같이 보여 준다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export const TRIAL_PLAN_OPTIONS = ['starter', 'basic', 'pro'] as const;
export type TrialPlanCode = typeof TRIAL_PLAN_OPTIONS[number];
/** 요금제 화면 «추천» 과 같은 값 — 서버 DEFAULT_SIGNUP_PLAN 과 맞춘다 */
export const DEFAULT_TRIAL_PLAN: TrialPlanCode = 'basic';

export function parseTrialPlan(v: string | null | undefined): TrialPlanCode | null {
  return (TRIAL_PLAN_OPTIONS as readonly string[]).includes(v || '') ? (v as TrialPlanCode) : null;
}

const KIND: Record<TrialPlanCode, string> = { starter: 'solo', basic: 'team', pro: 'bigTeam' };

interface Props {
  value: TrialPlanCode;
  onChange: (v: TrialPlanCode) => void;
  disabled?: boolean;
  /** 좁은 창(새 워크스페이스 모달) — 가격 줄을 줄인다 */
  compact?: boolean;
}

const TrialPlanPicker: React.FC<Props> = ({ value, onChange, disabled, compact }) => {
  const { t } = useTranslation('auth');
  const { t: tl } = useTranslation('landing');
  return (
    <Wrap role="radiogroup" aria-label={t('trialPlan.title', '어떻게 쓰실 건가요?') as string} data-testid="trial-plan-picker">
      <Title>{t('trialPlan.title', '어떻게 쓰실 건가요?')}</Title>
      <Options>
        {TRIAL_PLAN_OPTIONS.map((code) => {
          const on = value === code;
          return (
            <Option
              key={code}
              type="button"
              role="radio"
              aria-checked={on}
              $on={on}
              disabled={disabled}
              data-testid={`trial-plan-${code}`}
              onClick={() => onChange(code)}
            >
              <Dot $on={on} aria-hidden="true" />
              <Body>
                <Name>{t(`trialPlan.${KIND[code]}.label`)}</Name>
                <Meta>
                  {tl(`pricingPage.plans.${code}.name`)} · {t(`trialPlan.${KIND[code]}.members`)}
                  {!compact && <> · {tl(`pricingPage.plans.${code}.price`)}</>}
                </Meta>
              </Body>
            </Option>
          );
        })}
      </Options>
      <Note>{t('trialPlan.note', '14일 무료 체험 · 체험 중 AI 실행 월 50회 · 녹음 60분 · 체험 중에 언제든 바꿀 수 있어요')}</Note>
    </Wrap>
  );
};

export default TrialPlanPicker;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Title = styled.div`font-size: 0.8125rem; font-weight: 700; color: #0F172A;`;
const Options = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Option = styled.button<{ $on: boolean }>`
  display: flex; align-items: center; gap: 10px;
  width: 100%; min-height: 44px; padding: 8px 12px; box-sizing: border-box;
  background: ${(p) => (p.$on ? '#F0FDFA' : '#FFFFFF')};
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  border-radius: 8px; cursor: pointer; text-align: left; font-family: inherit;
  transition: border-color 0.15s, background 0.15s;
  &:hover:not(:disabled) { border-color: ${(p) => (p.$on ? '#14B8A6' : '#94A3B8')}; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #5EEAD4; outline-offset: 2px; }
`;
const Dot = styled.span<{ $on: boolean }>`
  flex-shrink: 0; width: 16px; height: 16px; border-radius: 50%; box-sizing: border-box;
  border: ${(p) => (p.$on ? '5px solid #0D9488' : '1.5px solid #CBD5E1')};
  background: #FFFFFF;
`;
const Body = styled.span`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const Name = styled.span`font-size: 0.875rem; font-weight: 600; color: #0F172A;`;
const Meta = styled.span`font-size: 0.75rem; color: #64748B;`;
const Note = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
