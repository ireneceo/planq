import { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import {
  listInvoices, formatMoney, updateInvoiceStatus, markInstallmentPaid,
  type ApiInvoice, type ApiInstallment,
} from '../../services/invoices';

type Period = 'thisMonth' | 'last30' | 'ytd';

// 고객이 송금완료를 알린(notify_paid_at) 미확인 청구서 — 운영자 입금확인 대기 1건
interface PendingDeposit {
  key: string;
  inv: ApiInvoice;
  installment: ApiInstallment | null;
  amount: number;
  payerName: string | null;
  reportedAt: string | null;
}

export default function OverviewTab() {
  const { t } = useTranslation('qbill');
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const isOwner = user?.business_role === 'owner';
  const [period, setPeriod] = useState<Period>('thisMonth');
  const [invoices, setInvoices] = useState<ApiInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    listInvoices(businessId)
      .then(list => { if (!cancelled) setInvoices(list); })
      .catch(() => { if (!cancelled) setInvoices([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId, reloadKey]);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  // N+39 — PWA visibility 안전망
  useVisibilityRefresh(reload);

  // 실시간 동기화 (CLAUDE.md 운영 안정성 16번) — 고객 송금 보고(notify-paid 의 inbox:refresh)가 즉시 뜸
  useEffect(() => {
    if (!businessId) return;
    let pending: number | null = null;
    const debouncedReload = () => {
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; reload(); }, 250);
    };
    let socket: { disconnect: () => void } | null = null;
    import('socket.io-client').then(({ io }) => {
      import('../../contexts/AuthContext').then(({ getAccessToken }) => {
        if (!getAccessToken()) return;
        const s = io({
          auth: (cb: (a: { token: string | null }) => void) => cb({ token: getAccessToken() }),
          transports: ['websocket', 'polling'],
          reconnection: true,
        });
        socket = s;
        s.on('connect', () => { s.emit('join:business', businessId); });
        s.on('invoice:new', debouncedReload);
        s.on('invoice:updated', debouncedReload);
        s.on('invoice:deleted', debouncedReload);
        s.on('inbox:refresh', debouncedReload);
      });
    });
    return () => {
      if (pending) window.clearTimeout(pending);
      if (socket) socket.disconnect();
    };
  }, [businessId, reload]);

  const stats = useMemo(() => computeStats(invoices, period), [invoices, period]);
  const trend = useMemo(() => buildTrend(invoices), [invoices]);
  const topUnpaid = useMemo(() => buildTopUnpaid(invoices), [invoices]);
  const pendingDeposits = useMemo(() => buildPendingDeposits(invoices), [invoices]);

  const handleConfirm = async (item: PendingDeposit) => {
    if (!businessId || confirming) return;
    setConfirming(item.key);
    try {
      if (item.installment) {
        await markInstallmentPaid(businessId, item.inv.id, item.installment.id,
          item.payerName ? { payer_memo: item.payerName } : {});
      } else {
        await updateInvoiceStatus(businessId, item.inv.id, 'paid');
      }
      reload();
    } catch {
      // 실패 시 reload 로 최신 상태 재조회 (낙관적 제거 없음)
      reload();
    } finally {
      setConfirming(null);
    }
  };

  return (
    <Wrap>
      {/* 상단: 제목 + 기간 토글 */}
      <Head>
        <TitleArea>
          <H1>{t('overview.title')}</H1>
        </TitleArea>
        <PeriodToggle role="tablist">
          {(['thisMonth', 'last30', 'ytd'] as Period[]).map(k => (
            <PeriodBtn
              key={k}
              role="tab"
              aria-selected={period === k}
              $active={period === k}
              onClick={() => setPeriod(k)}
            >
              {t(`overview.period.${k}`)}
            </PeriodBtn>
          ))}
        </PeriodToggle>
      </Head>

      {/* 입금 확인 대기 — 고객이 송금완료를 알린 미확인 청구서 (있을 때만) */}
      {pendingDeposits.length > 0 && (
        <ActionPanel role="region" aria-label={t('overview.pendingDeposit.title')}>
          <ActionHead>
            <ActionTitle>
              {t('overview.pendingDeposit.title')}
              <ActionCount>{pendingDeposits.length}</ActionCount>
            </ActionTitle>
            <ActionHint>{t('overview.pendingDeposit.hint')}</ActionHint>
          </ActionHead>
          <PendingList>
            {pendingDeposits.map(item => {
              const client = item.inv.Client || item.inv.client;
              const days = daysSince(item.reportedAt);
              return (
                <PendingRow key={item.key}>
                  <PendingMain onClick={() => navigate(`/bills?tab=invoices&invoice=${item.inv.id}`)}>
                    <PendingTop>
                      <PendingNum>{item.inv.invoice_number}</PendingNum>
                      {item.installment && <PendingTag>{item.installment.label}</PendingTag>}
                      <PendingClient>{client?.display_name || client?.biz_name || client?.company_name || '—'}</PendingClient>
                    </PendingTop>
                    <PendingMeta>
                      {t('overview.pendingDeposit.reportedBy', {
                        name: item.payerName || t('overview.pendingDeposit.unknownPayer'),
                      })}
                      {' · '}
                      {days <= 0 ? t('overview.pendingDeposit.today') : t('overview.pendingDeposit.daysAgo', { days })}
                    </PendingMeta>
                  </PendingMain>
                  <PendingRight>
                    <PendingAmt>{formatMoney(item.amount, item.inv.currency)}</PendingAmt>
                    {isOwner ? (
                      <ConfirmBtn
                        type="button"
                        disabled={confirming === item.key}
                        onClick={() => handleConfirm(item)}
                      >
                        {confirming === item.key
                          ? t('overview.pendingDeposit.confirming')
                          : t('overview.pendingDeposit.confirm')}
                      </ConfirmBtn>
                    ) : (
                      <ReviewBtn type="button" onClick={() => navigate(`/bills?tab=invoices&invoice=${item.inv.id}`)}>
                        {t('overview.pendingDeposit.review')}
                      </ReviewBtn>
                    )}
                  </PendingRight>
                </PendingRow>
              );
            })}
          </PendingList>
        </ActionPanel>
      )}

      {/* KPI 카드 4개 */}
      <KpiGrid>
        <KpiCard $accent="#0F766E">
          <KpiHead>
            <KpiLabel>{t('overview.kpi.revenue')}</KpiLabel>
            <KpiHelp>{t('overview.kpi.revenueHelp')}</KpiHelp>
          </KpiHead>
          <KpiValue>{formatMoney(stats.revenue, 'KRW')}</KpiValue>
          <KpiSpark $color="#14B8A6">
            <Sparkline data={stats.revenueSpark} color="#14B8A6" />
          </KpiSpark>
        </KpiCard>

        <KpiCard $accent="#F59E0B">
          <KpiHead>
            <KpiLabel>{t('overview.kpi.outstanding')}</KpiLabel>
            <KpiHelp>{t('overview.kpi.outstandingHelp')}</KpiHelp>
          </KpiHead>
          <KpiValue>{formatMoney(stats.outstanding, 'KRW')}</KpiValue>
          <KpiSub>{stats.outstandingCount}건 · 평균 {stats.outstandingAvgDays}일 대기</KpiSub>
        </KpiCard>

        <KpiCard $accent="#0EA5E9">
          <KpiHead>
            <KpiLabel>{t('overview.kpi.pendingIssue')}</KpiLabel>
            <KpiHelp>{t('overview.kpi.pendingIssueHelp')}</KpiHelp>
          </KpiHead>
          <KpiValue>{stats.draftCount}<KpiUnit>건</KpiUnit></KpiValue>
          <KpiSub>{formatMoney(stats.draftAmount, 'KRW')}</KpiSub>
        </KpiCard>

        <KpiCard $accent="#A855F7">
          <KpiHead>
            <KpiLabel>{t('overview.kpi.pendingTax')}</KpiLabel>
            <KpiHelp>{t('overview.kpi.pendingTaxHelp')}</KpiHelp>
          </KpiHead>
          <KpiValue>{stats.pendingTaxCount}<KpiUnit>건</KpiUnit></KpiValue>
          <KpiSub>{formatMoney(stats.pendingTaxAmount, 'KRW')}</KpiSub>
        </KpiCard>
      </KpiGrid>

      {/* 본문: 차트 + 사이드 패널 (2열) */}
      <ContentGrid>
        <Panel>
          <PanelHead>
            <PanelTitle>{t('overview.trend.title')}</PanelTitle>
          </PanelHead>
          <PanelBody>
            <BarChart data={trend} />
          </PanelBody>
        </Panel>

        <SidePanels>
          <Panel>
            <PanelHead>
              <PanelTitle>{t('overview.topUnpaid.title')}</PanelTitle>
              <PanelLink onClick={() => navigate('/bills?tab=invoices&filter=outstanding')}>
                {t('overview.topUnpaid.viewAll')}
              </PanelLink>
            </PanelHead>
            <PanelBody>
              {topUnpaid.length === 0 ? (
                <EmptyMsg>{t('overview.topUnpaid.empty')}</EmptyMsg>
              ) : (
                <UnpaidList>
                  {topUnpaid.slice(0, 5).map(inv => {
                    const client = inv.Client || inv.client;
                    const out = Number(inv.grand_total || 0) - Number(inv.paid_amount || 0);
                    return (
                      <UnpaidRow key={inv.id} onClick={() => navigate(`/bills?tab=invoices&invoice=${inv.id}`)}>
                        <UnpaidLeft>
                          <UnpaidNum>{inv.invoice_number}</UnpaidNum>
                          <UnpaidClient>{client?.display_name || client?.biz_name || client?.company_name || '—'}</UnpaidClient>
                        </UnpaidLeft>
                        <UnpaidRight>
                          <UnpaidAmt>{formatMoney(out, inv.currency)}</UnpaidAmt>
                          {inv.status === 'overdue' && inv.due_date && (
                            <OverdueBadge>{t('common.overdueDays', { days: Math.max(0, daysSince(inv.due_date)) })}</OverdueBadge>
                          )}
                        </UnpaidRight>
                      </UnpaidRow>
                    );
                  })}
                </UnpaidList>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHead>
              <PanelTitle>{t('overview.recent.title')}</PanelTitle>
            </PanelHead>
            <PanelBody>
              {invoices.length === 0 ? (
                <EmptyMsg>{loading ? t('common.loading') : t('overview.recent.empty')}</EmptyMsg>
              ) : (
                <RecentList>
                  {[...invoices].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 6).map((inv) => (
                    <RecentRow key={inv.id}>
                      <EventDot $color={inv.status === 'paid' ? '#22C55E' : inv.status === 'partially_paid' ? '#F59E0B' : inv.status === 'overdue' ? '#DC2626' : '#0EA5E9'} />
                      <RecentBody>
                        <RecentTitle>{inv.invoice_number} · {inv.title}</RecentTitle>
                        <RecentMeta>{t(`invoices.status.${inv.status}`)} · {formatRelative(inv.created_at)}</RecentMeta>
                      </RecentBody>
                    </RecentRow>
                  ))}
                </RecentList>
              )}
            </PanelBody>
          </Panel>
        </SidePanels>
      </ContentGrid>
    </Wrap>
  );
}

// ─── 통계 (실 ApiInvoice 기반) ───
function computeStats(list: ApiInvoice[], _period: Period) {
  const krw = list.filter(i => i.currency === 'KRW');
  const num = (v: string | number | null | undefined) => Number(v || 0);
  const revenue = krw.filter(i => i.status === 'paid' || i.status === 'partially_paid')
    .reduce((s, i) => s + num(i.paid_amount), 0);
  const outstandingList = krw.filter(i => i.status === 'sent' || i.status === 'partially_paid' || i.status === 'overdue');
  const outstanding = outstandingList.reduce((s, i) => s + (num(i.grand_total) - num(i.paid_amount)), 0);
  const outstandingAvgDays = outstandingList.length === 0 ? 0 :
    Math.round(outstandingList.reduce((s, i) => s + Math.max(0, daysSince(i.issued_at || i.created_at)), 0) / outstandingList.length);
  const drafts = krw.filter(i => i.status === 'draft');
  // 세금계산서 대기: tax_invoice_status='pending' 또는 분할 회차 paid+미발행
  const pendingTaxAmount = list.reduce((s, i) => {
    if (i.installments && i.installments.length > 0) {
      return s + i.installments.filter(x => x.status === 'paid' && !x.tax_invoice_no).reduce((ss, x) => ss + Number(x.amount || 0), 0);
    }
    if (i.tax_invoice_status === 'pending' && i.status === 'paid') return s + num(i.grand_total);
    return s;
  }, 0);
  const pendingTaxCount = list.filter(i => {
    if (i.installments && i.installments.length > 0) {
      return i.installments.some(x => x.status === 'paid' && !x.tax_invoice_no);
    }
    return i.tax_invoice_status === 'pending' && i.status === 'paid';
  }).length;
  return {
    revenue,
    revenueSpark: buildSparkFromInvoices(list),
    outstanding,
    outstandingCount: outstandingList.length,
    outstandingAvgDays,
    draftCount: drafts.length,
    draftAmount: drafts.reduce((s, i) => s + num(i.grand_total), 0),
    pendingTaxCount,
    pendingTaxAmount,
  };
}

// 최근 6개월 매출 sparkline (실 invoice 기반)
function buildSparkFromInvoices(list: ApiInvoice[]): number[] {
  const months = 6;
  const buckets: number[] = Array(months).fill(0);
  const now = new Date();
  for (const inv of list) {
    if (inv.status !== 'paid' && inv.status !== 'partially_paid') continue;
    if (inv.currency !== 'KRW') continue;
    const dt = inv.issued_at ? new Date(inv.issued_at) : new Date(inv.created_at);
    const monthDiff = (now.getFullYear() - dt.getFullYear()) * 12 + (now.getMonth() - dt.getMonth());
    if (monthDiff < 0 || monthDiff >= months) continue;
    buckets[months - 1 - monthDiff] += Number(inv.paid_amount || 0);
  }
  return buckets.length > 0 ? buckets : [0];
}

function buildTrend(list: ApiInvoice[]) {
  // 12개월 — 실 invoice 누적 매출
  const months = 12;
  const buckets: { month: string; value: number }[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ month: `${dt.getMonth() + 1}월`, value: 0 });
  }
  for (const inv of list) {
    if (inv.status !== 'paid' && inv.status !== 'partially_paid') continue;
    if (inv.currency !== 'KRW') continue;
    const dt = inv.issued_at ? new Date(inv.issued_at) : new Date(inv.created_at);
    const monthDiff = (now.getFullYear() - dt.getFullYear()) * 12 + (now.getMonth() - dt.getMonth());
    if (monthDiff < 0 || monthDiff >= months) continue;
    const idx = months - 1 - monthDiff;
    buckets[idx].value += Number(inv.paid_amount || 0);
  }
  return buckets;
}

