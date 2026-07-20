// 워크스페이스 trial / past_due / 잠금 상태 알림 배너.
// Dashboard 상단·PlanSettings 등에서 재사용. 본인이 owner 가 아니어도 표시 (워크스페이스 상태이므로).
//
// 상태별 노출:
//   - active        → 미노출
//   - in_trial      → 잔여일 N (7일 초과: info teal / 7일 이하: warning amber)
//   - past_due/grace → grace_ends_at 까지 남은일 + 결제 CTA (danger red)
//   - canceled      → 잠금 안내 + 결제 복구 CTA (danger red)
//
// 클릭 → /business/settings/plan
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { canPurchaseInApp } from '../../utils/purchase';

interface PlanStatus {
  plan: { code: string };
  active: boolean;
  in_trial: boolean;
  in_grace: boolean;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  subscription_status: string | null;
}

type Tone = 'info' | 'warn' | 'danger';

interface Props {
  businessId: number | null;
}

const daysBetween = (iso: string | null): number => {
  if (!iso) return 0;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
};

const TrialStatusBanner: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<PlanStatus | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let active = true;
    apiFetch(`/api/plan/${businessId}/status`)
      .then(r => r.json())
      .then(j => { if (active && j?.success) setStatus(j.data); })
      .catch(() => {});
    return () => { active = false; };
  }, [businessId]);

  if (!status || !businessId) return null;

  // active 정상 사용 중 → 배너 미노출
  if (status.subscription_status === 'active' && !status.in_trial) return null;

  let tone: Tone = 'info';
  let title = '';
  let desc = '';
  let cta = t('trialBanner.cta.openPlan', '결제 페이지');

  // App Store 3.1.1 — 네이티브 앱에선 명령형 결제 유도 문구(미리 결제하세요 등)도 리젝 회색지대라
  //   상태만 알리는 중립 문구로 대체한다. (CTA 숨김만으론 본문 유도 표현이 남음 — Fable 권고)
  const native = !canPurchaseInApp();

  if (status.subscription_status === 'canceled') {
    tone = 'danger';
    title = native
      ? t('trialBanner.canceled.titleNative', '워크스페이스가 잠겨 있습니다')
      : t('trialBanner.canceled.title', '워크스페이스 잠금 — 결제 후 복구됩니다');
    desc = native
      ? t('trialBanner.canceled.descNative', '현재 워크스페이스 사용이 제한된 상태입니다.')
      : t('trialBanner.canceled.desc', '결제 확인 시 즉시 정상 사용 가능합니다.');
    cta = t('trialBanner.cta.payNow', '결제하기');
  } else if (status.in_grace || status.subscription_status === 'past_due') {
    tone = 'danger';
    const days = daysBetween(status.grace_ends_at);
    title = native
      ? t('trialBanner.pastDue.titleNative', '체험 종료 — 접근 마감 {{days}}일 남음', { days: Math.max(days, 0) })
      : t('trialBanner.pastDue.title', '체험 종료 — 결제 마감 {{days}}일 남음', { days: Math.max(days, 0) });
    desc = native
      ? t('trialBanner.pastDue.descNative', '기간이 지나면 워크스페이스 기능이 제한됩니다.')
      : t('trialBanner.pastDue.desc', '결제하지 않으면 워크스페이스가 잠금됩니다.');
    cta = t('trialBanner.cta.payNow', '결제하기');
  } else if (status.in_trial) {
    const days = daysBetween(status.trial_ends_at);
    if (days <= 7) {
      tone = 'warn';
      title = native
        ? t('trialBanner.trialEnding.titleNative', '체험 {{days}}일 남음', { days })
        : t('trialBanner.trialEnding.title', '체험 {{days}}일 남음 — 결제 안내', { days });
      desc = native
        ? t('trialBanner.trialEnding.descNative', '체험 종료 후 일부 기능이 제한됩니다.')
        : t('trialBanner.trialEnding.desc', '체험 종료 후 자동 잠금되지 않도록 미리 결제하세요.');
    } else {
      tone = 'info';
      title = t('trialBanner.trial.title', 'Starter 체험 {{days}}일 남음', { days });
      desc = t('trialBanner.trial.desc', '체험 기간 동안 모든 Starter 기능을 사용할 수 있습니다.');
    }
  } else {
    return null;
  }

  return (
    <Wrap $tone={tone} role="status">
      <Texts>
        <Title $tone={tone}>{title}</Title>
        <Desc $tone={tone}>{desc}</Desc>
      </Texts>
      {/* App Store 3.1.1 — 네이티브에선 구매 유도 CTA 숨김 */}
      {canPurchaseInApp() && <CtaLink to="/business/settings/plan" $tone={tone}>{cta}</CtaLink>}
    </Wrap>
  );
};

export default TrialStatusBanner;

const TONES: Record<Tone, { bg: string; border: string; title: string; desc: string; cta: string; ctaBg: string; ctaHover: string }> = {
  info:   { bg: '#F0FDFA', border: '#99F6E4', title: '#0F172A', desc: '#0F766E', cta: '#FFFFFF', ctaBg: '#14B8A6', ctaHover: '#0D9488' },
  warn:   { bg: '#FFFBEB', border: '#FDE68A', title: '#78350F', desc: '#92400E', cta: '#FFFFFF', ctaBg: '#D97706', ctaHover: '#B45309' },
  danger: { bg: '#FEF2F2', border: '#FECACA', title: '#7F1D1D', desc: '#B91C1C', cta: '#FFFFFF', ctaBg: '#DC2626', ctaHover: '#B91C1C' },
};

const Wrap = styled.div<{ $tone: Tone }>`
  display: flex; align-items: center; gap: 16px;
  padding: 14px 18px;
  background: ${p => TONES[p.$tone].bg};
  border: 1px solid ${p => TONES[p.$tone].border};
  border-radius: 10px;
  margin-bottom: 16px;
  @media (max-width: 640px) { flex-direction: column; align-items: flex-start; }
`;
const Texts = styled.div` flex: 1; display: flex; flex-direction: column; gap: 2px; `;
const Title = styled.div<{ $tone: Tone }>`
  font-size: 14px; font-weight: 700;
  color: ${p => TONES[p.$tone].title};
`;
const Desc = styled.div<{ $tone: Tone }>`
  font-size: 13px; color: ${p => TONES[p.$tone].desc};
`;
const CtaLink = styled(Link)<{ $tone: Tone }>`
  flex-shrink: 0;
  padding: 8px 16px; border-radius: 8px;
  font-size: 13px; font-weight: 600;
  background: ${p => TONES[p.$tone].ctaBg};
  color: ${p => TONES[p.$tone].cta};
  text-decoration: none;
  transition: background 0.15s;
  &:hover { background: ${p => TONES[p.$tone].ctaHover}; }
`;
