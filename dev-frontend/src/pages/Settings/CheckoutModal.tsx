// 결제 요청 모달 — P-2 자체 결제 흐름 (관리자 입금확인 방식, Irene 결정 2026-06-08)
//
// step 1 (instructions): 입금 안내 (계좌·금액·결제 ID) + "입금했어요" 버튼 (owner)
// 사용자가 워크스페이스 계좌로 송금 → owner 가 "입금했어요" 통보 → 상태 "입금 확인 대기중"
// step 2 (notified): 통보 완료 안내. 실제 활성화는 플랫폼 관리자가 입금 확인 후.
//
// 자체 결제 정책 (CLAUDE.md):
//   1순위 자체 결제 (계좌이체 + 관리자 입금확인), 2순위 PortOne (P-7)

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { checkout, notifyPaymentPaid, type PlanCode, type BillingCycle, type PlanDef, type TaxInvoiceInput } from '../../services/plan';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface Props {
  open: boolean;
  businessId: number;
  plan: PlanDef;
  cycle: BillingCycle;
  bankInfo?: { name?: string; account?: string; holder?: string } | null;
  // 기존 pending payment 가 있으면 재사용 (또 만들지 않음)
  existingPaymentId?: number | null;
  existingAmount?: number | null;
  onClose: () => void;
  onPaid: () => void;
}

type Step = 'instructions' | 'notified';

