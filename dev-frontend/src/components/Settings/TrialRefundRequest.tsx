// 체험 중 결제 «해지하고 환불 요청» — 요금제 화면. 설계 docs/TRIAL_REFUND_DESIGN.md §6
//
//   자격·상태는 서버가 판정한 /status.trial_refund 만 읽는다(화면이 결제 이력으로 스스로 판정하지 않는다).
//   요청은 상태를 바꾸지 않는다 — 관리자가 확인해 환불하면 그때 구독이 체험으로 돌아간다. 그래서 요청 뒤에는
//   «관리자 확인 중» 상태줄과 [요청 취소] 를 보여 준다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import { apiFetch, useAuth } from '../../contexts/AuthContext';

export interface TrialRefundState {
  available: boolean;
  reason: string | null;
  requested: boolean;
  request_valid: boolean;
  payment_id: number | null;
  amount: number | null;
  currency: string | null;
  method: string | null;
  requested_at: string | null;
  trial_ends_at: string | null;
}

interface Props {
  businessId: number;
  state: TrialRefundState | null | undefined;
  onChanged: () => void;
  formatMoney: (n: number, cur: string) => string;
  formatDate: (s: string) => string;
}

const TrialRefundRequest: React.FC<Props> = ({ businessId, state, onChanged, formatMoney, formatDate }) => {
  const { t } = useTranslation('plan');
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [bank, setBank] = useState('');
  const [number, setNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = user?.business_role === 'owner' || user?.platform_role === 'platform_admin';
  if (!isOwner || !state || !state.payment_id) return null;
  const isCard = state.method === 'stripe' || state.method === 'card';
  const amountStr = state.amount != null && state.currency ? formatMoney(state.amount, state.currency) : '';
  const trialEnd = state.trial_ends_at ? formatDate(state.trial_ends_at) : '';

  if (state.requested && state.request_valid) {
    const cancel = async () => {
      if (busy) return;
      setBusy(true); setError(null);
      try {
        const r = await apiFetch(`/api/plan/${businessId}/payments/${state.payment_id}/refund-request`, { method: 'DELETE' });
        const j = await r.json();
        if (!j?.success) throw new Error(j?.message || 'failed');
        onChanged();
      } catch (e) {
        setError(t(`trialRefund.err.${(e as Error).message}`, t('trialRefund.errGeneric', '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')) as string);
      } finally { setBusy(false); }
    };
    return (
      <Card data-testid="plan-trial-refund-pending">
        <Line>
          <Text>
            {t('trialRefund.pending', {
              date: state.requested_at ? formatDate(state.requested_at) : '',
              defaultValue: '환불 요청 접수 {{date}} · 관리자 확인 중입니다. 확인되면 구독이 체험 상태로 돌아가고 결제 금액이 돌아갑니다.',
            }) as string}
          </Text>
          <ActionButton tone="secondary" size="sm" loading={busy} onClick={cancel} data-testid="plan-trial-refund-cancel">
            {t('trialRefund.cancelRequest', '요청 취소') as string}
          </ActionButton>
        </Line>
        {error && <Err role="alert">{error}</Err>}
      </Card>
    );
  }

  if (!state.available) return null;

  const accountOk = isCard || (bank.trim() && holder.trim() && /^[0-9-]{6,30}$/.test(number.replace(/\s/g, '')));
  const submit = async () => {
    if (busy || !accountOk) return;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/plan/${businessId}/payments/${state.payment_id}/refund-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: note.trim() || undefined,
          refund_account: isCard ? undefined : { bank: bank.trim(), number: number.replace(/\s/g, ''), holder: holder.trim() },
        }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.message || 'failed');
      setOpen(false); setBank(''); setNumber(''); setHolder(''); setNote('');
      onChanged();
    } catch (e) {
      setError(t(`trialRefund.err.${(e as Error).message}`, t('trialRefund.errGeneric', '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')) as string);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Card data-testid="plan-trial-refund-card">
        <Line>
          <Text>{t('trialRefund.hint', { date: trialEnd, defaultValue: '체험이 끝나는 {{date}} 전에 해지하면 결제 금액을 전액 환불해 드립니다(체험 중 환불은 1회).' }) as string}</Text>
          <ActionButton tone="danger" size="sm" onClick={() => { setError(null); setOpen(true); }} data-testid="plan-trial-refund-open">
            {t('trialRefund.open', '해지하고 환불 요청') as string}
          </ActionButton>
        </Line>
      </Card>
      <StandardModal open={open} onClose={() => setOpen(false)} size="sm"
        title={t('trialRefund.title', '해지하고 환불 요청') as string}
        footer={(
          <>
            <ActionButton tone="secondary" size="md" onClick={() => setOpen(false)}>{t('trialRefund.close', '닫기') as string}</ActionButton>
            <ActionButton tone="danger" size="md" loading={busy} disabled={!accountOk} onClick={submit} data-testid="plan-trial-refund-submit">
              {t('trialRefund.submit', '환불 요청') as string}
            </ActionButton>
          </>
        )}>
        <Lead>
          {t('trialRefund.confirm', {
            amount: amountStr, date: trialEnd,
            where: isCard ? t('trialRefund.toCard', '결제한 카드') : t('trialRefund.toAccount', '아래 계좌'),
            defaultValue: '{{amount}}을 전액 환불 요청합니다. 관리자가 확인하면 구독이 체험 상태로 돌아가고, 체험은 {{date}} 까지 그대로 이어집니다(연장되지 않음). 돌려받는 곳: {{where}}.',
          }) as string}
        </Lead>
        <Small>{t('trialRefund.once', '체험 중 환불은 워크스페이스당 한 번입니다. 다시 결제하면 그 결제는 체험 중 환불 대상이 아닙니다.') as string}</Small>
        {!isCard && (
          <>
            <Field>
              <Label htmlFor="tr-bank">{t('trialRefund.bank', '은행') as string}</Label>
              <Input id="tr-bank" value={bank} maxLength={80} onChange={(e) => setBank(e.target.value)} data-testid="plan-trial-refund-bank" />
            </Field>
            <Field>
              <Label htmlFor="tr-number">{t('trialRefund.number', '계좌번호') as string}</Label>
              <Input id="tr-number" value={number} maxLength={30} inputMode="numeric" onChange={(e) => setNumber(e.target.value)} data-testid="plan-trial-refund-number" />
            </Field>
            <Field>
              <Label htmlFor="tr-holder">{t('trialRefund.holder', '예금주') as string}</Label>
              <Input id="tr-holder" value={holder} maxLength={80} onChange={(e) => setHolder(e.target.value)} data-testid="plan-trial-refund-holder" />
            </Field>
          </>
        )}
        <Field>
          <Label htmlFor="tr-note">{t('trialRefund.note', '사유 (선택)') as string}</Label>
          {/* draft-exempt: 선택 사유 한 줄 — 요청 창 안에서 바로 제출하는 짧은 메모라 쓰다 만 글로 남길 대상이 아니다 */}
          <Textarea id="tr-note" value={note} maxLength={255} rows={2} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <Err role="alert">{error}</Err>}
      </StandardModal>
    </>
  );
};

export default TrialRefundRequest;

const Card = styled.div`
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px;
`;
const Line = styled.div`
  display: flex; align-items: center; gap: 12px; justify-content: space-between;
  @media (max-width: 640px) { flex-direction: column; align-items: stretch; }
`;
const Text = styled.div`font-size: 0.8125rem; color: #475569; line-height: 1.6;`;
const Lead = styled.div`font-size: 0.875rem; color: #0F172A; line-height: 1.6;`;
const Small = styled.div`font-size: 0.75rem; color: #64748B; line-height: 1.5;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 4px;`;
const Label = styled.label`font-size: 0.75rem; font-weight: 600; color: #334155;`;
const Input = styled.input`
  height: 40px; padding: 0 12px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A; font-family: inherit;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const Textarea = styled.textarea`
  padding: 8px 12px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; color: #0F172A; font-family: inherit; resize: vertical;
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }
`;
const Err = styled.div`font-size: 0.8125rem; color: #DC2626;`;