function buildTopUnpaid(list: ApiInvoice[]): ApiInvoice[] {
  return [...list]
    .filter(i => i.status === 'sent' || i.status === 'partially_paid' || i.status === 'overdue')
    .sort((a, b) => (Number(b.grand_total || 0) - Number(b.paid_amount || 0)) - (Number(a.grand_total || 0) - Number(a.paid_amount || 0)));
}

// 입금 확인 대기: 고객이 송금완료를 알렸으나(notify_paid_at) 아직 paid 처리 안 된 것.
// 단건 = invoice.notify_paid_at / 분할 = installment.notify_paid_at. 오래 기다린 순(오름차순).
function buildPendingDeposits(list: ApiInvoice[]): PendingDeposit[] {
  const items: PendingDeposit[] = [];
  for (const inv of list) {
    if (inv.status === 'canceled') continue;
    const insts = inv.installments || [];
    if (insts.length > 0) {
      for (const ins of insts) {
        if (ins.notify_paid_at && ins.status !== 'paid' && ins.status !== 'canceled') {
          items.push({
            key: `${inv.id}-${ins.id}`, inv, installment: ins,
            amount: Number(ins.amount || 0), payerName: ins.notify_payer_name, reportedAt: ins.notify_paid_at,
          });
        }
      }
    } else if (inv.notify_paid_at && inv.status !== 'paid') {
      items.push({
        key: `${inv.id}`, inv, installment: null,
        amount: Number(inv.grand_total || 0) - Number(inv.paid_amount || 0),
        payerName: inv.notify_payer_name, reportedAt: inv.notify_paid_at,
      });
    }
  }
  return items.sort((a, b) => (a.reportedAt || '').localeCompare(b.reportedAt || ''));
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  const target = new Date(dateStr);
  return Math.floor((Date.now() - target.getTime()) / (1000 * 60 * 60 * 24));
}

