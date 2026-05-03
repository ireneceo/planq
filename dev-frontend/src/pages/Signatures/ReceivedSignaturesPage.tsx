// 받은 서명 archive — cross-workspace 전체 history.
// 인박스가 pending action 만 자동 노출. 이 페이지는 "내가 서명한 모든 history" + 상태별 필터·검색·archive.
// 이전 위치: Q docs 의 "받은 서명" 탭. 능동(문서) vs 수동(받은 서명) 정신 모델 분리 위해 이전 (2026-05-03).

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import PageShell from '../../components/Layout/PageShell';
import ReceivedSignaturesList from './ReceivedSignaturesList';

const ReceivedSignaturesPage = () => {
  const { t } = useTranslation('qdocs');
  return (
    <PageShell
      title={t('receivedSignatures.pageTitle', '받은 서명')}
      actions={
        <BackLink to="/inbox" title={t('receivedSignatures.backToInbox', '인박스로') as string}>
          ← {t('receivedSignatures.backToInbox', '인박스로')}
        </BackLink>
      }
    >
      <ReceivedSignaturesList />
    </PageShell>
  );
};

export default ReceivedSignaturesPage;

const BackLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #64748B;
  text-decoration: none;
  padding: 6px 10px;
  border-radius: 6px;
  &:hover { color: #0F766E; background: #F0FDFA; }
`;
