// 구독 환불 안내·요청 입구 — 요금제 화면 «결제 이력» (2026-10-12)
//
// 고객 신고: *"환불신청하는 기능이 없어요! 안그래도 환불처리 할까 싶었는데, 기능없어서 못했어요."*
// 환불 문은 «체험 중 결제»(TrialRefundRequest) 하나뿐이었고, 자격이 없으면 그 컴포넌트가 조용히 사라져
// 체험 뒤 결제·갱신 결제 고객에게는 환불 관련 글자가 한 줄도 없었다. 약관 제4조는 7일/14일 환불을 약속한다.
// → 결제 이력 위에 기준 한 줄 + [환불 요청], 결제 행마다 [환불 요청].
//   ★ 2026-10-19 — 요청은 문의 창이 아니라 그 결제에 단다(RefundRequestModal → routes/plan_refund).
//     문의로 받으니 관리자에겐 «새 문의 #3» + [문의 보기] 만 가고 처리할 결제가 어디인지 몰랐다.
//   처리는 관리자 결제 관리 [환불 처리](services/refund.refundPayment) / [반려]. 체험 중 결제는 전용 카드가 받는다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

/** 결제 이력 위 안내 줄 — 대표는 [환불 요청], 멤버는 «대표가 요청» 안내 */
export const RefundHelpLine: React.FC<{ isOwner: boolean; canRequest: boolean; onRequest: () => void }> = ({ isOwner, canRequest, onRequest }) => {
  const { t } = useTranslation('plan');
  return (
    <Line data-testid="plan-refund-help">
      <span>{t('refundHelp.policy', '환불 기준(약관 제4조): 체험 중 결제는 체험이 끝나기 전 해지하면 전액 · 월간 결제는 결제일로부터 7일 이내 전액 · 연간 결제는 14일 이내 전액, 그 뒤엔 남은 기간 일할 환불.')}</span>
      {isOwner ? (canRequest && (
        <Btn type="button" data-testid="plan-refund-inquiry" onClick={onRequest}>{t('refundHelp.request', '환불 요청')}</Btn>
      )) : (
        <span>{t('refundHelp.ownerOnly', '환불은 워크스페이스 대표가 요청할 수 있습니다.')}</span>
      )}
    </Line>
  );
};

/** 결제 행의 [환불 요청] — 그 결제를 골라 둔 채 요청 창을 연다 */
export const RefundRowButton: React.FC<{ onRequest: () => void }> = ({ onRequest }) => {
  const { t } = useTranslation('plan');
  return (
    <RowBtn type="button" data-testid="plan-refund-row" onClick={onRequest}>
      {t('refundHelp.request', '환불 요청')}
    </RowBtn>
  );
};

const Line = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  margin: 0 0 10px; padding: 10px 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.75rem; line-height: 1.5; color: #475569;
`;
const Btn = styled.button`
  flex-shrink: 0;
  font-size: 0.75rem; font-weight: 600; font-family: inherit; color: #0D9488;
  padding: 6px 12px; min-height: 32px; background: #fff; cursor: pointer;
  border: 1px solid #5EEAD4; border-radius: 6px;
  &:hover { background: #F0FDFA; }
`;
// 영수증 버튼(PlanSettings ReceiptLink)과 같은 모양
const RowBtn = styled.button`
  font-size: 0.6875rem; color: #0D9488; font-weight: 600; font-family: inherit;
  padding: 4px 10px; background: transparent; cursor: pointer;
  border: 1px solid #5EEAD4; border-radius: 6px;
  &:hover { background: #F0FDFA; }
`;
