// 플랫폼 관리자 대시보드 — 실 API (/api/admin/overview)
// KPI(워크스페이스·사용자·구독·수익) + 활성 플랜 분포 + 6개월 가입 추이 + 관리 바로가기
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { apiFetch } from '../../contexts/AuthContext';
import { fmtKRW, fmtNum } from '../Insights/components';

interface Overview {
  businesses: { total: number; new_30d: number };
  users: { total: number; new_30d: number };
  subscriptions: { active: number; grace: number; pending: number; total: number; by_plan: Record<string, number> };
  revenue: { month_paid: number; pending_amount: number };
  signups: { month: string; count: number }[];
}

const AdminDashboardPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch('/api/admin/overview')
      .then((r) => r.json())
      .then((j) => { if (!alive) return; if (j.success) { setData(j.data); setErr(null); } else setErr(j.message || 'failed'); })
      .catch((e) => { if (alive) setErr(e?.message || 'failed'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const maxSignup = data ? Math.max(1, ...data.signups.map((s) => s.count)) : 1;
  const planEntries = data ? Object.entries(data.subscriptions.by_plan).sort((a, b) => b[1] - a[1]) : [];
  const maxPlan = planEntries.length ? Math.max(1, ...planEntries.map(([, n]) => n)) : 1;

  return (
    <PageShell title={t('dashboard.title', '플랫폼 대시보드')}>
      {loading ? (
        <KpiGrid>{[0, 1, 2, 3, 4, 5].map((i) => <SkeletonCard key={i} />)}</KpiGrid>
      ) : err ? (
        <ErrorBox>{t('dashboard.error', '데이터를 불러오지 못했습니다')} — {err}</ErrorBox>
      ) : data ? (
        <>
          <KpiGrid>
            <Kpi>
              <KpiLabel>{t('dashboard.kpi.businesses', '워크스페이스')}</KpiLabel>
              <KpiValue>{fmtNum(data.businesses.total)}</KpiValue>
              <KpiSub>+{fmtNum(data.businesses.new_30d)} {t('dashboard.kpi.new30d', '최근 30일')}</KpiSub>
            </Kpi>
            <Kpi>
              <KpiLabel>{t('dashboard.kpi.users', '사용자')}</KpiLabel>
              <KpiValue>{fmtNum(data.users.total)}</KpiValue>
              <KpiSub>+{fmtNum(data.users.new_30d)} {t('dashboard.kpi.new30d', '최근 30일')}</KpiSub>
            </Kpi>
            <Kpi>
              <KpiLabel>{t('dashboard.kpi.activeSubs', '활성 구독')}</KpiLabel>
              <KpiValue>{fmtNum(data.subscriptions.active)}</KpiValue>
              <KpiSub>{t('dashboard.kpi.ofTotal', '전체 {{n}}', { n: fmtNum(data.subscriptions.total) })}</KpiSub>
            </Kpi>
            <Kpi>
              <KpiLabel>{t('dashboard.kpi.grace', '유예 중')}</KpiLabel>
              <KpiValue>{fmtNum(data.subscriptions.grace)}</KpiValue>
              <KpiSub>{t('dashboard.kpi.pending', '결제 대기 {{n}}', { n: fmtNum(data.subscriptions.pending) })}</KpiSub>
            </Kpi>
            <Kpi $accent>
              <KpiLabel>{t('dashboard.kpi.monthRevenue', '이번 달 수익')}</KpiLabel>
              <KpiValue>{fmtKRW(data.revenue.month_paid)}</KpiValue>
              <KpiSub>{t('dashboard.kpi.paidOnly', '결제 완료 기준')}</KpiSub>
            </Kpi>
            <Kpi>
              <KpiLabel>{t('dashboard.kpi.pendingAmount', '미수금')}</KpiLabel>
              <KpiValue>{fmtKRW(data.revenue.pending_amount)}</KpiValue>
              <KpiSub>{t('dashboard.kpi.pendingHint', '입금 대기 중')}</KpiSub>
            </Kpi>
          </KpiGrid>

          <Row>
            <Panel>
              <PanelTitle>{t('dashboard.signups.title', '워크스페이스 가입 추이')}</PanelTitle>
              <PanelHint>{t('dashboard.signups.hint', '최근 6개월')}</PanelHint>
              {data.signups.every((s) => s.count === 0) ? (
                <EmptyHint>{t('dashboard.empty', '데이터가 아직 없습니다')}</EmptyHint>
              ) : (
                <BarChart>
                  {data.signups.map((s) => (
                    <BarCol key={s.month}>
                      <BarValue>{s.count}</BarValue>
                      <Bar style={{ height: `${Math.round((s.count / maxSignup) * 100)}%` }} />
                      <BarLabel>{s.month.slice(2)}</BarLabel>
                    </BarCol>
                  ))}
                </BarChart>
              )}
            </Panel>

            <Panel>
              <PanelTitle>{t('dashboard.plans.title', '활성 구독 플랜 분포')}</PanelTitle>
              <PanelHint>{t('dashboard.plans.hint', '플랜별 활성 구독 수')}</PanelHint>
              {planEntries.length === 0 ? (
                <EmptyHint>{t('dashboard.empty', '데이터가 아직 없습니다')}</EmptyHint>
              ) : (
                <PlanList>
                  {planEntries.map(([plan, n]) => (
                    <PlanRow key={plan}>
                      <PlanName>{plan.toUpperCase()}</PlanName>
                      <PlanBarTrack><PlanBar style={{ width: `${Math.round((n / maxPlan) * 100)}%` }} /></PlanBarTrack>
                      <PlanCount>{fmtNum(n)}</PlanCount>
                    </PlanRow>
                  ))}
                </PlanList>
              )}
            </Panel>
          </Row>

          <Panel>
            <PanelTitle>{t('dashboard.quick.title', '관리 바로가기')}</PanelTitle>
            <QuickLinks>
              <QuickLink to="/admin/businesses">{t('dashboard.quick.businesses', '워크스페이스')}</QuickLink>
              <QuickLink to="/admin/users">{t('dashboard.quick.users', '사용자')}</QuickLink>
              <QuickLink to="/admin/subscriptions">{t('dashboard.quick.subscriptions', '구독')}</QuickLink>
              <QuickLink to="/admin/payments">{t('dashboard.quick.payments', '결제')}</QuickLink>
              <QuickLink to="/admin/audit-logs">{t('dashboard.quick.audit', '감사 로그')}</QuickLink>
            </QuickLinks>
          </Panel>
        </>
      ) : null}
    </PageShell>
  );
};

export default AdminDashboardPage;

const KpiGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px;
`;
const Kpi = styled.div<{ $accent?: boolean }>`
  background: #FFFFFF; border: 1px solid ${(p) => (p.$accent ? '#CCFBF1' : '#E2E8F0')}; border-radius: 12px;
  padding: 16px 18px; display: flex; flex-direction: column; gap: 4px;
  ${(p) => p.$accent && 'background: linear-gradient(135deg, #F0FDFA 0%, #FFFFFF 100%);'}
`;
const KpiLabel = styled.div`font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;`;
const KpiValue = styled.div`font-size: 26px; font-weight: 700; color: #0F172A; line-height: 1.1; word-break: break-word;`;
const KpiSub = styled.div`font-size: 11px; color: #94A3B8;`;
const SkeletonCard = styled.div`
  height: 92px; border-radius: 12px; border: 1px solid #E2E8F0;
  background: linear-gradient(90deg, #F8FAFC 25%, #F1F5F9 50%, #F8FAFC 75%); background-size: 200% 100%;
  animation: shimmer 1.4s infinite; @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;
const ErrorBox = styled.div`
  background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 12px; padding: 16px; font-size: 13px; color: #B91C1C;
`;
const Row = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const Panel = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 20px; margin-bottom: 16px;
`;
const PanelTitle = styled.h2`font-size: 13px; font-weight: 700; color: #0F172A; margin: 0;`;
const PanelHint = styled.div`font-size: 11px; color: #94A3B8; margin: 2px 0 14px;`;
const EmptyHint = styled.div`font-size: 12px; color: #94A3B8; padding: 24px; text-align: center;`;
const BarChart = styled.div`display: flex; align-items: flex-end; gap: 10px; height: 160px; padding-top: 8px;`;
const BarCol = styled.div`flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; height: 100%;`;
const BarValue = styled.div`font-size: 11px; font-weight: 700; color: #475569;`;
const Bar = styled.div`width: 100%; max-width: 40px; min-height: 4px; background: linear-gradient(180deg, #14B8A6 0%, #0D9488 100%); border-radius: 6px 6px 0 0; transition: height 0.2s;`;
const BarLabel = styled.div`font-size: 10px; color: #94A3B8;`;
const PlanList = styled.div`display: flex; flex-direction: column; gap: 12px; padding-top: 4px;`;
const PlanRow = styled.div`display: grid; grid-template-columns: 64px 1fr 40px; align-items: center; gap: 10px;`;
const PlanName = styled.div`font-size: 12px; font-weight: 700; color: #334155;`;
const PlanBarTrack = styled.div`background: #F1F5F9; border-radius: 999px; height: 10px; overflow: hidden;`;
const PlanBar = styled.div`height: 100%; background: linear-gradient(90deg, #14B8A6 0%, #0D9488 100%); border-radius: 999px; transition: width 0.2s;`;
const PlanCount = styled.div`font-size: 12px; font-weight: 600; color: #475569; text-align: right;`;
const QuickLinks = styled.div`display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;`;
const QuickLink = styled(Link)`
  padding: 8px 14px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 12px; font-weight: 600;
  color: #0F766E; text-decoration: none; background: #FFFFFF; transition: background 0.15s, border-color 0.15s;
  &:hover { background: #F0FDFA; border-color: #99F6E4; }
`;
