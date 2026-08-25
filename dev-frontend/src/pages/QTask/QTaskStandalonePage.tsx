// QTaskStandalonePage — Q Task 분리 창 (Fable 설계 2026-07-28)
//   RightDock "열기 > Q Task" 클릭 시 window.open('/task-popout') 로 열림.
//   MainLayout 우회(사이드바/헤더 없음) + TaskPopoutView(경량 전용 뷰) 마운트.
//   QTaskPage 를 그대로 띄우지 않는 이유는 TaskPopoutView 상단 주석 참조.
//   핀(항상 위) = 이 창 헤더의 핀 아이콘. 누르면 이 창이 고정창을 열고 자신은 홀더로 줄어든다(utils/pinHost.ts).
import React, { useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import TaskPopoutView from '../../components/QTask/TaskPopoutView';
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import PinHolderView from '../../components/Common/PinHolderView';
import { usePinHost } from '../../utils/pinHost';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const QTaskStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qtask');
  const pin = usePinHost({ tool: 'qtask', title: 'Q Task' });

  useEffect(() => {
    document.title = t('popout.windowTitle', 'PlanQ 업무') as string;
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84 — 팝아웃 창 내부 이동에도 FAB/토스터 재노출 차단
    return () => { delete document.body.dataset.popout; };
  }, [t]);

  if (pin.mode === 'holder') return <Shell><PinHolderView host={pin} label="Q Task" /></Shell>;

  return (
    <Shell>
      <TaskPopoutView pinSlot={<PopoutPinButton host={pin} />} />
    </Shell>
  );
};

export default QTaskStandalonePage;

const Shell = styled.div`
  /* 높이는 --vvh 하나로 — 100dvh 는 네이티브 WebView 에서 가시영역보다 커져 body 가
     스크롤 가능해지고 iOS 고무줄이 발동한다("팝아웃이 위아래로 흔들림", 2026-08-25 실측).
     --vvh 는 main.tsx 가 visualViewport.height 로 계속 sync 하는 값이라 항상 정확하다. */
  height: 100vh;
  height: 100dvh;
  height: var(--vvh, 100dvh);
  width: 100vw;
  overflow: hidden;
  background: #FFFFFF;
  display: flex;
  flex-direction: column;
  /* #84 — 팝아웃 헤더 모바일 노치/상태바 대응 (전 팝아웃 통일) */
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top, 0);
`;
