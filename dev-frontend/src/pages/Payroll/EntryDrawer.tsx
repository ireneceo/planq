// 회차 × 한 사람 — 항목별 초안·대장·확정값과 출처 뱃지, 확정값 직접 입력(자동저장), 무급휴가 일수, 이달 제외.
//   ★ 칸마다 출처를 글자로 보인다 — 예상(PlanQ 계산) · 대장(세무사 값) · 입력(사람). 빈 칸은 «—» (0 이 아니다).
//   ★ 확정된 회차는 보기만 — 서버도 409 run_locked 로 막는다. 계좌번호는 없다(확정 때 동결한 은행·끝 4자리만).
import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import DetailDrawer from '../../components/Common/DetailDrawer';
import AutoSaveField from '../../components/Common/AutoSaveField';
import ActionButton from '../../components/Common/ActionButton';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { payrollApi, PayrollError, formatMoney, type RunDetail, type RunEntry, type RunLine } from './payrollApi';
import { SourceBadge } from './payrollUi';

interface Props {
  businessId: number;
  detail: RunDetail;
  entry: RunEntry;
  onClose: () => void;
  onChanged: () => void;
}

export default function EntryDrawer({ businessId, detail, entry, onClose, onChanged }: Props) {
  const { t, i18n } = useTranslation('payroll');
  const lang = i18n.language;
  const locked = detail.locked;
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const itemById = new Map(detail.items.map((x) => [x.id, x]));
  const money = (n: number | null) => formatMoney(n, entry.currency, lang);
  const fail = (e: unknown) => { setError(e instanceof PayrollError ? e.code : 'generic'); };

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); setError(null); onChanged(); } catch (e) { fail(e); }
  };

  const earnings = entry.lines.filter((l) => itemById.get(l.pay_item_id)?.side === 'earning');
  const deductions = entry.lines.filter((l) => itemById.get(l.pay_item_id)?.side === 'deduction');

  const lineRow = (l: RunLine) => {
    const it = itemById.get(l.pay_item_id);
    const differs = l.statement_amount !== null && l.draft_amount !== null && l.statement_amount !== l.draft_amount;
    return (
      <LineRow key={l.id} data-testid="payroll-entry-line">
        <LineHead>
          <LineName>{l.name}{it?.is_statutory ? <Tiny>{t('items.statutory')}</Tiny> : null}</LineName>
          <SourceBadge source={l.final_source} />
        </LineHead>
        <Vals>
          <Val><ValLabel>{t('entry.draft')}</ValLabel><ValNum>{money(l.draft_amount)}</ValNum></Val>
          <Val><ValLabel>{t('entry.statement')}</ValLabel><ValNum $warn={differs}>{money(l.statement_amount)}</ValNum></Val>
          <Val $grow>
            <ValLabel>{t('entry.final')}</ValLabel>
            {locked ? <ValNum $strong>{money(l.final_amount)}</ValNum> : (
              <FinalInput key={`${l.id}-${l.final_amount}-${l.final_source}`} line={l} onSave={(v) => payrollApi.updateLine(businessId, l.id, { final_amount: v }).then(() => { setError(null); onChanged(); }).catch((e) => { fail(e); throw e; })} />
            )}
          </Val>
        </Vals>
        {!locked && (
          <Quick>
            {l.statement_amount !== null && l.final_source !== 'statement' && <LinkBtn type="button" onClick={() => act(() => payrollApi.adopt(businessId, detail.run.id, { mode: 'statement', line_id: l.id }))}>{t('entry.useStatement')}</LinkBtn>}
            {l.draft_amount !== null && l.final_source !== 'draft' && <LinkBtn type="button" onClick={() => act(() => payrollApi.updateLine(businessId, l.id, { final_amount: null }))}>{t('entry.useDraft')}</LinkBtn>}
          </Quick>
        )}
      </LineRow>
    );
  };

  return (
    <DetailDrawer open onClose={onClose} ariaLabel={entry.display_name}>
      <DetailDrawer.Header onClose={onClose}>
        <Title data-testid="payroll-entry-title">{entry.display_name}</Title>
        {entry.employee_no && <Muted>{entry.employee_no}</Muted>}
      </DetailDrawer.Header>
      <DetailDrawer.Body>
        {error && <Err role="alert">{t(`error.${error}`, { defaultValue: t('error.generic') as string })}</Err>}
        {locked && <Info>{t('entry.locked')}</Info>}
        {entry.statement_warnings.map((w, i) => (
          <Warn key={i} role="status">{t(`entry.warn.${w.code}`, { statement: money(w.statement), recomputed: money(w.recomputed) })}</Warn>
        ))}
        <Totals data-testid="payroll-entry-totals">
          <Tot><span>{t('run.gross')}</span><b>{money(entry.gross_total)}</b></Tot>
          <Tot><span>{t('run.deduction')}</span><b>{money(entry.deduction_total)}</b></Tot>
          <Tot $net><span>{t('run.net')}</span><b>{money(entry.net_total)}</b></Tot>
        </Totals>

        {detail.run.kind === 'regular' && (
          <UnpaidRow>
            <UnpaidLabel>{t('entry.unpaidDays')}<Tiny>{entry.unpaid_leave_source === 'manual' ? t('entry.unpaidManual') : t('entry.unpaidFromLeave')}</Tiny></UnpaidLabel>
            {locked ? <b>{entry.unpaid_leave_days ?? 0}</b> : (
              <>
                <UnpaidInput key={`${entry.id}-${entry.unpaid_leave_days}`} value={entry.unpaid_leave_days} onSave={(v) => payrollApi.updateEntry(businessId, entry.id, { unpaid_leave_days: v }).then(() => { setError(null); onChanged(); }).catch((e) => { fail(e); throw e; })} />
                {entry.unpaid_leave_source === 'manual' && <LinkBtn type="button" onClick={() => act(() => payrollApi.updateEntry(businessId, entry.id, { unpaid_leave_days: null }))}>{t('entry.resetUnpaid')}</LinkBtn>}
              </>
            )}
          </UnpaidRow>
        )}

        <SectionTitle>{t('payslips.earnings')}</SectionTitle>
        <Lines>{earnings.map(lineRow)}</Lines>
        <SectionTitle>{t('payslips.deductions')}</SectionTitle>
        <Lines>{deductions.map(lineRow)}</Lines>

        {locked && entry.bank_last4 && <Muted>{t('entry.bank')}: {entry.bank_name || ''} ****{entry.bank_last4}</Muted>}
        <Footer>
          {locked
            ? <ActionButton tone="secondary" size="sm" data-testid="payroll-entry-pdf" onClick={() => payrollApi.entryPayslipPdf(businessId, entry.id, lang).catch(fail)}>{t('entry.pdf')}</ActionButton>
            : <ActionButton tone="secondary" size="sm" data-testid="payroll-entry-remove" onClick={() => setConfirmRemove(true)}>{t('entry.remove')}</ActionButton>}
        </Footer>
      </DetailDrawer.Body>
      <ConfirmDialog isOpen={confirmRemove} onClose={() => setConfirmRemove(false)} variant="warning"
        title={t('entry.removeTitle')} message={t('entry.removeMsg', { name: entry.display_name })} confirmText={t('entry.remove') as string} cancelText={t('common:cancel', 'Cancel') as string}
        onConfirm={() => { setConfirmRemove(false); payrollApi.removeEntry(businessId, entry.id).then(() => { onChanged(); onClose(); }).catch(fail); }} />
    </DetailDrawer>
  );
}

