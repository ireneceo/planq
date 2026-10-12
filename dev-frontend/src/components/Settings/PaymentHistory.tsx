// 요금제 화면 «결제 이력» 목록 — 영수증 PDF + 환불 안내·요청 입구 (PlanSettings 에서 분리, 2026-10-12)
//   PlanSettings 는 god-file 래칫 대상이라 환불 입구(RefundHelp)를 붙이며 이 목록을 통째로 옮겼다(동작·모양 그대로).
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { downloadFromApi } from '../../utils/download';
import { receiptPdfUrl, type PaymentRecord } from '../../services/plan';
import type { TrialRefundState } from './TrialRefundRequest';
import { RefundHelpLine, RefundRowButton } from './RefundHelp';

interface Props {
  businessId: number;
  payments: PaymentRecord[] | null | undefined;
  isOwner: boolean;
  trialRefund: TrialRefundState | null | undefined;
  /** 환불 요청 — 요금제 화면의 문의 창을 «환불» 뜻으로 연다(prefill = 그 결제의 날짜·금액) */
  onRefundRequest: (prefill: string) => void;
}

const PaymentHistory: React.FC<Props> = ({ businessId, payments, isOwner, trialRefund, onRefundRequest }) => {
  const { t } = useTranslation('plan');
  const { formatDate } = useTimeFormat();
  // 영수증 — 링크(<a href>)로 열면 Authorization 헤더가 안 실려 401 빈 화면이었다(운영 #464).
  //   인증 API 다운로드 한 곳(downloadFromApi)으로 받는다. 받는 중엔 버튼을 막고, 실패는 행 옆에 말한다.
  const [receiptBusy, setReceiptBusy] = useState<number | null>(null);
  const [receiptErr, setReceiptErr] = useState<number | null>(null);
  const openReceipt = async (paymentId: number) => {
    if (receiptBusy) return;
    setReceiptBusy(paymentId); setReceiptErr(null);
    try { await downloadFromApi(receiptPdfUrl(businessId, paymentId), `receipt-${paymentId}.pdf`); }
    catch { setReceiptErr(paymentId); }
    finally { setReceiptBusy(null); }
  };
  return (
    <>
      {payments?.some(p => p.status === 'paid') && (
        <RefundHelpLine isOwner={isOwner} onRequest={() => onRefundRequest('')} />
      )}
      {(!payments || payments.length === 0) ? (
        <Dim>{t('billing.history.empty', '결제 내역이 없습니다')}</Dim>
      ) : (
        <PaymentList>
          {payments.map(p => (
            <PaymentRow key={p.id}>
              <PaymentDate>{p.paid_at ? formatDate(p.paid_at) : '—'}</PaymentDate>
              <PaymentAmount>
                {p.currency === 'KRW' ? t('amountKrw', { amount: Number(p.amount).toLocaleString() }) : `${p.currency} ${Number(p.amount).toLocaleString()}`}
                {/* 금액이 플랜표와 다르면 사용자는 오류로 읽는다 — 내역(플랜 + 애드온)을 같이 적는다(FIX_0AB A-④) */}
                {p.line_items && p.line_items.length > 1 && (() => {
                  const planL = p.line_items.find(l => l.kind === 'plan');
                  const planAmt = planL ? Number(planL.amount) : 0;
                  const planStr = p.currency === 'KRW' ? t('amountKrw', { amount: planAmt.toLocaleString() }) : `${p.currency} ${planAmt.toLocaleString()}`;
                  return (
                    <PaymentLines>
                      {t('billing.history.lines', { plan: planStr, count: p.line_items.filter(l => l.kind === 'addon').length, defaultValue: '플랜 {{plan}} + 애드온 {{count}}건' })}
                    </PaymentLines>
                  );
                })()}
              </PaymentAmount>
              <PaymentMeta>
                {t(`billing.cycle.${p.cycle}`, p.cycle)}
                {p.period_start && p.period_end && ` · ${formatDate(p.period_start)} ~ ${formatDate(p.period_end)}`}
              </PaymentMeta>
              <PaymentStatus $status={p.status}>{t(`billing.payment.status.${p.status}`, p.status)}</PaymentStatus>
              {p.status === 'paid' && (
                <RowActions>
                  <ReceiptLink type="button" onClick={() => openReceipt(p.id)} disabled={receiptBusy === p.id} data-testid="plan-receipt">
                    {t('billing.history.receipt', '영수증')}
                  </ReceiptLink>
                  {isOwner && !(trialRefund?.available && trialRefund.payment_id === p.id) && (
                    <RefundRowButton date={p.paid_at ? formatDate(p.paid_at) : '—'} onRequest={onRefundRequest}
                      amount={p.currency === 'KRW' ? t('amountKrw', { amount: Number(p.amount).toLocaleString() }) : `${p.currency} ${Number(p.amount).toLocaleString()}`} />
                  )}
                  {receiptErr === p.id && <ReceiptError role="alert">{t('billing.history.receiptFailed', '영수증을 받지 못했습니다. 다시 시도해 주세요.')}</ReceiptError>}
                </RowActions>
              )}
            </PaymentRow>
          ))}
        </PaymentList>
      )}
    </>
  );
};

export default PaymentHistory;

// 영수증·환불 요청을 한 칸에 — 행 grid(5칸)를 늘리지 않는다
const RowActions = styled.div`
  display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end;
`;
const Dim = styled.div`padding:20px;text-align:center;font-size:0.75rem;color:#94A3B8;`;
const PaymentList = styled.div`display: flex; flex-direction: column;`;
const PaymentRow = styled.div`
  display: grid;
  grid-template-columns: 100px 110px 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #F1F5F9;
  &:last-child { border-bottom: none; }
  font-size: 0.75rem;
  @media (max-width: 768px) {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
  }
`;
const PaymentDate = styled.div`color: #64748B; font-variant-numeric: tabular-nums;`;
const PaymentAmount = styled.div`font-weight: 700; color: #0F172A;`;
const PaymentLines = styled.span`display: block; margin-top: 2px; font-size: 0.6875rem; font-weight: 500; color: #64748B;`;
const PaymentMeta = styled.div`color: #64748B;`;
const PaymentStatus = styled.span<{ $status: string }>`
  padding: 2px 8px; border-radius: 999px; font-size: 0.625rem; font-weight: 600;
  background: ${p =>
    p.$status === 'paid' ? '#DCFCE7' :
    p.$status === 'refunded' ? '#FEF3C7' :
    p.$status === 'failed' ? '#FEE2E2' :
    '#F1F5F9'};
  color: ${p =>
    p.$status === 'paid' ? '#15803D' :
    p.$status === 'refunded' ? '#92400E' :
    p.$status === 'failed' ? '#B91C1C' :
    '#64748B'};
`;
const ReceiptLink = styled.button`
  font-size: 0.6875rem; color: #0D9488; font-weight: 600; font-family: inherit;
  text-decoration: none; padding: 4px 10px; background: transparent; cursor: pointer;
  border: 1px solid #5EEAD4; border-radius: 6px;
  &:hover { background: #F0FDFA; }
  &:disabled { opacity: 0.6; cursor: wait; }
`;
const ReceiptError = styled.span`
  font-size: 0.6875rem; color: #DC2626;
`;
