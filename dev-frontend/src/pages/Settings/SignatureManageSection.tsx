// 설정 › 서명 관리 — 워크스페이스에서 오간 서명·확인 요청 전체 (2026-10-23, docs/SIGNATURE_MANAGE_DESIGN.md)
//   Irene: «전체 워크스페이스 설정에서 받은/보낸서명 관리가 있어서 다 정보가 리스트업 … 보낸담당자 누군지도»
//   목록·동작은 개인 «보낸 서명» 과 같은 컴포넌트(SignatureRequestList mode=manage) — 범위만 워크스페이스 전체.
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import SignatureRequestList from '../../components/Signatures/SignatureRequestList';

export default function SignatureManageSection({ businessId }: { businessId: number }) {
  const { t } = useTranslation('qdocs');
  return (
    <div data-testid="settings-signatures">
      <Lead>{t('sigManage.manageLead', '이 워크스페이스에서 보낸 서명·확인 요청 전체예요. 누가 보냈는지, 받는 분이 서명했는지 보고 다시 보내거나 취소할 수 있어요. 고치려면 문서에서 [고쳐서 다시 보내기] 를 누르세요. 서명 기록은 증빙이라 지우지 않고, 볼 수 없는 문서(나만 보기 등)는 내용을 가립니다.')}</Lead>
      <SignatureRequestList mode="manage" businessId={businessId} />
    </div>
  );
}

const Lead = styled.p`margin: 0; font-size: 0.8125rem; line-height: 1.6; color: #475569;`;