/** 확정값 칸 — 숫자만. 비우면 «사람이 넣은 값» 을 지우고 초안을 다시 따른다. 처음 보여준 값과 같으면 저장하지 않는다. */
function FinalInput({ line, onSave }: { line: RunLine; onSave: (v: string | null) => Promise<unknown> }) {
  const init = line.final_amount === null ? '' : String(line.final_amount);
  const [v, setV] = useState(init);
  const ref = useRef(v); ref.current = v;
  return (
    <AutoSaveField onSave={async () => {
      const cur = ref.current.replace(/,/g, '').trim();
      if (cur === init) return;
      await onSave(cur === '' ? null : cur);
    }}>
      <Num data-testid="payroll-line-final" inputMode="decimal" value={v} placeholder="—" onChange={(e) => setV(e.target.value.replace(/[^\d.,-]/g, ''))} />
    </AutoSaveField>
  );
}

function UnpaidInput({ value, onSave }: { value: number | null; onSave: (v: string | null) => Promise<unknown> }) {
  const init = value === null ? '' : String(value);
  const [v, setV] = useState(init);
  const ref = useRef(v); ref.current = v;
  useEffect(() => { setV(init); }, [init]);
  return (
    <AutoSaveField onSave={async () => { const cur = ref.current.trim(); if (cur === init) return; await onSave(cur === '' ? '0' : cur); }}>
      <Num data-testid="payroll-entry-unpaid" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} />
    </AutoSaveField>
  );
}

