// NoteCaptureStandalonePage — Q Note 빠른 캡처 분리 창 (#9, N+93)
//   RightDock 런처에서 Q Note 클릭 시 window.open('/note-popout') 로 열림.
//   MainLayout 우회 + MemoPopup 을 standalone(풀윈도우) 신규 캡처 모드로 마운트 (existingSessionId 없음).
//   닫기 = window.close. 기존 메모 열람용 /memo/:id (MemoStandalonePage) 와 별개 — 새 메모 작성 전용.
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import MemoPopup from '../../components/QNote/MemoPopup';
import { useAuth } from '../../contexts/AuthContext';
import { markPopoutWindow } from '../../utils/popout';

const NoteCaptureStandalonePage: React.FC = () => {
  const { t } = useTranslation('qnote');
  const { user } = useAuth();
  const businessId = user?.business_id ? Number(user.business_id) : 0;

  useEffect(() => {
    document.title = t('memoPopup.title', 'Q Note') as string;
    document.body.dataset.popout = '1';
    markPopoutWindow(); // #84
    return () => { delete document.body.dataset.popout; };
  }, [t]);

  if (!businessId) return null;

  return (
    <MemoPopup
      open
      onClose={() => window.close()}
      businessId={businessId}
      standalone
    />
  );
};

export default NoteCaptureStandalonePage;
