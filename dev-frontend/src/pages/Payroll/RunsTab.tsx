// 급여 › 급여 탭 — 월별 회차 목록 (docs/PAYROLL_DESIGN.md §9). 같은 달의 정정 회차는 접어서 «정정 n건» 뱃지로.
//   [이달 급여] = CreateDrawer(귀속월·지급일·송금 할 일 방식) → 서버가 유효 계약으로 초안을 채운다 → 그 회차 화면으로 간다.
//   실시간: payroll:updated(개인 방 신호) → 250ms 뒤 다시 읽기 + 탭 복귀 재조회.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import CreateDrawer from '../../components/Common/CreateDrawer';
import PlanQSelect from '../../components/Common/PlanQSelect';
import SingleDateField from '../../components/Common/SingleDateField';
import ActionButton from '../../components/Common/ActionButton';
import { useAuth } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { listRowTitleCss } from '../../theme/tokens';
import { payrollApi, PayrollError, formatMoney, type Run } from './payrollApi';
import { RunStatusChip } from './payrollUi';

function monthOptions(fmt: (y: number, m: number) => string) {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let d = 2; d >= -12; d--) {
    const x = new Date(now.getFullYear(), now.getMonth() + d, 1);
    const ym = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value: ym, label: fmt(x.getFullYear(), x.getMonth() + 1) });
  }
  return out;
}

export default function RunsTab({ createOpen, setCreateOpen }: { createOpen: boolean; setCreateOpen: (v: boolean) => void }) {
  const { t, i18n } = useTranslation('payroll');
  const { user } = useAuth();
  const navigate = useNavigate();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const seqRef = useRef(0);
  const lang = i18n.language;

  const load = useCallback(async (silent = false) => {
    if (!bizId) return;
    const seq = ++seqRef.current;
    if (!silent) setLoading(true);
    try {
      const rows = await payrollApi.runs(bizId);
      if (seq !== seqRef.current) return;
      setRuns(rows); setError(false);
    } catch { if (seq === seqRef.current && !silent) setError(true); }
    finally { if (seq === seqRef.current && !silent) setLoading(false); }
  }, [bizId]);
  useEffect(() => { load(); }, [load]);
  const silentLoad = useCallback(() => load(true), [load]);
  useVisibilityRefresh(silentLoad);
  useEffect(() => {
    let pending: number | null = null;
    const off = onSocket<{ business_id?: number }>('payroll:updated', (d) => {
      if (d?.business_id && Number(d.business_id) !== bizId) return;
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentLoad(); }, 250);
    });
    return () => { off(); if (pending) window.clearTimeout(pending); };
  }, [bizId, silentLoad]);

  // 같은 달은 한 줄 — 정기 회차(seq 1)가 대표, 정정은 뱃지
  const groups = useMemo(() => {
    const m = new Map<string, { main: Run | null; adj: Run[] }>();
    for (const r of runs) {
      const g = m.get(r.period_ym) || { main: null, adj: [] };
      if (r.kind === 'regular') g.main = r; else g.adj.push(r);
      m.set(r.period_ym, g);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [runs]);

  // 만들기
  const opts = useMemo(() => monthOptions((y, m) => t('runs.monthLabel', { y, m }) as string), [t]);
  const thisMonth = opts[2]?.value;
  const [form, setForm] = useState({ period_ym: thisMonth, pay_date: '', mode: 'per_person' });
  const [submitting, setSubmitting] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  useEffect(() => { if (createOpen) { setForm({ period_ym: thisMonth, pay_date: '', mode: 'per_person' }); setCreateErr(null); } }, [createOpen, thisMonth]);
  const submit = async () => {
    if (!bizId || submitting) return;
    setSubmitting(true); setCreateErr(null);
    try {
      const r = await payrollApi.createRun(bizId, { period_ym: form.period_ym, pay_date: form.pay_date || null, transfer_task_mode: form.mode });
      setCreateOpen(false);
      navigate(`/payroll/runs/${r.run.id}`);
    } catch (e) {
      const code = e instanceof PayrollError ? e.code : 'generic';
      const existing = (e instanceof PayrollError ? (e.data as { run_id?: number } | undefined)?.run_id : undefined);
      if (code === 'run_exists' && existing) { setCreateOpen(false); navigate(`/payroll/runs/${existing}`); return; }
      setCreateErr(code);
    } finally { setSubmitting(false); }
  };
  const modeOptions = [{ value: 'per_person', label: t('runs.create.modePerPerson') as string }, { value: 'single', label: t('runs.create.modeSingle') as string }];

  const amount = (r: Run, key: 'gross_total' | 'deduction_total' | 'net_total') => {
    const curs = r.totals_by_currency ? Object.entries(r.totals_by_currency) : [];
    if (curs.length > 1) return curs.map(([c, v]) => formatMoney(v[key], c, lang)).join(' · ');
    const cur = curs[0]?.[0] || 'KRW';
    return r[key] === null ? <Muted>{t('runs.unknown')}</Muted> : formatMoney(r[key], cur, lang);
  };

  return (
    <>
      {loading ? null : error ? (
        <Empty>
          <span>{t('runs.loadFailed')}</span>
          <ActionButton tone="secondary" onClick={() => load()}>{t('runs.retry')}</ActionButton>
        </Empty>
      ) : groups.length === 0 ? (
        <Empty data-testid="payroll-runs-empty">{t('runs.empty')}</Empty>
      ) : (
        <List data-testid="payroll-runs">
          {groups.map(([ym, g]) => {
            const r = g.main || g.adj[0];
            return (
              <Row key={ym} type="button" data-testid="payroll-run-row" onClick={() => navigate(`/payroll/runs/${r.id}`)}>
                <RowMain>
                  <RowTitle>{t('run.title', { period: ym })}</RowTitle>
                  <RowMeta>
                    {[r.pay_date ? t('run.payDate', { date: r.pay_date }) : null, t('runs.headcount', { n: r.headcount })].filter(Boolean).join(' · ')}
                    {g.adj.length > 0 && <AdjChip>{t('runs.adjustmentCount', { n: g.adj.length })}</AdjChip>}
                  </RowMeta>
                </RowMain>
                <Figures>
                  <Fig><FigLabel>{t('runs.gross')}</FigLabel><FigVal>{amount(r, 'gross_total')}</FigVal></Fig>
                  <Fig $hideOnPhone><FigLabel>{t('runs.deduction')}</FigLabel><FigVal>{amount(r, 'deduction_total')}</FigVal></Fig>
                  <Fig><FigLabel>{t('runs.net')}</FigLabel><FigVal $strong>{amount(r, 'net_total')}</FigVal></Fig>
                </Figures>
                <RunStatusChip status={r.status} />
              </Row>
            );
          })}
        </List>
      )}

      <CreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} title={t('runs.create.title')}
        onSubmit={submit} submitting={submitting} submitDisabled={!form.period_ym} submitLabel={t('runs.create.submit')} submitTestId="payroll-run-create-submit">
        <Hint>{t('runs.create.hint')}</Hint>
        {createErr && <Err role="alert">{t(`error.${createErr}`, { defaultValue: t('error.generic') as string })}</Err>}
        <Field>
          <Label>{t('runs.create.period')}</Label>
          <PlanQSelect size="sm" value={opts.find((o) => o.value === form.period_ym) || null}
            onChange={(v) => setForm({ ...form, period_ym: (v as { value?: string })?.value || thisMonth })} options={opts} />
        </Field>
        <Field>
          <Label>{t('runs.create.payDate')}</Label>
          <SingleDateField value={form.pay_date} onChange={(d) => setForm({ ...form, pay_date: d })} />
          <Sub>{t('runs.create.payDateHint')}</Sub>
        </Field>
        <Field>
          <Label>{t('runs.create.mode')}</Label>
          <PlanQSelect size="sm" value={modeOptions.find((o) => o.value === form.mode) || null}
            onChange={(v) => setForm({ ...form, mode: (v as { value?: string })?.value || 'per_person' })} options={modeOptions} />
        </Field>
      </CreateDrawer>
    </>
  );
}

