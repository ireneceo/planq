// 증빙 발행 큐 — 세금계산서 + 현금영수증 통합 (실 API, 단일 진실 원천 /receipts-due)
//   백엔드 services/receiptsDue 가 발행 의무를 산출 → 대시보드 인박스와 숫자 일치.
//   법정 발행기한(세금계산서 익월10일 / 현금영수증 권장) 임박·초과 신호 + 단건/분할 인라인 발행.
import { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useAuth, apiFetch } from '../../contexts/AuthContext';
import { useVisibilityRefresh } from '../../hooks/useVisibilityRefresh';
import {
  listReceiptsDue, formatMoney,
  markInstallmentTaxInvoice, markInstallmentCashReceipt, markInvoiceTaxInvoice, markInvoiceCashReceipt,
  markReceiptCorrection,
  type ReceiptDueRow, type CorrectionReason,
} from '../../services/invoices';
import SingleDateField from '../../components/Common/SingleDateField';
import PlanQSelect from '../../components/Common/PlanQSelect';

type Tab = 'pending' | 'issued' | 'all';

export default function TaxInvoicesTab() {
  const { t } = useTranslation('qbill');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const [tab, setTab] = useState<Tab>('pending');
  const [issuingFor, setIssuingFor] = useState<ReceiptDueRow | null>(null);
  const [correctingFor, setCorrectingFor] = useState<ReceiptDueRow | null>(null);
  const [rows, setRows] = useState<ReceiptDueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    listReceiptsDue(businessId)
      .then(list => { if (!cancelled) setRows(list); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [businessId, reloadKey]);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  useVisibilityRefresh(reload);

  // 실시간 동기화 (CLAUDE.md 운영 안정성 16번) — 증빙 신청·발행 마킹의 inbox:refresh 즉시 반영
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
        s.on('invoice:updated', debouncedReload);
        s.on('inbox:refresh', debouncedReload);
      });
    });
    return () => {
      if (pending) window.clearTimeout(pending);
      if (socket) socket.disconnect();
    };
  }, [businessId, reload]);

  const filtered = useMemo(() => {
    if (tab === 'all') return rows;
    return rows.filter(r => r.status === tab);
  }, [tab, rows]);

  const pendingCount = rows.filter(r => r.status === 'pending').length;
  const overdueCount = rows.filter(r => r.status === 'pending' && r.urgency === 'overdue').length;

  const onIssued = () => { setIssuingFor(null); reload(); };

  const rowKey = (r: ReceiptDueRow) => `${r.invoice_id}-${r.installment_id || 'single'}-${r.kind}`;

  return (
    <Wrap>
      <InfoBox>
        <InfoIcon>ⓘ</InfoIcon>
        <div>
          <InfoTitle>{t('taxInvoices.info.title', '증빙은 외부(홈택스/팝빌)에서 발행하고 발행번호만 마킹합니다')}</InfoTitle>
          <InfoDesc>{t('taxInvoices.info.desc', '입금 완료된 청구서의 세금계산서·현금영수증 발행 대기 목록입니다. 발행기한이 임박하거나 지난 건이 위로 정렬됩니다.')}</InfoDesc>
        </div>
      </InfoBox>

      {overdueCount > 0 && (
        <OverdueBanner>
          {t('taxInvoices.overdueBanner', { count: overdueCount, defaultValue: '발행기한이 지난 증빙이 {{count}}건 있습니다. 가산세가 발생할 수 있으니 우선 발행해주세요.' }) as string}
        </OverdueBanner>
      )}

      <TabBar role="tablist">
        {(['pending', 'issued', 'all'] as Tab[]).map(k => {
          const cnt = k === 'all' ? rows.length : (k === 'pending' ? pendingCount : rows.filter(r => r.status === k).length);
          return (
            <TabBtn key={k} role="tab" aria-selected={tab === k} $active={tab === k} onClick={() => setTab(k)}>
              <span>{t(`taxInvoices.tabs.${k}`)}</span>
              {cnt > 0 && <TabCount $active={tab === k}>{cnt}</TabCount>}
            </TabBtn>
          );
        })}
      </TabBar>

      {loading ? (
        <Empty>{t('common.loading')}</Empty>
      ) : filtered.length === 0 ? (
        <Empty>{t(`taxInvoices.empty.${tab}`)}</Empty>
      ) : (
        <List>
          <ListHead>
            <Cell style={{ width: 96 }}>{t('taxInvoices.col.kind', '구분')}</Cell>
            <Cell style={{ width: 124 }}>{t('taxInvoices.col.invoice')}</Cell>
            <Cell style={{ width: 76 }}>{t('taxInvoices.col.round')}</Cell>
            <Cell>{t('taxInvoices.col.recipient', '수취자')}</Cell>
            <Cell style={{ width: 124 }}>{t('taxInvoices.col.taxId')}</Cell>
            <Cell style={{ width: 112, textAlign: 'right' }}>{t('taxInvoices.col.amount')}</Cell>
            <Cell style={{ width: 100 }}>{t('taxInvoices.col.paidAt')}</Cell>
            <Cell style={{ width: 120 }}>{t('taxInvoices.col.dueAt', '발행기한')}</Cell>
            <Cell style={{ width: 130 }}>{t('taxInvoices.col.issueNo')}</Cell>
            <Cell style={{ width: 92, textAlign: 'right' }}>{t('taxInvoices.col.actions')}</Cell>
          </ListHead>
          {filtered.map(r => (
            <Row key={rowKey(r)}>
              <Cell style={{ width: 96 }}>
                <KindBadge $cash={r.kind === 'cash'}>
                  {r.kind === 'cash' ? t('taxInvoices.kind.cash', '현금영수증') : t('taxInvoices.kind.tax', '세금계산서')}
                </KindBadge>
              </Cell>
              <Cell style={{ width: 124 }}><Num>{r.invoice_number}</Num></Cell>
              <Cell style={{ width: 76 }}>
                {r.installment_no ? (t('taxInvoices.misc.roundSuffix', { n: r.installment_no, defaultValue: '{{n}}차' }) as string) : '—'}
              </Cell>
              <Cell><ClientName>{r.recipient_name || '—'}</ClientName></Cell>
              <Cell style={{ width: 124 }}><TaxId>{r.tax_id || '—'}</TaxId></Cell>
              <Cell style={{ width: 112, textAlign: 'right' }}>
                <Amt>{formatMoney(r.amount, r.currency)}</Amt>
              </Cell>
              <Cell style={{ width: 100 }}>{r.paid_at ? r.paid_at.split('T')[0] : '—'}</Cell>
              <Cell style={{ width: 120 }}><DueCell row={r} t={t} /></Cell>
              <Cell style={{ width: 130 }}>
                {r.effective === 'correction_pending'
                  ? <CorrPendingBadge>{t('taxInvoices.corrections.needed', '수정 필요')}</CorrPendingBadge>
                  : r.correction
                    ? <CorrBadge title={r.correction.corrected_no} $canceled={r.effective === 'canceled'}>
                        {t(`taxInvoices.corrections.eff.${r.effective}`, { defaultValue: r.effective })} · {r.correction.corrected_no}
                      </CorrBadge>
                    : r.issued_no ? <IssueNo>{r.issued_no}</IssueNo> : <Pending>{t('taxInvoices.misc.pending', '대기')}</Pending>}
              </Cell>
              <Cell style={{ width: 92, textAlign: 'right' }}>
                {r.status === 'pending' && (
                  <ActionBtn type="button" $primary onClick={() => setIssuingFor(r)}>{t('taxInvoices.actions.issue')}</ActionBtn>
                )}
                {r.effective === 'correction_pending' && (
                  <ActionBtn type="button" $danger onClick={() => setCorrectingFor(r)}>{t('taxInvoices.corrections.action', '수정·취소')}</ActionBtn>
                )}
                {r.status === 'issued' && r.effective === 'issued' && (
                  <ActionBtn type="button" onClick={() => setCorrectingFor(r)}>{t('taxInvoices.corrections.action', '수정·취소')}</ActionBtn>
                )}
              </Cell>
            </Row>
          ))}
        </List>
      )}

      {issuingFor && <IssueModal row={issuingFor} onClose={() => setIssuingFor(null)} onIssued={onIssued} />}
      {correctingFor && <CorrectionModal row={correctingFor} onClose={() => setCorrectingFor(null)} onDone={() => { setCorrectingFor(null); reload(); }} />}
    </Wrap>
  );
}