const Title = styled.h2`margin: 0; font-size: 1rem; font-weight: 700; color: #0F172A; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const Muted = styled.span`font-size: 0.75rem; color: #94A3B8;`;
const Tiny = styled.span`margin-left: 6px; font-size: 0.6875rem; font-weight: 500; color: #94A3B8;`;
const Err = styled.div`margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem; line-height: 1.5;`;
const Warn = styled.div`margin-bottom: 8px; padding: 8px 12px; border-radius: 8px; background: #FFFBEB; color: #B45309; font-size: 0.8125rem; line-height: 1.5;`;
const Info = styled.div`margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; background: #F8FAFC; color: #475569; font-size: 0.8125rem;`;
const Totals = styled.div`display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px;`;
const Tot = styled.div<{ $net?: boolean }>`
  display: flex; flex-direction: column; gap: 2px; padding: 10px; border-radius: 8px; background: ${(p) => (p.$net ? '#F0FDFA' : '#F8FAFC')};
  span { font-size: 0.6875rem; color: #64748B; } b { font-size: 0.875rem; color: #0F172A; font-variant-numeric: tabular-nums; }
`;
const UnpaidRow = styled.div`display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; & > div { width: 96px; }`;
const UnpaidLabel = styled.span`font-size: 0.8125rem; font-weight: 600; color: #334155; flex: 1 1 auto;`;
const SectionTitle = styled.h3`margin: 14px 0 6px; font-size: 0.8125rem; font-weight: 700; color: #334155;`;
// ★ 서랍 본문은 세로 flex — overflow 를 준 상자는 flex-shrink:0 이 없으면 눌려 줄이 잘린다(2026-10-15 실측: 소득세·무급휴가 줄이 안 보였다)
const Lines = styled.div`display: flex; flex-direction: column; border: 1px solid #F1F5F9; border-radius: 10px; overflow: hidden; flex-shrink: 0;`;
const LineRow = styled.div`padding: 10px 12px; border-bottom: 1px solid #F1F5F9; &:last-child { border-bottom: none; }`;
const LineHead = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;`;
const LineName = styled.span`font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
const Vals = styled.div`display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 8px; align-items: end;`;
const Val = styled.div<{ $grow?: boolean }>`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const ValLabel = styled.span`font-size: 0.6875rem; color: #94A3B8;`;
const ValNum = styled.span<{ $warn?: boolean; $strong?: boolean }>`
  font-size: 0.8125rem; font-variant-numeric: tabular-nums; color: ${(p) => (p.$warn ? '#B45309' : '#334155')}; font-weight: ${(p) => (p.$strong || p.$warn ? 700 : 500)};
  min-height: 36px; display: flex; align-items: center;
`;
const Num = styled.input`
  width: 100%; height: 36px; padding: 0 10px; border: 1px solid #E2E8F0; border-radius: 6px; font-size: 0.875rem; font-family: inherit; text-align: right;
  font-variant-numeric: tabular-nums; color: #0F172A; background: #FFF; box-sizing: border-box;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.15); }
`;
const Quick = styled.div`display: flex; gap: 10px; margin-top: 4px; justify-content: flex-end;`;
const LinkBtn = styled.button`background: none; border: none; padding: 4px 0; color: #0F766E; font-size: 0.75rem; font-weight: 600; cursor: pointer; font-family: inherit; min-height: 32px;`;
const Footer = styled.div`margin-top: 20px; display: flex; gap: 8px;`;
