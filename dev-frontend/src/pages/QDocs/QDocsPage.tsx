// Q docs — 워크스페이스 전역 문서 허브
import React from 'react';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import PostsPage from '../../components/Docs/PostsPage';
import { useAuth } from '../../contexts/AuthContext';

const QDocsPage: React.FC = () => {
  const { t } = useTranslation('qdocs');
  const { user } = useAuth();
  const businessId = user?.business_id;

  if (!businessId) {
    return (
      <PageShell title={t('page.title', 'Q docs') as string}>
        <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>
          {t('page.noWorkspace', '워크스페이스를 먼저 선택하세요')}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={t('page.title', 'Q docs') as string}>
      <PostsPage scope={{ type: 'workspace', businessId }} />
    </PageShell>
  );
};

export default QDocsPage;
