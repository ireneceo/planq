// N+32 — 내 업무 설정 페이지. ProfilePage 에서 분리.
// 포함: 타임존 (UserTimezoneSection) + 업무 흐름 (FocusSettingsCard)
// 사이드바 secondary nav 의 "개인" 그룹에 추가.

import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PageShell from '../../components/Layout/PageShell';
import FocusSettingsCard from '../../components/Focus/FocusSettingsCard';
import { UserTimezoneSection } from './ProfilePage';

const MyWorkSettingsPage: React.FC = () => {
  const { t } = useTranslation(['common', 'focus']);
  return (
    <PageShell title={t('common:nav.myWorkSettings', '내 업무 설정') as string}>
      <Body>
        <UserTimezoneSection />
        <FocusSettingsCard />
      </Body>
    </PageShell>
  );
};

export default MyWorkSettingsPage;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
`;