function formatRelative(iso: string): string {
  const target = new Date(iso);
  const diffMs = Date.now() - target.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) {
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours <= 0) return '방금';
    return `${hours}시간 전`;
  }
  if (days === 1) return '어제';
  if (days < 30) return `${days}일 전`;
  const months = Math.floor(days / 30);
  return `${months}달 전`;
}

// ─── 차트 컴포넌트 (간단 SVG) ───
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 120;
  const h = 28;
  const max = Math.max(...data);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface BarDatum { month: string; value: number; }
function BarChart({ data }: { data: BarDatum[] }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <BarsWrap>
      {data.map((d, i) => (
        <BarColumn key={i}>
          <BarFill style={{ height: `${(d.value / max) * 100}%` }} />
          <BarLabel>{d.month}</BarLabel>
        </BarColumn>
      ))}
    </BarsWrap>
  );
}

// ─── styled ───
const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 24px;
`;
const Head = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  flex-wrap: wrap; gap: 12px;
`;
const TitleArea = styled.div`
  display: flex; align-items: center; gap: 10px;
`;
const H1 = styled.h2`
  font-size: 18px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px; margin: 0;
`;
const PeriodToggle = styled.div`
  display: inline-flex; gap: 2px; padding: 3px;
  background: #F1F5F9; border-radius: 8px;
`;
const PeriodBtn = styled.button<{ $active: boolean }>`
  padding: 6px 12px; font-size: 12px; font-weight: 600;
  background: ${p => p.$active ? '#fff' : 'transparent'};
  color: ${p => p.$active ? '#0F172A' : '#64748B'};
  border: none; border-radius: 6px; cursor: pointer;
  box-shadow: ${p => p.$active ? '0 1px 2px rgba(15,23,42,0.06)' : 'none'};
  transition: all 0.15s;
  &:hover { color: #0F172A; }
`;
// ─── 입금 확인 대기 (action panel) ───
const ActionPanel = styled.div`
  background: #FFF1F2; border: 1px solid #FECDD3; border-radius: 12px;
  padding: 16px 18px; display: flex; flex-direction: column; gap: 12px;
`;
const ActionHead = styled.div`
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
`;
const ActionTitle = styled.div`
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700; color: #9F1239;
`;
const ActionCount = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px;
  background: #F43F5E; color: #fff; font-size: 11px; font-weight: 700;
  border-radius: 999px;
