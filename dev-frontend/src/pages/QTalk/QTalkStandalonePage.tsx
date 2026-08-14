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
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import { usePinContent } from '../../utils/pinHost';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const QTalkStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qtalk');
  const [params] = useSearchParams();
  const convId = Number(params.get('conv')) || null;
  const projectId = Number(params.get('project')) || null;
  const pin = usePinContent('qtalk');

  useEffect(() => {
    document.title = t('popout.title', { defaultValue: 'PlanQ 채팅' }) as string;
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84
    return () => { delete document.body.dataset.popout; };
  }, [t]);

  return (
    <Shell>
      <QTalkPage
        embedded
        initialConvId={convId}
        initialProjectId={projectId}
        pinSlot={<PopoutPinButton pin={pin} />}
        onEmbeddedContextChange={(p, c) => {
          // 이 창의 URL 만 조용히 갱신 (navigate 금지 — 팝아웃이 /talk 로 튕긴다).
          // 새로고침·공유 시 보던 대화가 유지된다. (핀은 메인 탭이 소유하므로 이 URL 을 물려받지 않는다 —
          //  도크 핀은 항상 기본 /talk-popout 으로 연다. 2026-08-14 재구조화.)
          const sp = new URLSearchParams();
          if (p) sp.set('project', String(p));
          if (c) sp.set('conv', String(c));
          const qs = sp.toString();
          const next = qs ? `/talk-popout?${qs}` : '/talk-popout';
          if (next !== `${window.location.pathname}${window.location.search}`) {
            window.history.replaceState({}, '', next);
          }
        }}
      />
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
