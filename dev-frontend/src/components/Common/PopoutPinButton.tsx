// PopoutPinButton — 팝아웃 창 헤더의 핀(항상 위) 토글 (Fable 설계 2026-07-28 → 구현 2026-07-31)
//   도크(RightDock)에 있던 핀을 팝아웃 창 자신으로 옮겼다. 이유는 utils/pinHost.ts 상단 주석 참조 —
//   팝아웃의 클릭은 메인 창으로 transient activation 이 전이되지 않아, 핀은 그 창이 직접 눌러야만 작동한다.
//   normal → 클릭 시 PiP 를 열고 이 창은 홀더로 변신 / pip-content(PiP 안) → 클릭 시 홀더에 해제 요청.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from './ConfirmDialog';
import type { PinHost } from '../../utils/pinHost';

interface Props {
  host: PinHost;
}

/** 핀 = 같은 라우트를 PiP 안에 새로 로드 = 이 창의 현재 마운트는 사라진다.
 *  녹음 중이면 마이크가 죽으므로(배포 자동 reload 와 같은 사고 계열) 확인을 받는다.
 *  플래그 계약은 body.dataset.recordingActive — QNotePage 가 녹음 phase 동안만 세운다. */
function isRecording(): boolean {
  try { return document.body.dataset.recordingActive === '1'; } catch { return false; }
}

const PopoutPinButton: React.FC<Props> = ({ host }) => {
  const { t } = useTranslation('common');
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!host.canPin) return null;

  const pinned = host.mode !== 'normal';
  const label = pinned
    ? (t('popoutPin.unpin', '핀 해제') as string)
    : (t('popoutPin.pin', '핀으로 열기 — 항상 위') as string);

  // 핀도 해제도 "이 창의 현재 마운트가 사라지고 라우트가 새로 로드된다" 는 점이 같다 →
  //   방향과 무관하게 녹음 중이면 물어본다 (PiP 안에서 녹음 중 해제도 같은 사고다).
  const handleClick = () => {
    if (isRecording()) { setConfirmOpen(true); return; }
    host.toggle();
  };

  return (
    <>
      <Btn
        type="button"
        data-testid="popout-pin-toggle"
        $active={pinned}
        aria-pressed={pinned}
        aria-label={label}
        title={label}
        onClick={handleClick}
      >
        <IconPin />
      </Btn>
      {/* 확인 버튼 클릭 자체가 사용자 제스처 → 그 안에서 requestWindow 를 부른다(활성화 유효) */}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); host.toggle(); }}
        title={t('popoutPin.recordingTitle', '녹음 중입니다') as string}
        message={t('popoutPin.recordingMessage', '지금 전환하면 이 창이 다시 열리며 녹음이 중단됩니다. 계속할까요?') as string}
        confirmText={t('popoutPin.recordingConfirm', '녹음을 멈추고 전환') as string}
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
//   모두 32 다. 핀은 데스크탑 전용(supportsPin 이 모바일을 배제)이라 터치 타겟 36 규칙 대상이 아니다.
const Btn = styled.button<{ $active: boolean }>`
  flex-shrink: 0;
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; cursor: pointer;
  background: ${({ $active }) => ($active ? '#0F766E' : 'transparent')};
  color: ${({ $active }) => ($active ? '#FFFFFF' : '#64748B')};
  border: 1px solid ${({ $active }) => ($active ? '#0F766E' : 'transparent')};
  transition: color 0.12s, background 0.12s, border-color 0.12s;
  &:hover { background: ${({ $active }) => ($active ? '#0F766E' : '#F1F5F9')}; color: ${({ $active }) => ($active ? '#FFFFFF' : '#0F766E')}; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
