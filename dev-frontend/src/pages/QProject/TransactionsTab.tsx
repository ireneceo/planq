// 프로젝트 거래 통합 뷰 (Phase D3)
// 계약/견적/SOW posts + invoices + installments + tax invoices 한 번에
import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import ConfirmDialog from '../../components/Common/ConfirmDialog';

interface Signer {
  id: number; signer_email: string; signer_name: string | null;
  status: string; signed_at: string | null; rejected_at: string | null;
}
interface PostRow {
  id: number; title: string; category: string; status: string;
  created_at: string; shared_at: string | null; share_token: string | null;
  signatures: Signer[];
}
interface Installment {
  id: number; installment_no: number; label: string; percent: number;
  amount: number; due_date: string | null; status: string;
  paid_at: string | null; tax_invoice_no: string | null; tax_invoice_at: string | null;
  notify_paid_at: string | null;
}
interface InvoiceRow {
  id: number; invoice_number: string; title: string; status: string;
  installment_mode: 'single' | 'split';
  grand_total: number; paid_amount: number; currency: string;
  issued_at: string | null; due_date: string | null; sent_at: string | null;
  paid_at: string | null; notify_paid_at: string | null;
  source_post_id: number | null;
  client: { id: number; display_name?: string; biz_name?: string; company_name?: string; is_business: boolean } | null;
  installments: Installment[];
}
interface Stage {
  id: number;
  order: number;
  kind: 'quote' | 'proposal' | 'contract' | 'invoice' | 'tax_invoice' | 'custom';
  label: string;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  linked_entity_type: string | null;
  linked_entity_id: number | null;
  metadata: { recurring?: boolean } | null;
  is_template_seeded: boolean;
}
interface NextAction {
  stage_id: number;
  stage_kind: string;
  stage_label: string;
  status: string;
  action_kind: 'create_post' | 'publish_post' | 'request_signature' | 'wait_signature' | 'review_signature'
            | 'create_invoice' | 'send_invoice' | 'mark_paid' | 'wait_payment' | 'mark_tax_invoice'
            | 'wait_or_proceed' | 'custom';
  label: string;
  hint: string | null;
  link: string | null;
}
interface TransactionsResponse {
  project: { id: number; name: string; status: string };
  stages: Stage[];
  next_action: NextAction | null;
  summary: {
    contracts_count: number;
    invoices_count: number;
    total_invoiced: number;
    total_paid: number;
    total_unpaid: number;
    overdue_count: number;
    tax_pending: number;
    currency: string;
  };
  posts: PostRow[];
  invoices: InvoiceRow[];
}

