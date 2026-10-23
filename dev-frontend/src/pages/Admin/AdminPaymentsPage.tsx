// 결제 이력 + 환불·조정 — platform_admin 만
// 라우트: /admin/payments

import { useEffect, useState, useCallback, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import SearchBox from '../../components/Common/SearchBox';
import EmptyState from '../../components/Common/EmptyState';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import HighlightText from '../../components/Common/HighlightText';
import MatchReason from '../../components/Common/MatchReason';
import { pickMatch } from '../../utils/searchMatch';
import { apiFetch } from '../../contexts/AuthContext';
import { formatDay, formatDayTime } from '../../utils/dateFormat';
import { useSearchParams } from 'react-router-dom';
import { refreshAdminTodo } from '../../hooks/useAdminInboxCounts';
import TrialRefundModal, { type TrialRefundTarget } from '../../components/Admin/TrialRefundModal';

// 할 일 탭 — 상태가 아니라 할 일 필터라 서버엔 따로 간다. 술어는 사이드바 배지와 같은 한 곳(services/adminTodo.paymentBucketWhere).
//   todo = 처리 필요(= 사이드바 «결제 이력» 배지: 애드온 입금 통보 + 세금계산서 + 환불 요청) → ?todo=1
//   refund_request = 환불 요청 → ?refund=requested · tax = 세금계산서 발행 필요(환불 요청 중인 건 제외) → ?tax=pending
//   «대기» 는 상태 탭이다 — 고객이 아직 입금 통보를 안 한 미결제까지 전부라 배지와 다르다.
type PayStatus = 'all' | 'todo' | 'paid' | 'pending' | 'failed' | 'refunded' | 'canceled' | 'tax' | 'refund_request';

interface PaymentRow {
  id: number;
  business: {
    id: number; name: string; slug: string;
    created_at: string | null;           // 가입일 = 워크스페이스를 만든 날
    trial_ends_at: string | null;
    subscription_status: string | null;
    owner: { id: number; name: string | null; email: string } | null;
  } | null;
  // 이 청구가 생긴 길 — 서버 파생(services/adminPaymentView). 사용자가 고른 것과 자동 청구를 가른다.
  origin: {
    kind: 'checkout' | 'trial_prebill' | 'renewal' | 'addon' | 'unknown';
    at: string | null;
    by: { id: number; name: string | null; email: string } | null;
    trial_option?: string | null;
    bonus_months?: number;
  } | null;
  subscription: { id: number; plan_code: string; cycle: string; status: string } | null;
  method: 'bank_transfer' | 'card' | 'portone' | 'stripe' | 'manual_adjust';
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'canceled';
  amount: number;
  currency: string;
  cycle: 'monthly' | 'yearly';
  period_start: string | null;
  period_end: string | null;
  payer_name: string | null;
  payer_memo: string | null;
  // 고객 입금 통보 — 관리자가 확인할 차례
  notify_paid_at: string | null;
  notify_payer_name: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  cancel_reason: string | null;
  // 매출 계상 여부 (운영 #275) — false = 내부·테스터 워크스페이스의 결제 테스트
  is_revenue: boolean;
  created_at: string;
  // Day 8/10 — addon / 세금계산서
  kind: 'plan' | 'addon';
  addon_code: string | null;
  addon_quantity: number | null;
  tax_invoice_requested: boolean;
  tax_invoice_status: 'none' | 'requested' | 'issued' | 'failed';
  tax_invoice_data: { biz_no?: string; biz_name?: string; ceo_name?: string; address?: string; email?: string } | null;
  tax_invoice_issued_at: string | null;
  // 체험 중 결제 환불 요청 (docs/TRIAL_REFUND_DESIGN.md) — 계좌는 실리지 않는다(있는지만)
  refund_requested_at?: string | null;
  refund_request_note?: string | null;
  refund_request_trial?: boolean;
  // 환불하면 같이 바뀌는 것 — 서버 판정(docs/REFUND_CANCEL_DESIGN.md §5-1)
  refund_cancels_subscription?: boolean;
  refund_addon_units?: number | null;
  has_refund_account?: boolean;
  refund_kind?: 'trial' | 'manual' | null;
  stripe_refund_id?: string | null;
  has_stripe_intent?: boolean;
}

interface Summary {
  pending: number; paid: number; failed: number; refunded: number; canceled: number; total: number;
  month_revenue: number;
  // 운영 #275 — 내부·테스터 결제는 매출에서 빠진다. 숨기지 않고 분리 노출.
  month_nonrevenue?: number;
  nonrevenue_paid?: number;
  tax_pending?: number;
  todo?: number;
  refund_requested?: number;
}

const STATUS_TABS: PayStatus[] = ['all', 'todo', 'refund_request', 'tax', 'paid', 'pending', 'failed', 'refunded'];

const AdminPaymentsPage = () => {
  const { t, i18n } = useTranslation('admin');
  const [items, setItems] = useState<PaymentRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<PayStatus>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<PaymentRow | null>(null);
  const [trialRefund, setTrialRefund] = useState<TrialRefundTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 늦게 온 옛 응답이 새 탭 목록을 덮지 않게 — 첫 «전체» 요청이 주소의 ?status 요청보다 늦게 오면 대기 탭에 환불 행이 섞였다
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (activeStatus === 'tax') sp.set('tax', 'pending');
      else if (activeStatus === 'todo') sp.set('todo', '1');
      else if (activeStatus === 'refund_request') sp.set('refund', 'requested');
      else if (activeStatus !== 'all') sp.set('status', activeStatus);
      if (search.trim()) sp.set('q', search.trim());
      const r = await apiFetch(`/api/admin/payments?${sp.toString()}`);
      const j = await r.json();
      if (seq !== loadSeq.current) return;
      if (j.success) setItems(j.data || []);
      const s = await apiFetch('/api/admin/payments/summary');
      const sj = await s.json();
      if (seq !== loadSeq.current) return;
      if (sj.success) setSummary(sj.data);
    } catch (e) {
      setError(t('payments.loadFailed', '목록을 불러오지 못했습니다') as string);
    } finally { if (seq === loadSeq.current) setLoading(false); }
  }, [activeStatus, search, t]);

  useEffect(() => { load(); }, [load]);

  // 확인 필요에서 넘어온 주소 — ?status=pending · ?tax=pending · ?payment=:id(그 행을 표시)
  const [params] = useSearchParams();
  const focusId = Number(params.get('payment')) || null;
  useEffect(() => {
    if (params.get('tax') === 'pending') { setActiveStatus('tax'); return; }
    if (params.get('todo') === '1') { setActiveStatus('todo'); return; }
    if (params.get('refund') === 'requested') { setActiveStatus('refund_request'); return; }
    const st = params.get('status') as PayStatus | null;
    if (st && (STATUS_TABS as string[]).includes(st)) setActiveStatus(st);
  }, [params]);
  useEffect(() => {
    if (!focusId || loading) return;
    const el = document.querySelector(`[data-payment-id="${focusId}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  }, [focusId, loading, items]);
  // 알림의 [환불 요청 처리하기] 로 왔으면 그 행의 처리 창을 바로 연다(한 번만) — 행을 찾아 버튼을 또 누르게 하지 않는다.
  const autoOpenedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusId || loading || autoOpenedRef.current === focusId) return;
    const p = items.find(x => x.id === focusId);
    if (!p || p.status !== 'paid' || !p.refund_requested_at) return;
    autoOpenedRef.current = focusId;
    setTrialRefund({
      id: p.id, amount: p.amount, currency: p.currency, method: p.method,
      businessName: p.business?.name || null, requestedAt: p.refund_requested_at || null,
      note: p.refund_request_note || null, hasStripeIntent: !!p.has_stripe_intent,
      taxIssued: p.tax_invoice_status === 'issued', trial: !!p.refund_request_trial,
      cancelsSubscription: !!p.refund_cancels_subscription, addonUnits: p.refund_addon_units ?? null,
    });
  }, [focusId, loading, items]);

  const fmtKRW = (n: number) => new Intl.NumberFormat('ko-KR').format(Math.round(n));
  const fmtDate = (s: string | null) =>
    s ? formatDay(s, { locale: i18n.language === 'ko' ? 'ko-KR' : 'en-US', tz: 'Asia/Seoul', year: 'always' }) : '—';

  const fmtDateTime = (s: string | null | undefined) =>
    s ? formatDayTime(s, { locale: i18n.language === 'ko' ? 'ko-KR' : 'en-US', tz: 'Asia/Seoul', year: 'always' }) : '—';
  const personOf = (u: { name: string | null; email: string } | null | undefined) => (u ? (u.name || u.email) : '');

  // 청구가 생긴 길 한 줄 — «결제 선택» 은 사람이 [결제하기] 를 누른 것만이다(체험 종료 전 자동 청구와 가른다)
  const originLine = (p: PaymentRow) => {
    const o = p.origin;
    const at = fmtDateTime(o?.at || p.created_at);
    const who = personOf(o?.by);
    switch (o?.kind) {
      case 'checkout': return t('payments.origin.checkout', { at, who, defaultValue: '결제 선택: {{at}} · {{who}}' });
      case 'trial_prebill': return t('payments.origin.trialPrebill', { at, defaultValue: '자동 청구(체험 종료 전): {{at}}' });
      case 'renewal': return t('payments.origin.renewal', { at, defaultValue: '갱신 자동 청구: {{at}}' });
      case 'addon': return t('payments.origin.addon', { at, who, defaultValue: '애드온 신청: {{at}} · {{who}}' });
      default: return who ? t('payments.origin.unknownBy', { at, who, defaultValue: '청구 생성: {{at}} · {{who}}' })
        : t('payments.origin.unknown', { at, defaultValue: '청구 생성: {{at}}' });
    }
  };

  const statusColor = (s: PaymentRow['status']) => {
    switch (s) {
      case 'paid': return { bg: '#CCFBF1', fg: '#0F766E' };
      case 'pending': return { bg: '#FEF3C7', fg: '#92400E' };
      case 'failed': return { bg: '#FEE2E2', fg: '#B91C1C' };
      case 'refunded': return { bg: '#F1F5F9', fg: '#64748B' };
      default: return { bg: '#F1F5F9', fg: '#64748B' };
    }
  };

  const statusLabel = (s: PaymentRow['status']) => {
    const fb: Record<PaymentRow['status'], string> = {
      pending: '대기', paid: '완료', failed: '실패', refunded: '환불', canceled: '취소',
    };
    return t(`payments.status.${s}`, fb[s]) as string;
  };

  const methodLabel = (m: PaymentRow['method']) => {
    const fb: Record<PaymentRow['method'], string> = {
      bank_transfer: '계좌이체', card: '카드', portone: 'PortOne', stripe: '카드(Stripe)', manual_adjust: '수기 조정',
    };
    return t(`payments.method.${m}`, fb[m]) as string;
  };

  const handleRefund = async (p: PaymentRow) => {
    setBusyId(p.id); setError(null);
    try {
      const r = await apiFetch(`/api/admin/payments/${p.id}/refund`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: t('payments.refundReason', '관리자 환불') }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      await load();
      refreshAdminTodo();
      setConfirm(null);
    } catch (e: unknown) {
      setError((e as Error).message || (t('payments.refundFailed', '환불 처리 실패') as string));
    } finally { setBusyId(null); }
  };

  const handleMarkPaid = async (p: PaymentRow) => {
    setBusyId(p.id); setError(null);
    try {
      const r = await apiFetch(`/api/admin/payments/${p.id}/mark-paid`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      await load();
      refreshAdminTodo();
    } catch (e: unknown) {
      setError((e as Error).message || (t('payments.markPaidFailed', '입금 처리 실패') as string));
    } finally { setBusyId(null); }
  };

  const handleIssueTaxInvoice = async (p: PaymentRow) => {
    setBusyId(p.id); setError(null);
    try {
      const r = await apiFetch(`/api/admin/payments/${p.id}/issue-tax-invoice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issued_by: 'manual' }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'failed');
      await load();
      refreshAdminTodo();
    } catch (e: unknown) {
      setError((e as Error).message || (t('payments.taxIssueFailed', '세금계산서 발행 처리 실패') as string));
    } finally { setBusyId(null); }
  };

  return (
    <PageShell
      title={t('payments.title', '결제 이력')}
      count={items.length}
      actions={<SearchBox value={search} onChange={setSearch} placeholder={t('payments.searchPh', '워크스페이스·주인 이름·이메일') as string} />}
    >
      <Wrap>
        {/* 이번 달 수익 카드 */}
        {summary && (
          <KpiRow>
            <Kpi>
              <KpiLabel>{t('payments.monthRevenue', '이번 달 수익 (확정)')}</KpiLabel>
              <KpiValue>KRW {fmtKRW(summary.month_revenue)}</KpiValue>
              {!!summary.month_nonrevenue && (
                <KpiSub>{t('payments.nonRevenue', '비매출(내부·테스터) {{amount}}', { amount: `KRW ${fmtKRW(summary.month_nonrevenue)}` })}</KpiSub>
              )}
            </Kpi>
            <Kpi>
              <KpiLabel>{t('payments.totalPaid', '누적 완료')}</KpiLabel>
              <KpiValue>{summary.paid}</KpiValue>
              {!!summary.nonrevenue_paid && (
                <KpiSub>{t('payments.nonRevenueCount', '중 비매출 {{n}}건', { n: summary.nonrevenue_paid })}</KpiSub>
              )}
            </Kpi>
            <Kpi>
              <KpiLabel>{t('payments.totalPending', '대기')}</KpiLabel>
              <KpiValue>{summary.pending}</KpiValue>
            </Kpi>
          </KpiRow>
        )}

        <TabBar role="tablist">
          {STATUS_TABS.map((s) => {
            const tabFb: Record<PayStatus, string> = {
              all: '전체', todo: '처리 필요', paid: '완료', pending: '입금 대기', failed: '실패', refunded: '환불', canceled: '취소', tax: '세금계산서 발행 필요', refund_request: '환불 요청',
            };
            const cnt = s === 'all' ? (summary?.total || 0)
              : s === 'tax' ? (summary?.tax_pending || 0)
              : s === 'todo' ? (summary?.todo || 0)
              : s === 'refund_request' ? (summary?.refund_requested || 0)
              : (summary as unknown as Record<string, number>)?.[s] || 0;
            return (
              <TabBtn key={s} role="tab" type="button" $active={activeStatus === s}
                aria-selected={activeStatus === s} onClick={() => setActiveStatus(s)}>
                <span>{t(`payments.tab.${s}`, tabFb[s]) as string}</span>
                {cnt > 0 && <Count $active={activeStatus === s}>{cnt}</Count>}
              </TabBtn>
            );
          })}
        </TabBar>

        {error && <ErrorBox>{error}</ErrorBox>}

        {loading ? (
          <Skeleton />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>}
            title={t('payments.empty', '결제 이력이 없습니다') as string}
            description={t('payments.emptyDesc', '필터를 바꿔서 확인해 보세요.') as string}
          />
        ) : (
          <List>
            {items.map((p) => {
              const c = statusColor(p.status);
              // 서버 검색은 워크스페이스 name·brand_name(= 표시 이름)·slug + 주인 이름·이메일 — slug 는 행에 없다
              const owner = p.business?.owner;
              const hit = pickMatch([
                { field: 'name', text: p.business?.name, shown: true },
                { field: 'email', text: owner?.email, shown: true },
                { field: 'name', text: owner?.name, shown: true },
                { field: 'url', text: p.business?.slug },
              ], search);
              return (
                <Row key={p.id} data-payment-id={p.id} $focus={focusId === p.id} $notified={p.status === 'pending' && !!p.notify_paid_at}>
                  <RowLeft>
                    <RowTop>
                      <BizName>{p.business?.name ? <HighlightText text={p.business.name} query={search} /> : `(workspace ${p.business?.id})`}</BizName>
                      <StatusBadge $bg={c.bg} $fg={c.fg}>{statusLabel(p.status)}</StatusBadge>
                      {/* 비매출(내부·테스터) 행 표시 — 합계와 목록이 대조되게 (운영 #275) */}
                      {p.status === 'pending' && p.notify_paid_at && (
                        <StatusBadge $bg="#0D9488" $fg="#FFFFFF">{t('subs.notified', '입금 통보')}</StatusBadge>
                      )}
                      {p.status === 'paid' && p.tax_invoice_status === 'failed' && (
                        <StatusBadge $bg="#FEE2E2" $fg="#B91C1C">{t('payments.taxFailed', '세금계산서 발행 실패')}</StatusBadge>
                      )}
                      {/* 처리 필요 탭에서 왜 들어왔는지 보이게 — 요청된 세금계산서는 버튼만 있고 표시가 없었다 */}
                      {p.status === 'paid' && p.tax_invoice_status === 'requested' && !p.refund_requested_at && (
                        <StatusBadge $bg="#E0F2FE" $fg="#0369A1">{t('payments.taxRequestedBadge', '세금계산서 요청')}</StatusBadge>
                      )}
                      {p.status === 'paid' && p.refund_requested_at && (
                        <StatusBadge $bg="#FFE4E6" $fg="#BE123C">{t('payments.refundRequestedBadge', '환불 요청')}</StatusBadge>
                      )}
                      {p.status === 'refunded' && p.refund_kind === 'trial' && (
                        <StatusBadge $bg="#F1F5F9" $fg="#475569">{t('payments.trialRefundedBadge', '체험 중 환불')}</StatusBadge>
                      )}
                      {p.is_revenue === false && (
                        <StatusBadge $bg="#F0FDFA" $fg="#0F766E">{t('payments.nonRevenueBadge', '비매출')}</StatusBadge>
                      )}
                    </RowTop>
                    {hit && !hit.shown && <MatchReason field={hit.field} snippet={hit.snippet} query={search} />}
                    {/* 누구 · 언제 가입 · 체험 끝 — 구독 관리와 같은 주인 표시 */}
                    <WhoLine data-testid={`admin-pay-who-${p.id}`}>
                      <span>
                        {owner ? (
                          <>
                            {owner.name && <><HighlightText text={owner.name} query={search} /> · </>}
                            <HighlightText text={owner.email} query={search} />
                          </>
                        ) : t('payments.noOwner', '주인 정보 없음')}
                      </span>
                      <span>{t('payments.joinedAt', '가입')}: {fmtDate(p.business?.created_at ?? null)}</span>
                      {p.business?.subscription_status === 'trialing' && p.business.trial_ends_at && (
                        <span>{t('payments.trialEndsAt', '체험 종료')}: {fmtDate(p.business.trial_ends_at)}</span>
                      )}
                    </WhoLine>
                    <RowMeta>
                      <Tag>{p.subscription?.plan_code} · {p.cycle === 'monthly' ? t('subs.monthly', '월간') : t('subs.yearly', '연간')}</Tag>
                      <Tag>{methodLabel(p.method)}</Tag>
                      <Amount>{p.currency} {fmtKRW(p.amount)}</Amount>
                      {p.origin?.kind === 'checkout' && (p.origin.bonus_months || 0) > 0 && (
                        <Tag>{t('payments.bonusMonths', { n: p.origin.bonus_months, defaultValue: '선결제 +{{n}}개월' })}</Tag>
                      )}
                    </RowMeta>
                    <RowDates>
                      <OriginText $auto={p.origin?.kind === 'trial_prebill' || p.origin?.kind === 'renewal'}
                        data-testid={`admin-pay-origin-${p.id}`} data-origin={p.origin?.kind || ''}>
                        {originLine(p)}
                      </OriginText>
                      {p.paid_at && <span>{t('payments.paid', '결제 완료')}: {fmtDate(p.paid_at)}</span>}
                      {p.refunded_at && <span>{t('payments.refunded', '환불')}: {fmtDate(p.refunded_at)}</span>}
                      {p.status === 'pending' && p.notify_paid_at && (
                        <span>{t('subs.notifiedAt', '입금 통보')}: {fmtDate(p.notify_paid_at)}{p.notify_payer_name ? ` · ${t('subs.payer', '입금자')} ${p.notify_payer_name}` : ''}</span>
                      )}
                      {p.payer_name && <span>{t('payments.payer', '입금자')}: {p.payer_name}</span>}
                    </RowDates>
                    {p.refund_reason && <Reason>{p.refund_reason}</Reason>}
                    {p.cancel_reason && <Reason>{p.cancel_reason}</Reason>}
                  </RowLeft>
                  <RowRight>
                    {p.status === 'pending' && (
                      <PrimaryBtn type="button" disabled={busyId === p.id}
                        onClick={() => handleMarkPaid(p)}>
                        {busyId === p.id ? '...' : t('payments.markPaid', '입금 완료 처리')}
                      </PrimaryBtn>
                    )}
                    {p.status === 'paid' && (p.tax_invoice_status === 'requested' || p.tax_invoice_status === 'failed') && (
                      <PrimaryBtn type="button" disabled={busyId === p.id}
                        onClick={() => handleIssueTaxInvoice(p)}
                        title={p.tax_invoice_data?.biz_name || ''}>
                        {busyId === p.id ? '...' : t('payments.issueTaxInvoice', '세금계산서 발행')}
                      </PrimaryBtn>
                    )}
                    {p.status === 'paid' && p.tax_invoice_status === 'issued' && (
                      <Tag>{t('payments.taxIssued', '세금계산서 발행됨')}</Tag>
                    )}
                    {p.kind === 'addon' && <Tag>Add-on</Tag>}
                    {p.status === 'paid' && p.refund_requested_at && (
                      <DangerBtn type="button" disabled={busyId === p.id} data-testid={`admin-trial-refund-open-${p.id}`}
                        onClick={() => setTrialRefund({
                          id: p.id, amount: p.amount, currency: p.currency, method: p.method,
                          businessName: p.business?.name || null, requestedAt: p.refund_requested_at || null,
                          note: p.refund_request_note || null, hasStripeIntent: !!p.has_stripe_intent,
                          taxIssued: p.tax_invoice_status === 'issued', trial: !!p.refund_request_trial,
      cancelsSubscription: !!p.refund_cancels_subscription, addonUnits: p.refund_addon_units ?? null,
                        })}>
                        {p.refund_request_trial ? t('payments.trialRefundOpen', '체험 환불 처리') : t('payments.requestRefundOpen', '환불 요청 처리')}
                      </DangerBtn>
                    )}
                    {p.status === 'paid' && !p.refund_requested_at && (
                      <DangerBtn type="button" disabled={busyId === p.id}
                        onClick={() => setConfirm(p)}>
                        {t('payments.refund', '환불')}
                      </DangerBtn>
                    )}
                  </RowRight>
                </Row>
              );
            })}
          </List>
        )}

        <TrialRefundModal target={trialRefund} onClose={() => setTrialRefund(null)}
          onDone={() => { setTrialRefund(null); load(); refreshAdminTodo(); }}
          fmtMoney={(n, cur) => `${cur} ${fmtKRW(n)}`} fmtDate={fmtDate} />
        {confirm && (
          <ConfirmDialog
            isOpen
            title={t('payments.confirmRefundTitle', '환불 처리') as string}
            message={`${t('payments.confirmRefundMsg', { amount: `${confirm.currency} ${fmtKRW(confirm.amount)}`, biz: confirm.business?.name, defaultValue: '{{biz}} 의 {{amount}} 결제를 환불 처리합니다.' })} ${
              // 환불하면 같이 바뀌는 것을 같은 규칙으로 말한다(처리 창과 같은 문구 — 모르고 해지하지 않게)
              confirm.refund_cancels_subscription ? t('payments.refundEffectCancel', '처리하면 전액 환불되고 워크스페이스가 무료 플랜으로 바뀝니다(구독 해지).')
                : confirm.kind === 'addon' ? t('payments.refundEffectAddon', { units: confirm.refund_addon_units ?? '', defaultValue: '애드온 한도 {{units}} 이 돌아갑니다(줄어듭니다).' })
                  : t('payments.refundEffectKeep', '지금 구독의 결제가 아니라 구독은 그대로입니다.')
            }`}
            confirmText={t('payments.refund', '환불') as string}
            variant="danger"
            onConfirm={() => handleRefund(confirm)}
            onClose={() => setConfirm(null)}
          />
        )}
      </Wrap>
    </PageShell>
  );
};

