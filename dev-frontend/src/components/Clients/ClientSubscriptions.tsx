// autosave-exempt: 자동저장이 아니다 — 일시정지/재개는 액션 버튼(busyId 로 잠금)이고,
//   구독 등록 폼에는 별도 저장 버튼이 있다.
// 고객 정기 구독청구 — ClientsPage 드로어 임베드 (사이클 N+83).
//   목록 + 인라인 "구독 시작" 폼 + 일시정지/재개/해지/지금 청구. popup-on-popup 회피(드로어 안 인라인 확장).
import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../contexts/AuthContext';
import PlanQSelect from '../Common/PlanQSelect';
import SingleDateField from '../Common/SingleDateField';
import ActionButton from '../Common/ActionButton';
import OverflowMenu from '../Common/OverflowMenu';
import ConfirmDialog from '../Common/ConfirmDialog';
import { onSocket } from '../../services/socket';

type Interval = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
type EndMode = 'never' | 'after_count' | 'until_date';
interface Sub {
  id: number; plan_name: string; amount: number; currency: string;
  interval: Interval; vat_rate: number;
  auto_mode: 'auto' | 'draft_review'; due_days: number; status: 'active' | 'paused' | 'canceled' | 'completed';
  start_date: string; next_billing_at: string; last_invoiced_at: string | null; notes: string | null;
  end_mode?: EndMode; max_occurrences?: number | null; occurrences_count?: number; end_date?: string | null;
  /** [지금 청구] 가 자동 발송일 때 메일이 갈 주소 — 서버가 실제 발송과 같은 함수로 계산해 준다 */
  bill_recipient?: string | null;
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
  // 되돌릴 수 없는 일(해지)·밖으로 나가는 일(지금 청구 = 자동 발송이면 고객 메일)은 묻는다
  const [ask, setAsk] = useState<{ kind: 'cancel' | 'bill'; sub: Sub } | null>(null);
  // 실패는 카드 아래에 말한다 — 삼키면 «눌렀는데 아무 일도 없음» 이 된다
  const [actErr, setActErr] = useState<{ id: number; msg: string } | null>(null);

  // 폼 상태
  const [plan, setPlan] = useState('');
  const [amount, setAmount] = useState('');
  const [interval, setIntervalV] = useState<Interval>('monthly');
  const [autoMode, setAutoMode] = useState<Sub['auto_mode']>('draft_review');
  const [startDate, setStartDate] = useState(todayStr());
  // 회차 자동 종료
  const [endMode, setEndMode] = useState<EndMode>('never');
  const [maxOcc, setMaxOcc] = useState('');
  const [endDate, setEndDate] = useState('');
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

  const resetForm = () => { setPlan(''); setAmount(''); setIntervalV('monthly'); setAutoMode('draft_review'); setStartDate(todayStr()); setEndMode('never'); setMaxOcc(''); setEndDate(''); setFormErr(''); };

