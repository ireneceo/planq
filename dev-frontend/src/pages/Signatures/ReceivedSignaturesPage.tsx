// 받은·보낸 서명 — 한 화면 두 탭 (2026-10-23, docs/SIGNATURE_MANAGE_DESIGN.md)
//   받은 = 내가 서명할 것(모든 워크스페이스) · 보낸 = 내가 요청한 것(지금 워크스페이스).
//   주소가 탭이다(/signatures/received · /signatures/sent) — 알림 링크 ?sig= · 보관 링크가 그대로 산다.
//   워크스페이스 전체는 설정 › 서명 관리(owner/admin).
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import PageShell from '../../components/Layout/PageShell';
import { SegmentedToggle, SegmentedBtn } from '../../components/Common/segmentedToggle';
import SignatureRequestList from '../../components/Signatures/SignatureRequestList';
import { useAuth } from '../../contexts/AuthContext';
import ReceivedSignaturesList from './ReceivedSignaturesList';

const ReceivedSignaturesPage = () => {
  const { t } = useTranslation('qdocs');
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : null;
  const tab: 'received' | 'sent' = location.pathname.startsWith('/signatures/sent') ? 'sent' : 'received';
  // 보내기는 워크스페이스 멤버의 일이다 — 고객(받기만)에게는 탭을 두지 않는다
  const canSend = !!businessId && (user?.business_role === 'owner' || user?.business_role === 'admin' || user?.business_role === 'member');
  return (
    <PageShell
      title={t('receivedSignatures.pageTitle2', '받은·보낸 서명')}
      actions={canSend ? (
        <SegmentedToggle role="tablist" data-testid="sig-tabs">
          <SegmentedBtn type="button" role="tab" aria-selected={tab === 'received'} $active={tab === 'received'} data-testid="sig-tab-received"
            onClick={() => navigate('/signatures/received')}>{t('receivedSignatures.tabReceived', '받은 서명')}</SegmentedBtn>
          <SegmentedBtn type="button" role="tab" aria-selected={tab === 'sent'} $active={tab === 'sent'} data-testid="sig-tab-sent"
            onClick={() => navigate('/signatures/sent')}>{t('receivedSignatures.tabSent', '보낸 서명')}</SegmentedBtn>
        </SegmentedToggle>
      ) : undefined}
    >
      {tab === 'sent' && canSend && businessId
        ? <SignatureRequestList mode="sent" businessId={businessId} />
        : <ReceivedSignaturesList />}
    </PageShell>
  );
};

export default ReceivedSignaturesPage;
