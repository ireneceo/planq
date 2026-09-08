// 플랫폼 관리자 대시보드 — 실 API (/api/admin/overview)
// KPI(워크스페이스·사용자·구독·수익) + 활성 플랜 분포 + 6개월 가입 추이 + 관리 바로가기
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import { apiFetch } from '../../contexts/AuthContext';
import { fmtKRW, fmtNum } from '../Insights/components';
import { CONTROL } from '../../theme/tokens';

interface Overview {
  businesses: { total: number; new_30d: number };
  users: { total: number; new_30d: number };
  subscriptions: { active: number; grace: number; pending: number; total: number; by_plan: Record<string, number> };
  // month_nonrevenue = 내부·테스터 워크스페이스 결제 (운영 #275). 숨기지 않고 분리 표시한다.
  revenue: { month_paid: number; month_nonrevenue?: number; pending_amount: number };
  signups: { month: string; count: number }[];
}

const AdminDashboardPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // ★ 2026-09-08 (Irene: "플랫폼 관리자 가니까 이래 … Failed to fetch")
  //   배포 창(운영 PM2 fork 모드 재기동)에 걸리면 이 요청이 서버에 못 닿는다.
  //   apiFetch 가 재시도로 대부분 덮지만, 그래도 못 넘겼을 때 **막다른 골목을 두지 않는다** —
  //   다시 시도 버튼을 준다. 그리고 502/504 는 본문이 HTML 이라 r.json() 이 먼저 터진다:
  //   상태부터 보고 사람 말로 바꾼다("Unexpected token '<'" 를 사용자에게 보이지 않는다).
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch('/api/admin/overview')
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status >= 500
          ? (t('dashboard.serverBusy', '서버가 응답하지 못했습니다 (재배포 중일 수 있습니다)') as string)
          : `HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => { if (!alive) return; if (j.success) { setData(j.data); setErr(null); } else setErr(j.message || 'failed'); })
      .catch((e) => { if (alive) setErr(e?.message || 'failed'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadKey, t]);

  const maxSignup = data ? Math.max(1, ...data.signups.map((s) => s.count)) : 1;
  const planEntries = data ? Object.entries(data.subscriptions.by_plan).sort((a, b) => b[1] - a[1]) : [];
  const maxPlan = planEntries.length ? Math.max(1, ...planEntries.map(([, n]) => n)) : 1;

  return (
    <PageShell title={t('dashboard.title', '플랫폼 대시보드')}>
      {loading ? (
        <KpiGrid>{[0, 1, 2, 3, 4, 5].map((i) => <SkeletonCard key={i} />)}</KpiGrid>
      ) : err ? (
        <ErrorBox>
          <span>{t('dashboard.error', '데이터를 불러오지 못했습니다')} — {err}</span>
          <RetryBtn type="button" onClick={() => setReloadKey((k) => k + 1)}>
            {t('dashboard.retry', '다시 시도')}
          </RetryBtn>
        </ErrorBox>
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
              <KpiSub>
                {t('dashboard.kpi.paidOnly', '결제 완료 기준')}
                {!!data.revenue.month_nonrevenue && (
                  <> · {t('dashboard.kpi.nonRevenue', '비매출(내부·테스터) {{amount}}', { amount: fmtKRW(data.revenue.month_nonrevenue) })}</>
                )}
              </KpiSub>
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
              {/* 운영 #289 — "공지는 어디에 올리는 거야? 메뉴가 없는데?" 두 발행 경로가 서로 다른 페이지 안쪽에
                  묻혀 있어 찾을 수 없었다. 운영자가 실제로 서 있는 이 화면에서 바로 가게 한다. */}
              <QuickLink to="/admin/platform-settings#announcement">{t('dashboard.quick.announcement', '공지 배너')}</QuickLink>
              <QuickLink to="/admin/wiki">{t('dashboard.quick.updates', '제품 업데이트 발행')}</QuickLink>
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
const KpiLabel = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;`;
const KpiValue = styled.div`font-size: 1.625rem; font-weight: 700; color: #0F172A; line-height: 1.1; word-break: break-word;`;
const KpiSub = styled.div`font-size: 0.6875rem; color: #94A3B8;`;
const SkeletonCard = styled.div`
  height: 92px; border-radius: 12px; border: 1px solid #E2E8F0;
  background: linear-gradient(90deg, #F8FAFC 25%, #F1F5F9 50%, #F8FAFC 75%); background-size: 200% 100%;
  animation: shimmer 1.4s infinite; @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;
const ErrorBox = styled.div`
  background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 12px; padding: 16px; font-size: 0.8125rem; color: #B91C1C;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
`;
const RetryBtn = styled.button`
  flex-shrink: 0; height: ${CONTROL.sm}px; padding: 0 12px;
  border: 1px solid #FCA5A5; border-radius: 8px; background: #FFFFFF;
  font-size: 0.75rem; font-weight: 700; font-family: inherit; color: #B91C1C; cursor: pointer;
  &:hover { background: #FEE2E2; }
  &:focus-visible { outline: 2px solid rgba(185,28,28,0.5); outline-offset: 2px; }
`;
const Row = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;
const Panel = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 20px; margin-bottom: 16px;
`;
const PanelTitle = styled.h2`font-size: 0.8125rem; font-weight: 700; color: #0F172A; margin: 0;`;
const PanelHint = styled.div`font-size: 0.6875rem; color: #94A3B8; margin: 2px 0 14px;`;
const EmptyHint = styled.div`font-size: 0.75rem; color: #94A3B8; padding: 24px; text-align: center;`;
const BarChart = styled.div`display: flex; align-items: flex-end; gap: 10px; height: 160px; padding-top: 8px;`;
const BarCol = styled.div`flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; height: 100%;`;
const BarValue = styled.div`font-size: 0.6875rem; font-weight: 700; color: #475569;`;
const Bar = styled.div`width: 100%; max-width: 40px; min-height: 4px; background: linear-gradient(180deg, #14B8A6 0%, #0D9488 100%); border-radius: 6px 6px 0 0; transition: height 0.2s;`;
const BarLabel = styled.div`font-size: 0.625rem; color: #94A3B8;`;
const PlanList = styled.div`display: flex; flex-direction: column; gap: 12px; padding-top: 4px;`;
const PlanRow = styled.div`display: grid; grid-template-columns: 64px 1fr 40px; align-items: center; gap: 10px;`;
const PlanName = styled.div`font-size: 0.75rem; font-weight: 700; color: #334155;`;
const PlanBarTrack = styled.div`background: #F1F5F9; border-radius: 999px; height: 10px; overflow: hidden;`;
const PlanBar = styled.div`height: 100%; background: linear-gradient(90deg, #14B8A6 0%, #0D9488 100%); border-radius: 999px; transition: width 0.2s;`;
const PlanCount = styled.div`font-size: 0.75rem; font-weight: 600; color: #475569; text-align: right;`;
const QuickLinks = styled.div`display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;`;
const QuickLink = styled(Link)`
  padding: 8px 14px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.75rem; font-weight: 600;
  color: #0F766E; text-decoration: none; background: #FFFFFF; transition: background 0.15s, border-color 0.15s;
  &:hover { background: #F0FDFA; border-color: #99F6E4; }
`;
