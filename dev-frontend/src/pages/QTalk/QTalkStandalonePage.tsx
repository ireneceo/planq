// QTalkStandalonePage — Q Talk 분리 창 (#9, N+93)
//   RightDock / ChatPanel 의 ⧉ 클릭 시 window.open('/talk-popout?conv=...') 로 열림.
//   MainLayout 우회(사이드바/헤더 없음) + QTalkPage embedded 모드 → 데스크탑앱 밖에서 채팅 이어가기.
//   embedded 가 URL 싱크를 끄므로 팝아웃이 /talk 로 튕기지 않고 chrome-less 유지 (재로그인 회귀 차단).
//   인증은 refresh 쿠키로 자체 부트스트랩 (AuthProvider checkSession).
import React, { useEffect } from 'react';
import styled from 'styled-components';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QTalkPage from './QTalkPage';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const QTalkStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qtalk');
  const [params] = useSearchParams();
  const convId = Number(params.get('conv')) || null;
  const projectId = Number(params.get('project')) || null;

  useEffect(() => {
    document.title = t('popout.title', { defaultValue: 'PlanQ 채팅' }) as string;
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84
    return () => { delete document.body.dataset.popout; };
  }, [t]);

  return (
    <Shell>
      <QTalkPage embedded initialConvId={convId} initialProjectId={projectId} />
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
  /* #84 — 팝아웃 헤더 모바일 노치/상태바 대응 (전 팝아웃 통일). box-sizing 으로 내용 영역이 노치 아래에서 시작. */
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top, 0);
`;