`;
const ActionHint = styled.div`
  font-size: 12px; color: #9F1239; opacity: 0.85;
`;
const PendingList = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`;
const PendingRow = styled.div`
  display: flex; align-items: center; gap: 12px;
  background: #fff; border: 1px solid #FECDD3; border-radius: 10px;
  padding: 12px 14px;
  @media (max-width: 640px) { flex-direction: column; align-items: stretch; }
`;
const PendingMain = styled.div`
  flex: 1; min-width: 0; cursor: pointer;
  display: flex; flex-direction: column; gap: 4px;
`;
const PendingTop = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0;
`;
const PendingNum = styled.span`
  font-size: 12px; font-weight: 700; color: #0F172A;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const PendingTag = styled.span`
  font-size: 10px; font-weight: 700; color: #9F1239; background: #FFE4E6;
  padding: 2px 6px; border-radius: 4px;
`;
const PendingClient = styled.span`
  font-size: 12px; color: #64748B;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const PendingMeta = styled.div`
  font-size: 11px; color: #64748B;
`;
const PendingRight = styled.div`
  display: flex; align-items: center; gap: 12px; flex-shrink: 0;
  @media (max-width: 640px) { justify-content: space-between; }
`;
const PendingAmt = styled.div`
  font-size: 14px; font-weight: 700; color: #0F172A;
