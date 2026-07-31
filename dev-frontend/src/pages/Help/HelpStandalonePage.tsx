// HelpStandalonePage — Q helper 분리 창 (#9, N+93)
//   RightDock 런처에서 Q helper 클릭 시 window.open('/help-popout') 로 열림.
//   MainLayout 우회 + CueHelpDrawer 를 standalone(풀윈도우)로 마운트 → 동일 Q helper UI 재사용.
//   닫기 = window.close (CueHelpDrawer 내부 처리).
//   핀(항상 위)은 이 창 자신이 소유한다 — utils/pinHost.ts 상단 주석 참조.
import React, { useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import CueHelpDrawer from '../../components/Common/CueHelpDrawer';
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import PinHolderView from '../../components/Common/PinHolderView';
import { usePinHost, POPOUT_SIZE } from '../../utils/pinHost';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const HelpStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('common');
  const pin = usePinHost({
    tool: 'qhelper',
    title: t('dock.qhelper', 'Q helper') as string,
    ...POPOUT_SIZE.qhelper,
  });

  useEffect(() => {
    document.title = t('qhelper.title', 'Q helper') as string;
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84 — 창 단위 영속(내부 /wiki 이동에도 팝아웃 유지)
    return () => { delete document.body.dataset.popout; };
  }, [t]);

  if (pin.mode === 'holder') {
    return <HolderShell><PinHolderView host={pin} label={t('dock.qhelper', 'Q helper') as string} /></HolderShell>;
  }

  return <CueHelpDrawer standalone pinSlot={<PopoutPinButton host={pin} />} />;
};

export default HelpStandalonePage;

const HolderShell = styled.div`
  height: 100vh;
  height: 100dvh;
  width: 100vw;
  overflow: hidden;
  background: #FFFFFF;
  display: flex;
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top, 0);
`;
