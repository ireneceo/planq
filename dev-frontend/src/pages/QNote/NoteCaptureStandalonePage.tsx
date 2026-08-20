// NoteCaptureStandalonePage — Q Note 빠른 캡처 분리 창 (#9, N+93)
//   RightDock 런처에서 Q Note 클릭 시 window.open('/note-popout') 로 열림.
//   MainLayout 우회 + MemoPopup 을 standalone(풀윈도우) 신규 캡처 모드로 마운트 (existingSessionId 없음).
//   닫기 = window.close. 기존 메모 열람용 /memo/:id (MemoStandalonePage) 와 별개 — 새 메모 작성 전용.
//   핀(항상 위) = 이 창 헤더의 핀 아이콘. 누르면 이 창이 고정창을 열고 자신은 홀더로 줄어든다(utils/pinHost.ts).
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import MemoPopup from '../../components/QNote/MemoPopup';
import PopoutPinButton from '../../components/Common/PopoutPinButton';
import PinHolderView from '../../components/Common/PinHolderView';
import { usePinHost } from '../../utils/pinHost';
import { useAuth } from '../../contexts/AuthContext';
import { markPopoutWindow } from '../../utils/popout';
import { useAppShellLock } from '../../hooks/useAppShellLock';

const NoteCaptureStandalonePage: React.FC = () => {
  useAppShellLock();
  const { t } = useTranslation('qnote');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : 0;
  const pin = usePinHost({ tool: 'qnote', title: 'Q Note' });

  useEffect(() => {
    document.title = t('memoPopup.title', 'Q Note') as string;
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84
    return () => { delete document.body.dataset.popout; };
  }, [t]);

  if (!businessId) return null;

  // 고정 중 — 이 창은 고정창의 주인으로 남는다(닫으면 고정창도 죽는다).
  if (pin.mode === 'holder') return <PinHolderView host={pin} label="Q Note" />;

  return (
    <MemoPopup
      open
      onClose={() => window.close()}
      businessId={businessId}
      standalone
      /* 녹음 중 핀 해제 = 고정창이 닫힘 = 마이크 사망 → PopoutPinButton 이 ConfirmDialog 로 막는다 */
      pinSlot={<PopoutPinButton host={pin} />}
    />
  );
};

export default NoteCaptureStandalonePage;