// 발행기한 셀 — 발행완료는 발행일, 대기는 임박/초과 뱃지
function DueCell({ row, t }: { row: ReceiptDueRow; t: (k: string, opts?: any) => unknown }) {
  if (row.status === 'issued') {
    return <DueMuted>{row.issued_at ? row.issued_at.split('T')[0] : '—'}</DueMuted>;
  }
  if (!row.due_at) return <DueMuted>—</DueMuted>;
  const dateStr = row.due_at.split('T')[0];
  const days = Math.ceil((new Date(row.due_at).getTime() - Date.now()) / 86400000);
  if (row.urgency === 'overdue') {
    return <DuePill $tone="overdue">{t('taxInvoices.due.overdue', '기한 지남') as string}</DuePill>;
  }
  if (row.urgency === 'soon') {
    return <DuePill $tone="soon">{t('taxInvoices.due.dday', { n: Math.max(days, 0), defaultValue: 'D-{{n}}' }) as string}</DuePill>;
  }
  return <DueMuted>{dateStr}</DueMuted>;
}

function IssueModal({ row, onClose, onIssued }: { row: ReceiptDueRow; onClose: () => void; onIssued: () => void }) {
  const { t } = useTranslation('qbill');
  const isCash = row.kind === 'cash';
  const [no, setNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!no.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      // #77 — 발행 파일(선택) 업로드 → file_id (고객이 공개 페이지에서 다운로드)
      let fileId: number | undefined;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const ur = await apiFetch(`/api/files/${row.business_id}`, { method: 'POST', body: fd });
        const uj = await ur.json();
        if (!uj.success || !uj.data?.id) throw new Error(uj.message || (t('taxInvoices.issueModal.fileUploadFailed', { defaultValue: '파일 업로드 실패' }) as string));
        fileId = Number(uj.data.id);
      }
      if (isCash && row.installment_id) {
        await markInstallmentCashReceipt(row.business_id, row.invoice_id, row.installment_id, { cash_receipt_no: no.trim(), cash_receipt_at: date, file_id: fileId });
      } else if (isCash) {
        await markInvoiceCashReceipt(row.business_id, row.invoice_id, { cash_receipt_no: no.trim(), cash_receipt_at: date, file_id: fileId });
      } else if (row.installment_id) {
        await markInstallmentTaxInvoice(row.business_id, row.invoice_id, row.installment_id, { tax_invoice_no: no.trim(), issued_at: date, file_id: fileId });
      } else {
        await markInvoiceTaxInvoice(row.business_id, row.invoice_id, { tax_invoice_no: no.trim(), tax_invoice_at: date, file_id: fileId });
      }
      onIssued();
    } catch (e) {
      setErr((e as Error).message || (t('taxInvoices.misc.issueFailed', { defaultValue: '발행 실패' }) as string));
    } finally {
      setBusy(false);
    }
  };

  const title = isCash
    ? t('taxInvoices.issueModal.titleCash', '현금영수증 발행 마킹')
    : t('taxInvoices.issueModal.title');
  const desc = isCash
    ? t('taxInvoices.issueModal.descCash', '외부에서 발행한 현금영수증 승인번호를 입력하세요')
    : t('taxInvoices.issueModal.desc');
  const noLabel = isCash
    ? t('taxInvoices.issueModal.noCash', '승인번호')
    : t('taxInvoices.issueModal.no');
  const noPh = isCash
    ? t('taxInvoices.issueModal.noCashPh', '예: 8자리 승인번호')
    : t('taxInvoices.issueModal.noPh');

  return (
    <ModalBackdrop onClick={onClose}>
      <ModalDialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <ModalHead>
          <ModalTitle>{title as string}</ModalTitle>
          <ModalClose type="button" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </ModalClose>
        </ModalHead>
        <ModalBody>
          <ModalDesc>{desc as string}</ModalDesc>
          <ModalField>
            <ModalLabel>{noLabel as string}</ModalLabel>
            <ModalInput value={no} autoFocus onChange={e => setNo(e.target.value)} placeholder={noPh as string} />
          </ModalField>
          <ModalField>
            <ModalLabel>{t('taxInvoices.issueModal.date')}</ModalLabel>
            <SingleDateField value={date} onChange={setDate} size="md" />
          </ModalField>
          <ModalField>
            <ModalLabel>{t('taxInvoices.issueModal.fileLabel', { defaultValue: '발행 파일 첨부 (선택)' }) as string}</ModalLabel>
            <FileRow>
              <FileBtn type="button" onClick={() => document.getElementById('receipt-file-input')?.click()}>
                {t('taxInvoices.issueModal.filePick', { defaultValue: '파일 선택' }) as string}
              </FileBtn>
              <FileName>{file ? file.name : (t('taxInvoices.issueModal.fileNone', { defaultValue: '선택된 파일 없음' }) as string)}</FileName>
              {file && <FileClear type="button" onClick={() => setFile(null)} aria-label="clear">×</FileClear>}
              <input id="receipt-file-input" type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                onChange={e => setFile(e.target.files?.[0] || null)} />
            </FileRow>
            <FileHint>{t('taxInvoices.issueModal.fileHint', { defaultValue: '첨부하면 고객이 공개 청구서 페이지에서 다운로드할 수 있어요. (PDF·이미지)' }) as string}</FileHint>
          </ModalField>
          <Hint>
            <KindBadge $cash={isCash} style={{ marginRight: 6 }}>
              {isCash ? t('taxInvoices.kind.cash', '현금영수증') : t('taxInvoices.kind.tax', '세금계산서')}
            </KindBadge>
            {row.invoice_number}
            {row.installment_no ? ` · ${t('taxInvoices.misc.roundSuffix', { n: row.installment_no, defaultValue: '{{n}}차' })}${row.installment_label ? ` · ${row.installment_label}` : ''}` : ''}
            {' · '}{formatMoney(row.amount, row.currency)}
            {row.recipient_name ? ` · ${row.recipient_name}` : ''}
          </Hint>
          {err && <ErrLine>! {err}</ErrLine>}
        </ModalBody>
        <ModalFooter>
          <SecondaryBtn type="button" onClick={onClose}>{t('taxInvoices.issueModal.cancel')}</SecondaryBtn>
          <PrimaryBtn type="button" disabled={!no.trim() || busy} onClick={submit}>
            {busy ? t('common.issuing') : t('taxInvoices.issueModal.submit')}
          </PrimaryBtn>
        </ModalFooter>
      </ModalDialog>
    </ModalBackdrop>
  );
}

