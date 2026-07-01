// Q file 전역 페이지 — 워크스페이스 전체 파일 + 내 개인 Drive (외부 연동 Phase 4)
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import DocsTab from '../QProject/DocsTab';
import PersonalDriveTab from './PersonalDriveTab';
import { useAuth } from '../../contexts/AuthContext';

type FileTab = 'workspace' | 'personal';

const QFilePage: React.FC = () => {
  const { t } = useTranslation('qfile');
  const { user } = useAuth();
  const businessId = user?.business_id;
  const [tab, setTab] = useState<FileTab>('workspace');

  if (!businessId) {
    return (
      <PageShell title={t('page.title', 'Q file') as string}>
        <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>
          {t('page.noWorkspace', '워크스페이스를 먼저 선택하세요')}
        </div>
      </PageShell>
    );
  }

  const tabs = (
    <Tabs role="tablist">
      <Tab type="button" role="tab" aria-selected={tab === 'workspace'} $active={tab === 'workspace'} onClick={() => setTab('workspace')}>
        {t('tabs.workspace', { defaultValue: '회사 파일' }) as string}
      </Tab>
      <Tab type="button" role="tab" aria-selected={tab === 'personal'} $active={tab === 'personal'} onClick={() => setTab('personal')}>
        {t('tabs.personal', { defaultValue: '내 파일 (Drive)' }) as string}
      </Tab>
    </Tabs>
  );

  return (
    <PageShell title={t('page.title', 'Q file') as string} actions={tabs}>
      {tab === 'workspace'
        ? <DocsTab scope={{ type: 'workspace', businessId }} />
        : <PersonalDriveTab businessId={Number(businessId)} />}
    </PageShell>
  );
};

export default QFilePage;

const Tabs = styled.div`
  display: inline-flex; gap: 4px; padding: 3px;
  background: #F1F5F9; border-radius: 10px;
`;
const Tab = styled.button<{ $active: boolean }>`
  height: 32px; padding: 0 14px; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  background: ${(p) => (p.$active ? '#FFFFFF' : 'transparent')};
  color: ${(p) => (p.$active ? '#0F766E' : '#64748B')};
  box-shadow: ${(p) => (p.$active ? '0 1px 2px rgba(15,23,42,0.08)' : 'none')};
  transition: background 0.12s, color 0.12s;
  &:hover { color: #0F172A; }
  &:focus-visible { outline: 2px solid #8B5CF6; outline-offset: 2px; }
`;
