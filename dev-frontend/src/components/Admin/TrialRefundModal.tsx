// 관리자 «환불 요청 처리» 창 — docs/TRIAL_REFUND_DESIGN.md §4·§5
//
//   요청이 둘이다(2026-10-19 — 일반 환불 요청도 결제에 묶여 여기로 온다, routes/plan_refund):
//     · trial  — 체험 중 결제. 처리 = mode 'trial'(구독이 체험으로 돌아간다).
//     · general — 그 밖의 결제. 약관 제4조 기준으로 판단해 처리 = mode 'manual'(결제만 환불 — 구독은 그대로) 또는 [반려](사유 → 대표 알림).
//     어느 쪽인지는 서버가 판정한 refund_request_trial 을 읽는다(화면이 고르지 않는다).
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
  /** 서버 판정 — 체험 중 결제 환불이면 true */
  trial: boolean;
  /** 서버 판정 — 일반 환불이 구독 해지(무료 전환)를 부르는가 (docs/REFUND_CANCEL_DESIGN.md §5-1) */
  cancelsSubscription?: boolean;
  /** 애드온 결제면 돌아가는 한도 수 */
  addonUnits?: number | null;
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
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [keepSubscription, setKeepSubscription] = useState(false);

  useEffect(() => {
    setViaStripe(true); setTransferred(false); setAccount(null); setAccountLoaded(false); setError(null);
    setDeclining(false); setDeclineReason(''); setKeepSubscription(false);
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
  const trial = target.trial;
  const canSubmit = declining ? !!declineReason.trim() : (isCard ? true : transferred);

  const decline = async () => {
    if (!declineReason.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/admin/payments/${target.id}/refund-request/decline`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason.trim() }),
      });
      const j = await r.json();
      if (!j?.success) throw new Error(j?.message || 'failed');
      onDone();
    } catch (e) {
      setError(t('payments.trialRefundFailed', { code: (e as Error).message, defaultValue: '환불 처리 실패 ({{code}})' }) as string);
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/admin/payments/${target.id}/refund`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: trial ? 'trial' : 'manual',
          via_stripe: isCard && target.hasStripeIntent ? viaStripe : false,
          ...(trial ? {} : { keep_subscription: keepSubscription }),
          reason: trial ? t('payments.trialRefundReason', '체험 중 환불') : t('payments.requestRefundReason', '고객 요청 환불'),
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
    <StandardModal open onClose={onClose} size="sm"
      title={(trial ? t('payments.trialRefundTitle', '체험 중 결제 환불') : t('payments.requestRefundTitle', '환불 요청 처리')) as string}
      ariaLabel={(trial ? t('payments.trialRefundTitle', '체험 중 결제 환불') : t('payments.requestRefundTitle', '환불 요청 처리')) as string}
      footer={declining ? (
        <>
          <ActionButton tone="secondary" size="md" onClick={() => setDeclining(false)}>{t('payments.back', '돌아가기') as string}</ActionButton>
          <ActionButton tone="danger" size="md" loading={busy} disabled={!canSubmit} onClick={decline} data-testid="admin-refund-decline-submit">
            {t('payments.declineSubmit', '요청 반려') as string}
          </ActionButton>
        </>
      ) : (
        <>
          <ActionButton tone="secondary" size="md" onClick={() => { setError(null); setDeclining(true); }} data-testid="admin-refund-decline-open">
            {t('payments.decline', '반려') as string}
          </ActionButton>
          <ActionButton tone="danger" size="md" loading={busy} disabled={!canSubmit} onClick={submit} data-testid="admin-trial-refund-submit">
            {t('payments.trialRefundSubmit', '환불 처리') as string}
          </ActionButton>
        </>
      )}>
      <Lead>
        {trial ? t('payments.trialRefundLead', {
          biz: target.businessName || '', amount: fmtMoney(target.amount, target.currency),
          defaultValue: '{{biz}} 의 {{amount}} 결제를 전액 환불합니다. 처리하면 구독이 체험 상태로 돌아갑니다(체험 종료일은 그대로).',
        }) as string : t('payments.requestRefundLead', {
          biz: target.businessName || '', amount: fmtMoney(target.amount, target.currency),
          defaultValue: '{{biz}} 가 {{amount}} 결제의 환불을 요청했습니다. 약관 제4조(월간 7일·연간 14일 이내 전액, 그 뒤 일할)로 확인한 뒤 처리하거나 반려하세요.',
        }) as string}
      </Lead>
      {!trial && (
        <Effect data-testid="admin-refund-effect">
          {target.cancelsSubscription
            ? (keepSubscription ? t('payments.refundEffectKept', '결제만 환불로 기록되고 구독은 그대로입니다(보상성 환불).') : t('payments.refundEffectCancel', '처리하면 전액 환불되고 워크스페이스가 무료 플랜으로 바뀝니다(구독 해지).'))
            : target.addonUnits != null
              ? (keepSubscription ? t('payments.refundEffectKept', '결제만 환불로 기록되고 구독은 그대로입니다(보상성 환불).') : t('payments.refundEffectAddon', { units: target.addonUnits, defaultValue: '애드온 한도 {{units}} 이 돌아갑니다(줄어듭니다).' }))
              : t('payments.refundEffectKeep', '지금 구독의 결제가 아니라 구독은 그대로입니다.')}
        </Effect>
      )}
      {!trial && !declining && (target.cancelsSubscription || target.addonUnits != null) && (
        <Check>
          <input type="checkbox" checked={keepSubscription} onChange={(e) => setKeepSubscription(e.target.checked)} data-testid="admin-refund-keep" />
          <span>{t('payments.refundKeepSub', '구독은 유지 — 보상성 환불') as string}</span>
        </Check>
      )}
      <Meta>
        <span>{isCard ? t('payments.method.card', '카드') : t('payments.method.bank_transfer', '계좌이체')}</span>
        <span>{t('payments.trialRefundRequested', { date: fmtDate(target.requestedAt), defaultValue: '{{date}} 요청' }) as string}</span>
      </Meta>
      {target.note && <Note>{t('payments.requestReason', { note: target.note, defaultValue: '고객 사유: {{note}}' }) as string}</Note>}
      {declining ? (
        <DeclineBox>
          <label htmlFor="rf-decline">{t('payments.declineReason', '반려 사유 (대표에게 알림으로 갑니다)') as string}</label>
          {/* draft-exempt: 창 안에서 바로 보내는 짧은 사유 */}
          <textarea id="rf-decline" rows={3} maxLength={255} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} data-testid="admin-refund-decline-reason"
            placeholder={t('payments.declineReasonPh', '예: 결제일로부터 7일이 지나 전액 환불 대상이 아닙니다. 일할 환불은 고객 지원 이메일로 안내드립니다.') as string} />
          {error && <Err role="alert">{error}</Err>}
        </DeclineBox>
      ) : (<>
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
      </>)}
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
const DeclineBox = styled.div`display: flex; flex-direction: column; gap: 6px;
  label { font-size: 0.75rem; font-weight: 600; color: #334155; }
  textarea { padding: 8px 12px; border: 1px solid #E2E8F0; border-radius: 8px; font-size: 0.875rem; font-family: inherit; resize: vertical; }
  textarea:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.12); }`;
const Effect = styled.div`font-size: 0.8125rem; font-weight: 600; color: #BE123C; background: #FFF1F2; border: 1px solid #FECDD3; border-radius: 8px; padding: 8px 10px; line-height: 1.5;`;
const Err = styled.div`font-size: 0.8125rem; color: #DC2626;`;
