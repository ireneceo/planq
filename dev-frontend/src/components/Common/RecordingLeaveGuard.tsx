// components/Common/RecordingLeaveGuard.tsx — Q note 녹음 중 이탈 확인창 (2026-11-19 · Fable 설계 DESIGN-READY)
//
//   services/recordingGuard.requestLeave 가 묻는 창 한 벌. App 루트(LeaveDecisionGuard 옆)라 탭·셸 두 트리 모두에 뜬다.
//   버튼은 둘뿐 — [녹음 계속하기](기본) / [녹음 멈추고 …]. «새 창에서 계속» 은 없다(녹음 스트림은 창 사이로 옮길 수 없다).
//   탭 모드에서 이동을 새 탭으로 돌렸을 때(녹음 1회당 한 번)는 묻지 않고 아래쪽에 짧은 안내 줄만 보인다.
import React, { useEffect, useSyncExternalStore } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from './ConfirmDialog';
import {
  subscribeRecordingGuard, getPendingLeave, getDivertNotice, clearDivertNotice, cancelLeave, confirmLeave,
} from '../../services/recordingGuard';

const NOTICE_MS = 6000;

const RecordingLeaveGuard: React.FC = () => {
  const { t } = useTranslation('common');
  const pending = useSyncExternalStore(subscribeRecordingGuard, getPendingLeave, getPendingLeave);
  const notice = useSyncExternalStore(subscribeRecordingGuard, getDivertNotice, getDivertNotice);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(clearDivertNotice, NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [notice]);

  return (
    <>
      <ConfirmDialog
        isOpen={!!pending}
        onClose={cancelLeave}
        onConfirm={confirmLeave}
        variant="warning"
        zIndex={10100}
        title={t('recordingLeave.title', '녹음이 진행 중입니다') as string}
        message={t('recordingLeave.message', '지금 나가면 녹음이 멈춥니다. 지금까지 기록된 내용은 저장되어 있고, 나중에 «녹음 이어하기» 로 이어갈 수 있어요.') as string}
        confirmText={t(`recordingLeave.confirm.${pending?.reason || 'navigate'}`, '녹음 멈추고 이동') as string}
        cancelText={t('recordingLeave.keep', '녹음 계속하기') as string}
      />
      {notice && (
        <Notice role="status" data-testid="recording-diverted" onClick={clearDivertNotice}>
          <Dot aria-hidden />
          {t('recordingLeave.diverted', '녹음은 Q note 탭에서 계속됩니다. 새 화면은 새 탭에 열었어요.')}
        </Notice>
      )}
    </>
  );
};

export default RecordingLeaveGuard;

const Notice = styled.div`
  position: fixed;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 3000;
  max-width: min(520px, calc(100vw - 32px));
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 10px;
  background: #0f172a;
  color: #fff;
  font-size: 0.8125rem;
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
  cursor: pointer;
`;
const Dot = styled.span`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
`;
