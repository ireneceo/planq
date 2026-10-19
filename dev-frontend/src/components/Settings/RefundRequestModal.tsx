// 결제 환불 요청 창 — 요금제 화면 «결제 이력» (2026-10-19)
//
// Irene: *"왜 환불요청이 문의폼으로 와? … 관리자로써 어쩌라는 건지 모르겠어. 링크가 그냥 문의보기야."*
// 예전엔 [환불 요청] 이 Enterprise 문의 창을 «환불» 뜻으로 열어 결제와 묶이지 않은 문의(«새 문의 #3»)로 들어갔다.
// 이제 고른 결제에 요청을 단다(POST /api/plan/:biz/payments/:id/refund-request — routes/plan_refund).
// 관리자는 «[환불 요청] …» 알림 → 관리자 결제 관리의 그 행에서 [환불 처리] / [반려].
// 체험 중 결제는 같은 문이 서버에서 체험 환불로 가른다(전용 카드 TrialRefundRequest 도 같은 문).
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import { apiFetch } from '../../contexts/AuthContext';
import type { PaymentRecord } from '../../services/plan';

interface Props {
  businessId: number;
  /** 요청할 수 있는 결제(결제 완료 · 요청 전) — null 이면 닫힘 */
  candidates: PaymentRecord[] | null;
  /** 행에서 열었으면 그 결제를 골라 둔다 */
  initialId: number | null;
  onClose: () => void;
  onDone: () => void;
  label: (p: PaymentRecord) => string;
}

const isCardMethod = (m: string) => m === 'stripe' || m === 'card';

const RefundRequestModal: React.FC<Props> = ({ businessId, candidates, initialId, onClose, onDone, label }) => {
  const { t } = useTranslation('plan');
  const [selected, setSelected] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [bank, setBank] = useState('');
  const [number, setNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = !!candidates;
  useEffect(() => {
    if (!candidates) return;
    setSelected(initialId ?? (candidates[0]?.id ?? null));
    setReason(''); setBank(''); setNumber(''); setHolder(''); setError(null);
  }, [candidates, initialId]);

  const pay = candidates?.find(p => p.id === selected) || null;
  const isCard = !!pay && isCardMethod(pay.method);
  const accountOk = isCard || (bank.trim() && holder.trim() && /^[0-9-]{6,30}$/.test(number.replace(/\s/g, '')));
  const canSubmit = !!pay && !!reason.trim() && !!accountOk;

  const submit = async () => {
    if (!pay || !canSubmit || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/plan/${businessId}/payments/${pay.id}/refund-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: reason.trim(),
          refund_account: isCard ? undefined : { bank: bank.trim(), number: number.replace(/\s/g, ''), holder: holder.trim() },
        }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.message || 'failed');
      onDone();
    } catch (e) {
      setError(t(`trialRefund.err.${(e as Error).message}`, t('trialRefund.errGeneric', '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')) as string);
    } finally { setBusy(false); }
  };

  return (
    <StandardModal open={open} onClose={onClose} size="sm"
      title={t('refundHelp.title', '환불 요청') as string}
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('trialRefund.close', '닫기') as string}</ActionButton>
          <ActionButton tone="danger" size="md" loading={busy} disabled={!canSubmit} onClick={submit} data-testid="plan-refund-submit">
            {t('refundHelp.submit', '환불 요청 보내기') as string}
          </ActionButton>
        </>
      )}>
      <Lead>{t('refundHelp.subtitle2', '환불 기준(약관 제4조)으로 확인한 뒤 처리 결과를 알려 드립니다. 요청만으로는 결제·구독이 바뀌지 않습니다.') as string}</Lead>
      <Field role="radiogroup" aria-label={t('refundHelp.pickPayment', '환불할 결제') as string}>
        <Label as="span">{t('refundHelp.pickPayment', '환불할 결제') as string}</Label>
        {(candidates || []).map(p => (
          <Pick key={p.id} $on={p.id === selected}>
            <input type="radio" name="refund-pay" checked={p.id === selected} onChange={() => setSelected(p.id)} data-testid={`plan-refund-pick-${p.id}`} />
            <span>{label(p)}</span>
          </Pick>
        ))}
      </Field>
      <Field>
        <Label htmlFor="rf-reason">{t('refundHelp.reason', '사유')}<Req>*</Req></Label>
        {/* draft-exempt: 요청 창 안에서 바로 제출하는 짧은 사유(255자) — 쓰다 만 글로 남길 대상이 아니다 */}
        <Textarea id="rf-reason" value={reason} maxLength={255} rows={3} onChange={(e) => setReason(e.target.value)}
          placeholder={t('refundHelp.reasonPh', '환불을 원하는 이유를 적어 주세요.') as string} data-testid="plan-refund-reason" />
      </Field>
      {pay && (isCard ? (
        <Small>{t('refundHelp.toCard', '카드 결제는 결제한 카드로 취소됩니다.') as string}</Small>
      ) : (
        <>
          <Small>{t('refundHelp.toAccount', '계좌이체 결제는 아래 계좌로 돌려드립니다.') as string}</Small>
          <Field>
            <Label htmlFor="rf-bank">{t('trialRefund.bank', '은행') as string}</Label>
            <Input id="rf-bank" value={bank} maxLength={80} onChange={(e) => setBank(e.target.value)} data-testid="plan-refund-bank" />
          </Field>
          <Field>
            <Label htmlFor="rf-number">{t('trialRefund.number', '계좌번호') as string}</Label>
            <Input id="rf-number" value={number} maxLength={30} inputMode="numeric" onChange={(e) => setNumber(e.target.value)} data-testid="plan-refund-number" />
          </Field>
          <Field>
            <Label htmlFor="rf-holder">{t('trialRefund.holder', '예금주') as string}</Label>
            <Input id="rf-holder" value={holder} maxLength={80} onChange={(e) => setHolder(e.target.value)} data-testid="plan-refund-holder" />
          </Field>
        </>
      ))}
      {error && <Err role="alert">{error}</Err>}
    </StandardModal>
  );
};

export default RefundRequestModal;

const Lead = styled.div`font-size: 0.8125rem; color: #475569; line-height: 1.6;`;
const Small = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #334155;`;
const Req = styled.span`color: #F43F5E; margin-left: 2px;`;
const Pick = styled.label<{ $on: boolean }>`
  display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 10px; cursor: pointer;
  font-size: 0.8125rem; color: #0F172A;
  border: 1px solid ${p => (p.$on ? '#14B8A6' : '#E2E8F0')}; background: ${p => (p.$on ? '#F0FDFA' : '#FFFFFF')};
  border-radius: 8px;
`;
const Input = styled.input`
  height: 40px; padding: 0 12px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A; font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const Textarea = styled.textarea`
  padding: 8px 12px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const Err = styled.div`font-size: 0.8125rem; color: #DC2626;`;
