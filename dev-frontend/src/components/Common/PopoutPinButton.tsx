// PopoutPinButton — **PiP 안 헤더의 핀 해제 버튼**. (2026-08-14 재구조화)
//   옛 역할(팝아웃 창 헤더에서 핀을 켜는 토글)은 사라졌다 — 핀 진입은 이제 도크에서만 한다.
//   두 진입점이 공존하면 "PiP 는 브라우저 전역 1개" 축출 프로토콜을 두 벌 유지해야 한다(설계 §2-3).
//   그래서 이 버튼은 PiP 안에서만 보이고, 하는 일은 하나다: 메인 탭에 해제를 요청한다.
//
//   ★ 해제하면 이 도구는 **닫힌다** — 일반 창으로 되돌아가지 않는다. 이유는 utils/pinOwner.unpin 주석 참조.
//     문구도 그렇게 적는다(되돌아간다고 쓰면 거짓말이 된다).
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from './ConfirmDialog';
import type { PinContent } from '../../utils/pinHost';

interface Props {
  pin: PinContent;
}

/** 해제 = PiP 가 닫히고 이 마운트가 사라진다 = 녹음 중이면 마이크가 죽는다(배포 자동 reload 와 같은 사고 계열).
 *  플래그 계약은 body.dataset.recordingActive — QNotePage 가 녹음 phase 동안만 세운다. */
function isRecording(): boolean {
  try { return document.body.dataset.recordingActive === '1'; } catch { return false; }
}

const PopoutPinButton: React.FC<Props> = ({ pin }) => {
  const { t } = useTranslation('common');
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!pin.isPip) return null;

  const label = t('popoutPin.unpin', '고정 해제') as string;

  const handleClick = () => {
    if (isRecording()) { setConfirmOpen(true); return; }
    pin.unpin();
  };

  return (
    <>
      <Btn
        type="button"
        data-testid="pip-unpin"
        aria-label={label}
        title={t('popoutPin.unpinHint', '고정을 해제하면 이 창이 닫힙니다. 도크에서 다시 열 수 있습니다.') as string}
        onClick={handleClick}
      >
        <IconPin />
      </Btn>
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); pin.unpin(); }}
        title={t('popoutPin.recordingTitle', '녹음 중입니다') as string}
        message={t('popoutPin.recordingMessage', '지금 해제하면 이 창이 닫히며 녹음이 중단됩니다. 계속할까요?') as string}
        confirmText={t('popoutPin.recordingConfirm', '녹음을 멈추고 해제') as string}
        cancelText={t('cancel', '취소') as string}
        variant="warning"
        /* Q Note 팝아웃의 MemoPopup 이 2301 — 기본 2100 이면 확인창이 뒤에 깔려 무반응처럼 보인다(2026-07-31 실측) */
        zIndex={2400}
      />
    </>
  );
};

export default PopoutPinButton;

const IconPin = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17h14l-1.7-2.6A2 2 0 0 1 17 13.3V7h1a1 1 0 0 0 0-2H6a1 1 0 0 0 0 2h1v6.3a2 2 0 0 1-.3 1.1z" />
  </svg>
);

// 32×32 — 옆에 서는 헤더 아이콘 버튼(NewChatBtn · MemoPopup HeaderBtn · CueHelpDrawer CloseBtn)이
//   모두 32 다. PiP 는 데스크탑 전용이라 터치 타겟 36 규칙 대상이 아니다.
//   핀이 켜져 있는 상태에서만 보이는 버튼이므로 항상 active 톤이다(눌러서 끄는 버튼).
const Btn = styled.button`
  flex-shrink: 0;
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; cursor: pointer;
  background: #0F766E; color: #FFFFFF;
  border: 1px solid #0F766E;
  transition: filter 0.12s;
  &:hover { filter: brightness(1.08); }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
