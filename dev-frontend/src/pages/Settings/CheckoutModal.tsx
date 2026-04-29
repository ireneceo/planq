// 결제 요청 모달 — P-2 자체 결제 흐름
//
// step 1 (instructions): 입금 안내 (계좌·금액·결제 ID) + "입금 완료 처리" 버튼 (owner)
// 사용자가 워크스페이스 계좌로 송금 → owner 가 같은 화면에서 "입금 완료 처리" → mark-paid → 활성화
//
// 자체 결제 정책 (CLAUDE.md):
//   1순위 자체 결제 (계좌이체 mark-paid), 2순위 PortOne (P-7)

import { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { checkout, markPaymentPaid, type PlanCode, type BillingCycle, type PlanDef } from '../../services/plan';
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

type Step = 'instructions' | 'completing';

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

  const handleMarkPaid = async () => {
    if (!paymentId || submitting) return;
    setSubmitting(true);
    setError(null);
    setStep('completing');
    const ok = await markPaymentPaid(businessId, paymentId, payerName.trim() || undefined);
    setSubmitting(false);
    if (!ok) {
      setError(t('checkout.errors.markPaidFailed'));
      setStep('instructions');
      return;
    }
    onPaid();
    onClose();
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

          {error && <ErrorBox>{error}</ErrorBox>}

          <Notice>{t('checkout.notice')}</Notice>
        </Body>

        <Footer>
          <SecondaryBtn type="button" onClick={onClose} disabled={submitting}>
            {t('checkout.cancel')}
          </SecondaryBtn>
          <PrimaryBtn type="button" onClick={handleMarkPaid} disabled={submitting || !paymentId}>
            {step === 'completing' ? t('checkout.processing') : t('checkout.markPaid')}
          </PrimaryBtn>
        </Footer>
      </Dialog>
    </Backdrop>
  );
}

const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15,23,42,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1200; padding: 16px;
`;
const Dialog = styled.div`
  background: #FFFFFF; border-radius: 14px; width: min(480px, 100%);
  max-height: 90vh; overflow: auto; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
`;
const ModalHeader = styled.div`
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #E2E8F0;
`;
const Title = styled.h2`margin: 0; font-size: 16px; font-weight: 700; color: #0F172A;`;
const CloseBtn = styled.button`
  background: transparent; border: none; cursor: pointer; color: #64748B;
  font-size: 20px; padding: 4px 8px; border-radius: 6px;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const Body = styled.div`padding: 20px; display: flex; flex-direction: column; gap: 16px;`;

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
