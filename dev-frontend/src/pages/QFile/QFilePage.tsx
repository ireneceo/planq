// Q file 전역 페이지 — 워크스페이스 전체 파일 통합 뷰
// DocsTab 컴포넌트를 workspace scope 로 재사용 (레거시 이름 유지,
// 청크 5 에서 진짜 문서 기능 분리되면 파일 전용 컴포넌트로 재작성 예정)
import React from 'react';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import DocsTab from '../QProject/DocsTab';
import { useAuth } from '../../contexts/AuthContext';

const QFilePage: React.FC = () => {
  const { t } = useTranslation('qfile');
  const { user } = useAuth();
  const businessId = user?.business_id;

  if (!businessId) {
    return (
      <PageShell title={t('page.title', 'Q file') as string}>
        <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>
          {t('page.noWorkspace', '워크스페이스를 먼저 선택하세요')}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={t('page.title', 'Q file') as string}>
      <DocsTab scope={{ type: 'workspace', businessId }} />
    </PageShell>
  );
};

export default QFilePage;
