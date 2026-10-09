// 워크스페이스 trial / past_due / 잠금 상태 알림 배너.
// Dashboard 상단·PlanSettings 등에서 재사용. 잠금·마감 임박은 owner 가 아니어도 표시 (워크스페이스 상태이므로) —
// 단 팀원에게는 결제 버튼 없이 상태 문구만, 평상시 체험 안내는 오너에게만.
//
// 상태별 노출:
//   - active        → 미노출
//   - in_trial      → 잔여일 N (7일 초과: info teal / 7일 이하: warning amber)
//   - past_due/grace → grace_ends_at 까지 남은일 + 결제 CTA (danger red)
//   - canceled      → 잠금 안내 + 결제 복구 CTA (danger red)
//
// 클릭 → /business/settings/plan
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { canPurchaseInApp } from '../../utils/purchase';

interface PlanStatus {
  plan: { code: string; name?: string };
  active: boolean;
  in_trial: boolean;
  in_grace: boolean;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  subscription_status: string | null;
  // 결제 면제 (운영 #275). services/plan.ts 의 PlanStatus 와 같은 필드 — 이 컴포넌트가
  // 로컬 타입을 따로 쓰므로 양쪽에 있어야 한다.
  exempt?: boolean;
  // 「지금 결제하면 +N개월」 자격 — 서버 판정(billing.isFirstPlanPayment). 화면이 결제 이력을 세지 않는다.
  prepay_bonus?: { available: boolean; months: number; option: string } | null;
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
  const { user } = useAuth();
  const isOwner = user?.business_role === 'owner' || user?.platform_role === 'platform_admin';
  const [status, setStatus] = useState<PlanStatus | null>(null);

  const load = useCallback(() => {
    if (!businessId) return;
    apiFetch(`/api/plan/${businessId}/status`)
      .then(r => r.json())
      .then(j => { if (j?.success) setStatus(j.data); })
      .catch(() => {});
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  // ★ 결제·입금확인·면제 설정이 이 페이지를 열어둔 채 일어나면 mount 1회 조회로는 stale 이다.
  //   그 상태로 두면 "면제 켰는데 잠금 배너가 그대로" 가 된다 — 고친 사실이 화면에 도달하지 못한다
  //   (memory feedback_fixed_but_unreachable). WorkspaceBillingBanner 와 같은 패턴.
  useEffect(() => {
    const onFocus = () => load();
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  if (!status || !businessId) return null;

  // 결제 면제 워크스페이스(내부·테스터)에는 체험/잠금/결제 안내를 띄우지 않는다 (운영 #275).
  if (status.exempt) return null;

  // active 정상 사용 중 → 배너 미노출
  if (status.subscription_status === 'active' && !status.in_trial) return null;

  let tone: Tone = 'info';
  let title = '';
  let desc = '';
  let cta = t('trialBanner.cta.openPlan', '결제 페이지');
  let ctaTo = '/business/settings/plan';

  // App Store 3.1.1 — 네이티브 앱에선 명령형 결제 유도 문구(미리 결제하세요 등)도 리젝 회색지대라
  //   상태만 알리는 중립 문구로 대체한다. (CTA 숨김만으론 본문 유도 표현이 남음 — Fable 권고)
  // 결제는 오너 몫이다 — 결제 화면(/business/settings/plan)도 오너 메뉴다. 팀원에게는 결제 버튼·결제 유도 문구 대신
  //   네이티브와 같은 «상태만 알리는» 문구를 쓰고, 평상시 체험 안내(할 일이 없는 정보)는 보이지 않는다
  //   (2026-10-09 새 팀 첫 길 점검 — 팀원 첫 화면에 «Starter 체험 · 결제 페이지» 가 떠 있었다).
  const canPay = isOwner && canPurchaseInApp();
  const native = !canPay;

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
      if (!isOwner) return null;
      tone = 'info';
      // 체험 플랜은 가입 때 고른다(혼자 Starter · 팀 Basic · 큰 팀 Pro) — 이름을 박아 두면 팀 체험에도 «Starter» 가 떴다.
      const planName = status.plan?.name || status.plan?.code || '';
      title = t('trialBanner.trial.title', { days, plan: planName, defaultValue: '{{plan}} 체험 {{days}}일 남음' });
      desc = t('trialBanner.trial.desc', { plan: planName, defaultValue: '체험 기간 동안 모든 {{plan}} 기능을 사용할 수 있습니다.' });
    }
    // 「지금 결제하면 +N개월」 — 체험 중 오너에게 같은 카드에서 제안한다(2026-10-09 Irene: "결제를 먼저 하면 +1달 주는 거 안내해서 결제유도 하자").
    //   체험은 그대로 쓰고 유료 기간은 체험이 끝나는 날부터 시작한다(billing.resolvePeriodStart — 체험 잔여 승계).
    const pb = status.prepay_bonus;
    if (canPay && pb?.available && pb.months > 0) {
      desc = t('trialBanner.prepay.desc', {
        months: pb.months, total: pb.months + 1,
        defaultValue: '지금 결제하면 {{months}}개월을 더 드립니다 — 체험은 끝까지 그대로 쓰고, 체험이 끝나는 날부터 {{total}}개월 이용합니다.',
      });
      cta = t('trialBanner.prepay.cta', { months: pb.months, defaultValue: '+{{months}}개월 받고 결제' });
      ctaTo = '/business/settings/plan#prepay';
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
      {canPay && <CtaLink to={ctaTo} $tone={tone} data-testid="trial-banner-cta">{cta}</CtaLink>}
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
  font-size: 0.875rem; font-weight: 700;
  color: ${p => TONES[p.$tone].title};
`;
const Desc = styled.div<{ $tone: Tone }>`
  font-size: 0.8125rem; color: ${p => TONES[p.$tone].desc};
`;
const CtaLink = styled(Link)<{ $tone: Tone }>`
  flex-shrink: 0;
  padding: 8px 16px; border-radius: 8px;
  font-size: 0.8125rem; font-weight: 600;
  background: ${p => TONES[p.$tone].ctaBg};
  color: ${p => TONES[p.$tone].cta};
  text-decoration: none;
  transition: background 0.15s;
  &:hover { background: ${p => TONES[p.$tone].ctaHover}; }
`;
