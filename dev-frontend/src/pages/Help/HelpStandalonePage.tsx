// HelpStandalonePage — Q helper 분리 창 (#9, N+93)
//   RightDock 런처에서 Q helper 클릭 시 window.open('/help-popout') 로 열림.
//   MainLayout 우회 + CueHelpDrawer 를 standalone(풀윈도우)로 마운트 → 동일 Q helper UI 재사용.
//   닫기 = window.close (CueHelpDrawer 내부 처리).
//   핀(항상 위)은 **메인 탭이 소유**한다 — utils/pinOwner.ts 참조. 이 창은 자기가 PiP 안인지만 안다.
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import CueHelpDrawer from '../../components/Common/CueHelpDrawer';
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import { usePinContent } from '../../utils/pinHost';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const HelpStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('common');
  const pin = usePinContent('qhelper');

  useEffect(() => {
    document.title = t('qhelper.title', 'Q helper') as string;
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84 — 창 단위 영속(내부 /wiki 이동에도 팝아웃 유지)
    return () => { delete document.body.dataset.popout; };
  }, [t]);

  return <CueHelpDrawer standalone pinSlot={<PopoutPinButton pin={pin} />} />;
};

export default HelpStandalonePage;
