// Q docs 전역 페이지 — 워크스페이스 문서 (포스팅) 허브
// 청크 5 에서 Tiptap 에디터 + posts 테이블 기반으로 본격 구현.
// 지금은 placeholder (파일 모음은 Q file 로 이동됨).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';

const QDocsPage: React.FC = () => {
  const { t } = useTranslation('qdocs');

  return (
    <PageShell title={t('page.title', 'Q docs') as string}>
      <Empty>
        <EmptyIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </EmptyIcon>
        <Title>{t('page.empty.title', '문서 기능 준비 중')}</Title>
        <Desc>
          {t('page.empty.desc', '매뉴얼·가이드·공지 등 포스팅 형식의 문서 기능을 준비하고 있습니다. 파일은 Q file 에서 관리하세요.')}
        </Desc>
      </Empty>
    </PageShell>
  );
};

export default QDocsPage;

const Empty = styled.div`
  background: #fff; border: 1px dashed #CBD5E1; border-radius: 14px;
  padding: 64px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;
`;
const EmptyIcon = styled.svg`width: 40px; height: 40px; color: #94A3B8;`;
const Title = styled.div`font-size: 16px; font-weight: 700; color: #334155;`;
const Desc = styled.p`font-size: 13px; color: #64748B; line-height: 1.6; max-width: 440px; margin: 0;`;
