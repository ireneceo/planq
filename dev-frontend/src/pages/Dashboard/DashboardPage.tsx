import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';

const DashboardPage: React.FC = () => {
  const { t } = useTranslation('dashboard');

  return (
    <PageShell title={t('title')}>
      <FutureArea>
        <FutureHint>Phase 1 청구/결제 · Phase 4 통계 요약 카드 영역</FutureHint>
      </FutureArea>
    </PageShell>
  );
};

export default DashboardPage;

const FutureArea = styled.div`
  background: #FFFFFF;
  border: 1px dashed #CBD5E1;
  border-radius: 12px;
  padding: 80px 20px;
  text-align: center;
`;

const FutureHint = styled.div`
  font-size: 13px;
  color: #94A3B8;
  font-style: italic;
`;
