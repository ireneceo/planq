// 관리자 «체험 환불 처리» 창 — docs/TRIAL_REFUND_DESIGN.md §4·§5
//
//   카드(Stripe 결제): «Stripe 로 카드 환불 실행» 기본 켬 — 끄면 이미 Stripe 대시보드에서 돌려준 건으로 기록만 한다.
//   계좌이체: 사용자가 적은 환불 계좌를 보여 주고(읽는 문 GET refund-account — 열람이 감사에 남는다),
//            «이체를 마쳤습니다» 를 확인해야 처리한다(돈 먼저, 장부 나중).
//   처리 = POST /api/admin/payments/:id/refund { mode:'trial', via_stripe } — 구독이 체험 상태로 돌아간다.
import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import StandardModal from '../Common/StandardModal';
import ActionButton from '../Common/ActionButton';
import { apiFetch } from '../../contexts/AuthContext';

export interface TrialRefundTarget {
  id: number;
  amount: number;
  currency: string;
  method: string;
  businessName: string | null;
  requestedAt: string | null;
  note: string | null;
  hasStripeIntent: boolean;
  taxIssued: boolean;
}

interface Props {
  target: TrialRefundTarget | null;
  onClose: () => void;
  onDone: () => void;
  fmtMoney: (n: number, cur: string) => string;
  fmtDate: (s: string | null) => string;
}

const TrialRefundModal: React.FC<Props> = ({ target, onClose, onDone, fmtMoney, fmtDate }) => {
  const { t } = useTranslation('admin');
  const isCard = !!target && (target.method === 'stripe' || target.method === 'card');
  const [viaStripe, setViaStripe] = useState(true);
  const [transferred, setTransferred] = useState(false);
  const [account, setAccount] = useState<{ bank: string; number: string; holder: string } | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setViaStripe(true); setTransferred(false); setAccount(null); setAccountLoaded(false); setError(null);
    if (!target || isCard) return;
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/admin/payments/${target.id}/refund-account`);
        const j = await r.json();
        if (alive && j?.success) setAccount(j.data?.account || null);
      } catch { /* 아래 «계좌 없음» 으로 보인다 */ }
      if (alive) setAccountLoaded(true);
    })();
    return () => { alive = false; };
  }, [target, isCard]);

  if (!target) return null;
  const canSubmit = isCard ? true : transferred;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/admin/payments/${target.id}/refund`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'trial',
          via_stripe: isCard && target.hasStripeIntent ? viaStripe : false,
          reason: t('payments.trialRefundReason', '체험 중 환불'),
        }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.message || 'failed');
      onDone();
    } catch (e) {
      setError(t(`payments.trialRefundErr.${(e as Error).message}`, {
        defaultValue: t('payments.trialRefundFailed', { code: (e as Error).message, defaultValue: '환불 처리 실패 ({{code}})' }) as string,
      }) as string);
    } finally { setBusy(false); }
  };

  return (
    <StandardModal open onClose={onClose} title={t('payments.trialRefundTitle', '체험 중 결제 환불') as string} size="sm"
      ariaLabel={t('payments.trialRefundTitle', '체험 중 결제 환불') as string}
      footer={(
        <>
          <ActionButton tone="secondary" size="md" onClick={onClose}>{t('payments.cancel', '취소') as string}</ActionButton>
          <ActionButton tone="danger" size="md" loading={busy} disabled={!canSubmit} onClick={submit} data-testid="admin-trial-refund-submit">
            {t('payments.trialRefundSubmit', '환불 처리') as string}
          </ActionButton>
        </>
      )}>
      <Lead>
        {t('payments.trialRefundLead', {
          biz: target.businessName || '', amount: fmtMoney(target.amount, target.currency),
          defaultValue: '{{biz}} 의 {{amount}} 결제를 전액 환불합니다. 처리하면 구독이 체험 상태로 돌아갑니다(체험 종료일은 그대로).',
        }) as string}
      </Lead>
      <Meta>
        <span>{isCard ? t('payments.method.card', '카드') : t('payments.method.bank_transfer', '계좌이체')}</span>
        <span>{t('payments.trialRefundRequested', { date: fmtDate(target.requestedAt), defaultValue: '{{date}} 요청' }) as string}</span>
      </Meta>
      {target.note && <Note>{target.note}</Note>}
      {target.taxIssued && <Warn>{t('payments.trialRefundTaxIssued', '세금계산서가 이미 발행됐습니다 — 수정세금계산서를 따로 발행하세요.') as string}</Warn>}

      {isCard ? (
        target.hasStripeIntent ? (
          <Check>
            <input type="checkbox" checked={viaStripe} onChange={(e) => setViaStripe(e.target.checked)} data-testid="admin-trial-refund-stripe" />
            <span>{t('payments.trialRefundViaStripe', 'Stripe 로 카드 환불 실행 (끄면 기록만 — 이미 Stripe 에서 돌려준 경우)') as string}</span>
          </Check>
        ) : (
          <Hint>{t('payments.trialRefundNoIntent', '이 결제에는 Stripe 결제 번호가 없습니다 — 카드사·Stripe 에서 직접 환불한 뒤 처리하세요.') as string}</Hint>
        )
      ) : (
        <>
          <AccountBox data-testid="admin-trial-refund-account">
            {!accountLoaded ? t('payments.loading', '불러오는 중…') as string
              : account ? (<><b>{account.bank}</b> {account.number} · {account.holder}</>)
                : t('payments.trialRefundNoAccount', '받은 환불 계좌가 없습니다 — 고객에게 연락해 받으세요.') as string}
          </AccountBox>
          <Check>
            <input type="checkbox" checked={transferred} onChange={(e) => setTransferred(e.target.checked)} data-testid="admin-trial-refund-transferred" />
            <span>{t('payments.trialRefundTransferred', '위 계좌로 이체를 마쳤습니다') as string}</span>
          </Check>
        </>
      )}
      {error && <Err role="alert">{error}</Err>}
    </StandardModal>
  );
};

export default TrialRefundModal;

const Lead = styled.div`font-size: 0.875rem; color: #0F172A; line-height: 1.6;`;
const Meta = styled.div`display: flex; gap: 10px; font-size: 0.8125rem; color: #64748B;`;
const Note = styled.div`font-size: 0.8125rem; color: #475569; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 8px 10px; white-space: pre-wrap;`;
const Warn = styled.div`font-size: 0.8125rem; color: #92400E; background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 8px 10px;`;
const Hint = styled.div`font-size: 0.8125rem; color: #64748B; line-height: 1.5;`;
const AccountBox = styled.div`font-size: 0.875rem; color: #0F172A; background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 8px; padding: 10px 12px;`;
const Check = styled.label`display: flex; align-items: flex-start; gap: 8px; font-size: 0.8125rem; color: #0F172A; cursor: pointer; line-height: 1.5;
  input { margin-top: 2px; }`;
const Err = styled.div`font-size: 0.8125rem; color: #DC2626;`;