export default AdminPaymentsPage;

const Wrap = styled.div`display: flex; flex-direction: column; gap: 16px; padding: 0 20px 20px;`;
const KpiRow = styled.div`
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
`;
const Kpi = styled.div`
  background: #FFFFFF;
  border: 1px solid #E2E8F0;
  border-radius: 10px;
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 4px;
`;
const KpiLabel = styled.div`font-size: 0.75rem; color: #64748B; font-weight: 600;`;
const KpiValue = styled.div`font-size: 1.25rem; font-weight: 700; color: #0F172A;`;
// 비매출(내부·테스터) 보조 라인 — 운영 #275. AdminDashboardPage 의 KpiSub 와 같은 규격.
const KpiSub = styled.div`font-size: 0.6875rem; color: #94A3B8; font-weight: 500; line-height: 1.4;`;
const TabBar = styled.div`
  display: flex; gap: 4px; padding: 0 4px;
  border-bottom: 1px solid #E2E8F0;
  overflow-x: auto;
  &::-webkit-scrollbar { display: none; }
`;
const TabBtn = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 14px; background: transparent; border: none;
  border-bottom: 2px solid ${p => p.$active ? '#14B8A6' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  font-size: 0.8125rem; font-weight: ${p => p.$active ? 700 : 500};
  cursor: pointer; white-space: nowrap;
  &:hover { color: #0F172A; }
`;
const Count = styled.span<{ $active: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; padding: 1px 7px; font-size: 0.6875rem; font-weight: 700;
  background: ${p => p.$active ? '#14B8A6' : '#E2E8F0'};
  color: ${p => p.$active ? '#FFFFFF' : '#64748B'};
  border-radius: 999px;
`;
const ErrorBox = styled.div`
  padding: 10px 14px; border-radius: 8px;
  background: #FEF2F2; color: #B91C1C;
  font-size: 0.8125rem; border: 1px solid #FECACA;
`;
const List = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const Row = styled.article<{ $focus?: boolean; $notified?: boolean }>`
  display: flex; gap: 16px; align-items: center;
  padding: 14px 16px; background: ${p => p.$notified ? '#F0FDFA' : '#FFFFFF'};
  border: 1px solid ${p => p.$focus ? '#14B8A6' : p.$notified ? '#5EEAD4' : '#E2E8F0'}; border-radius: 10px;
  ${p => p.$focus ? 'box-shadow: 0 0 0 3px rgba(20,184,166,0.15);' : ''}
  @media (max-width: 768px) { flex-direction: column; align-items: stretch; }
`;
const RowLeft = styled.div`flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0;`;
const RowTop = styled.div`display: flex; gap: 8px; align-items: center;`;
const BizName = styled.div`font-size: 0.875rem; font-weight: 700; color: #0F172A;`;
const StatusBadge = styled.span<{ $bg: string; $fg: string }>`
  padding: 2px 8px; font-size: 0.6875rem; font-weight: 700;
  background: ${p => p.$bg}; color: ${p => p.$fg}; border-radius: 4px;
`;
const RowMeta = styled.div`display: flex; gap: 6px; flex-wrap: wrap; align-items: center;`;
const Tag = styled.span`
  padding: 2px 8px; font-size: 0.6875rem; font-weight: 600;
  background: #F0FDFA; color: #0F766E; border-radius: 4px;
`;
const Amount = styled.span`font-size: 0.8125rem; color: #0F172A; font-weight: 700;`;
// 누구·가입일 줄 — 구독 관리 OwnerLine 과 같은 크기(이름이 길면 줄바꿈)
const WhoLine = styled.div`
  display: flex; gap: 12px; flex-wrap: wrap;
  font-size: 0.75rem; color: #475569; min-width: 0; overflow-wrap: anywhere;
`;
// 사람이 고른 청구는 진하게, 자동 청구는 기본 회색 — 같은 «대기» 라도 무게가 다르다
const OriginText = styled.span<{ $auto: boolean }>`
  color: ${p => p.$auto ? '#94A3B8' : '#0F766E'}; font-weight: ${p => p.$auto ? 400 : 600};
`;
const RowDates = styled.div`
  display: flex; gap: 12px; flex-wrap: wrap;
  font-size: 0.6875rem; color: #94A3B8;
`;
const Reason = styled.div`font-size: 0.75rem; color: #64748B; font-style: italic; margin-top: 2px;`;
const RowRight = styled.div`display: flex; gap: 8px; flex-shrink: 0;`;
const DangerBtn = styled.button`
  padding: 8px 14px; font-size: 0.8125rem; font-weight: 600;
  background: #FFFFFF; color: #DC2626;
  border: 1px solid #FECACA; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #FEF2F2; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const PrimaryBtn = styled.button`
  padding: 8px 14px; font-size: 0.8125rem; font-weight: 600;
  background: #14B8A6; color: #FFFFFF;
  border: 0; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Skeleton = styled.div`
  height: 200px;
  background: linear-gradient(90deg, #F1F5F9 0%, #E2E8F0 50%, #F1F5F9 100%);
  background-size: 200% 100%;
  border-radius: 10px;
  animation: shimmer 1.5s infinite;
  @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
`;
