// 급여 회차 상세 — /payroll/runs/:id (docs/PAYROLL_DESIGN.md §5 · §7 · §9)
//   상세 두 밴드: 밴드1 PanelHeader(제목 + ⋯) · 밴드2 DetailMetaBar(상태·지급일·인원·합계 | 액션 ≤3: 대장 가져오기 · 확정 · 지급완료).
//   본문 = [초안 | 대장 대조] — 표(사람 × 항목, 가로 스크롤)의 사람을 누르면 EntryDrawer(칸 편집·출처 뱃지).
//   ★ 칸의 숫자는 언제나 출처 뱃지와 함께 — 예상(PlanQ) · 대장(세무사) · 입력(사람). 빈칸은 «—».
//   ★ 확정·지급완료는 ConfirmDialog — 인원·차인지급액 합계·송금 할 일 수를 문구에 적는다.
//   실시간: payroll:updated(개인 방) 이 이 회차면 250ms 뒤 다시 읽기 + 탭 복귀 재조회(서버 응답으로 통째 교체).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PanelHeader, { PanelSubTitle, DetailMetaBar, DetailMetaLeft, DetailMetaRight } from '../../components/Layout/PanelHeader';
import ActionButton from '../../components/Common/ActionButton';
import OverflowMenu, { type OverflowItem } from '../../components/Common/OverflowMenu';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import DetailFallback from '../../components/Common/DetailFallback';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import { useAuth } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import { formatDayTime } from '../../utils/dateFormat';
import { payrollApi, PayrollError, formatMoney, type PayItem, type PersonSummary, type RunDetail, type RunEntry } from './payrollApi';
import { RunStatusChip, SourceBadge } from './payrollUi';
import EntryDrawer from './EntryDrawer';
import StatementPanel from './StatementPanel';

type Dialog = 'confirm' | 'paid' | 'delete' | 'adjust' | 'rebuild' | null;

