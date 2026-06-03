// 고객 정기 구독청구 — ClientsPage 드로어 임베드 (사이클 N+83).
//   목록 + 인라인 "구독 시작" 폼 + 일시정지/재개/해지/지금 청구. popup-on-popup 회피(드로어 안 인라인 확장).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import ActionButton from '../../components/Common/ActionButton';

interface Sub {
  id: number; plan_name: string; amount: number; currency: string;
  interval: 'weekly' | 'monthly' | 'quarterly' | 'yearly'; vat_rate: number;
  auto_mode: 'auto' | 'draft_review'; due_days: number; status: 'active' | 'paused' | 'canceled';
  start_date: string; next_billing_at: string; last_invoiced_at: string | null; notes: string | null;
}

interface Props { businessId: number; clientId: number; canWrite: boolean }

const todayStr = () => new Date().toISOString().slice(0, 10);

const ClientSubscriptions: React.FC<Props> = ({ businessId, clientId, canWrite }) => {
  const { t } = useTranslation('clients');
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // 폼 상태
  const [plan, setPlan] = useState('');
  const [amount, setAmount] = useState('');
  const [interval, setIntervalV] = useState<Sub['interval']>('monthly');
  const [autoMode, setAutoMode] = useState<Sub['auto_mode']>('draft_review');
  const [startDate, setStartDate] = useState(todayStr());
  const [formErr, setFormErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/client-subscriptions/${businessId}?client_id=${clientId}`);
      const j = await r.json();
      if (j.success) setSubs((j.data || []).filter((s: Sub) => s.status !== 'canceled'));
    } finally { setLoading(false); }
  }, [businessId, clientId]);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setPlan(''); setAmount(''); setIntervalV('monthly'); setAutoMode('draft_review'); setStartDate(todayStr()); setFormErr(''); };

  const submit = async () => {
    if (submitting) return;
    const amt = Number(amount);
    if (!plan.trim()) { setFormErr(t('subscription.errPlan', '구독명을 입력하세요') as string); return; }
    if (!(amt > 0)) { setFormErr(t('subscription.errAmount', '금액을 올바르게 입력하세요') as string); return; }
    setSubmitting(true); setFormErr('');
    try {
      const r = await apiFetch(`/api/client-subscriptions/${businessId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, plan_name: plan.trim(), amount: amt, interval, auto_mode: autoMode, start_date: startDate }),
      });
      const j = await r.json();
      if (j.success) { resetForm(); setFormOpen(false); await load(); }
      else setFormErr(j.message || 'error');
    } finally { setSubmitting(false); }
  };

  const setStatus = async (id: number, status: 'active' | 'paused') => {
    setBusyId(id);
    try {
      const r = await apiFetch(`/api/client-subscriptions/${businessId}/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      if ((await r.json()).success) await load();
    } finally { setBusyId(null); }
  };

  const cancel = async (id: number) => {
    setBusyId(id);
    try {
      const r = await apiFetch(`/api/client-subscriptions/${businessId}/${id}`, { method: 'DELETE' });
      if ((await r.json()).success) await load();
    } finally { setBusyId(null); }
  };

  const billNow = async (id: number) => {
    setBusyId(id);
    try {
      const r = await apiFetch(`/api/client-subscriptions/${businessId}/${id}/bill-now`, { method: 'POST' });
      if ((await r.json()).success) await load();
    } finally { setBusyId(null); }
  };

  const intervalLabel = (iv: Sub['interval']) => t(`subscription.interval.${iv}`, iv) as string;
  const fmtAmount = (a: number, cur: string) => `${Number(a).toLocaleString()} ${cur}`;

  const intervalOptions = (['monthly', 'weekly', 'quarterly', 'yearly'] as const).map((v) => ({ value: v, label: intervalLabel(v) }));
  const modeOptions = [
    { value: 'draft_review', label: t('subscription.modeDraft', '검토 후 발송') as string },
    { value: 'auto', label: t('subscription.modeAuto', '자동 발송') as string },
  ];

  return (
    <Wrap>
      <Head>
        <Title>{t('subscription.title', '정기 구독')} <Count>{subs.length}</Count></Title>
        {canWrite && !formOpen && (
          <ActionButton tone="secondary" size="sm" onClick={() => { resetForm(); setFormOpen(true); }}>
            {t('subscription.start', '구독 시작')}
          </ActionButton>
        )}
      </Head>

      {formOpen && (
        <Form>
          <Field>
            <Lbl>{t('subscription.planName', '구독명')}</Lbl>
            <Inp value={plan} onChange={(e) => setPlan(e.target.value)} placeholder={t('subscription.planPh', '예: 월 유지보수') as string} maxLength={200} />
          </Field>
          <Row2>
            <Field>
              <Lbl>{t('subscription.amount', '금액(공급가)')}</Lbl>
              <Inp type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500000" />
            </Field>
            <Field>
              <Lbl>{t('subscription.interval.label', '주기')}</Lbl>
              <PlanQSelect options={intervalOptions} isSearchable={false}
                value={intervalOptions.find((o) => o.value === interval)}
                onChange={(opt: unknown) => { const v = (opt as { value?: string } | null)?.value; if (v) setIntervalV(v as Sub['interval']); }} />
            </Field>
          </Row2>
          <Row2>
            <Field>
              <Lbl>{t('subscription.startDate', '시작일')}</Lbl>
              <SingleDateField value={startDate} onChange={setStartDate} minDate={todayStr()} />
            </Field>
            <Field>
              <Lbl>{t('subscription.mode', '발행 방식')}</Lbl>
              <PlanQSelect options={modeOptions} isSearchable={false}
                value={modeOptions.find((o) => o.value === autoMode)}
                onChange={(opt: unknown) => { const v = (opt as { value?: string } | null)?.value; if (v) setAutoMode(v as Sub['auto_mode']); }} />
            </Field>
          </Row2>
          <Helper>{t('subscription.vatNote', '부가세 10%가 자동으로 더해져 청구돼요.')}</Helper>
          {formErr && <Err>{formErr}</Err>}
          <FormActions>
            <ActionButton tone="secondary" size="sm" onClick={() => { setFormOpen(false); resetForm(); }} disabled={submitting}>
              {t('subscription.formCancel', '취소')}
            </ActionButton>
            <ActionButton tone="primary" size="sm" loading={submitting} onClick={submit}>
              {t('subscription.create', '구독 시작')}
            </ActionButton>
          </FormActions>
        </Form>
      )}

      {loading && subs.length === 0 ? (
        <Dim>{t('subscription.loading', '불러오는 중…')}</Dim>
      ) : subs.length === 0 && !formOpen ? (
        <Empty>{t('subscription.empty', '아직 정기 구독이 없어요. "구독 시작"으로 월/주 단위 자동 청구를 걸 수 있어요.')}</Empty>
      ) : (
        <List>
          {subs.map((s) => (
            <Card key={s.id} $paused={s.status === 'paused'}>
              <CardMain>
                <CardName>{s.plan_name}</CardName>
                <CardMeta>
                  <strong>{fmtAmount(s.amount, s.currency)}</strong> · {intervalLabel(s.interval)}
                  {s.status === 'active'
                    ? <NextBadge>{t('subscription.next', '다음 청구')} {s.next_billing_at}</NextBadge>
                    : <PausedBadge>{t('subscription.paused', '일시정지')}</PausedBadge>}
                </CardMeta>
              </CardMain>
              {canWrite && (
                <CardActions>
                  {s.status === 'active' ? (
                    <>
                      <MiniBtn type="button" onClick={() => billNow(s.id)} disabled={busyId === s.id}>{t('subscription.billNow', '지금 청구')}</MiniBtn>
                      <MiniBtn type="button" onClick={() => setStatus(s.id, 'paused')} disabled={busyId === s.id}>{t('subscription.pause', '일시정지')}</MiniBtn>
                    </>
                  ) : (
                    <MiniBtn type="button" onClick={() => setStatus(s.id, 'active')} disabled={busyId === s.id}>{t('subscription.resume', '재개')}</MiniBtn>
                  )}
                  <MiniBtn type="button" $danger onClick={() => cancel(s.id)} disabled={busyId === s.id}>{t('subscription.cancel', '해지')}</MiniBtn>
                </CardActions>
              )}
            </Card>
          ))}
        </List>
      )}
    </Wrap>
  );
};

export default ClientSubscriptions;

const Wrap = styled.div`display:flex;flex-direction:column;gap:10px;`;
const Head = styled.div`display:flex;align-items:center;justify-content:space-between;gap:8px;`;
const Title = styled.div`font-size:13px;font-weight:700;color:#0F172A;display:flex;align-items:center;gap:6px;`;
const Count = styled.span`font-size:11px;font-weight:600;color:#0F766E;background:#F0FDFA;border-radius:999px;padding:1px 8px;`;
const Form = styled.div`display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid #E2E8F0;border-radius:12px;background:#F8FAFC;`;
const Row2 = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:10px;`;
const Field = styled.div`display:flex;flex-direction:column;gap:5px;min-width:0;`;
const Lbl = styled.label`font-size:12px;font-weight:600;color:#334155;`;
const Inp = styled.input`height:36px;padding:0 10px;border:1px solid #CBD5E1;border-radius:8px;font-size:13px;color:#0F172A;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15);}`;
const Helper = styled.div`font-size:11px;color:#94A3B8;`;
const Err = styled.div`font-size:12px;color:#EF4444;`;
const FormActions = styled.div`display:flex;justify-content:flex-end;gap:8px;`;
const List = styled.div`display:flex;flex-direction:column;gap:8px;`;
const Card = styled.div<{ $paused?: boolean }>`display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:12px 14px;border:1px solid #E2E8F0;border-radius:12px;background:#fff;opacity:${(p) => (p.$paused ? 0.7 : 1)};`;
const CardMain = styled.div`display:flex;flex-direction:column;gap:4px;min-width:0;`;
const CardName = styled.div`font-size:13px;font-weight:600;color:#0F172A;`;
const CardMeta = styled.div`font-size:12px;color:#64748B;display:flex;align-items:center;gap:6px;flex-wrap:wrap;strong{color:#0F172A;font-weight:700;}`;
const NextBadge = styled.span`font-size:11px;color:#0F766E;background:#F0FDFA;border-radius:999px;padding:1px 8px;`;
const PausedBadge = styled.span`font-size:11px;color:#92400E;background:#FEF3C7;border-radius:999px;padding:1px 8px;`;
const CardActions = styled.div`display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;`;
const MiniBtn = styled.button<{ $danger?: boolean }>`height:30px;padding:0 10px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;
  background:#fff;border:1px solid ${(p) => (p.$danger ? '#FCA5A5' : '#CBD5E1')};color:${(p) => (p.$danger ? '#DC2626' : '#334155')};
  &:hover:not(:disabled){background:${(p) => (p.$danger ? '#FEF2F2' : '#F1F5F9')};}
  &:disabled{opacity:0.5;cursor:default;}`;
const Dim = styled.div`font-size:12px;color:#94A3B8;`;
const Empty = styled.div`font-size:12px;color:#94A3B8;line-height:1.5;padding:8px 0;`;
