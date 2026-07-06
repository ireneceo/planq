// 사이클 Q-G — Insights 통계·분석 진입점.
// 좌측 nav 의 2뎁스 메뉴 → /stats/{tab} 으로 진입하면 각 TabComponent 가 마운트됨.
// 페이지는 PageShell + 기간 셀렉터 + 탭별 컴포넌트.

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import PlanQSelect, { type PlanQSelectOption } from '../../components/Common/PlanQSelect';
import { useAuth } from '../../contexts/AuthContext';
import type { RangePreset, StatsSegment } from '../../services/insights';
import styled from 'styled-components';
import TasksTab from './tabs/TasksTab';
import OverviewTab from './tabs/OverviewTab';
import ProfitTab from './tabs/ProfitTab';
import TeamTab from './tabs/TeamTab';
import FinanceTab from './tabs/FinanceTab';
import ReportsTab from './tabs/ReportsTab';
import WeeklyTrendTab from './tabs/WeeklyTrendTab';

type TabKey = 'overview' | 'tasks' | 'weekly' | 'profit' | 'team' | 'finance' | 'reports';
const ALL_TABS: TabKey[] = ['overview', 'tasks', 'weekly', 'profit', 'team', 'finance', 'reports'];

const RANGE_OPTIONS: PlanQSelectOption[] = [
  { value: '7d',         label: 'Last 7 days' },
  { value: '30d',        label: 'Last 30 days' },
  { value: '90d',        label: 'Last 90 days' },
  { value: 'month',      label: 'This month' },
  { value: 'prev-month', label: 'Last month' },
  { value: 'quarter',    label: 'This quarter' },
];

const InsightsPage: React.FC = () => {
  const { t } = useTranslation('insights');
  const navigate = useNavigate();
  const { user } = useAuth();
  // user.business_id 우선, 없으면 첫 워크스페이스 fallback (platform_admin 같이 active workspace 없는 케이스)
  const bizId = user?.business_id
    ? Number(user.business_id)
    : (user?.workspaces?.[0]?.business_id ? Number(user.workspaces[0].business_id) : null);

  const [params, setParams] = useSearchParams();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const tab: TabKey = (ALL_TABS.includes(tabParam as TabKey) ? tabParam : 'overview') as TabKey;
  const range = (params.get('range') as RangePreset) || '30d';
  const segment = (['all', 'client', 'internal'].includes(params.get('segment') || '') ? params.get('segment') : 'client') as StatsSegment;
  // 세그먼트 토글은 수익성(profit) 탭에만 — 전용 '내부 투자' 뷰가 있는 유일한 탭.
  //   overview/team/finance 는 매출/가동률이 본질적으로 고객 기반이라 항상 고객(internal 제외) 집계.
  const segmentTabs: TabKey[] = ['profit'];
  const showSegment = segmentTabs.includes(tab);

  // 잘못된 path → /stats/overview 로 정정
  useEffect(() => {
    if (tabParam && !ALL_TABS.includes(tabParam as TabKey)) {
      navigate('/stats/overview', { replace: true });
    }
  }, [tabParam, navigate]);

  const setRange = (r: string) => {
    const next = new URLSearchParams(params);
    next.set('range', r);
    setParams(next, { replace: true });
  };
  const setSegment = (s: StatsSegment) => {
    const next = new URLSearchParams(params);
    next.set('segment', s);
    setParams(next, { replace: true });
  };

  const headerActions = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {showSegment && (
        <SegGroup role="group" aria-label={t('segment.label', '프로젝트 구분') as string}>
          {(['client', 'internal', 'all'] as StatsSegment[]).map((s) => (
            <SegBtn key={s} type="button" $active={segment === s} onClick={() => setSegment(s)}>
              {t(`segment.${s}`, s === 'client' ? '고객' : s === 'internal' ? '내부' : '전체')}
            </SegBtn>
          ))}
        </SegGroup>
      )}
      <PlanQSelect
        size="sm"
        isClearable={false}
        isSearchable={false}
        value={RANGE_OPTIONS.find((o) => o.value === range) || RANGE_OPTIONS[1]}
        options={RANGE_OPTIONS}
        onChange={(opt) => opt && setRange((opt as PlanQSelectOption).value as string)}
      />
    </div>
  );

  // 탭별 페이지 타이틀 — 사이드바 메뉴와 일관 (UserChip + 기간 셀렉터 우측에 자연스럽게)
  const tabTitle = t(`tabs.${tab}`, tab);
  const pageTitle = `${t('title', '통계 · Insights')} · ${tabTitle}`;

  if (!bizId) {
    return (
      <PageShell title={pageTitle} actions={headerActions}>
        <div style={{
          background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12,
          padding: '60px 20px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
            {t('noWorkspace.title', '워크스페이스를 선택하세요')}
          </div>
          <div style={{ fontSize: 12, color: '#64748B' }}>
            {t('noWorkspace.hint', '좌측 상단에서 워크스페이스를 선택한 후 통계를 확인할 수 있습니다.')}
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={pageTitle} actions={headerActions}>
      {tab === 'overview' && <OverviewTab businessId={bizId} range={range} />}
      {tab === 'tasks' && <TasksTab businessId={bizId} range={range} />}
      {tab === 'weekly' && <WeeklyTrendTab businessId={bizId} />}
      {tab === 'profit' && <ProfitTab businessId={bizId} range={range} segment={segment} />}
      {tab === 'team' && <TeamTab businessId={bizId} range={range} />}
      {tab === 'finance' && <FinanceTab businessId={bizId} range={range} />}
      {tab === 'reports' && <ReportsTab businessId={bizId} range={range} />}
    </PageShell>
  );
};

const SegGroup = styled.div`display:inline-flex;background:#F1F5F9;border:1px solid #E2E8F0;border-radius:8px;padding:2px;gap:2px;`;
const SegBtn = styled.button<{ $active?: boolean }>`
  padding:5px 12px;font-size:12px;font-weight:600;border:none;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap;
  background:${p => p.$active ? '#FFFFFF' : 'transparent'};
  color:${p => p.$active ? '#0F766E' : '#64748B'};
  box-shadow:${p => p.$active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none'};
  &:hover{color:#0F766E;}
`;

export default InsightsPage;
