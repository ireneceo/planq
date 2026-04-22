// Q docs — 워크스페이스 전역 문서 허브 (Q Note 와 동일 레이아웃 패턴)
// PostsPage 가 자체 Layout(Sidebar + Content + PanelHeader) 관리. PageShell 사용 안 함.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PostsPage from '../../components/Docs/PostsPage';
import { useAuth } from '../../contexts/AuthContext';

const QDocsPage: React.FC = () => {
  const { t } = useTranslation('qdocs');
  const { user } = useAuth();
  const businessId = user?.business_id;

  if (!businessId) {
    return (
      <Fallback>
        {t('page.noWorkspace', '워크스페이스를 먼저 선택하세요')}
      </Fallback>
    );
  }

  return (
    <FullHeight>
      <PostsPage scope={{ type: 'workspace', businessId }} />
    </FullHeight>
  );
};

export default QDocsPage;

const FullHeight = styled.div`
  height: 100vh;
  background: #F8FAFC;
  padding: 16px;
  @media (max-width: 768px) { height: calc(100vh - 56px); padding: 12px; }
`;
const Fallback = styled.div`
  padding: 40px; text-align: center; color: #94A3B8; font-size: 13px;
`;
