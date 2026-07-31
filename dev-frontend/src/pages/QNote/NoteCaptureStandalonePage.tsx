// NoteCaptureStandalonePage — Q Note 빠른 캡처 분리 창 (#9, N+93)
//   RightDock 런처에서 Q Note 클릭 시 window.open('/note-popout') 로 열림.
//   MainLayout 우회 + MemoPopup 을 standalone(풀윈도우) 신규 캡처 모드로 마운트 (existingSessionId 없음).
//   닫기 = window.close. 기존 메모 열람용 /memo/:id (MemoStandalonePage) 와 별개 — 새 메모 작성 전용.
//   핀(항상 위)은 이 창 자신이 소유한다 — utils/pinHost.ts 상단 주석 참조.
import React, { useEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import MemoPopup from '../../components/QNote/MemoPopup';
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import PinHolderView from '../../components/Common/PinHolderView';
import { usePinHost, POPOUT_SIZE } from '../../utils/pinHost';
import { useAuth } from '../../contexts/AuthContext';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const NoteCaptureStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qnote');
  const { t: tc } = useTranslation('common');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : 0;
  const pin = usePinHost({
    tool: 'qnote',
    title: tc('dock.qnote', 'Q Note') as string,
    ...POPOUT_SIZE.qnote,
  });

  useEffect(() => {
    document.title = t('memoPopup.title', 'Q Note') as string;
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84
    return () => { delete document.body.dataset.popout; };
  }, [t]);

  if (!businessId) return null;

  if (pin.mode === 'holder') {
    return <HolderShell><PinHolderView host={pin} label={tc('dock.qnote', 'Q Note') as string} /></HolderShell>;
  }

  return (
    <MemoPopup
      open
      onClose={() => window.close()}
      businessId={businessId}
      standalone
      /* 녹음 중 핀 = 이 창 재로드 = 마이크 사망 → PopoutPinButton 이 ConfirmDialog 로 막는다 */
      pinSlot={<PopoutPinButton host={pin} />}
    />
  );
};

export default NoteCaptureStandalonePage;

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
