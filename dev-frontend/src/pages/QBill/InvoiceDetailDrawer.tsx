// 청구서 상세 우측 드로어 — 실 API
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import DetailDrawer from '../../components/Common/DetailDrawer';
import ConfirmDialog from '../../components/Common/ConfirmDialog';
import { apiFetch, useAuth } from '../../contexts/AuthContext';
import { CheckIcon } from '../../components/Common/Icons';
import {
  formatMoney, invoiceStatusColor, installmentStatusColor,
  getInvoice, markInstallmentPaid, unmarkInstallmentPaid, unmarkInvoicePaid,
  markInstallmentTaxInvoice, cancelInstallment, updateInvoiceStatus,
  markInvoiceTaxInvoice, markInvoiceCashReceipt,
  findConversationForClient, deleteInvoice, sendInvoiceReminder, sendInvoicePreview, resendInvoice, downloadInvoicePdf,
  setInvoiceOverdueNotify,
  listInvoiceCorrections, getInvoiceStatusHistory, getInvoiceTimeline,
  type ApiInvoice, type ApiInstallment, type ApiReceiptCorrection, type ApiInvoiceStatusEvent, type ApiBillEvent,
} from '../../services/invoices';
import RecurringBillingNote from '../../components/QBill/RecurringBillingNote';
import { useTimeFormat } from '../../hooks/useTimeFormat';

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  tone?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
}

interface Props {
  invoice: ApiInvoice | null;
  onClose: () => void;
  onChanged?: () => void;
  /** draft 재편집 — 발행 모달을 edit 모드로 연다 */
  onEdit?: (invoiceId: number) => void;
}