`;
const ConfirmBtn = styled.button`
  height: 36px; padding: 0 14px; border: none; border-radius: 8px;
  background: #F43F5E; color: #fff; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: background 0.15s; white-space: nowrap;
  &:hover:not(:disabled) { background: #E11D48; }
  &:disabled { opacity: 0.5; cursor: default; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(244,63,94,0.3); }
`;
const ReviewBtn = styled.button`
  height: 36px; padding: 0 14px; border: 1px solid #CBD5E1; border-radius: 8px;
  background: #fff; color: #334155; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: background 0.15s; white-space: nowrap;
  &:hover { background: #F8FAFC; }
  &:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(20,184,166,0.3); }
`;
const KpiGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;
`;
const KpiCard = styled.div<{ $accent: string }>`
  position: relative; background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 16px 18px; overflow: hidden;
  &::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    background: ${p => p.$accent}; opacity: 0.6;
  }
`;
const KpiHead = styled.div`
  display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 10px;
`;
const KpiLabel = styled.div`
  font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.4px;
`;
const KpiHelp = styled.div`
  font-size: 11px; color: #94A3B8; text-align: right;
`;
const KpiValue = styled.div`
  font-size: 26px; font-weight: 700; color: #0F172A; letter-spacing: -0.5px;
  display: flex; align-items: baseline; gap: 4px;
`;
const KpiUnit = styled.span`
  font-size: 14px; font-weight: 600; color: #64748B;
`;
const KpiSub = styled.div`
  font-size: 12px; color: #64748B; margin-top: 4px;
`;
const KpiSpark = styled.div<{ $color: string }>`
  margin-top: 8px;
`;
const ContentGrid = styled.div`
  display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 12px;
  @media (max-width: 1024px) { grid-template-columns: 1fr; }
`;
const SidePanels = styled.div`
  display: flex; flex-direction: column; gap: 12px; min-width: 0;
`;
const Panel = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;
  display: flex; flex-direction: column;
`;
const PanelHead = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 18px; border-bottom: 1px solid #F1F5F9;
`;
const PanelTitle = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
`;
const PanelLink = styled.button`
  background: none; border: none; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #0D9488;
  &:hover { color: #0F766E; }
`;
const PanelBody = styled.div`
  padding: 18px; flex: 1;
`;
const EmptyMsg = styled.div`
  text-align: center; color: #94A3B8; font-size: 12px; padding: 24px 0;
`;
const UnpaidList = styled.div`
  display: flex; flex-direction: column; gap: 4px;
`;
const UnpaidRow = styled.div`
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 10px 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid transparent;
  &:hover { background: #F8FAFC; border-color: #E2E8F0; }
`;
const UnpaidLeft = styled.div`
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
`;
const UnpaidNum = styled.div`
  font-size: 12px; font-weight: 700; color: #0F172A;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const UnpaidClient = styled.div`
  font-size: 12px; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const UnpaidRight = styled.div`
  display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
`;
const UnpaidAmt = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
`;
const OverdueBadge = styled.span`
  font-size: 10px; font-weight: 700; color: #991B1B; background: #FEE2E2;
  padding: 2px 6px; border-radius: 4px;
`;
const RecentList = styled.div`
  display: flex; flex-direction: column; gap: 12px;
`;
const RecentRow = styled.div`
  display: flex; gap: 10px; align-items: flex-start;
`;
const EventDot = styled.span<{ $color: string }>`
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: ${p => p.$color}; margin-top: 6px;
  box-shadow: 0 0 0 3px ${p => p.$color}22;
`;
const RecentBody = styled.div`
  flex: 1; min-width: 0;
`;
const RecentTitle = styled.div`
  font-size: 12px; font-weight: 600; color: #0F172A;
`;
const RecentMeta = styled.div`
  font-size: 11px; color: #64748B; margin-top: 2px; line-height: 1.5;
`;
const BarsWrap = styled.div`
  display: flex; align-items: flex-end; gap: 6px; height: 160px;
`;
const BarColumn = styled.div`
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px;
  min-width: 0;
`;
const BarFill = styled.div`
  width: 100%; max-width: 28px;
  background: linear-gradient(180deg, #14B8A6 0%, #0D9488 100%);
  border-radius: 4px 4px 0 0;
  min-height: 2px;
  transition: opacity 0.15s;
  &:hover { opacity: 0.85; }
`;
const BarLabel = styled.div`
  font-size: 10px; color: #94A3B8; font-weight: 500;
`;