export default function CheckoutModal({
  open, businessId, plan, cycle, bankInfo, existingPaymentId, existingAmount, onClose, onPaid,
}: Props) {
  const { t } = useTranslation('plan');
  const ref = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);
  useEscapeStack(open, onClose);
  useFocusTrap(ref, open);

  const [step, setStep] = useState<Step>('instructions');
  const [paymentId, setPaymentId] = useState<number | null>(existingPaymentId ?? null);
  const [amount, setAmount] = useState<number>(
    existingAmount != null ? Number(existingAmount) :
    cycle === 'monthly' ? plan.price_monthly.KRW || 0 : plan.price_yearly.KRW || 0
  );
  const [payerName, setPayerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 세금계산서 옵션 (한국 사업자) — 입력 시 mark-paid 와 함께 발행 신청
  const [taxOpen, setTaxOpen] = useState(false);
  const [tax, setTax] = useState<TaxInvoiceInput>({ biz_no: '', biz_name: '', ceo_name: '', address: '', email: '' });
  const taxValid = taxOpen ? !!(tax.biz_no.trim() && tax.biz_name.trim() && tax.ceo_name.trim() && tax.email.trim()) : true;

  // 모달 진입 시: pending payment 가 없으면 checkout 호출하여 신규 생성
  useEffect(() => {
    if (!open) return;
    setStep('instructions');
    setError(null);
    setPayerName('');
    if (existingPaymentId) {
      setPaymentId(existingPaymentId);
      setAmount(Number(existingAmount || 0));
      return;
    }
    if (plan.code === 'free' || plan.code === 'enterprise') return;
    let alive = true;
    setSubmitting(true);
    checkout(businessId, plan.code as Exclude<PlanCode, 'free' | 'enterprise'>, cycle)
      .then(res => {
        if (!alive) return;
        if (!res) { setError(t('checkout.errors.checkoutFailed')); return; }
        setPaymentId(res.payment_id);
        setAmount(Number(res.amount || 0));
      })
      .catch(() => { if (alive) setError(t('checkout.errors.checkoutFailed')); })
      .finally(() => { if (alive) setSubmitting(false); });
    return () => { alive = false; };
  }, [open, businessId, plan.code, cycle, existingPaymentId, existingAmount, t]);

  if (!open) return null;

  const handleNotify = async () => {
    if (!paymentId || submitting) return;
    if (taxOpen && !taxValid) {
      setError(t('checkout.tax.requiredFields', '사업자번호·상호·대표자·이메일은 필수입니다.'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const taxPayload: TaxInvoiceInput | null = taxOpen ? {
      biz_no: tax.biz_no.trim(), biz_name: tax.biz_name.trim(),
      ceo_name: tax.ceo_name.trim(), address: tax.address?.trim() || '',
      email: tax.email.trim(),
    } : null;
    const ok = await notifyPaymentPaid(businessId, paymentId, payerName.trim() || undefined, undefined, taxPayload);
    setSubmitting(false);
    if (!ok) {
      setError(t('checkout.errors.notifyFailed', '입금 통보 실패. 잠시 후 다시 시도해 주세요.'));
      return;
    }
    // 통보 완료 — 상태 "입금 확인 대기중". 확인 패널 표시 (확인 누르면 부모 status 갱신 + 닫기).
    setStep('notified');
  };

  const fmtAmount = `₩${Number(amount || 0).toLocaleString()}`;
  const cycleLabel = cycle === 'monthly' ? t('checkout.cycle.monthly') : t('checkout.cycle.yearly');

  return (
    <Backdrop onClick={onClose}>
      <Dialog ref={ref} role="dialog" aria-modal="true" aria-label={t('checkout.title')}
        onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <Title>{t('checkout.title')}</Title>
          <CloseBtn type="button" onClick={onClose} aria-label="close">×</CloseBtn>
        </ModalHeader>

        {step === 'notified' ? (
          <>
            <Body>
              <NotifiedBox>
                <NotifiedIcon aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </NotifiedIcon>
                <NotifiedTitle>{t('checkout.notified.title', '입금 통보가 접수되었습니다')}</NotifiedTitle>
                <NotifiedDesc>{t('checkout.notified.desc', '관리자가 입금을 확인하면 구독이 활성화됩니다. 확인까지 잠시 시간이 걸릴 수 있습니다.')}</NotifiedDesc>
                <NotifiedMeta>
                  <span>{plan.name_ko || plan.name} · {cycleLabel}</span>
                  <strong>{fmtAmount}</strong>
                </NotifiedMeta>
              </NotifiedBox>
            </Body>
            <Footer>
              <PrimaryBtn type="button" onClick={() => { onPaid(); onClose(); }}>
                {t('checkout.notified.ok', '확인')}
              </PrimaryBtn>
            </Footer>
          </>
        ) : (
        <>
        <Body>
          <Summary>
            <SummaryRow>
              <SummaryLabel>{t('checkout.summary.plan')}</SummaryLabel>
              <SummaryValue>{plan.name_ko || plan.name} · {cycleLabel}</SummaryValue>
            </SummaryRow>
            <SummaryRow>
              <SummaryLabel>{t('checkout.summary.amount')}</SummaryLabel>
              <SummaryAmount>{fmtAmount}</SummaryAmount>
            </SummaryRow>
            {paymentId && (
              <SummaryRow>
                <SummaryLabel>{t('checkout.summary.paymentId')}</SummaryLabel>
                <SummaryValue>#{paymentId}</SummaryValue>
              </SummaryRow>
            )}
          </Summary>

          <BankBox>
            <BankLabel>{t('checkout.bank.title')}</BankLabel>
            {bankInfo?.name && bankInfo?.account ? (
              <BankInfo>
                <BankLine><strong>{bankInfo.name}</strong> {bankInfo.account}</BankLine>
                {bankInfo.holder && <BankLine>{t('checkout.bank.holder')}: {bankInfo.holder}</BankLine>}
              </BankInfo>
            ) : (
              <BankFallback>{t('checkout.bank.contactSupport')}</BankFallback>
            )}
            <BankHint>{t('checkout.bank.memoHint', { paymentId: paymentId || '—' })}</BankHint>
          </BankBox>

          <Field>
            <FieldLabel>{t('checkout.payerName.label')}</FieldLabel>
            <Input
              type="text"
              value={payerName}
              onChange={(e) => setPayerName(e.target.value)}
              placeholder={t('checkout.payerName.placeholder')}
              maxLength={80}
            />
            <FieldHint>{t('checkout.payerName.hint')}</FieldHint>
          </Field>

          {/* 세금계산서 — 한국 사업자 옵션 (체크 시 펼침) */}
          <TaxToggle>
            <input type="checkbox" id="tax-toggle" checked={taxOpen} onChange={e => setTaxOpen(e.target.checked)} />
            <label htmlFor="tax-toggle">{t('checkout.tax.toggle', '사업자 — 세금계산서 발행 받기')}</label>
          </TaxToggle>
          {taxOpen && (
            <TaxFields>
              <Field>
                <FieldLabel>{t('checkout.tax.bizNo', '사업자등록번호')} *</FieldLabel>
                <Input value={tax.biz_no} onChange={e => setTax({ ...tax, biz_no: e.target.value })}
                  placeholder="123-45-67890" maxLength={20} />
              </Field>
              <Field>
                <FieldLabel>{t('checkout.tax.bizName', '상호')} *</FieldLabel>
                <Input value={tax.biz_name} onChange={e => setTax({ ...tax, biz_name: e.target.value })} maxLength={200} />
              </Field>
              <Field>
                <FieldLabel>{t('checkout.tax.ceoName', '대표자')} *</FieldLabel>
                <Input value={tax.ceo_name} onChange={e => setTax({ ...tax, ceo_name: e.target.value })} maxLength={80} />
              </Field>
              <Field>
                <FieldLabel>{t('checkout.tax.address', '주소')}</FieldLabel>
                <Input value={tax.address} onChange={e => setTax({ ...tax, address: e.target.value })} maxLength={500} />
              </Field>
              <Field>
                <FieldLabel>{t('checkout.tax.email', '세금계산서 받을 이메일')} *</FieldLabel>
                <Input type="email" value={tax.email} onChange={e => setTax({ ...tax, email: e.target.value })} maxLength={200} />
                <FieldHint>{t('checkout.tax.emailHint', '세금계산서 PDF 가 발행 후 이 주소로 발송됩니다.')}</FieldHint>
              </Field>
            </TaxFields>
          )}

          {error && <ErrorBox>{error}</ErrorBox>}

          <Notice>{t('checkout.notice', '계좌이체로 입금하신 뒤 "입금했어요" 를 눌러 통보해 주세요. 관리자가 입금을 확인하면 구독이 활성화됩니다. 24시간 내 미입금 시 자동 취소됩니다.')}</Notice>
        </Body>

        <Footer>
          <SecondaryBtn type="button" onClick={onClose} disabled={submitting}>
            {t('checkout.cancel')}
          </SecondaryBtn>
          <PrimaryBtn type="button" onClick={handleNotify} disabled={submitting || !paymentId}>
            {submitting ? t('checkout.processing') : t('checkout.notify', '입금했어요')}
          </PrimaryBtn>
        </Footer>
        </>
        )}
      </Dialog>
    </Backdrop>
  );
}

const NotifiedBox = styled.div`
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: 12px; padding: 24px 8px;
`;
const NotifiedIcon = styled.div`
  width: 56px; height: 56px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #F0FDFA; color: #0D9488;
`;
const NotifiedTitle = styled.div`font-size: 16px; font-weight: 700; color: #0F172A;`;
const NotifiedDesc = styled.div`font-size: 13px; color: #64748B; line-height: 1.6; max-width: 340px;`;
const NotifiedMeta = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  width: 100%; margin-top: 4px; padding: 12px 16px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  span { font-size: 13px; color: #475569; font-weight: 600; }
  strong { font-size: 16px; color: #0F172A; font-weight: 700; }
`;
const TaxToggle = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #334155;
  input { width: 16px; height: 16px; }
  label { cursor: pointer; user-select: none; }
`;
const TaxFields = styled.div`
  display: flex; flex-direction: column; gap: 12px;
  padding: 12px;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px;
`;
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1200; padding: 16px;
  @media (max-width: 640px) { padding: 0; align-items: stretch; }
`;
const Dialog = styled.div`
  background: #FFFFFF; border-radius: 14px; width: min(480px, 100%);
  max-height: 90vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  @media (max-width: 640px) {
    width: 100%; max-height: none; border-radius: 0;
    margin-top: 60px; height: calc(100vh - 60px); height: calc(100dvh - 60px);
  }
`;
const ModalHeader = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
`;
const Title = styled.h2`margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;`;
const CloseBtn = styled.button`
  background: transparent; border: none; cursor: pointer; color: #64748B;
  font-size: 20px; padding: 4px 8px; border-radius: 6px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`padding: 20px; display: flex; flex-direction: column; gap: 16px; flex: 1; overflow-y: auto; min-height: 0;`;

const Summary = styled.div`
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px;
  padding: 14px 16px; display: flex; flex-direction: column; gap: 8px;
`;
const SummaryRow = styled.div`display: flex; justify-content: space-between; align-items: baseline;`;
const SummaryLabel = styled.span`font-size: 12px; color: #64748B; font-weight: 500;`;
const SummaryValue = styled.span`font-size: 13px; color: #0F172A; font-weight: 600;`;
const SummaryAmount = styled.span`font-size: 18px; color: #0F172A; font-weight: 700;`;

const BankBox = styled.div`
  background: #F0FDFA; border: 1px solid #5EEAD4; border-radius: 10px;
  padding: 14px 16px; display: flex; flex-direction: column; gap: 8px;
`;
const BankLabel = styled.div`
  font-size: 11px; font-weight: 700; color: #0F766E;
  text-transform: uppercase; letter-spacing: 0.5px;
`;
const BankInfo = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const BankLine = styled.div`font-size: 14px; color: #0F172A; line-height: 1.5;`;
const BankFallback = styled.div`font-size: 13px; color: #64748B;`;
const BankHint = styled.div`font-size: 11px; color: #64748B; line-height: 1.5;`;

const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const FieldLabel = styled.div`font-size: 12px; font-weight: 600; color: #475569;`;
const FieldHint = styled.div`font-size: 11px; color: #94A3B8;`;
const Input = styled.input`
  width: 100%; padding: 10px 12px; border: 1px solid #E2E8F0;
  border-radius: 8px; font-size: 14px; color: #0F172A;
  outline: none; transition: border-color 120ms;
  &:focus { border-color: #14B8A6; }
`;
const ErrorBox = styled.div`
  padding: 10px 12px; background: #FEF2F2; border: 1px solid #FECACA;
  border-radius: 8px; color: #B91C1C; font-size: 12px;
`;
const Notice = styled.div`
  font-size: 11px; color: #94A3B8; line-height: 1.6;
`;

const Footer = styled.div`
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 20px; border-top: 1px solid #F1F5F9;
  flex-shrink: 0; background: #fff;
`;
const PrimaryBtn = styled.button`
  padding: 10px 20px; background: #0D9488; color: #FFFFFF;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #0F766E; }
  &:disabled { background: #94A3B8; cursor: not-allowed; }
`;
const SecondaryBtn = styled.button`
  padding: 10px 16px; background: #FFFFFF; color: #334155;
  border: 1px solid #CBD5E1; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover:not(:disabled) { background: #F8FAFC; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
