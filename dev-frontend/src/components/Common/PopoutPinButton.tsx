// PopoutPinButton — 팝아웃 헤더의 **핀 토글**. (Irene 지시 2026-08-20)
//
//   일반 팝아웃 창(mode=normal)  : 윤곽 버튼 — 누르면 고정창이 열리고 이 창은 홀더로 줄어든다.
//   고정창 안(mode=pip-content) : 채운 버튼 — 누르면 고정이 풀리고 **원래 일반 창으로 돌아온다**.
//   홀더 창(mode=holder)        : 여기서는 안 그린다 (홀더 화면 자체에 해제 버튼이 있다).
//
// ★ 반드시 클릭 핸들러 안에서 host.toggle() 을 부른다 — requestWindow 는 그 창의 사용자 조작을 요구한다.
//   (setTimeout·await 뒤로 미루면 activation 이 끊겨 NotAllowedError 가 된다.)
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from './ConfirmDialog';
import type { PinHost } from '../../utils/pinHost';

interface Props {
  host: PinHost;
}

/** 해제 = 고정창(과 그 안의 마운트)이 사라진다 = 녹음 중이면 마이크가 죽는다.
 *  플래그 계약은 body.dataset.recordingActive — QNotePage 가 녹음 phase 동안만 세운다. */
function isRecording(): boolean {
  try { return document.body.dataset.recordingActive === '1'; } catch { return false; }
}

const PopoutPinButton: React.FC<Props> = ({ host }) => {
  const { t } = useTranslation('common');
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!host.canPin || host.mode === 'holder') return null;

  const pinned = host.mode === 'pip-content';
  const label = pinned
    ? (t('popoutPin.unpin', '고정 해제') as string)
    : (t('popoutPin.pin', '항상 위로 고정') as string);
  const hint = pinned
    ? (t('popoutPin.unpinHint', '고정을 풀면 원래 창으로 돌아옵니다.') as string)
    : (t('popoutPin.pinHint', '다른 창 위에 항상 보이게 고정합니다.') as string);

  const handleClick = () => {
    if (pinned && isRecording()) { setConfirmOpen(true); return; }
    host.toggle();
  };

  return (
    <>
      <Btn
        type="button"
        data-testid={pinned ? 'pip-unpin' : 'popout-pin-toggle'}
        aria-label={label}
        aria-pressed={pinned}
        title={hint}
        $muted={!pinned}
        onClick={handleClick}
      >
        <IconPin />
      </Btn>
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); host.toggle(); }}
        title={t('popoutPin.recordingTitle', '녹음 중입니다') as string}
        message={t('popoutPin.recordingMessage', '지금 해제하면 고정창이 닫히며 녹음이 중단됩니다. 계속할까요?') as string}
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
//   모두 32 다. 팝아웃·PiP 는 데스크탑 전용이라 터치 타겟 36 규칙 대상이 아니다.
const Btn = styled.button<{ $muted?: boolean }>`
  flex-shrink: 0;
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; cursor: pointer;
  /* 고정 중(채움) vs 고정 안 됨(윤곽) — 상태가 색으로 구분된다. */
  background: ${p => p.$muted ? '#FFFFFF' : '#0F766E'};
  color: ${p => p.$muted ? '#64748B' : '#FFFFFF'};
  border: 1px solid ${p => p.$muted ? '#CBD5E1' : '#0F766E'};
  transition: filter 0.12s, border-color 0.12s, color 0.12s;
  &:hover { ${p => p.$muted ? 'border-color:#94A3B8;color:#0F172A;' : 'filter: brightness(1.08);'} }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`;