function formatMoney(n: number, currency: string = 'KRW'): string {
  if (currency === 'KRW') return '₩' + Number(n).toLocaleString('ko-KR');
  if (currency === 'USD') return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${Number(n).toLocaleString()}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

interface Props { projectId: number; }

const TransactionsTab: React.FC<Props> = ({ projectId }) => {
  const { t } = useTranslation('qproject');
  const navigate = useNavigate();
  const { user } = useAuth();
  const isClient = user?.business_role === 'client';
  const [data, setData] = useState<TransactionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // 단계 보드 편집 모드
  const [editing, setEditing] = useState(false);
  const [labelDrafts, setLabelDrafts] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Stage | null>(null);

  const reloadStages = async () => {
    const r = await apiFetch(`/api/projects/${projectId}/transactions`);
    const j = await r.json();
    if (j.success) setData(j.data);
  };

  const saveLabel = async (stageId: number, label: string) => {
    if (!label.trim()) return;
    setSavingId(stageId);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/stages/${stageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'save_failed');
      await reloadStages();
    } catch (e) { setErr((e as Error).message); }
    finally { setSavingId(null); }
  };

  const moveStage = async (stageId: number, direction: 'up' | 'down') => {
    setSavingId(stageId);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/stages/${stageId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'move_failed');
      await reloadStages();
    } catch (e) { setErr((e as Error).message); }
    finally { setSavingId(null); }
  };

  const addCustomStage = async () => {
    if (!newLabel.trim()) { setAddingNew(false); return; }
    try {
      const r = await apiFetch(`/api/projects/${projectId}/stages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'custom', label: newLabel.trim() }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'add_failed');
      setAddingNew(false); setNewLabel('');
      await reloadStages();
    } catch (e) { setErr((e as Error).message); }
  };

  const deleteStage = async () => {
    if (!deleteTarget) return;
    try {
      const r = await apiFetch(`/api/projects/${projectId}/stages/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'delete_failed');
      setDeleteTarget(null);
      await reloadStages();
    } catch (e) { setErr((e as Error).message); setDeleteTarget(null); }
  };

  const toggleCustomStatus = async (stage: Stage) => {
    if (stage.kind !== 'custom') return; // template stage 는 entity 기반 자동 진행 — 수동 토글 차단
    const next = stage.status === 'completed' ? 'pending' : 'completed';
    setSavingId(stage.id);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/stages/${stage.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'toggle_failed');
      await reloadStages();
    } catch (e) { setErr((e as Error).message); }
    finally { setSavingId(null); }
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/projects/${projectId}/transactions`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return;
        if (!j.success) throw new Error(j.message || 'load_failed');
        setData(j.data);
        setErr(null);
      })
      .catch(e => { if (!cancelled) setErr((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const sortedEvents = useMemo(() => {
    if (!data) return [];
    type Event = { kind: string; time: string; ref_id: number; label: string; sub: string };
    const events: Event[] = [];
    for (const p of data.posts) {
      events.push({
        kind: `post.${p.category}`,
        time: p.created_at,
        ref_id: p.id,
        label: t(`tx.postCreated.${p.category}`, p.category) + `: ${p.title}`,
        sub: t('tx.created', '작성'),
      });
      for (const sg of p.signatures) {
        if (sg.signed_at) events.push({
          kind: 'signature.signed', time: sg.signed_at, ref_id: p.id,
          label: t('tx.signed', '서명 완료'), sub: `${sg.signer_name || sg.signer_email} · ${p.title}`,
        });
        if (sg.rejected_at) events.push({
          kind: 'signature.rejected', time: sg.rejected_at, ref_id: p.id,
          label: t('tx.rejected', '서명 거절'), sub: `${sg.signer_name || sg.signer_email} · ${p.title}`,
        });
      }
    }
    for (const inv of data.invoices) {
      if (inv.sent_at) events.push({
        kind: 'invoice.sent', time: inv.sent_at, ref_id: inv.id,
        label: t('tx.invoiceSent', '청구서 발송'),
        sub: `${inv.invoice_number} · ${formatMoney(inv.grand_total, inv.currency)}`,
      });
      if (inv.notify_paid_at) events.push({
        kind: 'invoice.notify_paid', time: inv.notify_paid_at, ref_id: inv.id,
        label: t('tx.notifyPaid', '송금 완료 알림'), sub: inv.invoice_number,
      });
      if (inv.paid_at) events.push({
        kind: 'invoice.paid', time: inv.paid_at, ref_id: inv.id,
        label: t('tx.invoicePaid', '결제 완료'),
        sub: `${inv.invoice_number} · ${formatMoney(inv.grand_total, inv.currency)}`,
      });
      for (const inst of inv.installments) {
        if (inst.paid_at) events.push({
          kind: 'installment.paid', time: inst.paid_at, ref_id: inv.id,
          label: t('tx.installmentPaid', '회차 결제'),
          sub: `${inv.invoice_number} · ${inst.label} · ${formatMoney(inst.amount, inv.currency)}`,
        });
        if (inst.notify_paid_at && !inst.paid_at) events.push({
          kind: 'installment.notify_paid', time: inst.notify_paid_at, ref_id: inv.id,
          label: t('tx.notifyPaid', '송금 완료 알림'),
          sub: `${inv.invoice_number} · ${inst.label}`,
        });
        if (inst.tax_invoice_at) events.push({
          kind: 'tax.issued', time: inst.tax_invoice_at, ref_id: inv.id,
          label: t('tx.taxIssued', '세금계산서 발행'),
          sub: `${inv.invoice_number} · ${inst.label} · ${inst.tax_invoice_no}`,
        });
      }
    }
    return events.sort((a, b) => b.time.localeCompare(a.time));
  }, [data, t]);

  if (loading) return <Loading>{t('common.loading', '불러오는 중...')}</Loading>;
  if (err) return <ErrorBanner>{err}</ErrorBanner>;
  if (!data) return <Loading>{t('common.loading', '불러오는 중...')}</Loading>;

  const { summary, posts, invoices, stages, next_action } = data;
  const currencyDisp = summary.currency;

  const handleAction = () => {
    if (!next_action || !next_action.link) return;
    // 외부(공개) 링크는 새 탭, 내부 라우트는 navigate
    if (next_action.link.startsWith('http') || next_action.link.startsWith('//')) {
      window.open(next_action.link, '_blank', 'noopener,noreferrer');
    } else {
      navigate(next_action.link);
    }
  };

  return (
    <Wrap>
      {/* ① 다음 할 일 — 가장 위 (지금 무얼 해야 하는지) */}
      {next_action && (
        <NextActionCard $kind={next_action.action_kind}>
          <NextActionLeft>
            <NextActionEyebrow>{t('tx.nextAction.eyebrow', '다음 할 일')} · {next_action.stage_label}</NextActionEyebrow>
            <NextActionTitle>{next_action.label}</NextActionTitle>
            {next_action.hint && <NextActionHint>{next_action.hint}</NextActionHint>}
          </NextActionLeft>
          {next_action.link && (
            <NextActionBtn type="button" onClick={handleAction}>
              {t('tx.nextAction.go', '바로 가기')}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </NextActionBtn>
          )}
        </NextActionCard>
      )}

      {/* ② 거래 진행 단계 보드 */}
      {stages && stages.length > 0 && (
        <StageBoard>
          <StageBoardHead>
            <StageBoardTitle>{t('tx.stageBoard.title', '거래 진행 단계')}</StageBoardTitle>
            {!isClient && (
              <EditToggle
                type="button"
                $on={editing}
                onClick={() => { setEditing(!editing); setLabelDrafts({}); setAddingNew(false); }}
                aria-pressed={editing}
              >
                {editing ? t('tx.stageBoard.done', '완료') : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    {t('tx.stageBoard.edit', '편집')}
                  </>
                )}
              </EditToggle>
            )}
          </StageBoardHead>

          {editing ? (
            <EditList>
              {stages.map((s, idx) => {
                const draft = labelDrafts[s.id] ?? s.label;
                return (
                  <EditRow key={s.id}>
                    <EditDot $status={s.status} $custom={s.kind === 'custom'} />
                    <EditLabelInput
                      type="text"
                      value={draft}
                      onChange={e => setLabelDrafts({ ...labelDrafts, [s.id]: e.target.value })}
                      onBlur={() => { if (draft.trim() && draft !== s.label) saveLabel(s.id, draft); }}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setLabelDrafts({ ...labelDrafts, [s.id]: s.label }); (e.target as HTMLInputElement).blur(); } }}
                      maxLength={80}
                      disabled={savingId === s.id}
                    />
                    <EditKindBadge $custom={s.kind === 'custom'}>
                      {s.kind === 'custom' ? t('tx.stageBoard.kindCustom', '사용자') : t('tx.stageBoard.kindTemplate', '기본')}
                    </EditKindBadge>
                    <MoveBtn type="button" onClick={() => moveStage(s.id, 'up')} disabled={idx === 0 || savingId === s.id} aria-label={t('tx.stageBoard.moveUp', '위로') as string} title={t('tx.stageBoard.moveUp', '위로') as string}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                    </MoveBtn>
                    <MoveBtn type="button" onClick={() => moveStage(s.id, 'down')} disabled={idx === stages.length - 1 || savingId === s.id} aria-label={t('tx.stageBoard.moveDown', '아래로') as string} title={t('tx.stageBoard.moveDown', '아래로') as string}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </MoveBtn>
                    {!s.is_template_seeded ? (
                      <DeleteBtn type="button" onClick={() => setDeleteTarget(s)} aria-label={t('tx.stageBoard.delete', '삭제') as string} title={t('tx.stageBoard.delete', '삭제') as string}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                      </DeleteBtn>
                    ) : (
                      <DeleteBtn type="button" disabled title={t('tx.stageBoard.cannotDelete', '기본 단계는 삭제할 수 없습니다') as string}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      </DeleteBtn>
                    )}
                  </EditRow>
                );
              })}

              {/* 단계 추가 */}
              {addingNew ? (
                <EditRow>
                  <EditDot $status="pending" $custom={true} />
                  <EditLabelInput
                    type="text"
                    autoFocus
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    onBlur={() => addCustomStage()}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setNewLabel(''); setAddingNew(false); } }}
                    placeholder={t('tx.stageBoard.newStagePh', '예: 사후 점검, 포트폴리오 등록') as string}
                    maxLength={80}
                  />
                  <EditKindBadge $custom={true}>{t('tx.stageBoard.kindCustom', '사용자')}</EditKindBadge>
                </EditRow>
              ) : (
                <AddStageBtn type="button" onClick={() => { setAddingNew(true); setNewLabel(''); }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  {t('tx.stageBoard.addStage', '단계 추가')}
                </AddStageBtn>
              )}
            </EditList>
          ) : (
            <StageList $count={stages.length}>
              {stages.map(s => {
                const isCustom = s.kind === 'custom';
                const dotClickable = isCustom && !isClient;
                return (
                  <StageItem key={s.id} $completed={s.status === 'completed' || s.status === 'skipped'}>
                    <StageDot
                      $status={s.status}
                      onClick={dotClickable ? () => toggleCustomStatus(s) : undefined}
                      style={dotClickable ? { cursor: 'pointer' } : undefined}
                      title={dotClickable ? (s.status === 'completed' ? t('tx.stageBoard.markPending', '대기로 변경') as string : t('tx.stageBoard.markCompleted', '완료로 변경') as string) : undefined}
                    />
                    <StageMeta>
                      <StageLabel $status={s.status}>{s.label}</StageLabel>
                      <StageStatus $status={s.status}>
                        {s.status === 'completed' && t('tx.stageStatus.completed', '완료')}
                        {s.status === 'active' && t('tx.stageStatus.active', '진행 중')}
                        {s.status === 'pending' && t('tx.stageStatus.pending', '대기')}
                        {s.status === 'skipped' && t('tx.stageStatus.skipped', '건너뜀')}
                      </StageStatus>
                    </StageMeta>
                  </StageItem>
                );
              })}
            </StageList>
          )}
        </StageBoard>
      )}

      {/* 삭제 확인 */}
      {deleteTarget && (
        <ConfirmDialog
          isOpen={true}
          title={t('tx.stageBoard.deleteConfirmTitle', '단계 삭제') as string}
          message={t('tx.stageBoard.deleteConfirmMessage', '"{{label}}" 단계를 삭제할까요?', { label: deleteTarget.label }) as string}
          confirmText={t('tx.stageBoard.delete', '삭제') as string}
          cancelText={t('common.cancel', '취소') as string}
          variant="danger"
          onConfirm={deleteStage}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* ③ 요약 카드 */}
      <SummaryGrid>
        <SummaryCard $accent="#0F766E">
          <SummaryLabel>{t('tx.summary.contracts', '계약/문서')}</SummaryLabel>
          <SummaryValue>{summary.contracts_count + posts.length - summary.contracts_count}<Unit>{t('tx.summary.unitDocs', '건')}</Unit></SummaryValue>
          <SummarySub>{posts.length === 0 ? t('tx.summary.noDoc', '문서 없음') : `${posts.length}${t('tx.summary.unitDocs', '건')}`}</SummarySub>
        </SummaryCard>
        <SummaryCard $accent="#14B8A6">
          <SummaryLabel>{t('tx.summary.invoiced', '청구 총액')}</SummaryLabel>
          <SummaryValue>{formatMoney(summary.total_invoiced, currencyDisp)}</SummaryValue>
          <SummarySub>{t('tx.summary.invoicesCount', '{{n}}건', { n: summary.invoices_count })}</SummarySub>
        </SummaryCard>
        <SummaryCard $accent="#22C55E">
          <SummaryLabel>{t('tx.summary.paid', '결제 완료')}</SummaryLabel>
          <SummaryValue>{formatMoney(summary.total_paid, currencyDisp)}</SummaryValue>
          <SummarySub>
            {summary.total_invoiced > 0 ? `${Math.round(summary.total_paid / summary.total_invoiced * 100)}%` : '—'}
          </SummarySub>
        </SummaryCard>
        <SummaryCard $accent={summary.overdue_count > 0 ? '#F43F5E' : '#F59E0B'}>
          <SummaryLabel>{t('tx.summary.unpaid', '미수금')}</SummaryLabel>
          <SummaryValue>{formatMoney(summary.total_unpaid, currencyDisp)}</SummaryValue>
          <SummarySub>
            {summary.overdue_count > 0
              ? t('tx.summary.overdue', '연체 {{n}}건', { n: summary.overdue_count })
              : (summary.tax_pending > 0
                  ? t('tx.summary.taxPending', '세금계산서 대기 {{n}}건', { n: summary.tax_pending })
                  : t('tx.summary.normal', '정상'))}
          </SummarySub>
        </SummaryCard>
      </SummaryGrid>

      {/* 문서 보드 */}
      <Section>
        <SectionTitle>{t('tx.section.docs', '계약·견적·SOW·제안')}</SectionTitle>
        {posts.length === 0 ? (
          <Empty>{t('tx.empty.docs', '아직 발행된 문서가 없습니다')}</Empty>
        ) : (
          <DocList>
            {posts.map(p => {
              const allSigned = p.signatures.length > 0 && p.signatures.every(s => s.status === 'signed');
              const anyRejected = p.signatures.some(s => s.status === 'rejected');
              const pending = p.signatures.filter(s => s.status !== 'signed' && s.status !== 'rejected').length;
              const openDoc = () => p.share_token && window.open(`/public/posts/${p.share_token}`, '_blank', 'noopener,noreferrer');
              return (
                <DocCard
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={openDoc}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openDoc(); }}
                >
                  <DocCat>{t(`tx.cat.${p.category}`, p.category)}</DocCat>
                  <DocTitle>{p.title}</DocTitle>
                  <DocMeta>
                    {formatDate(p.created_at)}
                    {p.signatures.length > 0 && (
                      <>
                        {' · '}
                        <SigBadge $tone={allSigned ? 'ok' : anyRejected ? 'reject' : 'pending'}>
                          {allSigned
                            ? t('tx.sigAll', '양사 서명 완료')
                            : anyRejected
                              ? t('tx.sigRejected', '거절됨')
                              : t('tx.sigPending', '서명 대기 {{n}}', { n: pending })}
                        </SigBadge>
                      </>
                    )}
                  </DocMeta>
                </DocCard>
              );
            })}
          </DocList>
        )}
      </Section>

      {/* 청구서 + 회차 */}
      <Section>
        <SectionTitle>{t('tx.section.invoices', '청구서')}</SectionTitle>
        {invoices.length === 0 ? (
          <Empty>{t('tx.empty.invoices', '청구서가 없습니다')}</Empty>
        ) : (
          <InvList>
            {invoices.map(inv => (
              <InvCard key={inv.id}>
                <InvHead
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/bills?tab=invoices&invoice=${inv.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navigate(`/bills?tab=invoices&invoice=${inv.id}`); }}
                >
                  <InvNumber>{inv.invoice_number}</InvNumber>
                  <InvTitle>{inv.title}</InvTitle>
                  <StatusChip $status={inv.status}>{t(`tx.status.${inv.status}`, inv.status)}</StatusChip>
                  <InvAmount>{formatMoney(inv.grand_total, inv.currency)}</InvAmount>
                </InvHead>
                {inv.installment_mode === 'split' && inv.installments.length > 0 && (
                  <InstTable>
                    {inv.installments.map(i => (
                      <InstRow key={i.id} $paid={i.status === 'paid'}>
                        <InstLabel>{i.installment_no}/{inv.installments.length} · {i.label}</InstLabel>
                        <InstAmt>{formatMoney(i.amount, inv.currency)}</InstAmt>
                        <InstStatus $status={i.status}>{t(`tx.instStatus.${i.status}`, i.status)}</InstStatus>
                        {i.tax_invoice_no
                          ? <TaxBadge $tone="ok">{t('tx.taxIssued', '세금계산서 발행')}</TaxBadge>
                          : (i.status === 'paid' && inv.client?.is_business)
                            ? <TaxBadge $tone="warn">{t('tx.taxPending', '세금계산서 대기')}</TaxBadge>
                            : null}
                      </InstRow>
                    ))}
                  </InstTable>
                )}
              </InvCard>
            ))}
          </InvList>
        )}
      </Section>

      {/* 타임라인 */}
      <Section>
        <SectionTitle>{t('tx.section.timeline', '거래 타임라인')}</SectionTitle>
        {sortedEvents.length === 0 ? (
          <Empty>{t('tx.empty.timeline', '아직 이벤트가 없습니다')}</Empty>
        ) : (
          <Timeline>
            {sortedEvents.map((e, idx) => (
              <TimelineRow key={`${e.kind}-${e.ref_id}-${idx}`}>
                <TimelineTime>{formatDate(e.time)}</TimelineTime>
                <TimelineDot $kind={e.kind} />
                <TimelineBody>
                  <TimelineLabel>{e.label}</TimelineLabel>
                  <TimelineSub>{e.sub}</TimelineSub>
                </TimelineBody>
              </TimelineRow>
            ))}
          </Timeline>
        )}
      </Section>
    </Wrap>
  );
};

export default TransactionsTab;

// ─── styled ───
const Wrap = styled.div`display: flex; flex-direction: column; gap: 20px;`;

// ─── 다음 할 일 카드 (Phase D+1) ───
const NextActionCard = styled.div<{ $kind: string }>`
  display: flex; align-items: center; gap: 16px;
  padding: 20px 22px;
  background: ${p => p.$kind === 'mark_paid' ? 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)'
                  : p.$kind === 'wait_or_proceed' ? 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)'
                  : 'linear-gradient(135deg, #F0FDFA 0%, #CCFBF1 100%)'};
  border: 1px solid ${p => p.$kind === 'mark_paid' ? '#FCD34D'
                       : p.$kind === 'wait_or_proceed' ? '#86EFAC'
                       : '#5EEAD4'};
  border-radius: 14px;
  @media (max-width: 640px) { flex-direction: column; align-items: flex-start; gap: 12px; }
