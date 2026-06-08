// QTalkStandalonePage — Q Talk 분리 창 (#9, N+93)
//   QTalkPage 헤더의 ⧉ "새 창으로 분리" 클릭 시 window.open('/talk-popout?conv=...') 로 열림.
//   MainLayout 우회 (사이드바/헤더 없음) → 데스크탑앱 밖에 띄워두고 채팅 이어가기.
//   QTalkPage 는 user.business_id + URL ?conv 로 자체완결 → 그대로 재사용. 인증은 refresh 쿠키로 부트스트랩.
import React, { useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import QTalkPage from './QTalkPage';

const QTalkStandalonePage: React.FC = () => {
  const { t } = useTranslation('qtalk');
  useEffect(() => {
    document.title = t('popout.title', { defaultValue: 'PlanQ 채팅' }) as string;
    document.body.dataset.popout = '1';
    return () => { delete document.body.dataset.popout; };
  }, [t]);
  return (
    <Shell>
      <QTalkPage />
    </Shell>
  );
};

export default QTalkStandalonePage;

const Shell = styled.div`
  height: 100vh;
  height: 100dvh;
  width: 100vw;
  overflow: hidden;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
`;
