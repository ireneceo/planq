// Q docs — 워크스페이스 전역 문서 허브 (PostsPage 사용)
// 템플릿/AI 기능은 PostsPage 안의 "새 글" 진입에 흡수됨.
import React, { useMemo } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PostsPage from '../../components/Docs/PostsPage';
import { useAuth } from '../../contexts/AuthContext';

const QDocsPage: React.FC = () => {
  const { t } = useTranslation('qdocs');
  const { user } = useAuth();
  const businessId = user?.business_id;

  // scope 객체는 useMemo 로 안정화 — props 가 매 렌더 새 객체면 PostsPage 의
  // useCallback(load, [scope]) 가 매번 재생성되어 fetchPosts 무한 호출 → 에디터 unmount/remount.
  const scope = useMemo(
    () => (businessId ? { type: 'workspace' as const, businessId: Number(businessId) } : null),
    [businessId]
  );

  if (!scope) {
    return <Fallback>{t('page.noWorkspace', '워크스페이스를 먼저 선택하세요')}</Fallback>;
  }

  return (
    <FullHeight>
      <PostsPage scope={scope} />
    </FullHeight>
  );
};

export default QDocsPage;

const FullHeight = styled.div`
  height: 100vh;
  @media (max-width: 768px) { height: calc(100vh - 56px); }
`;
const Fallback = styled.div`
  padding: 40px; text-align: center; color: #94A3B8; font-size: 13px;
`;