  const submit = async () => {
    if (submitting) return;
    const amt = Number(amount);
    if (!plan.trim()) { setFormErr(t('subscription.errPlan', '구독명을 입력하세요') as string); return; }
    if (!(amt > 0)) { setFormErr(t('subscription.errAmount', '금액을 올바르게 입력하세요') as string); return; }
    if (endMode === 'after_count' && !(Number(maxOcc) >= 1)) { setFormErr(t('subscription.errMaxOcc', '종료 회차를 1 이상 입력하세요') as string); return; }
    if (endMode === 'until_date' && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) { setFormErr(t('subscription.errEndDate', '종료일을 선택하세요') as string); return; }
    setSubmitting(true); setFormErr('');
    try {
      const r = await apiFetch(`/api/client-subscriptions/${businessId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, plan_name: plan.trim(), amount: amt, interval, auto_mode: autoMode, start_date: startDate,
          end_mode: endMode, max_occurrences: endMode === 'after_count' ? Number(maxOcc) : null, end_date: endMode === 'until_date' ? endDate : null }),
      });
      const j = await r.json();
      if (j.success) { resetForm(); setFormOpen(false); await load(); }
      else setFormErr(j.message || 'error');
    } finally { setSubmitting(false); }
  };

  // 버튼 셋이 같은 껍데기 — 잠금·실패 표시·다시 읽기
  const act = async (id: number, path: string, init: RequestInit) => {
    setBusyId(id); setActErr(null);
    try {
      const r = await apiFetch(`/api/client-subscriptions/${businessId}/${path}`, init);
      const j = await r.json().catch(() => ({}));
      if (j.success) await load();
      else setActErr({ id, msg: r.status === 403 ? (t('subscription.errOwnerOnly') as string) : (j.message || (t('subscription.errAction') as string)) });
    } catch { setActErr({ id, msg: t('subscription.errAction') as string }); }
    finally { setBusyId(null); }
  };
  const setStatus = (id: number, status: 'active' | 'paused') => act(id, String(id), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
  });
  const cancel = (id: number) => act(id, String(id), { method: 'DELETE' });
  const billNow = (id: number) => act(id, `${id}/bill-now`, { method: 'POST' });

  // 실시간 — 다른 사람·자동 청구가 구독을 바꾸면 따라간다(서버가 이미 쏘던 신호, 듣는 곳이 없었다)
  useEffect(() => onSocket('client_subscription:changed', () => { void load(); }), [load]);

  const intervalLabel = (iv: Sub['interval']) => t(`subscription.interval.${iv}`, iv) as string;
  const fmtAmount = (a: number, cur: string) => `${Number(a).toLocaleString()} ${cur}`;

  const intervalOptions = (['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannual', 'yearly'] as const).map((v) => ({ value: v, label: intervalLabel(v) }));
  const endModeOptions = ([
    { value: 'never', label: t('subscription.end.never', '무기한 (수동 종료 전까지)') as string },
    { value: 'after_count', label: t('subscription.end.afterCount', '지정 회차 후 종료') as string },
    { value: 'until_date', label: t('subscription.end.untilDate', '종료일까지') as string },
  ]);
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
          <Row2>
            <Field>
              <Lbl>{t('subscription.end.label', '종료 조건')}</Lbl>
              <PlanQSelect options={endModeOptions} isSearchable={false}
                value={endModeOptions.find((o) => o.value === endMode)}
                onChange={(opt: unknown) => { const v = (opt as { value?: string } | null)?.value; if (v) setEndMode(v as EndMode); }} />
            </Field>
            <Field>
              {endMode === 'after_count' && (<>
                <Lbl>{t('subscription.end.countLabel', '총 발행 회차')}</Lbl>
                <Inp type="number" inputMode="numeric" min={1} value={maxOcc} onChange={(e) => setMaxOcc(e.target.value)} placeholder="12" />
              </>)}
              {endMode === 'until_date' && (<>
                <Lbl>{t('subscription.end.dateLabel', '종료일 (이 날까지)')}</Lbl>
                <SingleDateField value={endDate} onChange={setEndDate} minDate={startDate} />
              </>)}
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
          {/* ★ 2026-10-23 (Irene «구독청구 부분이 정돈이 너무 안되고 버튼이랑 엉망이야») — 좁은 칸(상세 좌측 ~300px·우측 패널)에서
              본문과 버튼이 한 줄을 다투며 둘 다 여러 줄로 깨졌다. 세로 카드로: 이름·상태 / 금액·주기 / 메타 한 줄 / 버튼 줄. */}
          {subs.map((s) => {
            const metas: string[] = [];
            if (s.status === 'active' && s.next_billing_at) metas.push(`${t('subscription.next', '다음 청구')} ${s.next_billing_at}`);
            if (s.end_mode === 'after_count' && s.max_occurrences) metas.push(t('subscription.occCount', { n: s.occurrences_count || 0, m: s.max_occurrences }) as string);
            else if (s.occurrences_count) metas.push(t('subscription.occDone', { n: s.occurrences_count }) as string);
            if (s.end_mode === 'until_date' && s.end_date) metas.push(t('subscription.untilBadge', { d: s.end_date }) as string);
            const busy = busyId === s.id;
            return (
              <Card key={s.id} $paused={s.status !== 'active'} data-testid={`client-sub-${s.id}`}>
                <CardTop>
                  <CardName>{s.plan_name}</CardName>
                  <StatusBadge $s={s.status}>{t(`subscription.status.${s.status}`, s.status) as string}</StatusBadge>
                </CardTop>
                <CardAmount>
                  <strong>{fmtAmount(s.amount, s.currency)}</strong> · {intervalLabel(s.interval)}
                  <Sub2> · {t(s.auto_mode === 'auto' ? 'subscription.modeAuto' : 'subscription.modeDraft') as string}</Sub2>
                </CardAmount>
                {metas.length > 0 && <CardMeta>{metas.join(' · ')}</CardMeta>}
                {canWrite && s.status !== 'completed' && (
                  <CardActions>
                    {s.status === 'active' ? (
                      <>
                        <ActionButton tone="secondary" size="sm" disabled={busy || (s.auto_mode === 'auto' && !s.bill_recipient)}
                          title={s.auto_mode === 'auto' && !s.bill_recipient ? t('subscription.noRecipient') as string : undefined}
                          data-testid={`client-sub-bill-${s.id}`} onClick={() => setAsk({ kind: 'bill', sub: s })}>
                          {t('subscription.billNow', '지금 청구')}
                        </ActionButton>
                        <ActionButton tone="secondary" size="sm" disabled={busy}
                          data-testid={`client-sub-pause-${s.id}`} onClick={() => setStatus(s.id, 'paused')}>
                          {t('subscription.pause', '일시정지')}
                        </ActionButton>
                      </>
                    ) : (
                      <ActionButton tone="secondary" size="sm" disabled={busy}
                        data-testid={`client-sub-resume-${s.id}`} onClick={() => setStatus(s.id, 'active')}>
                        {t('subscription.resume', '재개')}
                      </ActionButton>
                    )}
                    <MoreSlot>
                      <OverflowMenu label={t('subscription.more') as string} data-testid={`client-sub-more-${s.id}`}
                        items={[{ key: 'cancel', label: t('subscription.cancel', '해지') as string, danger: true, disabled: busy,
                          testId: `client-sub-cancel-${s.id}`, onClick: () => setAsk({ kind: 'cancel', sub: s }) }]} />
                    </MoreSlot>
                  </CardActions>
                )}
                {s.auto_mode === 'auto' && !s.bill_recipient && canWrite && s.status === 'active' && (
                  <Hint>{t('subscription.noRecipient') as string}</Hint>
                )}
                {actErr && actErr.id === s.id && <Err role="alert">{actErr.msg}</Err>}
              </Card>
            );
          })}
        </List>
      )}
      <ConfirmDialog
        isOpen={!!ask}
        title={(ask?.kind === 'cancel' ? t('subscription.cancelTitle', { name: ask.sub.plan_name }) : t('subscription.billTitle', { name: ask?.sub.plan_name || '' })) as string}
        message={(ask?.kind === 'cancel'
          ? t('subscription.cancelBody')
          : ask?.sub.auto_mode === 'auto'
            ? t('subscription.billBodyAuto', { to: ask.sub.bill_recipient || '—' })
            : t('subscription.billBodyDraft')) as string}
        confirmText={(ask?.kind === 'cancel' ? t('subscription.cancel', '해지') : t('subscription.billNow', '지금 청구')) as string}
        cancelText={t('subscription.formCancel', '취소') as string}
        variant={ask?.kind === 'cancel' ? 'danger' : 'info'}
        onClose={() => setAsk(null)}
        onConfirm={() => { const a = ask; setAsk(null); if (!a) return; if (a.kind === 'cancel') void cancel(a.sub.id); else void billNow(a.sub.id); }}
      />
    </Wrap>
  );
};

export default ClientSubscriptions;

const Wrap = styled.div`display:flex;flex-direction:column;gap:10px;`;
const Head = styled.div`display:flex;align-items:center;justify-content:space-between;gap:8px;`;
const Title = styled.div`font-size:0.8125rem;font-weight:700;color:#0F172A;display:flex;align-items:center;gap:6px;`;
const Count = styled.span`font-size:0.6875rem;font-weight:600;color:#0F766E;background:#F0FDFA;border-radius:999px;padding:1px 8px;`;
const Form = styled.div`display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid #E2E8F0;border-radius:12px;background:#F8FAFC;`;
const Row2 = styled.div`display:grid;grid-template-columns:1fr 1fr;gap:10px;`;
const Field = styled.div`display:flex;flex-direction:column;gap:5px;min-width:0;`;
const Lbl = styled.label`font-size:0.75rem;font-weight:600;color:#334155;`;
const Inp = styled.input`height:36px;padding:0 10px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.8125rem;color:#0F172A;
  &:focus{outline:none;border-color:#14B8A6;box-shadow:0 0 0 3px rgba(20,184,166,0.15);}`;
const Helper = styled.div`font-size:0.6875rem;color:#94A3B8;`;
const Err = styled.div`font-size:0.75rem;color:#EF4444;`;
const FormActions = styled.div`display:flex;justify-content:flex-end;gap:8px;`;
const List = styled.div`display:flex;flex-direction:column;gap:8px;`;
const Card = styled.div<{ $paused?: boolean }>`display:flex;flex-direction:column;gap:6px;
  padding:12px 14px;border:1px solid #E2E8F0;border-radius:12px;background:${(p) => (p.$paused ? '#F8FAFC' : '#fff')};`;
const CardTop = styled.div`display:flex;align-items:flex-start;justify-content:space-between;gap:8px;`;
const CardName = styled.div`font-size:0.8125rem;font-weight:600;color:#0F172A;min-width:0;word-break:break-word;`;
const StatusBadge = styled.span<{ $s: Sub['status'] }>`flex-shrink:0;font-size:0.6875rem;font-weight:600;border-radius:999px;padding:1px 8px;white-space:nowrap;
  color:${(p) => (p.$s === 'active' ? '#0F766E' : p.$s === 'paused' ? '#92400E' : '#475569')};
  background:${(p) => (p.$s === 'active' ? '#F0FDFA' : p.$s === 'paused' ? '#FEF3C7' : '#F1F5F9')};`;
const CardAmount = styled.div`font-size:0.8125rem;color:#334155;strong{color:#0F172A;font-weight:700;}`;
const Sub2 = styled.span`color:#94A3B8;font-size:0.75rem;`;
const CardMeta = styled.div`font-size:0.75rem;color:#64748B;line-height:1.5;`;
const CardActions = styled.div`display:flex;align-items:center;gap:6px;flex-wrap:wrap;
  margin-top:4px;padding-top:10px;border-top:1px solid #F1F5F9;`;
const MoreSlot = styled.div`margin-left:auto;`;
const Hint = styled.div`font-size:0.6875rem;color:#94A3B8;`;
const Dim = styled.div`font-size:0.75rem;color:#94A3B8;`;
const Empty = styled.div`font-size:0.75rem;color:#94A3B8;line-height:1.5;padding:8px 0;`;
