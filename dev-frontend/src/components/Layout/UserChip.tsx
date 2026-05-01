// UserChip — 페이지 헤더 우측 상단 chip.
// 대시보드(/dashboard, /)에서만 표시:
//   - 구독 플랜 배지 (클릭 → /business/settings/plan, 체험/유예 시 잔여일)
//   - 인사말 ("안녕하세요, {name}님")
// 그 외 페이지에서는 아무것도 렌더링하지 않음.
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import { useAuth } from '../../contexts/AuthContext';
import { displayName } from '../../utils/displayName';
import { fetchStatus, type PlanStatus, type PlanCode } from '../../services/plan';

const daysUntil = (iso: string | null): number => {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
};

const planTone = (code: PlanCode, inTrial: boolean, inGrace: boolean): { bg: string; fg: string; bd: string } => {
  if (inGrace) return { bg: '#FEF2F2', fg: '#B91C1C', bd: '#FECACA' };
  if (inTrial) return { bg: '#FFFBEB', fg: '#B45309', bd: '#FDE68A' };
  switch (code) {
    case 'free':       return { bg: '#F1F5F9', fg: '#475569', bd: '#E2E8F0' };
    case 'enterprise': return { bg: '#F5F3FF', fg: '#6D28D9', bd: '#DDD6FE' };
    default:           return { bg: '#F0FDFA', fg: '#0F766E', bd: '#CCFBF1' };
  }
};

const UserChip: React.FC = () => {
  const { t, i18n } = useTranslation('common');
  const { user } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState<PlanStatus | null>(null);

  const businessId = user?.business_id || 0;

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetchStatus(businessId).then(s => { if (!cancelled) setStatus(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [businessId]);

  if (!user) return null;

  const onDashboard = location.pathname === '/dashboard' || location.pathname === '/';
  if (!onDashboard) return null;

  const name = displayName(user, i18n.language);

  const planLabel = status
    ? (i18n.language === 'ko' ? (status.plan.name_ko || status.plan.name) : status.plan.name)
    : null;

  const trialDays = status?.in_trial ? daysUntil(status.trial_ends_at) : 0;
  const graceDays = status?.in_grace ? daysUntil(status.grace_ends_at) : 0;

  const tone = status ? planTone(status.plan.code, status.in_trial, status.in_grace) : null;

  return (
    <Wrap>
      <ChipLink to="/profile" title={t('userChip.title', { defaultValue: '내 프로필' }) as string}>
        <Greeting>{t('userChip.greeting', { name, defaultValue: '안녕하세요, {{name}}님' })}</Greeting>
      </ChipLink>
      {status && tone && planLabel && (
        <PlanBadge
          to="/business/settings/plan"
          $bg={tone.bg}
          $fg={tone.fg}
          $bd={tone.bd}
          title={t('userChip.planTitle', { defaultValue: '구독 플랜' }) as string}
        >
          <span>{planLabel}</span>
          {trialDays > 0 && (
            <SubText>{t('userChip.trialDays', { days: trialDays, defaultValue: '체험 {{days}}일' })}</SubText>
          )}
          {graceDays > 0 && (
            <SubText>{t('userChip.graceDays', { days: graceDays, defaultValue: '유예 {{days}}일' })}</SubText>
          )}
        </PlanBadge>
      )}
    </Wrap>
  );
};

export default UserChip;

const Wrap = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;
const PlanBadge = styled(Link)<{ $bg: string; $fg: string; $bd: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  color: ${p => p.$fg};
  background: ${p => p.$bg};
  border: 1px solid ${p => p.$bd};
  border-radius: 999px;
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.15s;
  &:hover { filter: brightness(0.97); }
  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.3);
  }
`;
const SubText = styled.span`
  font-size: 11px;
  font-weight: 500;
  opacity: 0.85;
  &::before { content: '·'; margin-right: 4px; opacity: 0.6; }
`;
const ChipLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #64748B;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.15s;
  &:hover {
    color: #0F766E;
    background: #F0FDFA;
    border-color: #CCFBF1;
  }
  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.3);
  }
`;
const Greeting = styled.span`
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
`;