`;
const NextActionLeft = styled.div`flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0;`;
const NextActionEyebrow = styled.div`
  font-size: 11px; font-weight: 700; color: #0F766E;
  text-transform: uppercase; letter-spacing: 0.6px;
`;
const NextActionTitle = styled.div`font-size: 16px; font-weight: 700; color: #0F172A; letter-spacing: -0.2px;`;
const NextActionHint = styled.div`font-size: 13px; color: #475569;`;
const NextActionBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 18px; font-size: 13px; font-weight: 700;
  background: #0D9488; color: #FFF; border: none; border-radius: 10px;
  cursor: pointer; flex-shrink: 0; transition: background 0.15s, transform 0.1s;
  & svg { display: block; }
  &:hover { background: #0F766E; }
  &:active { transform: translateY(1px); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 3px; }
`;

// ─── Stage Board (Phase D+1) ───
// 편집 모드 스타일
const StageBoardHead = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-bottom: 14px;
`;
const EditToggle = styled.button<{ $on: boolean }>`
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px; font-size: 11px; font-weight: 700;
  background: ${p => p.$on ? '#0D9488' : '#fff'};
  color: ${p => p.$on ? '#fff' : '#0F766E'};
  border: 1px solid ${p => p.$on ? '#0D9488' : '#5EEAD4'};
  border-radius: 6px; cursor: pointer; transition: all 0.12s;
  & svg { display: block; }
  &:hover { background: ${p => p.$on ? '#0F766E' : '#F0FDFA'}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const EditList = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const EditRow = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
`;
const EditDot = styled.span<{ $status: string; $custom: boolean }>`
  width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
  background: ${p => p.$status === 'completed' ? '#22C55E'
                  : p.$status === 'active' ? '#14B8A6'
                  : p.$custom ? '#5EEAD4' : '#fff'};
  border: 2px solid ${p => p.$status === 'completed' ? '#15803D'
                       : p.$status === 'active' ? '#0D9488'
                       : '#CBD5E1'};
`;
const EditLabelInput = styled.input`
  flex: 1; min-width: 0;
  padding: 7px 10px; font-size: 13px; color: #0F172A;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  &:disabled { background: #F8FAFC; color: #94A3B8; }
`;
const EditKindBadge = styled.span<{ $custom: boolean }>`
  font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;
  background: ${p => p.$custom ? '#FFF7ED' : '#F1F5F9'};
  color: ${p => p.$custom ? '#B45309' : '#64748B'};
  flex-shrink: 0;
`;
const MoveBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex-shrink: 0;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer; color: #475569;
  transition: all 0.12s;
  &:hover:not(:disabled) { background: #F0FDFA; border-color: #14B8A6; color: #0F766E; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const DeleteBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex-shrink: 0;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer; color: #B91C1C;
  transition: all 0.12s;
  &:hover:not(:disabled) { background: #FEF2F2; border-color: #FECACA; }
  &:disabled { opacity: 0.4; cursor: not-allowed; color: #94A3B8; }
  &:focus-visible { outline: 2px solid #DC2626; outline-offset: 2px; }
`;
const AddStageBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 14px; font-size: 12px; font-weight: 700; color: #0F766E;
  background: #fff; border: 1px dashed #5EEAD4; border-radius: 8px; cursor: pointer;
  transition: all 0.12s;
  & svg { display: block; }
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;

const StageBoard = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 20px;
`;
const StageBoardTitle = styled.h3`font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px; margin: 0 0 14px 0;`;
const StageList = styled.div<{ $count: number }>`
  display: grid;
  grid-template-columns: repeat(${p => p.$count}, 1fr);
  gap: 0;
  @media (max-width: 720px) {
    grid-template-columns: 1fr;
    gap: 12px;
  }
`;
const StageItem = styled.div<{ $completed: boolean }>`
  position: relative;
  display: flex; flex-direction: column; align-items: center;
  padding-top: 4px;

  /* connector line — 다음 stage 까지 (마지막 제외) */
  &:not(:last-child)::after {
    content: '';
    position: absolute;
    top: 13px;
    left: 50%;
    right: -50%;
    height: 2px;
    background: ${p => p.$completed ? '#22C55E' : '#E2E8F0'};
    z-index: 0;
  }
  @media (max-width: 720px) {
    flex-direction: row; align-items: center; gap: 12px;
    &:not(:last-child)::after { display: none; }
  }
`;
const StageDot = styled.span<{ $status: string }>`
  position: relative;
  z-index: 1;
  width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0;
  background: ${p => p.$status === 'completed' ? '#22C55E'
                  : p.$status === 'active' ? '#14B8A6'
                  : p.$status === 'skipped' ? '#CBD5E1'
                  : '#fff'};
  border: 2px solid ${p => p.$status === 'completed' ? '#15803D'
                       : p.$status === 'active' ? '#0D9488'
                       : '#CBD5E1'};
  box-shadow: 0 0 0 4px #fff${p => p.$status === 'active' ? ', 0 0 0 7px rgba(20, 184, 166, 0.15)' : ''};
`;
const StageMeta = styled.div`
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding-top: 10px; text-align: center;
  @media (max-width: 720px) { align-items: flex-start; padding-top: 0; text-align: left; }
`;
const StageLabel = styled.div<{ $status: string }>`
  font-size: 12px; font-weight: ${p => p.$status === 'active' ? 700 : 600};
  color: ${p => p.$status === 'active' ? '#0F766E'
              : p.$status === 'completed' ? '#15803D'
              : p.$status === 'skipped' ? '#94A3B8'
              : '#64748B'};
  white-space: nowrap;
`;
const StageStatus = styled.div<{ $status: string }>`
  font-size: 10px; font-weight: 600;
  color: ${p => p.$status === 'active' ? '#0D9488'
              : p.$status === 'completed' ? '#15803D'
              : p.$status === 'skipped' ? '#CBD5E1'
              : '#94A3B8'};
`;
const Loading = styled.div`text-align: center; padding: 40px; color: #94A3B8; font-size: 13px;`;
const ErrorBanner = styled.div`padding: 10px 14px; background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; border-radius: 8px; font-size: 12px;`;

const SummaryGrid = styled.div`
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;
`;
const SummaryCard = styled.div<{ $accent: string }>`
  position: relative; background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  padding: 16px 18px; overflow: hidden;
  &::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
    background: ${p => p.$accent}; opacity: 0.6;
  }
`;
const SummaryLabel = styled.div`font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.4px;`;
const SummaryValue = styled.div`font-size: 22px; font-weight: 700; color: #0F172A; margin-top: 8px; letter-spacing: -0.4px; display: flex; align-items: baseline; gap: 4px; font-variant-numeric: tabular-nums;`;
const Unit = styled.span`font-size: 13px; font-weight: 600; color: #64748B;`;
const SummarySub = styled.div`font-size: 12px; color: #64748B; margin-top: 4px;`;

const Section = styled.section`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 20px;
  display: flex; flex-direction: column; gap: 12px;
`;
const SectionTitle = styled.h3`font-size: 14px; font-weight: 700; color: #0F172A; margin: 0;`;
const Empty = styled.div`padding: 24px; text-align: center; color: #94A3B8; font-size: 13px;`;

const DocList = styled.div`display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px;`;
const DocCard = styled.div`
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px;
  cursor: pointer; transition: background 0.12s, border-color 0.12s;
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const DocCat = styled.div`font-size: 11px; font-weight: 600; color: #0F766E; text-transform: uppercase; letter-spacing: 0.4px;`;
const DocTitle = styled.div`font-size: 13px; font-weight: 600; color: #0F172A; margin-top: 4px;`;
const DocMeta = styled.div`font-size: 11px; color: #64748B; margin-top: 4px; display: flex; align-items: center; gap: 4px;`;
const SigBadge = styled.span<{ $tone: 'ok' | 'pending' | 'reject' }>`
  font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px;
  background: ${p => p.$tone === 'ok' ? '#F0FDF4' : p.$tone === 'reject' ? '#FEF2F2' : '#FFFBEB'};
  color: ${p => p.$tone === 'ok' ? '#15803D' : p.$tone === 'reject' ? '#B91C1C' : '#B45309'};
`;

const InvList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
const InvCard = styled.div`background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden;`;
const InvHead = styled.div`
  display: grid; grid-template-columns: 110px 1fr auto 130px; gap: 12px; align-items: center;
  padding: 12px 14px; cursor: pointer;
  &:hover { background: #F0FDFA; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
  @media (max-width: 720px) { grid-template-columns: 1fr auto; gap: 6px; }
`;
const InvNumber = styled.div`font-size: 12px; font-weight: 600; color: #0F766E; font-family: ui-monospace, monospace;`;
const InvTitle = styled.div`font-size: 13px; color: #0F172A; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const StatusChip = styled.span<{ $status: string }>`
  font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
  background: ${p => {
    if (p.$status === 'paid') return '#F0FDF4';
    if (p.$status === 'partially_paid') return '#FFFBEB';
    if (p.$status === 'overdue') return '#FEF2F2';
    if (p.$status === 'sent') return '#F0FDFA';
    if (p.$status === 'canceled') return '#F1F5F9';
    return '#F8FAFC';
  }};
  color: ${p => {
    if (p.$status === 'paid') return '#15803D';
    if (p.$status === 'partially_paid') return '#B45309';
    if (p.$status === 'overdue') return '#B91C1C';
    if (p.$status === 'sent') return '#0F766E';
    if (p.$status === 'canceled') return '#64748B';
    return '#475569';
  }};
`;
const InvAmount = styled.div`font-size: 14px; font-weight: 700; color: #0F172A; text-align: right; font-variant-numeric: tabular-nums;`;
const InstTable = styled.div`background: #fff; border-top: 1px solid #E2E8F0; padding: 8px 14px; display: flex; flex-direction: column; gap: 6px;`;
const InstRow = styled.div<{ $paid: boolean }>`
  display: grid; grid-template-columns: 1fr 110px 100px 110px; gap: 8px; align-items: center;
  font-size: 12px; padding: 4px 0;
  opacity: ${p => p.$paid ? 0.85 : 1};
  @media (max-width: 720px) { grid-template-columns: 1fr 1fr; }
`;
const InstLabel = styled.div`color: #334155;`;
const InstAmt = styled.div`text-align: right; color: #0F172A; font-variant-numeric: tabular-nums;`;
const InstStatus = styled.div<{ $status: string }>`
  font-weight: 600;
  color: ${p => {
    if (p.$status === 'paid') return '#15803D';
    if (p.$status === 'overdue') return '#B91C1C';
    if (p.$status === 'canceled') return '#94A3B8';
    return '#475569';
  }};
`;
const TaxBadge = styled.span<{ $tone: 'ok' | 'warn' }>`
  font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px;
  background: ${p => p.$tone === 'ok' ? '#F0FDF4' : '#FFFBEB'};
  color: ${p => p.$tone === 'ok' ? '#15803D' : '#B45309'};
`;

const Timeline = styled.div`display: flex; flex-direction: column; gap: 4px; padding-left: 4px;`;
const TimelineRow = styled.div`display: grid; grid-template-columns: 90px 16px 1fr; gap: 12px; align-items: flex-start; padding: 6px 0;`;
const TimelineTime = styled.div`font-size: 11px; color: #94A3B8; font-variant-numeric: tabular-nums; padding-top: 2px;`;
const TimelineDot = styled.div<{ $kind: string }>`
  width: 10px; height: 10px; border-radius: 50%; margin-top: 5px;
  background: ${p => {
    if (p.$kind.startsWith('signature.signed')) return '#22C55E';
    if (p.$kind.startsWith('signature.rejected')) return '#F43F5E';
    if (p.$kind.startsWith('invoice.paid') || p.$kind === 'installment.paid') return '#15803D';
    if (p.$kind === 'invoice.notify_paid' || p.$kind === 'installment.notify_paid') return '#F59E0B';
    if (p.$kind === 'tax.issued') return '#0F766E';
    if (p.$kind === 'invoice.sent') return '#14B8A6';
    return '#94A3B8';
  }};
  box-shadow: 0 0 0 3px #fff;
`;
const TimelineBody = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const TimelineLabel = styled.div`font-size: 13px; font-weight: 600; color: #0F172A;`;
const TimelineSub = styled.div`font-size: 12px; color: #64748B;`;
