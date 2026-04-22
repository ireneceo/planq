// 공용 플레이스홀더 — 라우트는 활성화되어 있지만 기능은 개발 중.
// 사이드바 네비에서 클릭하면 정상 이동하고, 이 페이지가 "준비 중" 안내.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';

interface Props {
  titleKey: string;
  titleFallback: string;
  descKey?: string;
  descFallback?: string;
}

const ComingSoonPage: React.FC<Props> = ({ titleKey, titleFallback, descKey, descFallback }) => {
  const { t } = useTranslation('common');
  return (
    <PageShell title={t(titleKey, titleFallback) as string}>
      <Wrap>
        <IconBox>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </IconBox>
        <Title>{t('comingSoon.title', '곧 제공됩니다')}</Title>
        <Desc>
          {descKey
            ? t(descKey, descFallback || '이 기능은 현재 개발 중입니다.')
            : t('comingSoon.defaultDesc', '이 기능은 현재 개발 중입니다. 완성되는 대로 공개됩니다.')}
        </Desc>
      </Wrap>
    </PageShell>
  );
};

export default ComingSoonPage;

const Wrap = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 24px; text-align: center; color: #64748B;
`;
const IconBox = styled.div`
  width: 96px; height: 96px; border-radius: 50%;
  background: #F0FDFA; color: #14B8A6;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 24px;
`;
const Title = styled.h2`
  font-size: 20px; font-weight: 700; color: #0F172A; margin: 0 0 8px;
`;
const Desc = styled.p`
  font-size: 14px; color: #64748B; max-width: 420px; line-height: 1.6; margin: 0;
`;
