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

// 사용자 호소: "좌우 풀이 아니야" — max-width: 720px 가 본문 폭 제한. PageShell 의 표준 body
// padding 안에서 좌우 풀 차지하도록 max-width 제거. 단일 column flex 유지 (카드 2개 세로 배치).
const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;
