// 워크스페이스 결제 상태 배너 — past_due / grace / demoted
//
// 표시 조건:
//   subscription_status === 'past_due'  → 노랑 (D-day, 결제일 지남, 그러나 cron 전)
//   subscription.status === 'grace'     → 빨강 (D+1 ~ D+7, 강등 임박)
//   plan === 'free' && 직전이 paid 였음 → 회색 (이미 강등됨, 데이터 보존, 결제 시 즉시 복구)
//
// 클릭 → /business/settings/plan (결제 페이지)

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStatus, type PlanStatus } from '../../services/plan';

type BannerKind = 'past_due' | 'grace' | 'demoted' | null;

function pickBanner(status: PlanStatus | null): BannerKind {
  if (!status) return null;
  // grace: subscription.status='grace' 또는 subscription_status='past_due'
  if (status.subscription?.status === 'grace') return 'grace';
  if (status.subscription?.status === 'past_due') return 'past_due';
  if (status.subscription_status === 'past_due') return 'past_due';
  if (status.subscription?.status === 'demoted') return 'demoted';
  return null;
}

function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

export default function WorkspaceBillingBanner() {
  const { t } = useTranslation('plan');
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // #39 — 플랫폼 관리자 영역(/admin/*)에선 워크스페이스 빌링 배너 숨김 (다른 컨텍스트라 혼동 방지).
  const onPlatformAdmin = location.pathname.startsWith('/admin');

  const load = useCallback(() => {
    if (!user?.business_id || user.business_role === 'client') { setStatus(null); return; }
    fetchStatus(Number(user.business_id)).then(setStatus).catch(() => setStatus(null));
  }, [user?.business_id, user?.business_role]);

  useEffect(() => { load(); }, [load]);

  // #40 — 결제·입금확인이 페이지 열린 채 일어나면 mount 1회 조회론 stale. focus/visibility 복귀 시
  //   재조회해 active 전환을 즉시 반영(배너 자동 소멸). 새로고침 불필요.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
    return () => { window.removeEventListener('focus', onFocus); };
  }, [load]);

  const kind = pickBanner(status);
  if (!kind || dismissed || onPlatformAdmin) return null;

  const graceEndsIn = kind === 'grace' ? daysLeft(status?.subscription?.grace_ends_at || null) : null;
  const periodEndedAt = status?.subscription?.current_period_end || null;

  // grace/past_due 는 미결제 청구가 있으므로 ?pay=1 로 진입 → 결제 모달(청구 내역+입금 안내) 자동 오픈.
  // demoted(이미 free 강등) 는 미결제 건 없이 재구독이라 플랜 선택 화면 그대로.
  const handleClick = () => {
    const hasPending = !!status?.pending_payment;
    navigate(hasPending && kind !== 'demoted' ? '/business/settings/plan?pay=1' : '/business/settings/plan');
  };

  return (
    <Wrap $kind={kind}>
      <Content onClick={handleClick} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') handleClick(); }}>
        <Icon $kind={kind}>
          {kind === 'demoted' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          )}
        </Icon>
        <Body>
          <Title>
            {kind === 'past_due' && t('banner.pastDue.title')}
            {kind === 'grace' && t('banner.grace.title', { days: graceEndsIn ?? 7 })}
            {kind === 'demoted' && t('banner.demoted.title')}
          </Title>
          <Desc>
            {kind === 'past_due' && periodEndedAt && t('banner.pastDue.desc', { date: new Date(periodEndedAt).toISOString().slice(0, 10) })}
            {kind === 'grace' && t('banner.grace.desc')}
            {kind === 'demoted' && t('banner.demoted.desc')}
          </Desc>
        </Body>
        <CTA>{t('banner.cta')}</CTA>
      </Content>
      <CloseBtn type="button" onClick={() => setDismissed(true)} aria-label={t('banner.dismiss')}>×</CloseBtn>
    </Wrap>
  );
}

const KIND_BG: Record<Exclude<BannerKind, null>, string> = {
  past_due: '#FEF3C7',
  grace: '#FEE2E2',
  demoted: '#F1F5F9',
};
const KIND_BORDER: Record<Exclude<BannerKind, null>, string> = {
  past_due: '#F59E0B',
  grace: '#EF4444',
  demoted: '#CBD5E1',
};
const KIND_FG: Record<Exclude<BannerKind, null>, string> = {
  past_due: '#92400E',
  grace: '#B91C1C',
  demoted: '#475569',
};

const Wrap = styled.div<{ $kind: Exclude<BannerKind, null> }>`
  position: relative;
  flex-shrink: 0;
  display: flex; align-items: center;
  background: ${p => KIND_BG[p.$kind]};
  border-bottom: 1px solid ${p => KIND_BORDER[p.$kind]};
  color: ${p => KIND_FG[p.$kind]};
`;
const Content = styled.div`
  flex: 1; display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; cursor: pointer;
  &:hover { background: rgba(0,0,0,0.04); }
  /* 모바일: 1단 흐름 */
  @media (max-width: 640px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
`;
const Icon = styled.div<{ $kind: Exclude<BannerKind, null> }>`
  display: inline-flex; flex-shrink: 0; color: ${p => KIND_FG[p.$kind]};
  /* 모바일: 아이콘 숨김 */
  @media (max-width: 640px) { display: none; }
`;
const Body = styled.div`
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
  /* 모바일: 인라인 흐름 */
  @media (max-width: 640px) {
    display: inline;
  }
`;
const Title = styled.span`
  font-size: 13px; font-weight: 700; line-height: 1.4;
  display: block;
  /* 모바일: 인라인 */
  @media (max-width: 640px) { display: inline; }
`;
const Desc = styled.span`
  font-size: 12px; opacity: 0.9; line-height: 1.4;
  display: block;
  /* 모바일: 인라인, 제목 뒤 줄바꿈 */
  @media (max-width: 640px) { display: block; margin-top: 2px; }
`;
const CTA = styled.span`
  font-size: 12px; font-weight: 700;
  padding: 6px 12px; background: rgba(255,255,255,0.6);
  border-radius: 999px; flex-shrink: 0;
  text-decoration: underline;
  /* 모바일: 인라인 링크 스타일 */
  @media (max-width: 640px) {
    padding: 0;
    background: none;
    margin-top: 4px;
    &::after { content: ' →'; }
  }
`;
const CloseBtn = styled.button`
  background: transparent; border: none; cursor: pointer; color: inherit;
  font-size: 18px; padding: 6px 14px;
  &:hover { opacity: 0.7; }
  /* 모바일: 우상단 고정 */
  @media (max-width: 640px) {
    position: absolute;
    top: 4px;
    right: 4px;
  }
`;