export default function PayrollRunPage() {
  const { t, i18n } = useTranslation('payroll');
  const lang = i18n.language;
  const { id } = useParams<{ id: string }>();
  const runId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const bizId = user?.business_id ? Number(user.business_id) : null;
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'reconcile' ? 'reconcile' : 'draft';
  const entryId = params.get('entry') ? Number(params.get('entry')) : null;
  const [d, setD] = useState<RunDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<PayItem[]>([]);
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const uploadRef = useRef<(() => void) | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!bizId || !runId) return;
    const seq = ++seqRef.current;
    try {
      const r = await payrollApi.run(bizId, runId);
      if (seq !== seqRef.current) return;
      setD(r); setStatus('ready');
    } catch (e) {
      if (seq !== seqRef.current) return;
      const code = e instanceof PayrollError ? e.code : 'generic';
      if (!silent) setStatus(code === 'run_not_found' || code === 'http_404' ? 'not_found' : 'error');
    }
  }, [bizId, runId]);
  useEffect(() => { setStatus('loading'); load(); }, [load]);
  const silentLoad = useCallback(() => load(true), [load]);
  useVisibilityRefresh(silentLoad);
  useEffect(() => {
    let pending: number | null = null;
    const off = onSocket<{ business_id?: number; kind?: string; id?: number }>('payroll:updated', (x) => {
      if (x?.business_id && Number(x.business_id) !== bizId) return;
      if (x?.kind === 'run' && x.id && x.id !== runId) return;
      if (pending) return;
      pending = window.setTimeout(() => { pending = null; silentLoad(); }, 250);
    });
    return () => { off(); if (pending) window.clearTimeout(pending); };
  }, [bizId, runId, silentLoad]);
  // 대조 탭에서만 — 열 고르기·사람 고르기 목록
  useEffect(() => {
    if (!bizId || tab !== 'reconcile') return;
    payrollApi.items(bizId).then(setItems).catch(() => null);
    payrollApi.people(bizId).then(setPeople).catch(() => null);
  }, [bizId, tab, d?.statement?.imported_at]);

  const setQuery = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === null) sp.delete(k); else sp.set(k, v); }
    setParams(sp, { replace: true });
  };
  const openEntry = (eid: number) => setQuery({ entry: entryId === eid ? null : String(eid) });   // 재클릭 토글

  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); after?.(); await silentLoad(); } catch (e) { setError(e instanceof PayrollError ? e.code : 'generic'); }
    finally { setBusy(false); }
  };

  const currency = useMemo(() => (d?.run.totals_by_currency ? Object.keys(d.run.totals_by_currency)[0] : null) || d?.entries[0]?.currency || 'KRW', [d]);
  const unresolved = useMemo(() => {
    if (!d) return 0;
    const inTotal = new Set(d.items.filter((x) => x.in_total).map((x) => x.id));
    return d.entries.reduce((n, e) => n + e.lines.filter((l) => inTotal.has(l.pay_item_id) && l.final_amount === null).length, 0);
  }, [d]);

  if (status !== 'ready' || !d || !bizId) {
    return (
      <Page>
        <PanelHeader onBack={() => navigate('/payroll')} backLabel={t('run.back') as string} backOnDesktop>
          <TitleSlot><PanelSubTitle>{t('title') as string}</PanelSubTitle></TitleSlot>
          <ActionSlot />
        </PanelHeader>
        <DetailFallback status={status === 'loading' ? 'loading' : status === 'not_found' ? 'not_found' : 'error'} onRetry={() => load()} onBack={() => navigate('/payroll')} />
      </Page>
    );
  }

  const run = d.run;
  const locked = d.locked;
  const isAdj = run.kind === 'adjustment';
  const title = isAdj ? t('run.titleAdj', { period: run.period_ym, n: run.seq - 1 }) : t('run.title', { period: run.period_ym });
  const money = (n: number | null) => formatMoney(n, currency, lang);
  const transferCount = run.transfer_task_mode === 'single' ? (d.entries.some((e) => e.net_total) ? 1 : 0) : d.entries.filter((e) => e.net_total).length;
  const nextSeq = Math.max(...d.siblings.map((s) => s.seq)) + 1;

  const menu: OverflowItem[] = [
    ...(!locked && !isAdj ? [{ key: 'rebuild', label: t('run.rebuild') as string, onClick: () => setDialog('rebuild'), testId: 'payroll-run-rebuild' }] : []),
    ...(!locked ? [
      { key: 'adoptAll', label: t('run.adoptAll') as string, onClick: () => act(() => payrollApi.adopt(bizId, run.id, { mode: 'statement' })), disabled: !d.statement },
      { key: 'adoptDraft', label: t('run.adoptDraft') as string, onClick: () => act(() => payrollApi.adopt(bizId, run.id, { mode: 'draft' })) },
      { key: 'zero', label: t('run.zeroBlank') as string, onClick: () => act(() => payrollApi.adopt(bizId, run.id, { mode: 'zero' })), disabled: unresolved === 0 },
    ] : []),
    ...(locked ? [
      { key: 'tasks', label: t('run.tasks') as string, onClick: () => act(async () => { const r = await payrollApi.transferTasks(bizId, run.id); setNotice(t('run.tasksCreated', { n: r.created.length }) as string); }) },
      { key: 'adjust', label: t('run.adjust') as string, onClick: () => setDialog('adjust'), testId: 'payroll-run-adjust' },
    ] : []),
    { key: 'csv', label: t('run.csv') as string, onClick: () => { payrollApi.exportCsv(bizId, run.id, lang).catch((e) => setError(e instanceof PayrollError ? e.code : 'generic')); }, dividerBefore: true },
    ...(run.status === 'draft' ? [{ key: 'delete', label: t('run.delete') as string, onClick: () => setDialog('delete'), danger: true, dividerBefore: true }] : []),
  ];

  const selectedEntry = d.entries.find((e) => e.id === entryId) || null;
  const earningItems = d.items.filter((x) => x.side === 'earning');
  const deductionItems = d.items.filter((x) => x.side === 'deduction');
  const cell = (e: RunEntry, itemId: number) => {
    const l = e.lines.find((x) => x.pay_item_id === itemId);
    if (!l) return <Td key={itemId} $muted> </Td>;
    const differs = tab === 'reconcile' && l.statement_amount !== null && l.draft_amount !== null && l.statement_amount !== l.draft_amount;
    return (
      <Td key={itemId} $warn={differs}>
        <CellNum>{l.final_amount === null ? '—' : formatMoney(l.final_amount, e.currency, lang)}</CellNum>
        {tab === 'reconcile' && l.statement_amount !== null && l.final_source !== 'statement' && <CellSub>{t('entry.statement')} {formatMoney(l.statement_amount, e.currency, lang)}</CellSub>}
        <SourceBadge source={l.final_source} />
      </Td>
    );
  };

  return (
    <Page>
      {/* 밴드1 — 제목 + ⋯ */}
      <PanelHeader onBack={() => navigate('/payroll')} backLabel={t('run.back') as string} backOnDesktop>
        <TitleSlot><PanelSubTitle>{title}</PanelSubTitle></TitleSlot>
        <ActionSlot><OverflowMenu label={t('run.more') as string} items={menu} data-testid="payroll-run-more" /></ActionSlot>
      </PanelHeader>
      {/* 밴드2 — 상태·지급일·인원·합계 | 액션 ≤3 */}
      <DetailMetaBar data-testid="payroll-run-meta">
        <DetailMetaLeft>
          <RunStatusChip status={run.status} />
          {run.pay_date && <Meta>{t('run.payDate', { date: run.pay_date })}</Meta>}
          <Meta>{t('run.headcount', { n: run.headcount })}</Meta>
          <Meta>{t('run.net')} <b>{money(run.net_total)}</b></Meta>
        </DetailMetaLeft>
        <DetailMetaRight>
          {!locked && (
            <ActionButton tone="secondary" size="sm" data-testid="payroll-statement-open" onClick={() => { setQuery({ tab: 'reconcile' }); window.setTimeout(() => uploadRef.current?.(), 50); }}>{t('run.import')}</ActionButton>
          )}
          {!locked && (
            <ActionButton tone="primary" size="sm" data-testid="payroll-run-confirm" disabled={busy || !d.entries.length} onClick={() => setDialog('confirm')}>{t('run.confirm')}</ActionButton>
          )}
          {run.status === 'confirmed' && (
            <ActionButton tone="primary" size="sm" data-testid="payroll-run-paid" disabled={busy} onClick={() => setDialog('paid')}>{t('run.paid')}</ActionButton>
          )}
        </DetailMetaRight>
      </DetailMetaBar>

      <Body>
        {error && <Err role="alert" data-testid="payroll-run-error">{t(`error.${error}`, { defaultValue: t('error.generic') as string })}</Err>}
        {notice && <Info role="status" data-testid="payroll-run-notice">{notice}</Info>}
        <Info $subtle>{t('responsibility')}</Info>
        {locked && <Info>{t('run.locked')}</Info>}
        {isAdj && !locked && <Info>{t('run.adjOf', { period: run.period_ym })}</Info>}
        {!locked && unresolved > 0 && <Warn data-testid="payroll-run-unresolved">{t('run.unresolved', { n: unresolved })}</Warn>}

        <TabRow>
          <SegmentedToggle role="tablist">
            <SegmentedBtn type="button" role="tab" $active={tab === 'draft'} aria-selected={tab === 'draft'} data-testid="payroll-run-tab-draft" onClick={() => setQuery({ tab: null })}>{t('run.tabDraft')}</SegmentedBtn>
            <SegmentedBtn type="button" role="tab" $active={tab === 'reconcile'} aria-selected={tab === 'reconcile'} data-testid="payroll-run-tab-reconcile" onClick={() => setQuery({ tab: 'reconcile' })}>{t('run.tabReconcile')}</SegmentedBtn>
          </SegmentedToggle>
          {tab === 'reconcile' && !locked && d.statement && (
            <ActionButton tone="primary" size="sm" data-testid="payroll-adopt-all" disabled={busy} onClick={() => act(() => payrollApi.adopt(bizId, run.id, { mode: 'statement' }))}>{t('run.adoptAll')}</ActionButton>
          )}
        </TabRow>

        {tab === 'reconcile' && <StatementPanel businessId={bizId} detail={d} items={items} people={people} onChanged={silentLoad} uploadRef={uploadRef} />}

        {d.entries.length === 0 ? (
          <Empty>{t('run.empty')}</Empty>
        ) : (
          <TableWrap data-testid="payroll-run-table">
            <Table>
              <thead>
                <tr>
                  <Th $sticky>{t('run.person')}</Th>
                  {earningItems.map((x) => <Th key={x.id}>{x.name}</Th>)}
                  <Th $sum>{t('run.gross')}</Th>
                  {deductionItems.map((x) => <Th key={x.id}>{x.name}</Th>)}
                  <Th $sum>{t('run.deduction')}</Th>
                  <Th $sum>{t('run.net')}</Th>
                </tr>
              </thead>
              <tbody>
                {d.entries.map((e) => (
                  <Tr key={e.id} $active={entryId === e.id} onClick={() => openEntry(e.id)} data-testid="payroll-run-entry">
                    <Td $sticky>
                      <PersonBtn type="button" onClick={(ev) => { ev.stopPropagation(); openEntry(e.id); }}>{e.display_name}</PersonBtn>
                      <PersonMeta>
                        {!e.contract_id && <Tag>{t('run.noContract')}</Tag>}
                        {d.statement && !e.statement_matched && <Tag $warn>{t('run.notInStatement')}</Tag>}
                        {e.statement_warnings.length > 0 && <Tag $warn>{t('run.warnings')}</Tag>}
                        {e.transfer_task_status && <Tag>{['completed', 'canceled'].includes(e.transfer_task_status) ? t('run.transfer.done') : t('run.transfer.open')}</Tag>}
                      </PersonMeta>
                    </Td>
                    {earningItems.map((x) => cell(e, x.id))}
                    <Td $sum><CellNum>{e.gross_total === null ? '—' : formatMoney(e.gross_total, e.currency, lang)}</CellNum></Td>
                    {deductionItems.map((x) => cell(e, x.id))}
                    <Td $sum><CellNum>{e.deduction_total === null ? '—' : formatMoney(e.deduction_total, e.currency, lang)}</CellNum></Td>
                    <Td $sum $net><CellNum>{e.net_total === null ? '—' : formatMoney(e.net_total, e.currency, lang)}</CellNum></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}

        {d.history.length > 0 && (
          <History>
            <HistTitle>{t('run.history')}</HistTitle>
            {d.history.map((h, i) => (
              <HistRow key={i}>
                <span>{formatDayTime(h.at, { locale: lang === 'en' ? 'en-US' : 'ko-KR' })}</span>
                <span>{h.from ? `${t(`runStatus.${h.from}`, { defaultValue: h.from })} → ` : ''}{t(`runStatus.${h.to}`, { defaultValue: h.to })}</span>
                <span>{h.by_name || ''}</span>
              </HistRow>
            ))}
          </History>
        )}
      </Body>

      {selectedEntry && (
        <EntryDrawer key={selectedEntry.id} businessId={bizId} detail={d} entry={selectedEntry} onClose={() => setQuery({ entry: null })} onChanged={silentLoad} />
      )}

      <ConfirmDialog isOpen={dialog === 'confirm'} onClose={() => setDialog(null)} variant="warning"
        title={t('run.confirmDialog.title')} confirmText={t('run.confirmDialog.confirm') as string} cancelText={t('common:cancel', 'Cancel') as string}
        message={t('run.confirmDialog.message', { n: run.headcount, net: money(run.net_total), tasks: transferCount }) as string}
        onConfirm={() => { setDialog(null); act(async () => {
          const r = await payrollApi.confirmRun(bizId, run.id, {});
          setNotice((r.tasks_ok ? t('run.tasksCreated', { n: r.tasks_created }) : t('run.tasksFailed')) as string);
        }); }} />
      <ConfirmDialog isOpen={dialog === 'paid'} onClose={() => setDialog(null)} variant={d.open_transfer_tasks ? 'warning' : 'info'}
        title={t('run.paidDialog.title')} confirmText={t('run.paidDialog.confirm') as string} cancelText={t('common:cancel', 'Cancel') as string}
        message={(d.open_transfer_tasks ? t('run.paidDialog.messageOpen', { n: d.open_transfer_tasks }) : t('run.paidDialog.message')) as string}
        onConfirm={() => { setDialog(null); act(() => payrollApi.markPaid(bizId, run.id)); }} />
      <ConfirmDialog isOpen={dialog === 'delete'} onClose={() => setDialog(null)} variant="danger"
        title={t('run.deleteDialog.title')} confirmText={t('run.deleteDialog.confirm') as string} cancelText={t('common:cancel', 'Cancel') as string}
        message={t('run.deleteDialog.message', { period: run.period_ym }) as string}
        onConfirm={() => { setDialog(null); act(() => payrollApi.deleteRun(bizId, run.id), () => navigate('/payroll')); }} />
      <ConfirmDialog isOpen={dialog === 'adjust'} onClose={() => setDialog(null)} variant="info"
        title={t('run.adjustDialog.title')} confirmText={t('run.adjustDialog.confirm') as string} cancelText={t('common:cancel', 'Cancel') as string}
        message={t('run.adjustDialog.message', { period: run.period_ym, n: nextSeq - 1 }) as string}
        onConfirm={() => { setDialog(null); act(async () => {
          try { const r = await payrollApi.createAdjustment(bizId, run.id, {}); navigate(`/payroll/runs/${r.run.id}`); }
          catch (e) { const open = e instanceof PayrollError ? (e.data as { run_id?: number } | undefined)?.run_id : undefined; if (open) { navigate(`/payroll/runs/${open}`); return; } throw e; }
        }); }} />
      <ConfirmDialog isOpen={dialog === 'rebuild'} onClose={() => setDialog(null)} variant="info"
        title={t('run.rebuildDialog.title')} confirmText={t('run.rebuildDialog.confirm') as string} cancelText={t('common:cancel', 'Cancel') as string}
        message={t('run.rebuildDialog.message') as string}
        onConfirm={() => { setDialog(null); act(() => payrollApi.buildRun(bizId, run.id)); }} />
    </Page>
  );
}

const Page = styled.div`display: flex; flex-direction: column; height: 100%; min-height: 0; background: #F8FAFC;`;
const TitleSlot = styled.div`display: flex; align-items: baseline; gap: 8px; min-width: 0;`;
const ActionSlot = styled.div`display: flex; align-items: center; gap: 8px; flex-shrink: 0;`;
const Meta = styled.span`font-size: 0.8125rem; color: #475569; white-space: nowrap; b { color: #0F172A; font-variant-numeric: tabular-nums; }`;
const Body = styled.div`flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 88px; @media (max-width: 640px) { padding: 14px 14px 88px; }`;
const Err = styled.div`margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; background: #FEF2F2; color: #B91C1C; font-size: 0.8125rem; line-height: 1.5;`;
const Info = styled.div<{ $subtle?: boolean }>`
  margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; font-size: 0.8125rem; line-height: 1.5;
  background: ${(p) => (p.$subtle ? '#FFFFFF' : '#F0FDFA')}; color: ${(p) => (p.$subtle ? '#64748B' : '#0F766E')}; border: 1px solid ${(p) => (p.$subtle ? '#E2E8F0' : '#CCFBF1')};
`;
const Warn = styled.div`margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; background: #FFFBEB; color: #B45309; font-size: 0.8125rem;`;
const TabRow = styled.div`display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 6px 0 12px; flex-wrap: wrap;`;
const Empty = styled.div`padding: 40px 16px; text-align: center; color: #64748B; font-size: 0.875rem; line-height: 1.6; background: #FFF; border: 1px dashed #E2E8F0; border-radius: 12px;`;
const TableWrap = styled.div`background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; overflow-x: auto; `;
const Table = styled.table`border-collapse: separate; border-spacing: 0; min-width: 100%; font-size: 0.8125rem;`;
const Th = styled.th<{ $sticky?: boolean; $sum?: boolean }>`
  position: ${(p) => (p.$sticky ? 'sticky' : 'static')}; left: 0; z-index: ${(p) => (p.$sticky ? 1 : 0)};
  background: ${(p) => (p.$sum ? '#F1F5F9' : '#F8FAFC')}; color: #475569; font-weight: 600; font-size: 0.75rem; text-align: ${(p) => (p.$sticky ? 'left' : 'right')};
  padding: 10px 12px; border-bottom: 1px solid #E2E8F0; white-space: nowrap;
`;
const Tr = styled.tr<{ $active: boolean }>`
  cursor: pointer; & > td { background: ${(p) => (p.$active ? '#F0FDFA' : '#FFF')}; }
  &:hover > td { background: ${(p) => (p.$active ? '#F0FDFA' : '#F8FAFC')}; }
`;
const Td = styled.td<{ $sticky?: boolean; $sum?: boolean; $net?: boolean; $warn?: boolean; $muted?: boolean }>`
  position: ${(p) => (p.$sticky ? 'sticky' : 'static')}; left: 0; z-index: ${(p) => (p.$sticky ? 1 : 0)};
  padding: 8px 12px; border-bottom: 1px solid #F1F5F9; text-align: ${(p) => (p.$sticky ? 'left' : 'right')}; vertical-align: top; white-space: nowrap;
  ${(p) => (p.$sum ? 'font-weight: 600;' : '')} ${(p) => (p.$net ? 'color: #0F766E; font-weight: 700;' : '')}
  ${(p) => (p.$warn ? 'box-shadow: inset 3px 0 0 #F59E0B;' : '')}
  & > span + span { margin-left: 4px; }
`;
const CellNum = styled.span`display: block; font-variant-numeric: tabular-nums; color: inherit;`;
const CellSub = styled.span`display: block; font-size: 0.6875rem; color: #B45309; font-variant-numeric: tabular-nums;`;
const PersonBtn = styled.button`background: none; border: none; padding: 0; font: inherit; font-weight: 600; color: #0F172A; cursor: pointer; text-align: left;`;
const PersonMeta = styled.div`display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px;`;
const Tag = styled.span<{ $warn?: boolean }>`padding: 0 6px; border-radius: 4px; font-size: 0.6875rem; font-weight: 600; background: ${(p) => (p.$warn ? '#FFFBEB' : '#F1F5F9')}; color: ${(p) => (p.$warn ? '#B45309' : '#64748B')};`;
const History = styled.section`margin-top: 20px; background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 16px;`;
const HistTitle = styled.h3`margin: 0 0 6px; font-size: 0.8125rem; font-weight: 700; color: #334155;`;
const HistRow = styled.div`display: grid; grid-template-columns: 160px 1fr auto; gap: 10px; padding: 4px 0; font-size: 0.75rem; color: #475569; border-top: 1px solid #F8FAFC;`;
