// 사용량 80%+ 한도 항목 사전 경고 카드 — DashboardPage 에 노출.
// 빨간 한도 도달 모달과 별도 — 이건 노란색 사전 안내.
//
// 2026-05-05 도입.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';

interface UsageBlock {
  members: number;
  clients: number;
  projects: number;
  conversations: number;
  storage_bytes: number;
  cue_actions_this_month: number;
  qnote_minutes_this_month: number;
}

interface PlanLimits {
  members_max: number | null;
  clients_max: number | null;
  projects_max: number | null;
  conversations_max: number | null;
  storage_bytes: number | null;
  cue_actions_monthly: number | null;
  qnote_minutes_monthly: number | null;
}

const WARN_THRESHOLD = 0.8;

interface Props {
  businessId: number | null;
}

const UsageWarningCard: React.FC<Props> = ({ businessId }) => {
  const { t } = useTranslation('common');
  const [usage, setUsage] = useState<UsageBlock | null>(null);
  const [limits, setLimits] = useState<PlanLimits | null>(null);

  useEffect(() => {
    if (!businessId) return;
    let mounted = true;
    apiFetch(`/api/plan/${businessId}/status`)
      .then(r => r.json())
      .then(j => {
        if (!mounted || !j?.success) return;
        setUsage(j.data.usage);
        setLimits(j.data.plan?.limits);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [businessId]);

  if (!usage || !limits) return null;

  const items: { key: string; label: string; current: number; limit: number; pct: number; format?: (n: number) => string }[] = [];
  const push = (key: string, labelKey: string, current: number, limit: number | null, fmt?: (n: number) => string) => {
    if (limit == null || limit === 0) return;
    const pct = current / limit;
    if (pct < WARN_THRESHOLD) return;
    items.push({ key, label: t(labelKey), current, limit, pct, format: fmt });
  };

  push('members',  'usageWarn.members',  usage.members,                  limits.members_max);
  push('clients',  'usageWarn.clients',  usage.clients,                  limits.clients_max);
  push('projects', 'usageWarn.projects', usage.projects,                 limits.projects_max);
  push('storage',  'usageWarn.storage',  usage.storage_bytes,            limits.storage_bytes,        fmtBytes);
  push('cue',      'usageWarn.cue',      usage.cue_actions_this_month,   limits.cue_actions_monthly);
  push('qnote',    'usageWarn.qnote',    usage.qnote_minutes_this_month, limits.qnote_minutes_monthly, fmtMinutes);

  if (items.length === 0) return null;

  return (
    <Wrap role="alert">
      <Header>
        <Title>{t('usageWarn.title', '한도가 거의 찼습니다')}</Title>
        <CtaLink to="/business/settings/plan">{t('usageWarn.cta', '플랜·Add-on')}</CtaLink>
      </Header>
      <List>
        {items.map(it => (
          <Row key={it.key} $danger={it.pct >= 1}>
            <RowLabel>{it.label}</RowLabel>
            <RowMeta>
              {(it.format ? it.format(it.current) : it.current.toLocaleString())} / {it.format ? it.format(it.limit) : it.limit.toLocaleString()}
              <Pct>{Math.round(it.pct * 100)}%</Pct>
            </RowMeta>
            <Bar>
              <BarFill style={{ width: `${Math.min(100, it.pct * 100)}%` }} $danger={it.pct >= 1} />
            </Bar>
          </Row>
        ))}
      </List>
    </Wrap>
  );
};

export default UsageWarningCard;

function fmtBytes(n: number) {
  if (n >= 1024 ** 3) return `${(n / (1024 ** 3)).toFixed(1)}GB`;
  if (n >= 1024 ** 2) return `${(n / (1024 ** 2)).toFixed(0)}MB`;
  return `${(n / 1024).toFixed(0)}KB`;
}
function fmtMinutes(n: number) {
  if (n >= 60) return `${(n / 60).toFixed(1)}h`;
  return `${n}m`;
}

const Wrap = styled.div`
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-radius: 10px;
  padding: 14px 16px 16px;
  margin-bottom: 16px;
`;
const Header = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
`;
const Title = styled.div` font-size: 14px; font-weight: 700; color: #78350F; `;
const CtaLink = styled(Link)`
  font-size: 13px; font-weight: 600; color: #B45309;
  text-decoration: underline;
  &:hover { color: #92400E; }
`;
const List = styled.div` display: flex; flex-direction: column; gap: 8px; `;
const Row = styled.div<{ $danger: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  column-gap: 12px;
  align-items: baseline;
`;
const RowLabel = styled.div` font-size: 13px; color: #78350F; font-weight: 600; `;
const RowMeta = styled.div`
  font-size: 12px; color: #92400E;
  display: flex; gap: 8px; align-items: baseline;
`;
const Pct = styled.span` font-weight: 700; `;
const Bar = styled.div`
  grid-column: 1 / -1;
  height: 4px; border-radius: 2px;
  background: #FEF3C7; overflow: hidden;
`;
const BarFill = styled.div<{ $danger: boolean }>`
  height: 100%;
  background: ${p => p.$danger ? '#DC2626' : '#D97706'};
  transition: width 0.4s ease-out;
`;
