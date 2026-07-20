// 사용량 80%+ 한도 항목 사전 경고 카드 — DashboardPage 에 노출.
// 빨간 한도 도달 모달과 별도 — 이건 노란색 사전 안내.
//
// 2026-05-05 도입.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import { canPurchaseInApp } from '../../utils/purchase';

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

  // 한도 초과 항목 1개 이상이면 "초과" 톤으로 — 카드 색상·제목 강조.
  const anyOver = items.some(it => it.pct >= 1);

  return (
    <Wrap role="alert" $over={anyOver}>
      <Header>
        <TitleArea>
          <Title $over={anyOver}>
            {anyOver
              ? t('usageWarn.titleOver', '한도를 초과한 항목이 있어요')
              : t('usageWarn.title', '한도가 거의 찼습니다')}
          </Title>
          {anyOver && (
            <Subtitle>{t('usageWarn.subtitleOver', '초과 상태에선 신규 추가가 차단됩니다. 플랜을 올리거나 기존 항목을 정리하세요.')}</Subtitle>
          )}
        </TitleArea>
        <CtaGroup>
          <CtaLink to="/business/settings/plan#usage">{t('usageWarn.detail', '사용량 자세히')}</CtaLink>
          {/* App Store 3.1.1 — 네이티브에선 구매 유도 CTA 숨김. 사용량 확인 링크는 정보라 유지 */}
          {canPurchaseInApp() && (
            <CtaPrimary to="/business/settings/plan" $danger={anyOver}>
              {anyOver
                ? t('usageWarn.ctaUpgrade', '지금 업그레이드')
                : t('usageWarn.cta', '플랜·Add-on')}
            </CtaPrimary>
          )}
        </CtaGroup>
      </Header>
      <List>
        {items.map(it => {
          const over = it.pct >= 1;
          // 표시 정책: percent cap 100%+ (160% 같은 부풀린 수치 노출 X), 실제 초과량 별도 라벨.
          const pctLabel = over ? '100%+' : `${Math.round(it.pct * 100)}%`;
          const overBy = over ? Math.max(0, it.current - it.limit) : 0;
          return (
            <Row key={it.key} $danger={over}>
              <RowLabel>{it.label}</RowLabel>
              <RowMeta>
                {(it.format ? it.format(it.current) : it.current.toLocaleString())} / {it.format ? it.format(it.limit) : it.limit.toLocaleString()}
                <Pct $over={over}>{pctLabel}</Pct>
                {over && overBy > 0 && !it.format && (
                  <OverBy>{t('usageWarn.overBy', { count: overBy, defaultValue: '({{count}} 초과)' })}</OverBy>
                )}
              </RowMeta>
              <Bar>
                <BarFill style={{ width: `${Math.min(100, it.pct * 100)}%` }} $danger={over} />
              </Bar>
            </Row>
          );
        })}
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

// 초과 상태일 때는 빨간 톤 (Error), 아니면 노란 톤 (Warning).
const Wrap = styled.div<{ $over?: boolean }>`
  background: ${p => p.$over ? '#FEF2F2' : '#FFFBEB'};
  border: 1px solid ${p => p.$over ? '#FECACA' : '#FDE68A'};
  border-radius: 10px;
  padding: 14px 16px 16px;
  margin-bottom: 16px;
`;
const Header = styled.div`
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
`;
const TitleArea = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  flex: 1; min-width: 200px;
`;
const Title = styled.div<{ $over?: boolean }>`
  font-size: 14px; font-weight: 700;
  color: ${p => p.$over ? '#991B1B' : '#78350F'};
`;
const Subtitle = styled.div`
  font-size: 12px; color: #991B1B; line-height: 1.5;
`;
const CtaGroup = styled.div`
  display: flex; align-items: center; gap: 8px; flex-shrink: 0;
`;
const CtaLink = styled(Link)`
  font-size: 13px; font-weight: 600;
  color: #64748B; text-decoration: underline;
  &:hover { color: #334155; }
`;
// 사이클 N+20 — 초과 상태일 때 Primary 강조 (Danger red), 경고만일 때 amber.
const CtaPrimary = styled(Link)<{ $danger?: boolean }>`
  display: inline-flex; align-items: center;
  height: 36px; padding: 0 14px;
  font-size: 13px; font-weight: 600;
  color: #FFFFFF;
  background: ${p => p.$danger ? '#DC2626' : '#B45309'};
  border-radius: 8px;
  text-decoration: none;
  transition: background 0.15s;
  &:hover { background: ${p => p.$danger ? '#B91C1C' : '#92400E'}; }
`;
const OverBy = styled.span`
  font-size: 11px;
  color: #B91C1C;
  font-weight: 600;
  margin-left: 4px;
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
const Pct = styled.span<{ $over?: boolean }>`
  font-weight: 700;
  color: ${p => p.$over ? '#B91C1C' : 'inherit'};
`;
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
