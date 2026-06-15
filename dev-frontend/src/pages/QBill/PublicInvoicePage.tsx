// 공개 결제 페이지 — share_token 기반 (인증 없음)
// 라우트: /public/invoices/:token
// 기능: 청구서 본문 + 입금 안내 + 입금자명 가이드 + 송금 완료 알림 보내기
import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import ExpiredShareLink from '../../components/Common/ExpiredShareLink';
import { apiFetch, getAccessToken } from '../../contexts/AuthContext';

interface Installment {
  id: number;
  installment_no: number;
  label: string;
  percent: number;
  amount: number;
  due_date: string | null;
  status: 'pending' | 'sent' | 'paid' | 'overdue' | 'canceled';
  paid_at: string | null;
  notify_paid_at: string | null;
  notify_payer_name: string | null;
}

interface PublicInvoice {
  id: number;
  invoice_number: string;
  title: string;
  status: 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'canceled';
  installment_mode: 'single' | 'split';
  grand_total: number;
  paid_amount: number;
  currency: string;
  issued_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  payment_terms: string | null;
  notify_paid_at: string | null;
  notify_payer_name: string | null;
  items: Array<{ id: number; description: string; detail?: string | null; quantity: number; unit_price: number; amount: number }>;
  installments: Installment[];
  client: { display_name?: string; company_name?: string; biz_name?: string } | null;
  recipient_business_name?: string | null;
  sender: {
    name?: string;
    biz_name?: string;
    biz_name_en?: string;
    biz_ceo?: string;
    bank_name?: string;
    bank_account_number?: string;
    bank_account_name?: string;
    // 외화 청구서 노출용
    swift_code?: string;
    bank_name_en?: string;
    bank_account_name_en?: string;
  } | null;
  source_post: { id: number; category: string; title: string; share_token: string | null } | null;
  receipt?: {
    payment_method: 'bank_transfer' | 'card' | 'other';
    receipt_type: 'none' | 'tax_invoice' | 'cash_receipt';
    tax_invoice_status: 'none' | 'pending' | 'issued' | 'failed' | 'canceled';
    cash_receipt_status: 'none' | 'pending' | 'issued' | 'failed' | 'canceled';
    requested_at: string | null;
    profile: ReceiptProfile | null;
    is_registered_client: boolean;
    client_country: string | null;
  };
}

interface ReceiptProfile {
  biz_type?: 'business' | 'individual';
  biz_name?: string | null;
  biz_tax_id?: string | null;
  biz_ceo?: string | null;
  biz_category?: string | null;
  biz_item?: string | null;
  biz_address?: string | null;
  tax_email?: string | null;
  cr_purpose?: 'income_deduction' | 'expense_proof';
  cr_identifier?: string | null;
  requested_by_name?: string | null;
  contact_phone?: string | null;
}

function formatMoney(amount: number, currency: string = 'KRW'): string {
  if (currency === 'KRW') return Number(amount).toLocaleString('ko-KR') + '원';
  if (currency === 'USD') return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === 'EUR') return '€' + Number(amount).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${Number(amount).toLocaleString()}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  // 한국어 표기 YYYY/M/D — locale/timezone 의존 없이 날짜 문자열 직접 파싱 (M/D/YYYY 역전 방지)
  const ymd = String(iso).slice(0, 10).split('-');
  if (ymd.length === 3 && ymd[0].length === 4) return `${ymd[0]}/${Number(ymd[1])}/${Number(ymd[2])}`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