// 수정·취소 발행 마킹 (수정세금계산서 / 현금영수증 취소) — 부가세법 §70 6 사유
const REASONS: CorrectionReason[] = ['cancel', 'amount_change', 'return', 'clerical', 'duplicate', 'other'];

function CorrectionModal({ row, onClose, onDone }: { row: ReceiptDueRow; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation('qbill');
  const isCash = row.kind === 'cash';
  // 취소건(correction_pending)은 cancel 기본, 그 외는 amount_change 기본
  const [reason, setReason] = useState<CorrectionReason>(row.effective === 'correction_pending' ? 'cancel' : 'amount_change');
  const [no, setNo] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 사유 변경 시 금액부호 기본값 prefill (전액취소/반품/중복=음수)
  const fullNeg = -Math.abs(Number(row.amount || 0));
  useEffect(() => {
    if (reason === 'cancel' || reason === 'duplicate') setDelta(String(fullNeg));
    else if (reason === 'return') setDelta(String(fullNeg));
    else setDelta('');
  }, [reason]); // eslint-disable-line react-hooks/exhaustive-deps

  const reasonOptions = REASONS.map(r => ({ value: r, label: t(`taxInvoices.corrections.reason.${r}`) as string }));
  const submit = async () => {
    if (!no.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      await markReceiptCorrection(row.business_id, row.invoice_id, row.installment_id, {
        kind: row.kind, reason,
        corrected_no: no.trim(), written_at: date,
        amount_delta: delta !== '' ? Number(delta) : undefined,
        customer_note: note.trim() || undefined,
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message || (t('taxInvoices.corrections.failed', { defaultValue: '정정 실패' }) as string));
    } finally { setBusy(false); }
  };

  const noLabel = isCash ? t('taxInvoices.corrections.cancelNo', '취소 승인번호') : t('taxInvoices.corrections.amendNo', '수정세금계산서 발행번호');

  return (
    <ModalBackdrop onClick={onClose}>
      <ModalDialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <ModalHead>
          <ModalTitle>{isCash ? t('taxInvoices.corrections.titleCash', '현금영수증 취소 마킹') : t('taxInvoices.corrections.title', '수정세금계산서 발행 마킹')}</ModalTitle>
          <ModalClose type="button" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </ModalClose>
        </ModalHead>
        <ModalBody>
          <ModalField>
            <ModalLabel>{t('taxInvoices.corrections.reasonLabel', '수정 사유')}</ModalLabel>
            <PlanQSelect
              options={reasonOptions}
              value={reasonOptions.find(o => o.value === reason) || null}
              onChange={(opt) => { const o = opt as { value: string } | null; if (o) setReason(o.value as CorrectionReason); }}
              size="md"
            />
          </ModalField>
          <GuideBox>{t(`taxInvoices.corrections.guide.${reason}`, { defaultValue: '외부(홈택스/팝빌)에서 발행 후 번호를 입력하세요.' }) as string}</GuideBox>
          <ModalField>
            <ModalLabel>{noLabel as string}</ModalLabel>
            <ModalInput value={no} autoFocus onChange={e => setNo(e.target.value)} placeholder={t('taxInvoices.corrections.noPh', { defaultValue: '발행/승인 번호' }) as string} />
          </ModalField>
          <ModalField>
            <ModalLabel>{t('taxInvoices.corrections.writtenAt', '작성일자')}</ModalLabel>
            <SingleDateField value={date} onChange={setDate} size="md" />
          </ModalField>
          {!isCash && (
            <ModalField>
              <ModalLabel>{t('taxInvoices.corrections.delta', '증감액 (취소·반품은 음수)')}</ModalLabel>
              <ModalInput value={delta} onChange={e => setDelta(e.target.value)} inputMode="numeric" placeholder="-1100000" />
            </ModalField>
          )}
          <ModalField>
            <ModalLabel>{t('taxInvoices.corrections.note', '고객 안내 메모 (선택)')}</ModalLabel>
            <ModalInput value={note} onChange={e => setNote(e.target.value)} placeholder={t('taxInvoices.corrections.notePh', { defaultValue: '예: 계약 해지에 따른 취소' }) as string} />
          </ModalField>
          <Hint>
            <KindBadge $cash={isCash} style={{ marginRight: 6 }}>
              {isCash ? t('taxInvoices.kind.cash', '현금영수증') : t('taxInvoices.kind.tax', '세금계산서')}
            </KindBadge>
            {row.invoice_number}{row.installment_no ? ` · ${t('taxInvoices.misc.roundSuffix', { n: row.installment_no, defaultValue: '{{n}}차' })}` : ''} · {formatMoney(row.amount, row.currency)}
            {row.issued_no ? ` · ${t('taxInvoices.corrections.original', { defaultValue: '원' })} ${row.issued_no}` : ''}
          </Hint>
          {err && <ErrLine>! {err}</ErrLine>}
        </ModalBody>
        <ModalFooter>
          <SecondaryBtn type="button" onClick={onClose}>{t('taxInvoices.issueModal.cancel')}</SecondaryBtn>
          <PrimaryBtn type="button" disabled={!no.trim() || busy} onClick={submit}>
            {busy ? t('common.issuing') : t('taxInvoices.corrections.submit', '정정 마킹')}
          </PrimaryBtn>
        </ModalFooter>
      </ModalDialog>
    </ModalBackdrop>
  );
}

const Wrap = styled.div`display: flex; flex-direction: column; gap: 14px;`;
const GuideBox = styled.div`
  font-size: 11px; color: #1E40AF; background: #EFF6FF; border: 1px solid #BFDBFE;
  border-radius: 8px; padding: 8px 10px; line-height: 1.5;
`;
const ErrLine = styled.div`font-size: 12px; color: #991B1B; background: #FEF2F2; padding: 6px 10px; border-radius: 6px;`;
const InfoBox = styled.div`
  display: flex; gap: 10px; align-items: flex-start;
  background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 10px; padding: 12px 14px;
`;
const InfoIcon = styled.div`
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: #2563EB; color: #fff; font-size: 12px; font-weight: 700;
`;
const InfoTitle = styled.div`font-size: 12px; font-weight: 700; color: #1E40AF;`;
const InfoDesc = styled.div`font-size: 11px; color: #1E40AF; line-height: 1.5; margin-top: 2px;`;
const OverdueBanner = styled.div`
  font-size: 12px; font-weight: 600; color: #991B1B;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 10px; padding: 10px 14px;
`;
const TabBar = styled.div`display: flex; gap: 4px; border-bottom: 1px solid #E2E8F0; padding: 0 4px;`;
const TabBtn = styled.button<{ $active: boolean }>`
  display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; margin-bottom: -1px;
  font-size: 13px; font-weight: 600; background: transparent; border: none; cursor: pointer;
  color: ${p => p.$active ? '#0F172A' : '#64748B'};
  border-bottom: 2px solid ${p => p.$active ? '#0D9488' : 'transparent'};
`;
const TabCount = styled.span<{ $active: boolean }>`
  font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 999px;
  background: ${p => p.$active ? '#CCFBF1' : '#F1F5F9'};
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
`;
const Empty = styled.div`
  text-align: center; padding: 60px 20px; color: #94A3B8; font-size: 13px;
  background: #fff; border: 1px dashed #E2E8F0; border-radius: 12px;
`;
const List = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  overflow-x: auto;
  &::-webkit-scrollbar { height: 6px; }
  &::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
`;
const ListHead = styled.div`
  display: flex; gap: 12px; padding: 10px 16px; background: #F8FAFC; border-bottom: 1px solid #E2E8F0;
  font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.4px;
  min-width: 940px;
`;
const Row = styled.div`
  display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #F1F5F9; align-items: center;
  &:last-child { border-bottom: none; }
  &:hover { background: #F8FAFC; }
  min-width: 940px;
`;
const Cell = styled.div`flex: 1; min-width: 0;`;
const KindBadge = styled.span<{ $cash?: boolean }>`
  display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px;
  white-space: nowrap;
  background: ${p => p.$cash ? '#ECFDF5' : '#EFF6FF'};
  color: ${p => p.$cash ? '#047857' : '#1D4ED8'};
  border: 1px solid ${p => p.$cash ? '#A7F3D0' : '#BFDBFE'};
`;
const Num = styled.div`font-size: 12px; font-weight: 700; color: #0F172A; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`;
const ClientName = styled.div`font-size: 13px; color: #0F172A; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const TaxId = styled.div`font-size: 12px; color: #475569; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`;
const Amt = styled.div`font-size: 13px; font-weight: 700; color: #0F172A; font-variant-numeric: tabular-nums;`;
const DueMuted = styled.span`font-size: 12px; color: #64748B;`;
const DuePill = styled.span<{ $tone: 'overdue' | 'soon' }>`
  font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; white-space: nowrap;
  background: ${p => p.$tone === 'overdue' ? '#FEE2E2' : '#FEF3C7'};
  color: ${p => p.$tone === 'overdue' ? '#991B1B' : '#92400E'};
`;
const IssueNo = styled.span`
  font-size: 11px; font-weight: 600; color: #166534; background: #DCFCE7;
  padding: 3px 8px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const Pending = styled.span`
  font-size: 11px; font-weight: 700; color: #92400E; background: #FEF3C7;
  padding: 3px 8px; border-radius: 4px;
`;
const ActionBtn = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  padding: 6px 12px; font-size: 12px; font-weight: 600; white-space: nowrap;
  background: ${p => p.$primary ? '#14B8A6' : '#fff'};
  color: ${p => p.$danger ? '#B91C1C' : p.$primary ? '#fff' : '#334155'};
  border: 1px solid ${p => p.$danger ? '#FCA5A5' : p.$primary ? '#14B8A6' : '#E2E8F0'};
  border-radius: 6px; cursor: pointer;
  &:hover { background: ${p => p.$primary ? '#0D9488' : p.$danger ? '#FEF2F2' : '#F8FAFC'}; }
`;
const CorrPendingBadge = styled.span`
  font-size: 11px; font-weight: 700; color: #991B1B; background: #FEE2E2;
  padding: 3px 8px; border-radius: 4px; white-space: nowrap;
`;
const CorrBadge = styled.span<{ $canceled?: boolean }>`
  font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap;
  display: inline-block; max-width: 120px; overflow: hidden; text-overflow: ellipsis;
  color: ${p => p.$canceled ? '#991B1B' : '#92400E'};
  background: ${p => p.$canceled ? '#FEE2E2' : '#FEF3C7'};
`;
const ModalBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 20px;
`;
const ModalDialog = styled.div`
  background: #fff; border-radius: 12px; max-width: 460px; width: 100%;
  display: flex; flex-direction: column; box-shadow: 0 24px 64px rgba(0,0,0,0.2);
`;
const ModalHead = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #F1F5F9;
`;
const ModalTitle = styled.h3`font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const ModalClose = styled.button`
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer; color: #64748B; border-radius: 4px;
  &:hover { background: #F1F5F9; }
`;
const ModalBody = styled.div`padding: 18px 20px; display: flex; flex-direction: column; gap: 12px;`;
const ModalDesc = styled.div`font-size: 12px; color: #64748B; line-height: 1.5;`;
const ModalField = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const ModalLabel = styled.label`font-size: 11px; font-weight: 600; color: #475569;`;
const ModalInput = styled.input`
  width: 100%; padding: 8px 10px; font-size: 13px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const Hint = styled.div`font-size: 11px; color: #94A3B8; padding: 8px 10px; background: #F8FAFC; border-radius: 6px; line-height: 1.7;`;
// #77 — 발행 파일 첨부
const FileRow = styled.div`display: flex; align-items: center; gap: 8px;`;
const FileBtn = styled.button`
  flex-shrink: 0; padding: 7px 12px; font-size: 12px; font-weight: 600;
  color: #334155; background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const FileName = styled.span`flex: 1; min-width: 0; font-size: 12px; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const FileClear = styled.button`
  flex-shrink: 0; width: 22px; height: 22px; border: none; background: transparent;
  color: #94A3B8; font-size: 16px; cursor: pointer; border-radius: 4px;
  &:hover { background: #F1F5F9; color: #EF4444; }
`;
const FileHint = styled.div`font-size: 11px; color: #94A3B8; line-height: 1.5;`;
const ModalFooter = styled.div`
  display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px;
  border-top: 1px solid #F1F5F9;
`;
const PrimaryBtn = styled.button`
  padding: 8px 16px; font-size: 13px; font-weight: 700; color: #fff; background: #14B8A6;
  border: none; border-radius: 6px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 8px 14px; font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;
