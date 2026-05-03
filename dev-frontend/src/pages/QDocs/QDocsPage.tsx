// Q docs — 워크스페이스 문서 페이지.
//
// 2026-05-03: 받은 서명 archive 를 /signatures/received 로 분리 (능동 vs 수동 정신 모델 분리).
// 이전 ?tab=received-signatures URL 은 /signatures/received 로 redirect (북마크 호환).

import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PostsPage from '../../components/Docs/PostsPage';
import { useAuth } from '../../contexts/AuthContext';

const QDocsPage: React.FC = () => {
  const { t } = useTranslation('qdocs');
  const { user } = useAuth();
  const businessId = user?.business_id;
  const location = useLocation();
  const navigate = useNavigate();

  // 이전 받은 서명 탭 URL 호환 — 북마크/외부 링크 보호
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'received-signatures') {
      navigate('/signatures/received', { replace: true });
    }
  }, [location.search, navigate]);

  const scope = useMemo(
    () => (businessId ? { type: 'workspace' as const, businessId: Number(businessId) } : null),
    [businessId]
  );

  return (
    <FullHeight>
      {scope ? <PostsPage scope={scope} /> : <Fallback>{t('page.noWorkspace')}</Fallback>}
    </FullHeight>
  );
};

export default QDocsPage;

const FullHeight = styled.div`
  height: 100vh;
  display: flex;
  flex-direction: column;
  @media (max-width: 768px) { height: calc(100vh - 56px); }
`;
const Fallback = styled.div`padding: 40px; text-align: center; color: #94A3B8; font-size: 13px;`;