function daysSinceIso(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

// Q Bill 타임라인 이벤트 → i18n 키·기본문구·점 색상. 색상은 COLOR_GUIDE 토큰만 사용.
function billEventMeta(type: ApiBillEvent['event_type'], detail: Record<string, unknown> | null): { key: string; fallback: string; color: string } {
  const kind = detail && typeof detail.kind === 'string' ? detail.kind : null;
  switch (type) {
    case 'created': return { key: 'created', fallback: '청구서 생성', color: '#94A3B8' };
    case 'sent': return { key: 'sent', fallback: '발행', color: '#14B8A6' };
    case 'viewed': return { key: 'viewed', fallback: '공개 링크 열람', color: '#0284C7' };
    case 'paid_partial': return { key: 'paid_partial', fallback: '일부 결제 완료', color: '#22C55E' };
    case 'paid_full': return { key: 'paid_full', fallback: '결제 완료', color: '#22C55E' };
    case 'overdue': return { key: 'overdue', fallback: '결제 기한 경과', color: '#DC2626' };
    case 'canceled': return { key: 'canceled', fallback: '취소', color: '#DC2626' };
    case 'refunded': return { key: 'refunded', fallback: '환불', color: '#DC2626' };
    case 'tax_issued':
      return kind === 'cash'
        ? { key: 'cash_issued', fallback: '현금영수증 발행', color: '#6B21A8' }
        : { key: 'tax_issued', fallback: '세금계산서 발행', color: '#6B21A8' };
    case 'commented':
      if (kind === 'payment_notified') return { key: 'payment_alert', fallback: '송금 완료 알림', color: '#F59E0B' };
      if (kind === 'correction') return { key: 'correction', fallback: '증빙 정정', color: '#DC2626' };
      return { key: 'commented', fallback: '코멘트', color: '#94A3B8' };
    default: return { key: type, fallback: type, color: '#94A3B8' };
  }
}

export default function InvoiceDetailDrawer({ invoice: initialInvoice, onClose, onChanged, onEdit }: Props) {
  const { t } = useTranslation('qbill');
  const { user } = useAuth();
  // #91 — 결제 완료 마킹(상태 변경)은 백엔드에서 owner/platform_admin 전용
  const isOwner = user?.business_role === 'owner' || user?.platform_role === 'platform_admin';
  const navigate = useNavigate();
  const [copiedAcct, setCopiedAcct] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);
  const [chatConvId, setChatConvId] = useState<number | null>(null);
  const [corrections, setCorrections] = useState<ApiReceiptCorrection[]>([]);
  const [statusHistory, setStatusHistory] = useState<ApiInvoiceStatusEvent[]>([]);
  const [timeline, setTimeline] = useState<ApiBillEvent[]>([]);
  const { formatDateTime } = useTimeFormat();
  const [invoice, setInvoice] = useState<ApiInvoice | null>(initialInvoice);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = () => {
    if (!invoice) return;
    setConfirm({
      open: true,
      title: t('detail.delete.title', { defaultValue: '청구서를 삭제할까요?' }) as string,
      message: t('detail.delete.message', { defaultValue: '되돌릴 수 없습니다. 발송된 청구서는 삭제 대신 "취소" 처리하세요.' }) as string,
      tone: 'danger',
      onConfirm: async () => {
        if (deleting) return;
        setDeleting(true);
        try {
          await deleteInvoice(invoice.business_id, invoice.id);
          setConfirm(null);
          onChanged?.();
          onClose();
        } catch (e) {
          console.error('[InvoiceDetailDrawer] delete error:', e);
          setConfirm(null);
        } finally { setDeleting(false); }
      },
    });
  };
  const [taxModal, setTaxModal] = useState<{ installmentId: number | null; kind?: 'tax' | 'cash' } | null>(null);
  const [taxNoInput, setTaxNoInput] = useState('');
  const [taxFile, setTaxFile] = useState<File | null>(null); // #77 — 발행 파일 첨부
  const [remindBusy, setRemindBusy] = useState(false);
  const [remindNote, setRemindNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewNote, setPreviewNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNote, setResendNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [overdueNotifyBusy, setOverdueNotifyBusy] = useState(false);

  const onDownloadPdf = async () => {
    if (!invoice || pdfBusy) return;
    setPdfBusy(true);
    setRemindNote(null);
    try {
      await downloadInvoicePdf(invoice.business_id, invoice.id, invoice.invoice_number);
    } catch (e) {
      setRemindNote({ tone: 'warn', text: (e as Error).message || (t('detail.header.actions.pdfError', { defaultValue: 'PDF 생성 실패' }) as string) });
    } finally {
      setPdfBusy(false);
    }
  };

  // 외부에서 invoice prop 변경 시 동기화 + 최신 데이터 fetch
  useEffect(() => {
    setInvoice(initialInvoice);
    setChatConvId(null);
    setCorrections([]);
    setStatusHistory([]);
    setTimeline([]);
    if (initialInvoice) {
      // 상세 fetch (include 풀세트)
      getInvoice(initialInvoice.business_id, initialInvoice.id)
        .then(fresh => setInvoice(fresh))
        .catch(() => {/* fallback to initial */});
      // 증빙 정정 이력 (수정세금계산서/취소) — best-effort
      listInvoiceCorrections(initialInvoice.business_id, initialInvoice.id)
        .then(setCorrections)
        .catch(() => setCorrections([]));
      // 상태 변경 이력 (기본 히스토리) — best-effort
      getInvoiceStatusHistory(initialInvoice.business_id, initialInvoice.id)
        .then(setStatusHistory)
        .catch(() => setStatusHistory([]));
      // Q Bill 이벤트 타임라인 (생애주기) — best-effort
      getInvoiceTimeline(initialInvoice.business_id, initialInvoice.id)
        .then(setTimeline)
        .catch(() => setTimeline([]));
      // 발송된 청구서면 연결된 채팅방 자동 검색 (best-effort)
      if (initialInvoice.client_id && (initialInvoice.status === 'sent' || initialInvoice.status === 'partially_paid' || initialInvoice.status === 'paid' || initialInvoice.status === 'overdue')) {
        findConversationForClient(initialInvoice.business_id, initialInvoice.client_id, initialInvoice.project_id || undefined)
          .then(r => { if (r?.conversation?.id) setChatConvId(r.conversation.id); })
          .catch(() => {/* noop */});
      }
    }
  }, [initialInvoice?.id, initialInvoice?.client_id, initialInvoice?.project_id, initialInvoice?.status]);

  if (!invoice) return null;
  const client = invoice.Client || invoice.client;
  // 실제 발송 대상 이메일 — 백엔드 발송 우선순위와 동일
  // (invoice.recipient_email → client.tax_invoice_email → billing_contact_email → invite_email)
  const sendEmail = invoice.recipient_email
    || client?.tax_invoice_email
    || client?.billing_contact_email
    || (client as { invite_email?: string } | null)?.invite_email
    || null;
  const sc = invoiceStatusColor(invoice.status);
  const grandTotal = Number(invoice.grand_total || 0);
  const paidAmount = Number(invoice.paid_amount || 0);
  const outstanding = grandTotal - paidAmount;
  const isSplit = invoice.installment_mode === 'split';
  const sourcePost = invoice.sourcePost;
  const items = invoice.items || [];
  const installments = invoice.installments || [];
  const bank = invoice.bank_snapshot || {};
  const subtotal = Number(invoice.subtotal || invoice.total_amount || 0);
  const vatAmount = Number(invoice.tax_amount || 0);
  const vatRate = Number(invoice.vat_rate || 0);

  const refresh = async () => {
    try {
      const fresh = await getInvoice(invoice.business_id, invoice.id);
      setInvoice(fresh);
      onChanged?.();
      // 드로어 내 액션(발송·결제·증빙 등) 후 타임라인·정정·상태이력 즉시 갱신
      getInvoiceTimeline(invoice.business_id, invoice.id).then(setTimeline).catch(() => {/* keep */});
      getInvoiceStatusHistory(invoice.business_id, invoice.id).then(setStatusHistory).catch(() => {/* keep */});
      listInvoiceCorrections(invoice.business_id, invoice.id).then(setCorrections).catch(() => {/* keep */});
    } catch {/* noop */}
  };

  // 재무 헬퍼는 throw 함(403 owner_only·400 등) — catch 없으면 uncaught rejection + 사용자 피드백 0.
  const financeErr = (e: unknown) => setRemindNote({ tone: 'warn', text: (e as Error).message || (t('detail.financeError', { defaultValue: '처리에 실패했습니다' }) as string) });
  const handleMarkPaid = async (installmentId: number) => {
    if (busy) return;
    setBusy(true); setRemindNote(null);
    try { await markInstallmentPaid(invoice.business_id, invoice.id, installmentId, { paid_at: new Date().toISOString() }); await refresh(); }
    catch (e) { financeErr(e); }
    finally { setBusy(false); }
  };
  const handleUnmarkPaid = async (installmentId: number) => {
    if (busy) return;
    setBusy(true); setRemindNote(null);
    try { await unmarkInstallmentPaid(invoice.business_id, invoice.id, installmentId); await refresh(); }
    catch (e) { financeErr(e); }
    finally { setBusy(false); }
  };
  // Q Bill — 단일 invoice 결제 취소 (실수로 결제 확인한 것 되돌림)
  const handleUnmarkInvoicePaid = async () => {
    if (busy) return;
    setBusy(true); setRemindNote(null);
    try { await unmarkInvoicePaid(invoice.business_id, invoice.id); await refresh(); }
    catch (e) { financeErr(e); }
    finally { setBusy(false); }
  };
  const handleMarkTax = (installmentId: number) => {
    setTaxNoInput(''); setTaxFile(null);
    setTaxModal({ installmentId, kind: 'tax' });
  };
  const handleMarkInvoiceReceipt = (kind: 'tax' | 'cash') => {
    setTaxNoInput(''); setTaxFile(null);
    setTaxModal({ installmentId: null, kind });
  };
  const submitTaxNo = async () => {
    if (!taxModal || !taxNoInput.trim() || busy) return;
    setBusy(true);
    try {
      // #77 — 발행 파일(선택) 업로드 → file_id
      let fileId: number | undefined;
      if (taxFile) {
        const fd = new FormData();
        fd.append('file', taxFile);
        const ur = await apiFetch(`/api/files/${invoice.business_id}`, { method: 'POST', body: fd });
        const uj = await ur.json();
        if (!uj.success || !uj.data?.id) throw new Error(uj.message || 'file_upload_failed');
        fileId = Number(uj.data.id);
      }
      if (taxModal.installmentId != null) {
        await markInstallmentTaxInvoice(invoice.business_id, invoice.id, taxModal.installmentId, { tax_invoice_no: taxNoInput.trim(), file_id: fileId });
      } else if (taxModal.kind === 'cash') {
        await markInvoiceCashReceipt(invoice.business_id, invoice.id, { cash_receipt_no: taxNoInput.trim(), file_id: fileId });
      } else {
        await markInvoiceTaxInvoice(invoice.business_id, invoice.id, { tax_invoice_no: taxNoInput.trim(), file_id: fileId });
      }
      setTaxModal(null);
      setTaxNoInput(''); setTaxFile(null);
      await refresh();
    } catch (e) { financeErr(e); }
    finally { setBusy(false); }
  };
  const doCancelInst = async (installmentId: number) => {
    if (busy) return;
    setBusy(true); setRemindNote(null);
    try { await cancelInstallment(invoice.business_id, invoice.id, installmentId); await refresh(); }
    catch (e) { financeErr(e); }
    finally { setBusy(false); }
  };
  const handleCancelInst = (installmentId: number) => {
    setConfirm({
      open: true,
      title: t('detail.confirm.cancelInstallmentTitle', { defaultValue: '회차 취소' }) as string,
      message: t('detail.confirm.cancelInstallmentMsg', { defaultValue: '이 회차를 취소하시겠습니까? 결제 완료된 회차는 취소할 수 없습니다.' }) as string,
      tone: 'danger',
      onConfirm: () => { setConfirm(null); doCancelInst(installmentId); },
    });
  };
  const doCancelInvoice = async () => {
    if (busy) return;
    setBusy(true);
    try { await updateInvoiceStatus(invoice.business_id, invoice.id, 'canceled'); await refresh(); }
    finally { setBusy(false); }
  };
  const handleCancelInvoice = () => {
    setConfirm({
      open: true,
      title: t('detail.confirm.cancelInvoiceTitle', { defaultValue: '청구서 취소' }) as string,
      message: t('detail.confirm.cancelInvoiceMsg', { defaultValue: '이 청구서를 취소 상태로 변경하시겠습니까?' }) as string,
      tone: 'danger',
      onConfirm: () => { setConfirm(null); doCancelInvoice(); },
    });
  };
  const doMarkInvoicePaid = async () => {
    if (busy) return;
    setBusy(true);
    try { await updateInvoiceStatus(invoice.business_id, invoice.id, 'paid'); await refresh(); }
    finally { setBusy(false); }
  };
  const handleMarkInvoicePaid = () => {
    setConfirm({
      open: true,
      title: t('detail.confirm.markPaidTitle', { defaultValue: '결제 완료 처리' }) as string,
      message: t('detail.confirm.markPaidMsg', { defaultValue: '입금을 확인했다면 이 청구서를 결제 완료로 표시합니다. 계속할까요?' }) as string,
      tone: 'default',
      onConfirm: () => { setConfirm(null); doMarkInvoicePaid(); },
    });
  };
  const handleSendPreview = async () => {
    if (!invoice || previewBusy) return;
    setPreviewBusy(true);
    setPreviewNote(null);
    try {
      const r = await sendInvoicePreview(invoice.business_id, invoice.id);
      setPreviewNote({ tone: 'ok', text: t('detail.preview.sent', { defaultValue: '내 이메일({{to}})로 미리보기를 보냈어요', to: r.to }) as string });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setPreviewNote({
        tone: 'warn',
        text: msg.includes('no_email')
          ? (t('detail.preview.noEmail', { defaultValue: '내 계정 이메일이 없어 보낼 수 없어요' }) as string)
          : (t('detail.preview.failed', { defaultValue: '미리보기 발송에 실패했어요. 잠시 후 다시 시도해 주세요' }) as string),
      });
    } finally {
      setPreviewBusy(false);
    }
  };
  const handleSendReminder = async () => {
    if (!invoice || remindBusy) return;
    setRemindBusy(true);
    setRemindNote(null);
    try {
      await sendInvoiceReminder(invoice.business_id, invoice.id);
      setRemindNote({ tone: 'ok', text: t('detail.reminder.sent', { defaultValue: '독촉 메일을 보냈습니다' }) as string });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('cooldown')) {
        setRemindNote({ tone: 'warn', text: t('detail.reminder.cooldown', { defaultValue: '최근에 보냈어요. 잠시 후 다시 시도해 주세요' }) as string });
      } else if (msg.includes('no_recipient')) {
        setRemindNote({ tone: 'warn', text: t('detail.reminder.noRecipient', { defaultValue: '고객 이메일이 없어 보낼 수 없어요' }) as string });
      } else {
        setRemindNote({ tone: 'warn', text: t('detail.reminder.failed', { defaultValue: '발송에 실패했어요. 잠시 후 다시 시도해 주세요' }) as string });
      }
    } finally {
      setRemindBusy(false);
    }
  };
  const handleToggleOverdueNotify = async () => {
    if (!invoice || overdueNotifyBusy) return;
    setOverdueNotifyBusy(true);
    try {
      await setInvoiceOverdueNotify(invoice.business_id, invoice.id, Boolean(invoice.meta?.overdue_notify_off));
      await refresh();
    } catch {
      setRemindNote({ tone: 'warn', text: t('detail.overdueNotify.failed', { defaultValue: '알림 설정을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요' }) as string });
    } finally {
      setOverdueNotifyBusy(false);
    }
  };
  const handleResend = async () => {
    if (!invoice || resendBusy) return;
    setResendBusy(true);
    setResendNote(null);
    try {
      const r = await resendInvoice(invoice.business_id, invoice.id);
      setResendNote({ tone: 'ok', text: t('detail.resend.sent', { to: r.to, defaultValue: `청구서를 다시 보냈습니다 (${r.to})` }) as string });
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('no_recipient')) {
        setResendNote({ tone: 'warn', text: t('detail.resend.noRecipient', { defaultValue: '고객 이메일이 없어 보낼 수 없어요' }) as string });
      } else if (msg.includes('cooldown') || msg.includes('rate')) {
        setResendNote({ tone: 'warn', text: t('detail.resend.cooldown', { defaultValue: '최근에 보냈어요. 잠시 후 다시 시도해 주세요' }) as string });
      } else {
        setResendNote({ tone: 'warn', text: t('detail.resend.failed', { defaultValue: '재발송에 실패했어요. 잠시 후 다시 시도해 주세요' }) as string });
      }
    } finally {
      setResendBusy(false);
    }
  };

  const APP_URL = window.location.origin;
  const shareUrl = invoice.share_token ? `${APP_URL}/public/invoices/${invoice.share_token}` : null;

  const copyAccount = () => {
    if (!bank.account_number) return;
    navigator.clipboard.writeText(String(bank.account_number)).then(() => { setCopiedAcct(true); setTimeout(() => setCopiedAcct(false), 1500); }).catch(() => {/* noop */});
  };
  const copyShareLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => { setCopiedMemo(true); setTimeout(() => setCopiedMemo(false), 1500); }).catch(() => {/* noop */});
  };

  return (
    <DetailDrawer
      open={!!invoice}
      onClose={onClose}
      width={480}
      ariaLabel={t('detail.confirm.aria', { number: invoice.invoice_number, defaultValue: '청구서 {{number}}' }) as string}
    >
      {/* ─── 헤더 ─── */}
      <DrawerHeader>
        <HeaderTop>
          <NumWrap>
            <NumBadge>{invoice.invoice_number}</NumBadge>
            <StatusBadge $bg={sc.bg} $fg={sc.fg}>
              <StatusDot $color={sc.dot} />
              {t(`invoices.status.${invoice.status}`)}
            </StatusBadge>
          </NumWrap>
          <CloseBtn onClick={onClose} aria-label={t('common.close') as string}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </CloseBtn>
        </HeaderTop>
        <HeaderTitle>{invoice.title}</HeaderTitle>
        {invoice.notes && <HeaderSub>{invoice.notes}</HeaderSub>}
        <RecurringBillingNote recurring={invoice.recurring} />

        {/* 액션 바 */}
        <ActionRow>
          {(invoice.status === 'draft' || invoice.status === 'canceled') && onEdit && (
            <ActionBtn onClick={() => { const id = invoice.id; onClose(); onEdit(id); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              {invoice.status === 'canceled'
                ? t('detail.header.actions.editReissue', { defaultValue: '편집·재발행' }) as string
                : t('detail.header.actions.edit', { defaultValue: '편집' }) as string}
            </ActionBtn>
          )}
          {isOwner && invoice.status === 'draft' && (
            <ActionBtn onClick={handleSendPreview} disabled={previewBusy} title={t('detail.preview.hint', { defaultValue: '고객에게 보내기 전 내 이메일로 미리보기 발송' }) as string}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
              {previewBusy
                ? t('detail.preview.busy', { defaultValue: '보내는 중…' }) as string
                : t('detail.preview.btn', { defaultValue: '나에게 미리보기' }) as string}
            </ActionBtn>
          )}
          {(invoice.status === 'draft' || invoice.status === 'canceled') && (
            <ActionBtn onClick={handleDelete} style={{ color: '#DC2626', borderColor: '#FECACA' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              {t('detail.header.actions.delete', { defaultValue: '삭제' }) as string}
            </ActionBtn>
          )}
          <ActionBtn onClick={copyShareLink} disabled={!shareUrl}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/></svg>
            {copiedMemo ? t('detail.header.actions.linkCopied') : t('detail.header.actions.copyLink')}
          </ActionBtn>
          <ActionBtn onClick={onDownloadPdf} disabled={pdfBusy}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>
            {pdfBusy ? t('detail.header.actions.pdfBusy', { defaultValue: 'PDF 생성 중…' }) : t('detail.header.actions.downloadPdf', 'PDF 다운로드')}
          </ActionBtn>
          {chatConvId && (
            <ActionBtn onClick={() => { onClose(); navigate(`/talk/${chatConvId}`); }} title={t('detail.header.actions.goChatHint', '이 청구서가 공유된 채팅방으로') as string}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              {t('detail.header.actions.goChat', '채팅방 가기')}
            </ActionBtn>
          )}
          {isOwner && !isSplit && (invoice.status === 'sent' || invoice.status === 'partially_paid' || invoice.status === 'overdue') && (
            <ActionBtn
              onClick={handleMarkInvoicePaid}
              disabled={busy}
              $primary
              title={t('detail.markPaid.hint', { defaultValue: '입금 확인 후 결제 완료로 표시' }) as string}
            >
              <CheckIcon size={13} style={{ verticalAlign: '-1px' }} />
              {t('detail.markPaid.action', { defaultValue: '결제 완료' })}
            </ActionBtn>
          )}
          {/* 단일 invoice 결제 취소 — 실수로 결제 확인한 것 되돌림 (paid → sent + payment 회수) */}
          {isOwner && !isSplit && invoice.status === 'paid' && (
            <ActionBtn
              onClick={handleUnmarkInvoicePaid}
              disabled={busy}
              title={t('detail.unmarkPaid.hint', { defaultValue: '결제 완료를 취소하고 미결제로 되돌립니다' }) as string}
            >
              {t('detail.unmarkPaid.action', { defaultValue: '결제 취소' })}
            </ActionBtn>
          )}
          {invoice.status !== 'draft' && invoice.status !== 'canceled' && (invoice.client_id || invoice.recipient_email) && (
            <ActionBtn
              onClick={handleResend}
              disabled={resendBusy}
              title={invoice.meta?.last_resent_at
                ? t('detail.resend.lastSent', { days: daysSinceIso(invoice.meta.last_resent_at), defaultValue: '최근 재발송함' }) as string
                : t('detail.resend.hint', { defaultValue: '원본 청구서 메일(PDF 포함)을 고객에게 다시 보냅니다 — 독촉 아님' }) as string}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/></svg>
              {resendBusy ? t('detail.resend.sending', { defaultValue: '보내는 중…' }) : t('detail.resend.action', { defaultValue: '재발송' })}
            </ActionBtn>
          )}
          {(invoice.status === 'sent' || invoice.status === 'partially_paid' || invoice.status === 'overdue') && invoice.client_id && (
            <ActionBtn
              onClick={handleSendReminder}
              disabled={remindBusy}
              title={invoice.meta?.last_reminder_at
                ? t('detail.reminder.lastSent', { days: daysSinceIso(invoice.meta.last_reminder_at), defaultValue: '최근 발송함' }) as string
                : t('detail.reminder.hint', { defaultValue: '고객에게 결제 안내 메일을 보냅니다' }) as string}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              {remindBusy ? t('detail.reminder.sending', { defaultValue: '보내는 중…' }) : t('detail.reminder.action', { defaultValue: '결제 독촉 보내기' })}
            </ActionBtn>
          )}
          {invoice.status !== 'canceled' && (
            <ActionBtn onClick={handleCancelInvoice} disabled={busy}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              {t('detail.header.actions.cancel')}
            </ActionBtn>
          )}
        </ActionRow>
        {remindNote && <RemindNote $tone={remindNote.tone}>{remindNote.text}</RemindNote>}
        {resendNote && <RemindNote $tone={resendNote.tone}>{resendNote.text}</RemindNote>}
        {previewNote && <RemindNote $tone={previewNote.tone}>{previewNote.text}</RemindNote>}
        {(invoice.status === 'sent' || invoice.status === 'partially_paid' || invoice.status === 'overdue') && (
          <OverdueNotifyRow>
            <span>
              {invoice.meta?.overdue_notify_off
                ? t('detail.overdueNotify.offHint', { defaultValue: '마감이 지나도 알리지 않습니다. 독촉 메일은 위 버튼으로만 나갑니다.' })
                : t('detail.overdueNotify.onHint', { defaultValue: '마감이 지나면 독촉 메일을 보낼지 알림으로 물어봅니다. 자동 발송은 하지 않습니다.' })}
            </span>
            <LinkBtn type="button" onClick={handleToggleOverdueNotify} disabled={overdueNotifyBusy}>
              {invoice.meta?.overdue_notify_off
                ? t('detail.overdueNotify.turnOn', { defaultValue: '알림 다시 받기' })
                : t('detail.overdueNotify.turnOff', { defaultValue: '알림 끄기' })}
            </LinkBtn>
          </OverdueNotifyRow>
        )}
      </DrawerHeader>

      {/* ─── 본문 (스크롤) ─── */}
      <Body>
        {/* 출처 문서 (계약/견적/SOW/제안) */}
        {sourcePost && (
          <SourceCard>
            <SourceLeft>
              <SourceKindBadge $kind={sourcePost.category || ''}>
                {sourcePost.category ? t(`kind.${sourcePost.category}`, { defaultValue: sourcePost.category }) : t('kind.document', { defaultValue: '문서' })}
              </SourceKindBadge>
              <SourceText>
                <SourceTitle>{sourcePost.title}</SourceTitle>
                <SourceMeta>
                  {t('detail.source.note', { defaultValue: '본 청구서는 위 문서에 따른 청구입니다' })}
                  {sourcePost.shared_at && ` · ${t('detail.source.sharedPrefix', { defaultValue: '공유' })} ${sourcePost.shared_at.split('T')[0]}`}
                </SourceMeta>
              </SourceText>
            </SourceLeft>
            <SourceLink href={`/docs?post=${sourcePost.id}`}>
              {t('detail.source.viewDoc', { defaultValue: '문서 보기' })}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
            </SourceLink>
          </SourceCard>
        )}

        {/* 진행 stepper */}
        <ProgressStepper status={invoice.status} />

        {/* 발신 / 수신 */}
        <Parties>
          <PartyCard>
            <PartyLabel>{t('detail.parties.from')}</PartyLabel>
            <PartyName>{bank.account_holder || '—'}</PartyName>
            <PartyMeta>
              <MetaRow><MetaKey>{t('detail.parties.bank', { defaultValue: '은행' })}</MetaKey><MetaVal>{bank.bank_name || '—'}</MetaVal></MetaRow>
            </PartyMeta>
          </PartyCard>
          <PartyArrow>→</PartyArrow>
          <PartyCard>
            <PartyLabel>
              {t('detail.parties.to')}
              {!client && <ExtBadge title={t('detail.parties.externalHint', { defaultValue: '내부 고객과 연동되지 않은 외부 청구' }) as string}>{t('detail.parties.external', { defaultValue: '외부' }) as string}</ExtBadge>}
            </PartyLabel>
            <PartyName>{client?.biz_name || client?.display_name || client?.company_name || invoice.recipient_business_name || '—'}</PartyName>
            <PartyMeta>
              <MetaRow>
                <MetaKey>{t('detail.parties.sendEmail', { defaultValue: '발송 이메일' }) as string}</MetaKey>
                <MetaVal>{sendEmail || <Missing>{t('detail.parties.noEmail', { defaultValue: '이메일 없음 · 발송 불가' })}</Missing>}</MetaVal>
              </MetaRow>
              {client?.is_business ? (
                <>
                  <MetaRow>
                    <MetaKey>{t('detail.parties.taxId')}</MetaKey>
                    <MetaVal>{client?.biz_tax_id || invoice.recipient_business_number || <Missing>{t('detail.parties.missingInfo')}</Missing>}</MetaVal>
                  </MetaRow>
                  <MetaRow>
                    <MetaKey>{t('detail.parties.rep')}</MetaKey>
                    <MetaVal>{client?.biz_ceo || '—'}</MetaVal>
                  </MetaRow>
                  <MetaRow>
                    <MetaKey>{t('detail.parties.address')}</MetaKey>
                    <MetaVal>{client?.biz_address || client?.biz_address_en || '—'}</MetaVal>
                  </MetaRow>
                </>
              ) : (
                <MetaRow><MetaKey>{t('detail.parties.country')}</MetaKey><MetaVal>{t('detail.parties.individual')}</MetaVal></MetaRow>
              )}
            </PartyMeta>
          </PartyCard>
        </Parties>

        {/* 항목 */}
        <Section>
          <SectionTitle>{t('detail.items.title')}</SectionTitle>
          <ItemTable>
            <ItemHead>
              <ItemHeadCell style={{ width: 28 }}>#</ItemHeadCell>
              <ItemHeadCell>{t('detail.items.description')}</ItemHeadCell>
              <ItemHeadCell style={{ width: 50, textAlign: 'right' }}>{t('detail.items.qty')}</ItemHeadCell>
              <ItemHeadCell style={{ width: 100, textAlign: 'right' }}>{t('detail.items.unitPrice')}</ItemHeadCell>
              <ItemHeadCell style={{ width: 110, textAlign: 'right' }}>{t('detail.items.subtotal')}</ItemHeadCell>
            </ItemHead>
            {items.map((it, idx) => (
              <ItemRow key={it.id}>
                <ItemCell style={{ width: 28, color: '#94A3B8' }}>{idx + 1}</ItemCell>
                <ItemCell>
                  {it.description}
                  {it.detail && <ItemDetailText>{it.detail}</ItemDetailText>}
                </ItemCell>
                <ItemCell style={{ width: 50, textAlign: 'right' }}>{it.quantity}</ItemCell>
                <ItemCell style={{ width: 100, textAlign: 'right' }}>{formatMoney(it.unit_price, invoice.currency)}</ItemCell>
                <ItemCell style={{ width: 110, textAlign: 'right', fontWeight: 700 }}>{formatMoney(it.amount, invoice.currency)}</ItemCell>
              </ItemRow>
            ))}
          </ItemTable>

          <Summary>
            <SummaryRow>
              <SumKey>{t('detail.summary.subtotal')}</SumKey>
              <SumVal>{formatMoney(subtotal, invoice.currency)}</SumVal>
            </SummaryRow>
            {vatRate > 0 && (
              <SummaryRow>
                <SumKey>{t('detail.summary.vat')} ({Math.round(vatRate * 100)}%)</SumKey>
                <SumVal>{formatMoney(vatAmount, invoice.currency)}</SumVal>
              </SummaryRow>
            )}
            <SummaryDiv />
            <SummaryRow>
              <SumKey style={{ fontWeight: 700, color: '#0F172A' }}>{t('detail.summary.total')}</SumKey>
              <SumVal style={{ fontSize: 16, fontWeight: 700 }}>{formatMoney(grandTotal, invoice.currency)}</SumVal>
            </SummaryRow>
            {paidAmount > 0 && (
              <>
                <SummaryRow>
                  <SumKey style={{ color: '#166534' }}>{t('detail.summary.paid')}</SumKey>
                  <SumVal style={{ color: '#166534' }}>{formatMoney(paidAmount, invoice.currency)}</SumVal>
                </SummaryRow>
                {outstanding > 0 && (
                  <SummaryRow>
                    <SumKey style={{ color: '#92400E' }}>{t('detail.summary.outstanding')}</SumKey>
                    <SumVal style={{ color: '#92400E', fontWeight: 700 }}>{formatMoney(outstanding, invoice.currency)}</SumVal>
                  </SummaryRow>
                )}
              </>
            )}
          </Summary>
        </Section>

        {/* 분할 일정 */}
        {isSplit && installments.length > 0 && (
          <Section>
            <SectionTitleRow>
              <SectionTitle>{t('detail.installments.title')}</SectionTitle>
              <SectionMeta>{t('detail.installments.subtitle', { count: installments.length })}</SectionMeta>
            </SectionTitleRow>
            <InstallmentList>
              {installments.map((ins) => (
                <InstallmentRow
                  key={ins.id}
                  ins={ins}
                  currency={invoice.currency}
                  busy={busy}
                  onMarkPaid={handleMarkPaid}
                  onUnmarkPaid={handleUnmarkPaid}
                  onMarkTax={handleMarkTax}
                  onCancel={handleCancelInst}
                />
              ))}
            </InstallmentList>
          </Section>
        )}

        {/* 입금 안내 */}
        <Section>
          <SectionTitle>{t('detail.bank.title')}</SectionTitle>
          <BankCard>
            <BankRow>
              <BankKey>{t('detail.bank.bank')}</BankKey>
              <BankVal>{bank.bank_name || '—'}</BankVal>
            </BankRow>
            <BankRow>
              <BankKey>{t('detail.bank.account')}</BankKey>
              <BankValRow>
                <BankVal style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{bank.account_number || '—'}</BankVal>
                {bank.account_number && (
                  <CopyChip onClick={copyAccount}>
                    {copiedAcct ? t('detail.bank.copied') : t('detail.bank.copy')}
                  </CopyChip>
                )}
              </BankValRow>
            </BankRow>
            <BankRow>
              <BankKey>{t('detail.bank.holder')}</BankKey>
              <BankVal>{bank.account_holder || '—'}</BankVal>
            </BankRow>
            <PayerHint>
              <PayerHintTitle>{t('detail.bank.payerMemoHelp')}</PayerHintTitle>
              <PayerCode>
                <code>{`${invoice.invoice_number} ${client?.display_name || client?.biz_name || ''}`}</code>
              </PayerCode>
            </PayerHint>
          </BankCard>
        </Section>

        {/* 증빙 — 세금계산서 / 현금영수증 */}
        {(client?.is_business || (invoice.receipt_type && invoice.receipt_type !== 'none') || invoice.receipt_profile) && (() => {
          const rp = invoice.receipt_profile;
          const isCash = invoice.receipt_type === 'cash_receipt' || rp?.biz_type === 'individual';
          const status = isCash ? (invoice.cash_receipt_status || 'none') : invoice.tax_invoice_status;
          const issuedNo = isCash ? invoice.cash_receipt_no : invoice.tax_invoice_external_id;
          return (
            <Section>
              <SectionTitle>{isCash ? t('detail.tax.titleCash', { defaultValue: '현금영수증' }) : t('detail.tax.title')}</SectionTitle>
              {/* 고객이 공개 페이지에서 입력·확인한 증빙 정보 */}
              {rp && (
                <ReceiptInfoBox>
                  <ReceiptInfoHead>{t('detail.tax.customerSubmitted', { defaultValue: '고객 확인 정보' })}</ReceiptInfoHead>
                  {rp.biz_type === 'individual' ? (
                    <>
                      <ReceiptRow><span>{t('detail.tax.crPurpose', { defaultValue: '용도' })}</span><b>{rp.cr_purpose === 'expense_proof' ? t('detail.tax.crExpense', { defaultValue: '지출증빙' }) : t('detail.tax.crIncome', { defaultValue: '소득공제' })}</b></ReceiptRow>
                      <ReceiptRow><span>{t('detail.tax.crIdentifier', { defaultValue: '번호' })}</span><b>{rp.cr_identifier || '—'}</b></ReceiptRow>
                    </>
                  ) : (
                    <>
                      <ReceiptRow><span>{t('detail.tax.bizTaxId', { defaultValue: '사업자등록번호' })}</span><b>{rp.biz_tax_id || '—'}</b></ReceiptRow>
                      <ReceiptRow><span>{t('detail.tax.bizName', { defaultValue: '상호' })}</span><b>{rp.biz_name || '—'}</b></ReceiptRow>
                      {rp.biz_ceo && <ReceiptRow><span>{t('detail.tax.bizCeo', { defaultValue: '대표자' })}</span><b>{rp.biz_ceo}</b></ReceiptRow>}
                      {(rp.biz_category || rp.biz_item) && <ReceiptRow><span>{t('detail.tax.bizCatItem', { defaultValue: '업태/종목' })}</span><b>{[rp.biz_category, rp.biz_item].filter(Boolean).join(' / ') || '—'}</b></ReceiptRow>}
                      {rp.biz_address && <ReceiptRow><span>{t('detail.tax.bizAddress', { defaultValue: '주소' })}</span><b>{rp.biz_address}</b></ReceiptRow>}
                      {rp.tax_email && <ReceiptRow><span>{t('detail.tax.taxEmail', { defaultValue: '수취 이메일' })}</span><b>{rp.tax_email}</b></ReceiptRow>}
                    </>
                  )}
                </ReceiptInfoBox>
              )}
              <TaxBox $status={status}>
                <TaxIcon $status={status}>
                  {status === 'issued' ? <CheckIcon size={14} /> : status === 'pending' ? '!' : ''}
                </TaxIcon>
                <TaxBody>
                  <TaxLabel>
                    {status === 'issued' ? (issuedNo ? t('detail.tax.issuedNo', { no: issuedNo, defaultValue: `발행완료 · ${issuedNo}` }) : t('detail.tax.issued')) :
                     status === 'pending' ? t('detail.tax.required') :
                     t('detail.tax.notRequired')}
                  </TaxLabel>
                  {status === 'pending' && <TaxDesc>{t('detail.tax.issuePromptDesc')}</TaxDesc>}
                </TaxBody>
              </TaxBox>
              {/* 단건 청구서 발행 마킹 (분할은 회차별로) */}
              {!isSplit && status !== 'issued' && (
                <ReceiptMarkRow>
                  <ReceiptMarkBtn type="button" onClick={() => handleMarkInvoiceReceipt('tax')}>
                    {t('detail.tax.markTaxBtn', { defaultValue: '세금계산서 발행번호 입력' })}
                  </ReceiptMarkBtn>
                  <ReceiptMarkBtn type="button" onClick={() => handleMarkInvoiceReceipt('cash')}>
                    {t('detail.tax.markCashBtn', { defaultValue: '현금영수증 번호 입력' })}
                  </ReceiptMarkBtn>
                </ReceiptMarkRow>
              )}
              {/* 정정 이력 (수정세금계산서 / 현금영수증 취소) */}
              {corrections.length > 0 && (
                <CorrHistory>
                  <CorrHistTitle>{t('detail.tax.correctionHistory', { defaultValue: '정정 이력' })}</CorrHistTitle>
                  {corrections.map(c => (
                    <CorrItem key={c.id}>
                      <CorrTop>
                        <CorrReason>{t(`taxInvoices.corrections.reason.${c.reason}`, { defaultValue: c.reason, ns: 'qbill' }) as string}</CorrReason>
                        <CorrNo>{c.corrected_no}</CorrNo>
                      </CorrTop>
                      <CorrMeta>
                        {c.written_at ? c.written_at.slice(0, 10) : '—'}
                        {c.amount_delta != null && ` · ${formatMoney(Number(c.amount_delta), invoice.currency)}`}
                        {c.original_no && ` · ${t('taxInvoices.corrections.original', { defaultValue: '원', ns: 'qbill' })} ${c.original_no}`}
                      </CorrMeta>
                    </CorrItem>
                  ))}
                </CorrHistory>
              )}
            </Section>
          );
        })()}

        {/* 상태 변경 이력 (기본 히스토리) */}
        {statusHistory.length > 0 && (
          <Section>
            <SectionTitle>{t('detail.statusHistory.title', { defaultValue: '상태 이력' })}</SectionTitle>
            <StatusHistList>
              {statusHistory.map(ev => (
                <StatusHistRow key={ev.id}>
                  <StatusHistDot />
                  <StatusHistBody>
                    <StatusHistMain>
                      {ev.from_status && (
                        <>
                          <StatusHistChip>{t(`status.${ev.from_status}`, { defaultValue: ev.from_status })}</StatusHistChip>
                          <StatusHistArrow>→</StatusHistArrow>
                        </>
                      )}
                      <StatusHistChip $to>{t(`status.${ev.to_status}`, { defaultValue: ev.to_status })}</StatusHistChip>
                    </StatusHistMain>
                    <StatusHistMeta>
                      {formatDateTime(ev.created_at)}
                      {ev.changed_by_name && ` · ${ev.changed_by_name}`}
                      {ev.note && ` · ${ev.note}`}
                    </StatusHistMeta>
                  </StatusHistBody>
                </StatusHistRow>
              ))}
            </StatusHistList>
          </Section>
        )}

        {/* Q Bill 이벤트 타임라인 (생애주기: 생성→발행→고객열람→(부분)결제→증빙→정정) */}
        {timeline.length > 0 && (
          <Section>
            <SectionTitle>{t('detail.events.title', { defaultValue: '활동' })}</SectionTitle>
            <TlList>
              {timeline.map(ev => {
                const meta = billEventMeta(ev.event_type, ev.detail);
                const actorName = ev.actor?.name || t('detail.events.customer', { defaultValue: '고객' });
                const d = (ev.detail || {}) as Record<string, unknown>;
                const suffixParts: string[] = [];
                if (typeof d.label === 'string' && d.label) suffixParts.push(d.label);
                if (typeof d.amount === 'number') suffixParts.push(formatMoney(d.amount, invoice.currency));
                if (typeof d.no === 'string' && d.no) suffixParts.push(d.no);
                if (typeof d.payer_name === 'string' && d.payer_name) suffixParts.push(d.payer_name);
                // 발송처 — 어느 이메일·어느 채팅방에 보냈는지 무조건 표시 (sent 이벤트)
                const isResend = ev.event_type === 'sent' && d.resend === true;
                if (isResend) suffixParts.unshift(t('detail.events.resendTag', { defaultValue: '재발송' }) as string);
                const suffix = suffixParts.join(' · ');
                const destParts: string[] = [];
                if (ev.event_type === 'sent') {
                  const emailTo = (typeof d.email_to === 'string' && d.email_to) ? d.email_to : (typeof d.to === 'string' ? d.to : '');
                  if (emailTo) destParts.push(t('detail.events.sentEmail', { email: emailTo, defaultValue: `📧 ${emailTo}` }) as string);
                  if (typeof d.chat_title === 'string' && d.chat_title) destParts.push(t('detail.events.sentChat', { name: d.chat_title, defaultValue: `💬 ${d.chat_title}` }) as string);
                  else if (d.chat_conversation_id) destParts.push(t('detail.events.sentChatGeneric', { defaultValue: '💬 채팅방' }) as string);
                }
                return (
                  <TlRow key={ev.id}>
                    <TlDot $c={meta.color} />
                    <TlBody>
                      <TlMain>
                        <TlLabel>{t(`detail.events.types.${meta.key}`, { defaultValue: meta.fallback })}</TlLabel>
                        {suffix && <TlSuffix>{suffix}</TlSuffix>}
                      </TlMain>
                      {destParts.length > 0 && <TlDest>{destParts.join('  ·  ')}</TlDest>}
                      <TlMeta>
                        {formatDateTime(ev.created_at)} · {actorName}
                      </TlMeta>
                    </TlBody>
                  </TlRow>
                );
              })}
            </TlList>
          </Section>
        )}
      </Body>
      {confirm?.open && (
        <ConfirmDialog
          isOpen={confirm.open}
          title={confirm.title}
          message={confirm.message}
          variant={confirm.tone === 'danger' ? 'danger' : confirm.tone === 'warning' ? 'warning' : 'info'}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}
      {taxModal && (
        <TaxModalBackdrop onClick={() => setTaxModal(null)}>
          <TaxModalDialog onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('detail.tax.issuePromptTitle') as string}>
            <TaxModalHead>
              <TaxModalTitle>{taxModal.kind === 'cash' ? t('detail.tax.cashPromptTitle', { defaultValue: '현금영수증 번호 입력' }) : t('detail.tax.issuePromptTitle')}</TaxModalTitle>
              <TaxModalClose type="button" onClick={() => setTaxModal(null)} aria-label={t('common.close') as string}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </TaxModalClose>
            </TaxModalHead>
            <TaxModalBody>
              <TaxModalDesc>{t('detail.tax.issuePromptDesc')}</TaxModalDesc>
              <TaxModalLabel htmlFor="tax-no-input">{t('detail.tax.issueNo')}</TaxModalLabel>
              <TaxModalInput
                id="tax-no-input"
                type="text"
                value={taxNoInput}
                onChange={e => setTaxNoInput(e.target.value)}
                placeholder={t('detail.tax.issueNoPh') as string}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitTaxNo(); }}
              />
              {/* #77 — 발행 파일 첨부 (선택) */}
              <TaxModalLabel htmlFor="tax-file-input" style={{ marginTop: 12 }}>
                {t('detail.tax.fileLabel', { defaultValue: '발행 파일 첨부 (선택)' }) as string}
              </TaxModalLabel>
              <TaxFileRow>
                <TaxFileBtn type="button" onClick={() => document.getElementById('tax-file-input')?.click()}>
                  {t('detail.tax.filePick', { defaultValue: '파일 선택' }) as string}
                </TaxFileBtn>
                <TaxFileName>{taxFile ? taxFile.name : (t('detail.tax.fileNone', { defaultValue: '선택된 파일 없음' }) as string)}</TaxFileName>
                {taxFile && <TaxFileClear type="button" onClick={() => setTaxFile(null)} aria-label="clear">×</TaxFileClear>}
                <input id="tax-file-input" type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                  onChange={e => setTaxFile(e.target.files?.[0] || null)} />
              </TaxFileRow>
              <TaxFileHint>{t('detail.tax.fileHint', { defaultValue: '첨부하면 고객이 공개 청구서 페이지에서 다운로드할 수 있어요.' }) as string}</TaxFileHint>
            </TaxModalBody>
            <TaxModalFooter>
              <TaxModalSecondary type="button" onClick={() => setTaxModal(null)}>{t('common.cancel')}</TaxModalSecondary>
              <TaxModalPrimary type="button" onClick={submitTaxNo} disabled={!taxNoInput.trim() || busy}>
                {busy ? t('common.issuing') : t('detail.tax.issueAction')}
              </TaxModalPrimary>
            </TaxModalFooter>
          </TaxModalDialog>
        </TaxModalBackdrop>
      )}
    </DetailDrawer>
  );
}

// ─── 회차 행 ───
interface InstallmentRowProps {
  ins: ApiInstallment;
  currency: ApiInvoice['currency'];
  busy: boolean;
  onMarkPaid: (id: number) => void;
  onUnmarkPaid: (id: number) => void;
  onMarkTax: (id: number) => void;
  onCancel: (id: number) => void;
}
function InstallmentRow({ ins, currency, busy, onMarkPaid, onUnmarkPaid, onMarkTax, onCancel }: InstallmentRowProps) {
  const { t } = useTranslation('qbill');
  const sc = installmentStatusColor(ins.status);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <InstRowWrap>
      <InstNo>{ins.installment_no}</InstNo>
      <InstInfo>
        <InstLabel>{ins.label}</InstLabel>
        {ins.milestone_ref && <InstMilestone>{ins.milestone_ref}</InstMilestone>}
        {ins.status === 'paid' && ins.paid_at && (
          <InstSubMeta>
            <CheckIcon size={11} style={{ verticalAlign: '-1px' }} /> {t('detail.installments.paidAt', { date: ins.paid_at.split('T')[0] })}
            {ins.tax_invoice_no && ` · ${t('detail.installments.taxNo', { no: ins.tax_invoice_no })}`}
          </InstSubMeta>
        )}
      </InstInfo>
      <InstDue>{ins.due_date ? ins.due_date.split('T')[0] : '—'}</InstDue>
      <InstAmt>{formatMoney(ins.amount, currency)}</InstAmt>
      <InstStatus $bg={sc.bg} $fg={sc.fg}>
        <StatusDot $color={sc.dot} />
        {t(`detail.installments.status.${ins.status}`)}
      </InstStatus>
      <InstMenuWrap>
        <InstMenuBtn type="button" onClick={() => setMenuOpen(o => !o)} aria-label="actions" disabled={busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></svg>
        </InstMenuBtn>
        {menuOpen && (
          <>
            <MenuBackdrop onClick={() => setMenuOpen(false)} />
            <Menu role="menu">
              {ins.status !== 'paid' && ins.status !== 'canceled' && (
                <MenuItem type="button" onClick={() => { setMenuOpen(false); onMarkPaid(ins.id); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {t('detail.installments.menu.markPaid')}
                </MenuItem>
              )}
              {ins.status === 'paid' && !ins.tax_invoice_no && (
                <MenuItem type="button" onClick={() => { setMenuOpen(false); onMarkTax(ins.id); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  {t('detail.installments.menu.markTax')}
                </MenuItem>
              )}
              {ins.status === 'paid' && (
                <MenuItem type="button" onClick={() => { setMenuOpen(false); onUnmarkPaid(ins.id); }}>
                  {t('detail.installments.menu.unmarkPaid')}
                </MenuItem>
              )}
              <MenuDivider />
              <MenuItem type="button" $danger onClick={() => { setMenuOpen(false); onCancel(ins.id); }}>
                {t('detail.installments.menu.cancel')}
              </MenuItem>
            </Menu>
          </>
        )}
      </InstMenuWrap>
    </InstRowWrap>
  );
}

// ─── Stepper ───
function ProgressStepper({ status }: { status: ApiInvoice['status'] }) {
  const { t } = useTranslation('qbill');
  const steps = [
    { key: 'issued', label: t('detail.progress.issued') },
    { key: 'sent', label: t('detail.progress.sent') },
    { key: 'paid', label: t('detail.progress.paid') },
  ];
  const currentIdx = status === 'draft' ? 0 :
    status === 'sent' ? 1 :
    status === 'partially_paid' ? 1 :
    status === 'paid' ? 2 :
    status === 'overdue' ? 1 :
    -1;

  return (
    <Stepper>
      {steps.map((s, i) => {
        const reached = i <= currentIdx;
        const active = i === currentIdx;
        return (
          <StepWrap key={s.key}>
            <StepNode $active={active} $reached={reached}>
              {reached ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ) : (
                i + 1
              )}
            </StepNode>
            <StepLabel $active={active} $reached={reached}>{s.label}</StepLabel>
            {i < steps.length - 1 && <StepLine $reached={i < currentIdx} />}
          </StepWrap>
        );
      })}
      {status === 'overdue' && (
        <OverdueChip>⚠ {t('detail.progress.overdue')}</OverdueChip>
      )}
    </Stepper>
  );
}

// (eventColor / formatDateTime — 활동 타임라인 백엔드 API 추가 후 재도입)

// ─── styled (세금계산서 마킹 모달) ───
const TaxModalBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 20px;
`;
const TaxModalDialog = styled.div`
  background: #fff; border-radius: 12px; max-width: 460px; width: 100%;
  display: flex; flex-direction: column; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.2);
`;
const TaxModalHead = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #F1F5F9;
`;
const TaxModalTitle = styled.h3`
  font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;
`;
const TaxModalClose = styled.button`
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer; color: #64748B; border-radius: 4px;
  &:hover { background: #F1F5F9; }
`;
const TaxModalBody = styled.div`
  padding: 18px 20px; display: flex; flex-direction: column; gap: 10px;
`;
const TaxModalDesc = styled.div`font-size: 12px; color: #64748B; line-height: 1.5;`;
const TaxModalLabel = styled.label`font-size: 11px; font-weight: 600; color: #475569;`;
const TaxModalInput = styled.input`
  width: 100%; padding: 9px 12px; font-size: 13px; color: #0F172A;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
// #77 — 발행 파일 첨부
const TaxFileRow = styled.div`display: flex; align-items: center; gap: 8px; margin-top: 4px;`;
const TaxFileBtn = styled.button`
  flex-shrink: 0; padding: 7px 12px; font-size: 12px; font-weight: 600;
  color: #334155; background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const TaxFileName = styled.span`flex: 1; min-width: 0; font-size: 12px; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const TaxFileClear = styled.button`
  flex-shrink: 0; width: 22px; height: 22px; border: none; background: transparent;
  color: #94A3B8; font-size: 16px; cursor: pointer; border-radius: 4px;
  &:hover { background: #F1F5F9; color: #EF4444; }
`;
const TaxFileHint = styled.div`font-size: 11px; color: #94A3B8; line-height: 1.5; margin-top: 4px;`;
const TaxModalFooter = styled.div`
  display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px;
  border-top: 1px solid #F1F5F9;
`;
const TaxModalPrimary = styled.button`
  padding: 8px 16px; font-size: 13px; font-weight: 700; color: #fff; background: #14B8A6;
  border: none; border-radius: 6px; cursor: pointer;
  &:hover:not(:disabled) { background: #0D9488; }
  &:disabled { background: #CBD5E1; cursor: not-allowed; }
`;
const TaxModalSecondary = styled.button`
  padding: 8px 14px; font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer;
  &:hover { background: #F8FAFC; }
`;

// ─── styled ───
const DrawerHeader = styled.div`
  flex-shrink: 0; padding: 18px 22px 14px; border-bottom: 1px solid #F1F5F9; background: #fff;
`;
const HeaderTop = styled.div`
  display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px;
`;
const NumWrap = styled.div`
  display: inline-flex; align-items: center; gap: 8px; min-width: 0;
`;
const NumBadge = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; font-weight: 700; color: #0F172A;
  background: #F1F5F9; padding: 3px 8px; border-radius: 6px;
`;
const StatusBadge = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 8px 3px 7px; font-size: 11px; font-weight: 700;
  background: ${p => p.$bg}; color: ${p => p.$fg}; border-radius: 999px;
`;
const StatusDot = styled.span<{ $color: string }>`
  width: 6px; height: 6px; border-radius: 50%; background: ${p => p.$color};
`;
const CloseBtn = styled.button`
  width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const HeaderTitle = styled.h2`
  font-size: 18px; font-weight: 700; color: #0F172A; margin: 0; letter-spacing: -0.3px;
`;
const HeaderSub = styled.div`
  font-size: 13px; color: #64748B; margin-top: 4px;
`;
const ActionRow = styled.div`
  display: flex; gap: 6px; margin-top: 14px; flex-wrap: wrap;
`;
const ActionBtn = styled.button<{ $primary?: boolean }>`
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 12px; font-size: 12px; font-weight: 600;
  background: ${p => p.$primary ? '#14B8A6' : '#fff'};
  color: ${p => p.$primary ? '#fff' : '#334155'};
  border: 1px solid ${p => p.$primary ? '#14B8A6' : '#E2E8F0'};
  border-radius: 8px; cursor: pointer;
  transition: all 0.15s;
  &:hover:not(:disabled) {
    background: ${p => p.$primary ? '#0D9488' : '#F8FAFC'};
    border-color: ${p => p.$primary ? '#0D9488' : '#CBD5E1'};
  }
  &:disabled { opacity: 0.5; cursor: default; }
`;
const RemindNote = styled.div<{ $tone: 'ok' | 'warn' }>`
  margin-top: 8px; font-size: 12px; font-weight: 600;
  color: ${p => p.$tone === 'ok' ? '#0F766E' : '#B45309'};
`;
const OverdueNotifyRow = styled.div`
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 10px; font-size: 12px; line-height: 1.5; color: #64748B;
`;
const LinkBtn = styled.button`
  background: none; border: none; padding: 0;
  font-size: 12px; font-weight: 600; color: #475569;
  text-decoration: underline; cursor: pointer;
  &:hover:not(:disabled) { color: #0F766E; }
  &:disabled { opacity: 0.5; cursor: default; }
`;
const Body = styled.div`
  flex: 1; overflow-y: auto; padding: 18px 22px 32px;
  display: flex; flex-direction: column; gap: 22px;
  background: #FAFBFC;
`;
const Stepper = styled.div`
  display: flex; align-items: center; padding: 14px 18px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  position: relative;
`;
const StepWrap = styled.div`
  display: flex; align-items: center; flex: 1; min-width: 0; position: relative;
  &:last-child { flex: 0; }
`;
const StepNode = styled.div<{ $active: boolean; $reached: boolean }>`
  width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${p => p.$reached ? '#14B8A6' : '#fff'};
  color: ${p => p.$reached ? '#fff' : '#94A3B8'};
  border: 2px solid ${p => p.$reached ? '#14B8A6' : '#E2E8F0'};
  font-size: 11px; font-weight: 700;
  ${p => p.$active && `box-shadow: 0 0 0 4px rgba(20, 184, 166, 0.15);`}
`;
const StepLabel = styled.span<{ $active: boolean; $reached: boolean }>`
  font-size: 12px; font-weight: ${p => p.$active ? 700 : 500};
  color: ${p => p.$reached ? '#0F766E' : '#94A3B8'};
  margin-left: 8px;
`;
const StepLine = styled.div<{ $reached: boolean }>`
  flex: 1; height: 2px; min-width: 24px;
  background: ${p => p.$reached ? '#14B8A6' : '#E2E8F0'}; margin: 0 10px;
`;
const OverdueChip = styled.span`
  position: absolute; right: 14px; top: 14px;
  font-size: 11px; font-weight: 700; color: #991B1B; background: #FEE2E2;
  padding: 3px 8px; border-radius: 999px;
`;
const Parties = styled.div`
  display: grid; grid-template-columns: 1fr 24px 1fr; gap: 8px; align-items: center;
  @media (max-width: 720px) { grid-template-columns: 1fr; gap: 12px; }
`;
const PartyArrow = styled.div`
  text-align: center; color: #CBD5E1; font-size: 18px; font-weight: 300;
  @media (max-width: 720px) { display: none; }
`;
const PartyCard = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px 14px;
`;
const PartyLabel = styled.div`
  font-size: 10px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.4px;
  margin-bottom: 6px; display: flex; align-items: center; gap: 6px;
`;
// 외부(미연동) 청구 배지 (운영 #11)
const ExtBadge = styled.span`
  font-size: 10px; font-weight: 700; color: #92400E; text-transform: none; letter-spacing: 0;
  background: #FEF3C7; border-radius: 999px; padding: 1px 7px;
`;
const PartyName = styled.div`
  font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 8px;
`;
const PartyMeta = styled.div`
  display: flex; flex-direction: column; gap: 4px;
`;
const MetaRow = styled.div`
  display: flex; gap: 6px; font-size: 12px;
`;
const MetaKey = styled.span`
  color: #94A3B8; min-width: 60px; flex-shrink: 0;
`;
const MetaVal = styled.span`
  color: #334155; flex: 1; min-width: 0;
`;
const Missing = styled.span`
  color: #DC2626; font-weight: 500; font-size: 11px;
`;
const Section = styled.div`
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px;
`;
const SectionTitle = styled.div`
  font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px;
  margin-bottom: 10px;
`;
const SectionTitleRow = styled.div`
  display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;
  ${SectionTitle} { margin-bottom: 0; }
`;
const SectionMeta = styled.span`
  font-size: 11px; color: #94A3B8;
`;
const ItemTable = styled.div`
  display: flex; flex-direction: column; border: 1px solid #F1F5F9; border-radius: 8px; overflow: hidden;
`;
const ItemHead = styled.div`
  display: flex; gap: 8px; padding: 8px 12px; background: #F8FAFC;
  border-bottom: 1px solid #F1F5F9;
  font-size: 11px; font-weight: 600; color: #64748B;
`;
const ItemHeadCell = styled.div`
  flex: 1; min-width: 0;
`;
const ItemRow = styled.div`
  display: flex; gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid #F1F5F9;
  font-size: 13px; color: #0F172A;
  &:last-child { border-bottom: none; }
`;
const ItemCell = styled.div`
  flex: 1; min-width: 0;
  font-variant-numeric: tabular-nums;
`;
// 항목 상세내용 (운영 #2)
const ItemDetailText = styled.div`
  margin-top: 2px; font-size: 11px; color: #94A3B8; line-height: 1.4; white-space: pre-wrap; word-break: break-word;
`;
const Summary = styled.div`
  display: flex; flex-direction: column; gap: 6px; padding-top: 12px; margin-top: 8px;
  border-top: 1px solid #F1F5F9;
`;
const SummaryRow = styled.div`
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 13px;
`;
const SumKey = styled.span`color: #64748B;`;
const SumVal = styled.span`color: #0F172A; font-variant-numeric: tabular-nums;`;
const SummaryDiv = styled.div`height: 1px; background: #F1F5F9; margin: 4px 0;`;
const InstallmentList = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const InstRowWrap = styled.div`
  display: grid; grid-template-columns: 28px minmax(0, 1fr) 80px 110px 100px 32px;
  gap: 10px; align-items: center;
  padding: 12px 12px;
  background: #F8FAFC; border: 1px solid #F1F5F9; border-radius: 8px;
  @media (max-width: 720px) {
    grid-template-columns: 28px minmax(0, 1fr) 32px;
    grid-auto-rows: auto;
  }
`;
const InstNo = styled.div`
  width: 24px; height: 24px; border-radius: 50%;
  background: #fff; color: #475569; border: 1px solid #E2E8F0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
`;
const InstInfo = styled.div`
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
`;
const InstLabel = styled.div`
  font-size: 13px; font-weight: 600; color: #0F172A;
`;
const InstMilestone = styled.div`
  font-size: 11px; color: #64748B;
`;
const InstSubMeta = styled.div`
  font-size: 11px; color: #166534; margin-top: 2px;
`;
const InstDue = styled.div`
  font-size: 12px; color: #475569; font-variant-numeric: tabular-nums;
`;
const InstAmt = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A; text-align: right;
  font-variant-numeric: tabular-nums;
`;
const InstStatus = styled.span<{ $bg: string; $fg: string }>`
  display: inline-flex; align-items: center; gap: 4px; justify-content: center;
  padding: 3px 8px; font-size: 11px; font-weight: 700;
  background: ${p => p.$bg}; color: ${p => p.$fg}; border-radius: 999px;
`;
const InstMenuWrap = styled.div`
  position: relative;
`;
const InstMenuBtn = styled.button`
  width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid transparent; border-radius: 6px; cursor: pointer; color: #64748B;
  &:hover { background: #fff; border-color: #E2E8F0; color: #0F172A; }
`;
const MenuBackdrop = styled.div`
  position: fixed; inset: 0; z-index: 1000;
`;
const Menu = styled.div`
  position: absolute; right: 0; top: 32px; z-index: 51;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);
  min-width: 180px; padding: 4px; display: flex; flex-direction: column; gap: 1px;
`;
const MenuItem = styled.button<{ $danger?: boolean }>`
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 10px; font-size: 12px; font-weight: 500;
  color: ${p => p.$danger ? '#DC2626' : '#334155'};
  background: transparent; border: none; border-radius: 6px; cursor: pointer; text-align: left;
  &:hover { background: ${p => p.$danger ? '#FEF2F2' : '#F8FAFC'}; }
`;
const MenuDivider = styled.div`
  height: 1px; background: #F1F5F9; margin: 4px 0;
`;
const BankCard = styled.div`
  display: flex; flex-direction: column; gap: 6px;
`;
const BankRow = styled.div`
  display: flex; gap: 10px; padding: 4px 0;
  font-size: 12px;
`;
const BankKey = styled.span`
  color: #94A3B8; min-width: 60px; flex-shrink: 0;
`;
const BankVal = styled.span`
  color: #0F172A; font-weight: 500;
`;
const BankValRow = styled.span`
  display: inline-flex; gap: 8px; align-items: center;
`;
const CopyChip = styled.button`
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #14B8A6;
  padding: 2px 8px; border-radius: 999px; cursor: pointer; white-space: nowrap;
  &:hover { background: #14B8A6; color: #fff; }
`;
// ─── 증빙 — 고객 확인 정보 + 발행 마킹 ───
const ReceiptInfoBox = styled.div`
  margin-bottom: 8px; padding: 12px 14px; background: #F8FAFC;
  border: 1px solid #E2E8F0; border-radius: 10px;
`;
const ReceiptInfoHead = styled.div`
  font-size: 11px; font-weight: 700; color: #475569; margin-bottom: 8px;
`;
const ReceiptRow = styled.div`
  display: flex; justify-content: space-between; gap: 12px; padding: 3px 0;
  font-size: 12px;
  span { color: #94A3B8; flex-shrink: 0; }
  b { color: #334155; font-weight: 600; text-align: right; word-break: break-all; }
`;
const ReceiptMarkRow = styled.div`display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;`;
const ReceiptMarkBtn = styled.button`
  flex: 1; min-width: 140px; min-height: 40px; padding: 9px 12px;
  font-size: 12px; font-weight: 600; color: #0F766E;
  background: #FFF; border: 1.5px solid #0D9488; border-radius: 8px; cursor: pointer;
  &:hover { background: #F0FDFA; }
`;
const CorrHistory = styled.div`
  margin-top: 12px; padding: 12px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 10px;
  display: flex; flex-direction: column; gap: 8px;
`;
const CorrHistTitle = styled.div`font-size: 11px; font-weight: 700; color: #991B1B; text-transform: uppercase; letter-spacing: 0.4px;`;
const CorrItem = styled.div`display: flex; flex-direction: column; gap: 2px; padding-bottom: 8px; border-bottom: 1px solid #FECACA; &:last-child { border-bottom: none; padding-bottom: 0; }`;
const CorrTop = styled.div`display: flex; justify-content: space-between; align-items: baseline; gap: 8px;`;
const CorrReason = styled.span`font-size: 12px; font-weight: 600; color: #0F172A;`;
const CorrNo = styled.span`font-size: 12px; font-weight: 700; color: #991B1B; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;`;
const CorrMeta = styled.div`font-size: 11px; color: #B91C1C;`;

// 상태 변경 이력 타임라인 (기본 히스토리)
const StatusHistList = styled.div`display: flex; flex-direction: column; gap: 12px;`;
const StatusHistRow = styled.div`display: flex; gap: 10px; align-items: flex-start;`;
const StatusHistDot = styled.div`
  width: 8px; height: 8px; border-radius: 999px; background: #14B8A6; margin-top: 5px; flex-shrink: 0;
`;
const StatusHistBody = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const StatusHistMain = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const StatusHistChip = styled.span<{ $to?: boolean }>`
  font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  background: ${p => (p.$to ? '#F0FDFA' : '#F1F5F9')};
  color: ${p => (p.$to ? '#0F766E' : '#64748B')};
`;
const StatusHistArrow = styled.span`font-size: 12px; color: #94A3B8;`;
const StatusHistMeta = styled.div`font-size: 11px; color: #94A3B8;`;

// Q Bill 이벤트 타임라인 (생애주기) — 좌측 점 + 세로 연결선
const TlList = styled.div`display: flex; flex-direction: column;`;
const TlRow = styled.div`
  display: flex; gap: 10px; align-items: flex-start; position: relative; padding-bottom: 12px;
  &:not(:last-child)::before { content: ''; position: absolute; left: 3.5px; top: 12px; bottom: 0; width: 1px; background: #E2E8F0; }
  &:last-child { padding-bottom: 0; }
`;
const TlDot = styled.div<{ $c: string }>`
  width: 8px; height: 8px; border-radius: 999px; background: ${p => p.$c}; margin-top: 4px; flex-shrink: 0; z-index: 1;
`;
const TlBody = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const TlMain = styled.div`display: flex; align-items: center; gap: 6px; flex-wrap: wrap;`;
const TlLabel = styled.span`font-size: 13px; font-weight: 600; color: #0F172A;`;
const TlSuffix = styled.span`font-size: 12px; color: #64748B;`;
const TlDest = styled.div`font-size: 12px; color: #0F766E; font-weight: 600; margin-top: 2px; word-break: break-all;`;
const TlMeta = styled.div`font-size: 11px; color: #94A3B8;`;
const PayerHint = styled.div`
  margin-top: 8px; padding: 10px 12px;
  background: #FEF3C7; border-radius: 8px;
  border: 1px dashed #F59E0B;
`;
const PayerHintTitle = styled.div`
  font-size: 11px; font-weight: 700; color: #92400E; margin-bottom: 6px;
`;
const PayerCode = styled.div`
  display: flex; align-items: center; gap: 8px; justify-content: space-between;
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px; color: #0F172A; font-weight: 600;
    background: #fff; padding: 4px 8px; border-radius: 4px;
    border: 1px solid #FDE68A;
  }
`;
const TaxBox = styled.div<{ $status: string }>`
  display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  background: ${p => p.$status === 'issued' ? '#F0FDF4' : p.$status === 'required' ? '#FEF3C7' : '#F8FAFC'};
  border: 1px solid ${p => p.$status === 'issued' ? '#86EFAC' : p.$status === 'required' ? '#FDE68A' : '#E2E8F0'};
  border-radius: 10px;
`;
const TaxIcon = styled.div<{ $status: string }>`
  width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700;
  background: ${p => p.$status === 'issued' ? '#22C55E' : p.$status === 'required' ? '#F59E0B' : '#CBD5E1'};
  color: #fff;
`;
const TaxBody = styled.div`
  flex: 1; min-width: 0;
`;
const TaxLabel = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
`;
const TaxDesc = styled.div`
  font-size: 11px; color: #64748B; margin-top: 2px;
`;

// 출처 카드
const SourceCard = styled.div`
  display: flex; gap: 12px; align-items: center; justify-content: space-between;
  padding: 12px 14px; background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 10px;
`;
const SourceLeft = styled.div`display: flex; gap: 10px; align-items: center; min-width: 0; flex: 1;`;
const SourceKindBadge = styled.span<{ $kind: string }>`
  font-size: 10px; font-weight: 700; flex-shrink: 0;
  padding: 3px 8px; border-radius: 4px;
  background: ${p =>
    p.$kind === 'contract' ? '#FEF3C7' :
    p.$kind === 'quote' ? '#E0F2FE' :
    p.$kind === 'sow' ? '#F0FDFA' :
    '#FEE2E2'};
  color: ${p =>
    p.$kind === 'contract' ? '#92400E' :
    p.$kind === 'quote' ? '#0284C7' :
    p.$kind === 'sow' ? '#6B21A8' :
    '#991B1B'};
`;
const SourceText = styled.div`display: flex; flex-direction: column; gap: 2px; min-width: 0;`;
const SourceTitle = styled.div`
  font-size: 13px; font-weight: 700; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const SourceMeta = styled.div`font-size: 11px; color: #64748B;`;
const SourceLink = styled.a`
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 700; color: #0F766E;
  background: #fff; border: 1px solid #14B8A6; padding: 6px 12px; border-radius: 6px;
  text-decoration: none; flex-shrink: 0;
  &:hover { background: #14B8A6; color: #fff; }
`;
