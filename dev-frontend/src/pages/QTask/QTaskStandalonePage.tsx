// QTaskStandalonePage — Q Task 분리 창 (Fable 설계 2026-07-28)
//   RightDock "열기 > Q Task" 클릭 시 window.open('/task-popout') 로 열림.
//   MainLayout 우회(사이드바/헤더 없음) + TaskPopoutView(경량 전용 뷰) 마운트.
//   QTaskPage 를 그대로 띄우지 않는 이유는 TaskPopoutView 상단 주석 참조.
//   핀(항상 위)은 **메인 탭이 소유**한다 — utils/pinOwner.ts 참조. 이 창은 자기가 PiP 안인지만 안다.
import React, { useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import TaskPopoutView from '../../components/QTask/TaskPopoutView';
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import { usePinContent } from '../../utils/pinHost';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const QTaskStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qtask');
  const pin = usePinContent('qtask');

  useEffect(() => {
    document.title = t('popout.windowTitle', 'PlanQ 업무') as string;
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84 — 팝아웃 창 내부 이동에도 FAB/토스터 재노출 차단
    return () => { delete document.body.dataset.popout; };
  }, [t]);

  return (
    <Shell>
      <TaskPopoutView pinSlot={<PopoutPinButton pin={pin} />} />
    </Shell>
  );
};

export default QTaskStandalonePage;

const Shell = styled.div`
  height: 100vh;
  height: 100dvh;
  width: 100vw;
  overflow: hidden;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  /* #84 — 팝아웃 헤더 모바일 노치/상태바 대응 (전 팝아웃 통일) */
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top, 0);
`;
