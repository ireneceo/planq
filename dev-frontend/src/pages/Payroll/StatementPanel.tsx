// 대장 대조 — 세무사 급여대장 파일 · 못 맞춘 사람·열 결정 (docs/PAYROLL_DESIGN.md §7.2~§7.4)
//   엑셀·CSV 는 기계가 읽고 PDF 만 AI 가 표로 옮긴다(주민번호·계좌 모양 가린 뒤). 결정은 서버가 저장하고 회차를 다시 싣는다.
//   ★ 사람이 고른 열은 항목 별칭으로 남아 다음 달엔 자동으로 맞는다.
import { useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from '../../components/Common/PlanQSelect';
import { formatDayTime } from '../../utils/dateFormat';
import ActionButton from '../../components/Common/ActionButton';
import { payrollApi, PayrollError, type PayItem, type PersonSummary, type RunDetail } from './payrollApi';

type Opt = { value: string; label: string };

interface Props {
  businessId: number;
  detail: RunDetail;
  items: PayItem[];
  people: PersonSummary[];
  onChanged: () => void;
  uploadRef?: React.MutableRefObject<(() => void) | null>;
}

export default function StatementPanel({ businessId, detail, items, people, onChanged, uploadRef }: Props) {
  const { t, i18n } = useTranslation('payroll');
  const st = detail.statement;
  const locked = detail.locked;
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (uploadRef) uploadRef.current = () => fileRef.current?.click();

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key); setError(null);
    try { await fn(); onChanged(); } catch (e) { setError(e instanceof PayrollError ? e.code : 'generic'); } finally { setBusy(null); }
  };
  const onFile = (f: File | null | undefined) => { if (f) run('upload', () => payrollApi.uploadStatement(businessId, detail.run.id, f)); };

  const unmatchedRows = (st?.rows || []).filter((r) => !r.person_id && r.match !== 'skipped');
  const unmatchedCols = (st?.columns || []).filter((c) => c.role === 'item' && !c.item_id && !c.decided);
  const personOpts: Opt[] = people.map((p) => ({ value: String(p.id), label: p.employee_no ? `${p.display_name} (${p.employee_no})` : p.display_name }));
  const itemOpts: Opt[] = items.filter((x) => x.is_active).map((x) => ({ value: String(x.id), label: `${x.name} · ${t(`items.side.${x.side}`)}` }));
  const at = st?.imported_at ? formatDayTime(st.imported_at, { locale: i18n.language === 'en' ? 'en-US' : 'ko-KR' }) : '';

  return (
    <Card data-testid="payroll-statement">
      <Head>
        <Title>{t('statement.title')}</Title>
        {!locked && (
          <>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.pdf" hidden data-testid="payroll-statement-input"
              onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
            <ActionButton tone="secondary" size="sm" loading={busy === 'upload'} data-testid="payroll-statement-upload" onClick={() => fileRef.current?.click()}>
              {busy === 'upload' ? t('statement.uploading') : st ? t('statement.replace') : t('statement.upload')}
            </ActionButton>
          </>
        )}
      </Head>
      <Hint>{t('statement.hint')}</Hint>
      {error && <Err role="alert">{t(`error.${error}`, { defaultValue: t('error.generic') as string })}</Err>}
      {st && (
        <>
          <FileLine>{t('statement.file', { name: st.file_name, at })}</FileLine>
          {st.dropped_secret_columns > 0 && <Muted>{t('statement.droppedSecret', { n: st.dropped_secret_columns })}</Muted>}
          {unmatchedRows.length === 0 && unmatchedCols.length === 0 ? (
            <Ok>{t('statement.allMatched')}</Ok>
          ) : (
            <>
              {unmatchedRows.length > 0 && (
                <>
                  <SubTitle>{t('statement.rows')}</SubTitle>
                  {unmatchedRows.map((r) => (
                    <Line key={r.idx} data-testid="payroll-statement-row">
                      <LineMain><b>{r.name}</b>{r.employee_no ? <Muted> · {r.employee_no}</Muted> : null}<Muted> — {t(`statement.match.${r.match || 'none'}`)}</Muted></LineMain>
                      {!locked && (
                        <LineActions>
                          <SelectBox><PlanQSelect size="sm" placeholder={t('statement.pickPerson') as string} options={personOpts} value={null}
                            onChange={(v) => { const id = Number((v as Opt)?.value); if (id) run(`row-${r.idx}`, () => payrollApi.decideRow(businessId, detail.run.id, { idx: r.idx, action: 'map', person_id: id })); }} /></SelectBox>
                          <ActionButton tone="secondary" size="sm" onClick={() => run(`row-${r.idx}`, () => payrollApi.decideRow(businessId, detail.run.id, { idx: r.idx, action: 'create' }))}>{t('statement.createPerson')}</ActionButton>
                          <ActionButton tone="secondary" size="sm" onClick={() => run(`row-${r.idx}`, () => payrollApi.decideRow(businessId, detail.run.id, { idx: r.idx, action: 'skip' }))}>{t('statement.skip')}</ActionButton>
                        </LineActions>
                      )}
                    </Line>
                  ))}
                </>
              )}
              {unmatchedCols.length > 0 && (
                <>
                  <SubTitle>{t('statement.cols')}</SubTitle>
                  {unmatchedCols.map((c) => (
                    <Line key={c.key} data-testid="payroll-statement-col">
                      <LineMain><b>{c.header}</b></LineMain>
                      {!locked && (
                        <LineActions>
                          <SelectBox><PlanQSelect size="sm" placeholder={t('statement.pickItem') as string} options={itemOpts} value={null}
                            onChange={(v) => { const id = Number((v as Opt)?.value); if (id) run(`col-${c.key}`, () => payrollApi.decideColumn(businessId, detail.run.id, { key: c.key, action: 'map', item_id: id })); }} /></SelectBox>
                          <ActionButton tone="secondary" size="sm" onClick={() => run(`col-${c.key}`, () => payrollApi.decideColumn(businessId, detail.run.id, { key: c.key, action: 'create', side: 'earning' }))}>{t('statement.createEarning')}</ActionButton>
                          <ActionButton tone="secondary" size="sm" onClick={() => run(`col-${c.key}`, () => payrollApi.decideColumn(businessId, detail.run.id, { key: c.key, action: 'create', side: 'deduction' }))}>{t('statement.createDeduction')}</ActionButton>
                          <ActionButton tone="secondary" size="sm" onClick={() => run(`col-${c.key}`, () => payrollApi.decideColumn(businessId, detail.run.id, { key: c.key, action: 'ignore' }))}>{t('statement.ignore')}</ActionButton>
                        </LineActions>
                      )}
                    </Line>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}

const Card = styled.section`background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px;`;
const Head = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 10px;`;
const Title = styled.h3`margin: 0; font-size: 0.9375rem; font-weight: 700; color: #0F172A;`;
const Hint = styled.p`margin: 6px 0 10px; font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const FileLine = styled.div`font-size: 0.8125rem; color: #334155; margin-bottom: 4px;`;
const Muted = styled.span`font-size: 0.75rem; color: #94A3B8;`;
const Ok = styled.div`margin-top: 8px; font-size: 0.8125rem; color: #0F766E; font-weight: 600;`;
const Err = styled.div`margin-bottom: 8px; padding: 8px 12px; border-radius: 8px; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem;`;
const SubTitle = styled.h4`margin: 12px 0 6px; font-size: 0.8125rem; font-weight: 700; color: #334155;`;
const Line = styled.div`display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid #F1F5F9; flex-wrap: wrap;`;
const LineMain = styled.div`flex: 1 1 180px; min-width: 0; font-size: 0.8125rem; color: #0F172A;`;
const LineActions = styled.div`display: flex; gap: 6px; align-items: center; flex-wrap: wrap;`;
const SelectBox = styled.div`width: 200px; @media (max-width: 640px) { width: 100%; }`;