const List = styled.div`margin-top: 4px; background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;`;
const Row = styled.button`
  width: 100%; display: flex; align-items: center; gap: 16px; padding: 12px 16px; min-height: 64px;
  background: #FFF; border: none; border-bottom: 1px solid #F1F5F9; text-align: left; cursor: pointer; font-family: inherit;
  &:last-child { border-bottom: none; }
  &:hover { background: #F8FAFC; }
  @media (max-width: 640px) { flex-wrap: wrap; gap: 8px; }
`;
const RowMain = styled.div`flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 2px;`;
const RowTitle = styled.span`${listRowTitleCss} color: #0F172A;`;
const RowMeta = styled.span`font-size: 0.75rem; color: #64748B; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;`;
const AdjChip = styled.span`padding: 1px 8px; border-radius: 999px; background: #FFF7ED; color: #C2410C; font-size: 0.6875rem; font-weight: 600;`;
const Figures = styled.div`display: flex; gap: 20px; flex: 0 0 auto; @media (max-width: 640px) { gap: 14px; }`;
const Fig = styled.div<{ $hideOnPhone?: boolean }>`
  display: flex; flex-direction: column; align-items: flex-end; min-width: 96px;
  @media (max-width: 640px) { min-width: 0; ${(p) => (p.$hideOnPhone ? 'display: none;' : '')} }
`;
const FigLabel = styled.span`font-size: 0.6875rem; color: #94A3B8;`;
const FigVal = styled.span<{ $strong?: boolean }>`font-size: 0.8125rem; font-weight: ${(p) => (p.$strong ? 700 : 600)}; color: #0F172A; font-variant-numeric: tabular-nums;`;
const Muted = styled.span`color: #94A3B8; font-weight: 500;`;
const Empty = styled.div`
  margin-top: 4px; padding: 40px 16px; text-align: center; color: #64748B; font-size: 0.875rem; line-height: 1.6;
  background: #FFF; border: 1px dashed #E2E8F0; border-radius: 12px; display: flex; flex-direction: column; align-items: center; gap: 12px;
`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #475569;`;
const Sub = styled.span`font-size: 0.75rem; color: #94A3B8;`;
const Hint = styled.p`margin: 0 0 14px; font-size: 0.8125rem; color: #475569; line-height: 1.5;`;
const Err = styled.div`margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem;`;