const PublicInvoicePage: React.FC = () => {
  const { t } = useTranslation('qbill');
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<PublicInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // N+44 — 410 share_expired 분기
  const [expired, setExpired] = useState<{ at: string | null } | null>(null);

  // 알림 모달
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTarget, setNotifyTarget] = useState<Installment | null>(null);
  const [payerName, setPayerName] = useState('');
  const [payerMemo, setPayerMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copyHit, setCopyHit] = useState<string | null>(null);

  // 증빙(세금계산서/현금영수증) 신청 모달
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [rcBizType, setRcBizType] = useState<'business' | 'individual'>('business');
  const [rcForm, setRcForm] = useState({
    biz_name: '', biz_tax_id: '', biz_ceo: '', biz_category: '', biz_item: '', biz_address: '', tax_email: '',
    cr_purpose: 'income_deduction' as 'income_deduction' | 'expense_proof', cr_identifier: '', requested_by_name: '', contact_phone: '',
  });
  const [rcSubmitting, setRcSubmitting] = useState(false);
  const [rcErr, setRcErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await fetch(`/api/invoices/public/${token}`);
        const j = await r.json().catch(() => ({}));
        if (r.status === 410 && j.code === 'share_expired') {
          setExpired({ at: j.expired_at || null });
        } else if (!j.success) {
          throw new Error(j.message || 'load_failed');
        } else {
          setInvoice(j.data);
        }
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // N+47 — Smart Routing. PlanQ 로그인된 사용자면 in-app 으로 자동 redirect.
  useEffect(() => {
    if (!token || !invoice) return;
    if (!getAccessToken()) return;
    apiFetch(`/api/invoices/public/${token}/auth-check`)
      .then(r => r.json())
      .then(j => {
        if (j.success && j.data?.canAccess && j.data?.appUrl) {
          setTimeout(() => navigate(j.data.appUrl), 300);
        }
      })
      .catch(() => { /* silent */ });
  }, [token, invoice, navigate]);

  // 모달 열림 동안 body scroll lock + Esc 닫기
  useEffect(() => {
    if (!notifyOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNotifyOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener('keydown', onKey);
    };
  }, [notifyOpen]);

  const isSplit = invoice?.installment_mode === 'split';
  const targetable = useMemo(() => {
    if (!invoice) return [];
    if (!isSplit) return [];
    return invoice.installments.filter(i => i.status !== 'paid' && i.status !== 'canceled');
  }, [invoice, isSplit]);

  const recipientLine = useMemo(() => {
    const c = invoice?.client;
    return (c && (c.biz_name || c.company_name || c.display_name)) || invoice?.recipient_business_name || '';
  }, [invoice]);

  const senderName = useMemo(() => {
    const s = invoice?.sender;
    if (!s) return '';
    return s.biz_name || s.name || '';
  }, [invoice]);

  const payerGuide = useMemo(() => {
    if (!invoice) return '';
    const num = invoice.invoice_number;
    const recip = recipientLine || '';
    if (notifyTarget) return `${num} ${recip} ${notifyTarget.label}`.replace(/\s+/g, ' ').trim();
    return `${num} ${recip}`.replace(/\s+/g, ' ').trim();
  }, [invoice, recipientLine, notifyTarget]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyHit(key);
      setTimeout(() => setCopyHit(null), 1500);
    } catch {}
  };

  const openNotify = (inst: Installment | null) => {
    setNotifyTarget(inst);
    setPayerName('');
    setPayerMemo('');
    setNotifyOpen(true);
  };

  const openReceipt = () => {
    const p = invoice?.receipt?.profile;
    setRcBizType(p?.biz_type === 'individual' ? 'individual' : 'business');
    setRcForm({
      biz_name: p?.biz_name || invoice?.receipt?.profile?.biz_name || '',
      biz_tax_id: p?.biz_tax_id || '',
      biz_ceo: p?.biz_ceo || '',
      biz_category: p?.biz_category || '',
      biz_item: p?.biz_item || '',
      biz_address: p?.biz_address || '',
      tax_email: p?.tax_email || '',
      cr_purpose: p?.cr_purpose === 'expense_proof' ? 'expense_proof' : 'income_deduction',
      cr_identifier: p?.cr_identifier || '',
      requested_by_name: p?.requested_by_name || '',
      contact_phone: p?.contact_phone || '',
    });
    setRcErr(null);
    setReceiptOpen(true);
  };

  const submitReceipt = async () => {
    if (!token || rcSubmitting) return;
    setRcErr(null);
    if (rcBizType === 'business') {
      if (rcForm.biz_tax_id.replace(/[^0-9]/g, '').length !== 10) { setRcErr(t('public.receipt.errBizTaxId', '사업자등록번호 10자리를 정확히 입력해주세요') as string); return; }
      if (!rcForm.biz_name.trim()) { setRcErr(t('public.receipt.errBizName', '상호를 입력해주세요') as string); return; }
    } else {
      if (rcForm.cr_identifier.replace(/[^0-9]/g, '').length < 8) { setRcErr(t('public.receipt.errCrId', '휴대폰번호 또는 사업자번호를 정확히 입력해주세요') as string); return; }
    }
    setRcSubmitting(true);
    try {
      const body = rcBizType === 'business'
        ? { biz_type: 'business', biz_name: rcForm.biz_name, biz_tax_id: rcForm.biz_tax_id, biz_ceo: rcForm.biz_ceo, biz_category: rcForm.biz_category, biz_item: rcForm.biz_item, biz_address: rcForm.biz_address, tax_email: rcForm.tax_email, requested_by_name: rcForm.requested_by_name, contact_phone: rcForm.contact_phone }
        : { biz_type: 'individual', cr_purpose: rcForm.cr_purpose, cr_identifier: rcForm.cr_identifier, requested_by_name: rcForm.requested_by_name, contact_phone: rcForm.contact_phone };
      const r = await fetch(`/api/invoices/public/${token}/receipt-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'receipt_failed');
      const r2 = await fetch(`/api/invoices/public/${token}`);
      const j2 = await r2.json();
      if (j2.success) setInvoice(j2.data);
      setReceiptOpen(false);
    } catch (e) {
      setRcErr((e as Error).message);
    } finally {
      setRcSubmitting(false);
    }
  };

  const sendNotify = async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/invoices/public/${token}/notify-paid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installment_id: notifyTarget?.id || null,
          payer_name: payerName.trim() || null,
          payer_memo: payerMemo.trim() || null,
        }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.message || 'notify_failed');
      // 응답 후 invoice 다시 로드
      const r2 = await fetch(`/api/invoices/public/${token}`);
      const j2 = await r2.json();
      if (j2.success) setInvoice(j2.data);
      setNotifyOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Center>{t('public.loading', '청구서 로드 중...')}</Center>;
  if (expired) return <ExpiredShareLink expiredAt={expired.at} />;
  if (err || !invoice) return <Center>{err || t('public.notFound', '공개되지 않았거나 만료된 링크입니다')}</Center>;

  const isFullyPaid = invoice.status === 'paid';
  const isCanceled = invoice.status === 'canceled';

  return (
    <Page>
      <Toolbar>
        <Brand src="/planQ-slogan_color.svg" alt="PlanQ" />
        <ToolbarSpacer />
        <PrintBtn type="button" onClick={() => window.open(`/api/invoices/public/${token}/pdf`, '_blank')}>{t('public.downloadPdf', 'PDF 다운로드')}</PrintBtn>
      </Toolbar>

      <Frame>
        {/* 헤더 */}
        <Header>
          <Title>{t('public.headline', '결제 요청')}</Title>
          <Meta>
            {senderName}{recipientLine && <> <Arrow>›</Arrow> {recipientLine}</>}
          </Meta>
        </Header>

        {/* 청구서 카드 */}
        <Card>
          <CardTitle>{invoice.title}</CardTitle>
          <CardNumber>{invoice.invoice_number}</CardNumber>
          {!isSplit && (
            <Total>{formatMoney(Number(invoice.grand_total), invoice.currency)}</Total>
          )}
          {!isSplit && invoice.due_date && (
            <DueRow>{t('public.due', '기한')}: {formatDate(invoice.due_date)}</DueRow>
          )}

          {/* 분할 회차 표 */}
          {isSplit && (
            <InstallList>
              {invoice.installments.map(inst => {
                const paid = inst.status === 'paid';
                const canceled = inst.status === 'canceled';
                const notified = !!inst.notify_paid_at && !paid;
                return (
                  <InstallRow key={inst.id} $paid={paid} $canceled={canceled}>
                    <InstallLeft>
                      <InstallLabel>{inst.label}</InstallLabel>
                      <InstallSub>
                        {inst.installment_no}/{invoice.installments.length} · {Number(inst.percent).toFixed(1)}%
                        {inst.due_date && <> · {t('public.due', '기한')}: {formatDate(inst.due_date)}</>}
                      </InstallSub>
                    </InstallLeft>
                    <InstallRight>
                      <InstallAmt $paid={paid}>{formatMoney(Number(inst.amount), invoice.currency)}</InstallAmt>
                      <InstallStatus $paid={paid} $notified={notified} $canceled={canceled}>
                        {paid && t('public.statusPaid', '결제 완료')}
                        {canceled && t('public.statusCanceled', '취소됨')}
                        {notified && t('public.statusNotified', '입금 알림 받음')}
                        {!paid && !canceled && !notified && t('public.statusPending', '결제 대기')}
                      </InstallStatus>
                      {!paid && !canceled && (
                        <NotifyBtnSm
                          type="button"
                          disabled={isFullyPaid || isCanceled}
                          onClick={() => openNotify(inst)}
                        >
                          {t('public.notifyForThis', '이 회차 입금 알림')}
                        </NotifyBtnSm>
                      )}
                    </InstallRight>
                  </InstallRow>
                );
              })}
            </InstallList>
          )}
        </Card>

        {/* 입금 안내 */}
        {invoice.sender?.bank_name && (
          <Section>
            <SectionTitle>{t('public.bankInfo', '입금 안내')}</SectionTitle>
            <BankCard>
              <BankRow>
                <BankLabel>{t('public.bank', '은행')}</BankLabel>
                <BankValue>{invoice.sender.bank_name}</BankValue>
              </BankRow>
              <BankRow>
                <BankLabel>{t('public.account', '계좌번호')}</BankLabel>
                <BankValueRow>
                  <BankValueMono>{invoice.sender.bank_account_number || '—'}</BankValueMono>
                  {invoice.sender.bank_account_number && (
                    <CopyBtn type="button" onClick={() => copy(invoice.sender!.bank_account_number || '', 'acct')}>
                      {copyHit === 'acct' ? t('public.copied', '복사됨') : t('public.copy', '복사')}
                    </CopyBtn>
                  )}
                </BankValueRow>
              </BankRow>
              <BankRow>
                <BankLabel>{t('public.holder', '예금주')}</BankLabel>
                <BankValue>{invoice.sender.bank_account_name || invoice.sender.biz_name || invoice.sender.name || '—'}</BankValue>
              </BankRow>
              {/* 외화 청구서 — SWIFT + 영문 정보 자동 노출 */}
              {invoice.currency !== 'KRW' && (invoice.sender.swift_code || invoice.sender.bank_name_en || invoice.sender.bank_account_name_en) && (
                <>
                  <BankDivider />
                  {invoice.sender.swift_code && (
                    <BankRow>
                      <BankLabel>{t('public.swift', 'SWIFT')}</BankLabel>
                      <BankValueRow>
                        <BankValueMono>{invoice.sender.swift_code}</BankValueMono>
                        <CopyBtn type="button" onClick={() => copy(invoice.sender!.swift_code || '', 'swift')}>
                          {copyHit === 'swift' ? t('public.copied', '복사됨') : t('public.copy', '복사')}
                        </CopyBtn>
                      </BankValueRow>
                    </BankRow>
                  )}
                  {invoice.sender.bank_name_en && (
                    <BankRow>
                      <BankLabel>{t('public.bankEn', 'Bank (EN)')}</BankLabel>
                      <BankValue>{invoice.sender.bank_name_en}</BankValue>
                    </BankRow>
                  )}
                  {invoice.sender.bank_account_name_en && (
                    <BankRow>
                      <BankLabel>{t('public.holderEn', 'Holder (EN)')}</BankLabel>
                      <BankValue>{invoice.sender.bank_account_name_en}</BankValue>
                    </BankRow>
                  )}
                </>
              )}
            </BankCard>
          </Section>
        )}

        {/* 입금자명 가이드 */}
        <Section>
          <SectionTitle>{t('public.payerGuideTitle', '입금자명 가이드')}</SectionTitle>
          <SectionDesc>{t('public.payerGuideDesc', '입금 시 입금자명에 다음을 기재해주세요')}</SectionDesc>
          <PayerGuideRow>
            <PayerGuideMono>{payerGuide || invoice.invoice_number}</PayerGuideMono>
            <CopyBtn type="button" onClick={() => copy(payerGuide || invoice.invoice_number, 'payer')}>
              {copyHit === 'payer' ? t('public.copied', '복사됨') : t('public.copy', '복사')}
            </CopyBtn>
          </PayerGuideRow>
        </Section>

        {/* 메모 */}
        {invoice.notes && (
          <Section>
            <SectionTitle>{t('public.note', '메모')}</SectionTitle>
            <Memo>{invoice.notes}</Memo>
          </Section>
        )}

        {/* 송금 완료 알림 (단일 발행 또는 분할 일괄) */}
        {!isSplit && !isFullyPaid && !isCanceled && (
          <NotifyArea>
            {invoice.notify_paid_at ? (
              <NotifyDoneBox>
                <DoneIcon>✓</DoneIcon>
                <NotifyDoneText>
                  <NotifyDoneTitle>{t('public.notifySent', '송금 완료 알림을 보냈습니다')}</NotifyDoneTitle>
                  <NotifyDoneSub>{new Date(invoice.notify_paid_at).toLocaleString()} · {t('public.waitingConfirm', '발행자 확인 대기 중')}</NotifyDoneSub>
                </NotifyDoneText>
              </NotifyDoneBox>
            ) : (
              <NotifyBtn type="button" onClick={() => openNotify(null)}>
                {t('public.notifyButton', '송금 완료 알림 보내기')}
              </NotifyBtn>
            )}
            <NotifyHint>{t('public.notifyHint', '버튼을 누르면 발행자에게 알림이 전송됩니다.')}</NotifyHint>
          </NotifyArea>
        )}

        {/* 증빙 신청 (세금계산서 / 현금영수증) — 고객이 직접 정보 입력·확인 */}
        {!isCanceled && invoice.receipt && (() => {
          const rc = invoice.receipt;
          const taxIssued = rc.tax_invoice_status === 'issued';
          const cashIssued = rc.cash_receipt_status === 'issued';
          // 고객이 실제로 증빙정보를 제출했을 때만 "제출함" 표시 — 발행자가 토글만 켠 상태(status=pending)와 구분.
          const submitted = !!rc.requested_at;
          const issuedLabel = taxIssued
            ? t('public.receipt.taxIssued', '세금계산서가 발행되었습니다')
            : t('public.receipt.cashIssued', '현금영수증이 발행되었습니다');
          return (
            <Section>
              <SectionTitle>{t('public.receipt.title', '증빙 발행 (세금계산서 · 현금영수증)')}</SectionTitle>
              {(taxIssued || cashIssued) ? (
                <NotifyDoneBox>
                  <DoneIcon>✓</DoneIcon>
                  <NotifyDoneText>
                    <NotifyDoneTitle>{issuedLabel as string}</NotifyDoneTitle>
                    <NotifyDoneSub>{t('public.receipt.issuedSub', '등록하신 정보로 발행 완료되었습니다.')}</NotifyDoneSub>
                  </NotifyDoneText>
                </NotifyDoneBox>
              ) : submitted ? (
                <>
                  <NotifyDoneBox>
                    <DoneIcon>✓</DoneIcon>
                    <NotifyDoneText>
                      <NotifyDoneTitle>{t('public.receipt.requested', '증빙 발행 정보를 제출했습니다')}</NotifyDoneTitle>
                      <NotifyDoneSub>{t('public.receipt.requestedSub', '발행자가 확인 후 발행합니다.')}</NotifyDoneSub>
                    </NotifyDoneText>
                  </NotifyDoneBox>
                  <NotifyHint as="button" type="button" onClick={openReceipt} style={{ cursor: 'pointer', background: 'none', border: 'none' }}>
                    {t('public.receipt.editInfo', '입력 정보 수정하기')}
                  </NotifyHint>
                </>
              ) : (
                <>
                  <SectionDesc>{t('public.receipt.desc', '세금계산서(사업자) 또는 현금영수증(개인) 발행을 원하시면 정보를 입력·확인해주세요. 발행자가 확인 후 발행합니다.')}</SectionDesc>
                  <NotifyBtn type="button" onClick={openReceipt}>
                    {t('public.receipt.button', '세금계산서 · 현금영수증 신청')}
                  </NotifyBtn>
                </>
              )}
            </Section>
          );
        })()}

        {isFullyPaid && (
          <PaidBanner>
            <DoneIcon>✓</DoneIcon>
            {t('public.fullyPaid', '결제가 완료된 청구서입니다')}
            {invoice.paid_at && <> · {new Date(invoice.paid_at).toLocaleDateString()}</>}
          </PaidBanner>
        )}

        {invoice.payment_terms && (
          <Section>
            <SectionTitle>{t('public.paymentTerms', '결제 조건')}</SectionTitle>
            <Memo>{invoice.payment_terms}</Memo>
          </Section>
        )}

        <Footer>
          <FooterText>{t('public.footer', '이 페이지는 PlanQ 를 통해 제공됩니다.')}</FooterText>
          <FooterContact href="/contact" target="_blank" rel="noopener noreferrer">
            {t('public.contact', '문의하기')}
          </FooterContact>
        </Footer>
      </Frame>

      {/* 알림 모달 */}
      {notifyOpen && (
        <ModalBackdrop onClick={() => setNotifyOpen(false)}>
          <ModalBox
            role="dialog"
            aria-modal="true"
            aria-labelledby="phaseC-notify-title"
            onClick={e => e.stopPropagation()}
          >
            <ModalHead>
              <ModalTitle id="phaseC-notify-title">{t('public.modalTitle', '송금 완료 알림 보내기')}</ModalTitle>
              <ModalClose type="button" onClick={() => setNotifyOpen(false)} aria-label={t('common.close', '닫기')}>×</ModalClose>
            </ModalHead>
            <ModalBody>
              {notifyTarget && (
                <ModalLine>
                  <strong>{notifyTarget.label}</strong> · {formatMoney(Number(notifyTarget.amount), invoice.currency)}
                </ModalLine>
              )}
              <ModalLine $muted>{t('public.modalDesc', '입금자명을 알려주시면 발행자가 더 빨리 확인할 수 있습니다.')}</ModalLine>
              <FormField>
                <FormLabel>{t('public.payerName', '입금자명')} <FormHint>({t('public.optional', '선택')})</FormHint></FormLabel>
                <FormInput
                  type="text"
                  value={payerName}
                  onChange={e => setPayerName(e.target.value)}
                  placeholder={recipientLine}
                  maxLength={80}
                />
              </FormField>
              <FormField>
                <FormLabel>{t('public.payerMemo', '메모')} <FormHint>({t('public.optional', '선택')})</FormHint></FormLabel>
                <FormTextarea
                  value={payerMemo}
                  onChange={e => setPayerMemo(e.target.value)}
                  rows={3}
                  maxLength={200}
                  placeholder={t('public.memoPlaceholder', '예: 우리은행에서 송금했습니다.')}
                />
              </FormField>
            </ModalBody>
            <ModalFoot>
              <ModalCancelBtn type="button" onClick={() => setNotifyOpen(false)}>{t('common.cancel', '취소')}</ModalCancelBtn>
              <ModalSendBtn type="button" disabled={submitting} onClick={sendNotify}>
                {submitting ? t('public.sending', '전송 중...') : t('public.send', '알림 보내기')}
              </ModalSendBtn>
            </ModalFoot>
          </ModalBox>
        </ModalBackdrop>
      )}

      {targetable.length > 0 && !notifyOpen && (
        // 분할의 경우 카드 안에 회차별 버튼이 있으므로 페이지 하단에는 노출 X
        null
      )}

      {/* 증빙 신청 모달 */}
      {receiptOpen && (
        <ModalBackdrop onClick={() => setReceiptOpen(false)}>
          <ModalBox role="dialog" aria-modal="true" aria-labelledby="receipt-title" onClick={e => e.stopPropagation()}>
            <ModalHead>
              <ModalTitle id="receipt-title">{t('public.receipt.modalTitle', '증빙 발행 신청')}</ModalTitle>
              <ModalClose type="button" onClick={() => setReceiptOpen(false)} aria-label={t('common.close', '닫기') as string}>×</ModalClose>
            </ModalHead>
            <ModalBody>
              <ModalLine $muted>{t('public.receipt.modalDesc', '발행 유형을 선택하고 정보를 정확히 입력해주세요. 입력하신 정보 그대로 발행됩니다.')}</ModalLine>
              <RcAmountBox>
                <span>{t('public.receipt.requestAmount', '신청 금액')}</span>
                <strong>{formatMoney(invoice.grand_total, invoice.currency)} <em>({t('public.receipt.vatIncluded', 'VAT 포함')})</em></strong>
              </RcAmountBox>
              <RcToggleRow>
                <RcToggleBtn type="button" $active={rcBizType === 'business'} onClick={() => setRcBizType('business')}>
                  {t('public.receipt.typeBusiness', '사업자 · 세금계산서')}
                </RcToggleBtn>
                <RcToggleBtn type="button" $active={rcBizType === 'individual'} onClick={() => setRcBizType('individual')}>
                  {t('public.receipt.typeIndividual', '개인 · 현금영수증')}
                </RcToggleBtn>
              </RcToggleRow>

              {rcBizType === 'business' ? (
                <>
                  <FormField>
                    <FormLabel>{t('public.receipt.bizTaxId', '사업자등록번호')}</FormLabel>
                    <FormInput type="text" inputMode="numeric" value={rcForm.biz_tax_id} maxLength={12}
                      onChange={e => setRcForm(f => ({ ...f, biz_tax_id: e.target.value }))} placeholder="123-45-67890" />
                  </FormField>
                  <FormField>
                    <FormLabel>{t('public.receipt.bizName', '상호 (사업자명)')}</FormLabel>
                    <FormInput type="text" value={rcForm.biz_name} maxLength={200}
                      onChange={e => setRcForm(f => ({ ...f, biz_name: e.target.value }))} />
                  </FormField>
                  <FormField>
                    <FormLabel>{t('public.receipt.bizCeo', '대표자')} <FormHint>({t('public.optional', '선택')})</FormHint></FormLabel>
                    <FormInput type="text" value={rcForm.biz_ceo} maxLength={100}
                      onChange={e => setRcForm(f => ({ ...f, biz_ceo: e.target.value }))} />
                  </FormField>
                  <RcTwoCol>
                    <FormField>
                      <FormLabel>{t('public.receipt.bizCategory', '업태')} <FormHint>({t('public.optional', '선택')})</FormHint></FormLabel>
                      <FormInput type="text" value={rcForm.biz_category} maxLength={100}
                        onChange={e => setRcForm(f => ({ ...f, biz_category: e.target.value }))} />
                    </FormField>
                    <FormField>
                      <FormLabel>{t('public.receipt.bizItem', '종목')} <FormHint>({t('public.optional', '선택')})</FormHint></FormLabel>
                      <FormInput type="text" value={rcForm.biz_item} maxLength={100}
                        onChange={e => setRcForm(f => ({ ...f, biz_item: e.target.value }))} />
                    </FormField>
                  </RcTwoCol>
                  <FormField>
                    <FormLabel>{t('public.receipt.bizAddress', '사업장 주소')} <FormHint>({t('public.optional', '선택')})</FormHint></FormLabel>
                    <FormInput type="text" value={rcForm.biz_address} maxLength={500}
                      onChange={e => setRcForm(f => ({ ...f, biz_address: e.target.value }))} />
                  </FormField>
                  <FormField>
                    <FormLabel>{t('public.receipt.taxEmail', '세금계산서 수취 이메일')} <FormHint>({t('public.optional', '선택')})</FormHint></FormLabel>
                    <FormInput type="email" value={rcForm.tax_email} maxLength={200}
                      onChange={e => setRcForm(f => ({ ...f, tax_email: e.target.value }))} placeholder="tax@company.com" />
                  </FormField>
                </>
              ) : (
                <>
                  <FormField>
                    <FormLabel>{t('public.receipt.crPurpose', '발급 용도')}</FormLabel>
                    <RcToggleRow>
                      <RcToggleBtn type="button" $active={rcForm.cr_purpose === 'income_deduction'} onClick={() => setRcForm(f => ({ ...f, cr_purpose: 'income_deduction' }))}>
                        {t('public.receipt.crIncome', '소득공제')}
                      </RcToggleBtn>
                      <RcToggleBtn type="button" $active={rcForm.cr_purpose === 'expense_proof'} onClick={() => setRcForm(f => ({ ...f, cr_purpose: 'expense_proof' }))}>
                        {t('public.receipt.crExpense', '지출증빙')}
                      </RcToggleBtn>
                    </RcToggleRow>
                  </FormField>
                  <FormField>
                    <FormLabel>{rcForm.cr_purpose === 'expense_proof' ? t('public.receipt.crIdBiz', '사업자번호') : t('public.receipt.crIdPhone', '휴대폰번호')}</FormLabel>
                    <FormInput type="text" inputMode="numeric" value={rcForm.cr_identifier} maxLength={20}
                      onChange={e => setRcForm(f => ({ ...f, cr_identifier: e.target.value }))}
                      placeholder={rcForm.cr_purpose === 'expense_proof' ? '123-45-67890' : '010-1234-5678'} />
                  </FormField>
                </>
              )}

              <RcTwoCol>
                <FormField>
                  <FormLabel>{t('public.receipt.contactName', '담당자명')} <FormHint>({t('public.optional', '선택')})</FormHint></FormLabel>
                  <FormInput type="text" value={rcForm.requested_by_name} maxLength={80}
                    onChange={e => setRcForm(f => ({ ...f, requested_by_name: e.target.value }))} />
                </FormField>
                <FormField>
                  <FormLabel>{t('public.receipt.contactPhone', '담당자 연락처')} <FormHint>({t('public.optional', '선택')})</FormHint></FormLabel>
                  <FormInput type="tel" inputMode="tel" value={rcForm.contact_phone} maxLength={40}
                    onChange={e => setRcForm(f => ({ ...f, contact_phone: e.target.value }))} placeholder="010-1234-5678" />
                </FormField>
              </RcTwoCol>

              {rcErr && <RcErr>{rcErr}</RcErr>}
            </ModalBody>
            <ModalFoot>
              <ModalCancelBtn type="button" onClick={() => setReceiptOpen(false)}>{t('common.cancel', '취소') as string}</ModalCancelBtn>
              <ModalSendBtn type="button" disabled={rcSubmitting} onClick={submitReceipt}>
                {rcSubmitting ? (t('public.sending', '전송 중...') as string) : (t('public.receipt.submit', '신청하기') as string)}
              </ModalSendBtn>
            </ModalFoot>
          </ModalBox>
        </ModalBackdrop>
      )}
    </Page>
  );
};

export default PublicInvoicePage;

// ─── styled ───
const Page = styled.div`
  min-height: 100vh; background: #F8FAFC; padding: 0 0 40px 0;
  @media print { background: #FFF; padding: 0; }
`;
const Toolbar = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 12px 24px;
  background: #FFF; border-bottom: 1px solid #E2E8F0;
  position: sticky; top: 0; z-index: 10;
  @media print { display: none !important; }
`;
const Brand = styled.img`display:block;width:120px;height:auto;user-select:none;`;
const ToolbarSpacer = styled.div`flex:1;`;
const PrintBtn = styled.button`
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 8px 16px; font-size: 13px; font-weight: 600; color: #334155;
  border: 1px solid #E2E8F0; border-radius: 8px; background: #FFF; cursor: pointer;
  &:hover { border-color: #14B8A6; color: #0F766E; }
`;
const Frame = styled.div`
  max-width: 720px; margin: 32px auto; display: flex; flex-direction: column; gap: 16px;
  padding: 0 16px;
  @media (max-width: 640px) { margin: 16px auto; gap: 12px; }
  @media print { max-width: 100%; margin: 0; padding: 0; }
`;
const Header = styled.header`
  text-align: center; padding: 8px 0 4px;
`;
const Title = styled.h1`
  font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 6px 0; letter-spacing: -0.3px;
`;
const Meta = styled.div`
  font-size: 13px; color: #64748B;
`;
const Arrow = styled.span`color: #CBD5E1; margin: 0 6px;`;
const Card = styled.div`
  background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 24px;
  display: flex; flex-direction: column; gap: 8px;
  @media (max-width: 640px) { padding: 18px 16px; }
`;
const CardTitle = styled.h2`
  font-size: 18px; font-weight: 700; color: #0F172A; margin: 0;
`;
const CardNumber = styled.div`
  font-size: 12px; color: #64748B; font-family: ui-monospace, monospace;
`;
const Total = styled.div`
  font-size: 32px; font-weight: 700; color: #0F172A; margin-top: 8px; letter-spacing: -0.5px;
  font-variant-numeric: tabular-nums;
`;
const DueRow = styled.div`
  font-size: 13px; color: #64748B;
`;
const InstallList = styled.div`
  display: flex; flex-direction: column; margin-top: 12px;
  border-top: 1px solid #F1F5F9;
`;
const InstallRow = styled.div<{ $paid: boolean; $canceled: boolean }>`
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 14px 0; border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
  opacity: ${p => p.$canceled ? 0.5 : 1};
  text-decoration: ${p => p.$canceled ? 'line-through' : 'none'};
  background: ${p => p.$paid ? '#F0FDF4' : 'transparent'};
  padding-left: ${p => p.$paid ? '12px' : '0'};
  border-radius: ${p => p.$paid ? '8px' : '0'};
  margin-bottom: ${p => p.$paid ? '4px' : '0'};
  @media (max-width: 640px) {
    flex-direction: column; align-items: flex-start; gap: 6px;
    padding: 12px 0;
  }
`;
const InstallLeft = styled.div`display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1;`;
const InstallLabel = styled.div`font-size: 14px; font-weight: 600; color: #0F172A;`;
const InstallSub = styled.div`font-size: 12px; color: #64748B;`;
const InstallRight = styled.div`
  display: flex; flex-direction: column; gap: 4px; align-items: flex-end;
  @media (max-width: 640px) { align-items: flex-start; width: 100%; }
`;
const InstallAmt = styled.div<{ $paid: boolean }>`
  font-size: 16px; font-weight: 700; color: ${p => p.$paid ? '#15803D' : '#0F172A'};
  font-variant-numeric: tabular-nums;
`;
const InstallStatus = styled.div<{ $paid: boolean; $notified: boolean; $canceled: boolean }>`
  font-size: 11px; font-weight: 600;
  color: ${p => p.$paid ? '#15803D' : p.$canceled ? '#94A3B8' : p.$notified ? '#B45309' : '#64748B'};
`;
const NotifyBtnSm = styled.button`
  display: inline-flex; align-items: center; min-height: 36px;
  padding: 6px 12px; font-size: 11px; font-weight: 600;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; color: #0F766E; cursor: pointer;
  &:hover:not(:disabled) { background: #F0FDFA; border-color: #14B8A6; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const Section = styled.section`
  background: #FFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px 20px;
  display: flex; flex-direction: column; gap: 8px;
`;
const SectionTitle = styled.h3`font-size: 13px; font-weight: 700; color: #0F172A; margin: 0;`;
const SectionDesc = styled.div`font-size: 12px; color: #64748B;`;
const BankCard = styled.div`
  display: flex; flex-direction: column; gap: 8px;
  background: #F8FAFC; border-radius: 8px; padding: 14px 16px; margin-top: 4px;
`;
const BankRow = styled.div`display: flex; gap: 16px; align-items: center;`;
const BankDivider = styled.div`height: 1px; background: #E2E8F0; margin: 4px 0;`;
const BankLabel = styled.div`font-size: 12px; color: #64748B; width: 80px; flex-shrink: 0;`;
const BankValue = styled.div`font-size: 14px; color: #0F172A; font-weight: 500;`;
const BankValueRow = styled.div`display: flex; gap: 8px; align-items: center; flex: 1;`;
const BankValueMono = styled.div`
  font-size: 14px; color: #0F172A; font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
`;
const CopyBtn = styled.button`
  display: inline-flex; align-items: center; min-height: 36px;
  padding: 6px 12px; font-size: 11px; font-weight: 600; color: #0F766E;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 6px; cursor: pointer;
  &:hover { background: #F0FDFA; border-color: #14B8A6; }
`;
const PayerGuideRow = styled.div`
  display: flex; gap: 8px; align-items: center;
  background: #F0FDFA; border: 1px dashed #5EEAD4; border-radius: 8px; padding: 12px 14px; margin-top: 4px;
`;
const PayerGuideMono = styled.div`
  flex: 1; font-size: 14px; color: #0F766E; font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
`;
const Memo = styled.div`
  font-size: 13px; color: #475569; line-height: 1.6; white-space: pre-wrap;
`;
const NotifyArea = styled.div`
  display: flex; flex-direction: column; gap: 6px; align-items: stretch; margin-top: 4px;
`;
const NotifyBtn = styled.button`
  width: 100%; min-height: 44px; padding: 14px 20px; font-size: 14px; font-weight: 700;
  background: #0D9488; color: #FFF; border: none; border-radius: 10px; cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #0F766E; }
`;
const NotifyHint = styled.div`font-size: 11px; color: #64748B; text-align: center;`;
const NotifyDoneBox = styled.div`
  display: flex; gap: 12px; align-items: center;
  background: #FFFBEB; border: 1px solid #FCD34D; border-radius: 10px; padding: 14px 18px;
`;
const DoneIcon = styled.div`
  font-size: 18px; font-weight: 700; color: #B45309;
`;
const NotifyDoneText = styled.div`display: flex; flex-direction: column; gap: 2px;`;
const NotifyDoneTitle = styled.div`font-size: 14px; font-weight: 600; color: #92400E;`;
const NotifyDoneSub = styled.div`font-size: 12px; color: #78716C;`;
const PaidBanner = styled.div`
  display: flex; gap: 10px; align-items: center;
  background: #F0FDF4; border: 1px solid #86EFAC; border-radius: 10px; padding: 14px 18px;
  font-size: 14px; font-weight: 600; color: #15803D;
  & ${DoneIcon} { color: #15803D; }
`;
const Footer = styled.footer`
  margin-top: 8px; padding-top: 12px;
  text-align: center;
`;
const FooterText = styled.div`font-size: 11px; color: #94A3B8;`;
const FooterContact = styled.a`
  display: inline-block; margin-top: 8px; font-size: 12px; font-weight: 600;
  color: #0D9488; text-decoration: none;
  &:hover { text-decoration: underline; }
`;

const Center = styled.div`
  min-height: 60vh; display: flex; align-items: center; justify-content: center;
  color: #64748B; font-size: 14px;
`;

// 모달
const ModalBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 100;
`;
const ModalBox = styled.div`
  background: #FFF; border-radius: 12px; width: 100%; max-width: 460px;
  display: flex; flex-direction: column; max-height: 90vh;
  box-shadow: 0 20px 60px rgba(15,23,42,0.25);
`;
const ModalHead = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 16px 20px; border-bottom: 1px solid #E2E8F0;
`;
const ModalTitle = styled.h3`font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;`;
const ModalClose = styled.button`
  display: inline-flex; align-items: center; justify-content: center; min-width: 36px; min-height: 36px;
  background: none; border: none; font-size: 22px; line-height: 1; color: #94A3B8; cursor: pointer; padding: 0 4px;
  &:hover { color: #475569; }
`;
const ModalBody = styled.div`
  padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto;
`;
const ModalLine = styled.div<{ $muted?: boolean }>`
  font-size: 13px; color: ${p => p.$muted ? '#64748B' : '#0F172A'};
`;
const FormField = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FormLabel = styled.label`font-size: 12px; font-weight: 600; color: #475569;`;
const FormHint = styled.span`font-weight: 400; color: #94A3B8;`;
const FormInput = styled.input`
  padding: 9px 12px; font-size: 13px; color: #0F172A;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const FormTextarea = styled.textarea`
  padding: 9px 12px; font-size: 13px; color: #0F172A; font-family: inherit;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
`;
const ModalFoot = styled.div`
  display: flex; gap: 8px; justify-content: flex-end; padding: 14px 20px;
  border-top: 1px solid #E2E8F0;
`;
const ModalCancelBtn = styled.button`
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 9px 16px; font-size: 13px; font-weight: 600; color: #334155;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; cursor: pointer;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
`;
const ModalSendBtn = styled.button`
  display: inline-flex; align-items: center; min-height: 44px;
  padding: 9px 16px; font-size: 13px; font-weight: 600; color: #FFF;
  background: #0D9488; border: none; border-radius: 8px; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;

// ─── 증빙 신청 모달 — 사업자/개인 토글 + 레이아웃 ───
const RcAmountBox = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; margin-bottom: 4px;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 10px;
  span { font-size: 13px; font-weight: 600; color: #0F766E; }
  strong { font-size: 16px; font-weight: 700; color: #0F172A; }
  em { font-size: 12px; font-weight: 500; color: #64748B; font-style: normal; }
`;
const RcToggleRow = styled.div`display: flex; gap: 8px; margin-bottom: 4px;`;
const RcToggleBtn = styled.button<{ $active: boolean }>`
  flex: 1; min-height: 44px; padding: 10px 12px; font-size: 13px; font-weight: 600;
  border-radius: 8px; cursor: pointer; transition: all .12s;
  color: ${p => p.$active ? '#0F766E' : '#64748B'};
  background: ${p => p.$active ? '#F0FDFA' : '#FFF'};
  border: 1.5px solid ${p => p.$active ? '#0D9488' : '#E2E8F0'};
  &:hover { border-color: ${p => p.$active ? '#0D9488' : '#CBD5E1'}; }
`;
const RcTwoCol = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 10px;`;
const RcErr = styled.div`
  margin-top: 4px; padding: 9px 12px; font-size: 12px; font-weight: 500;
  color: #B91C1C; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px;
`;
