// PopoutPinButton — **PiP 안 헤더의 핀 해제 버튼**. (2026-08-14 재구조화)
//   옛 역할(팝아웃 창 헤더에서 핀을 켜는 토글)은 사라졌다 — 핀 진입은 이제 도크에서만 한다.
//   두 진입점이 공존하면 "PiP 는 브라우저 전역 1개" 축출 프로토콜을 두 벌 유지해야 한다(설계 §2-3).
//   그래서 이 버튼은 PiP 안에서만 보이고, 하는 일은 하나다: 메인 탭에 해제를 요청한다.
//
//   ★ 해제하면 이 도구는 **닫힌다** — 일반 창으로 되돌아가지 않는다. 이유는 utils/pinOwner.unpin 주석 참조.
//     문구도 그렇게 적는다(되돌아간다고 쓰면 거짓말이 된다).
//
// ★ 2026-08-20 구조 확정 (Fable 설계 판정) — 이 파일은 **PiP 안 해제 버튼 전용**이 됐다.
//   일반 팝아웃 창에서는 아무것도 그리지 않는다(return null). 아래 실측이 그 근거다.
//
// ★ 2026-08-19 실측 결론 (#258·#280·#286) — **1클릭은 브라우저가 막는다.**
//   팝아웃에서 실제 클릭으로 메시지를 보내도 메인 창의 requestWindow() 는
//   `NotAllowedError: Document PiP requires user activation` 으로 거부된다(즉시 호출·협상 후 호출 모두).
//   사용자 조작은 창을 건너 전달되지 않는다. (한때 전달된다는 측정이 있었으나 자동화 도구가
//   메인 창에도 가짜 조작을 심은 오염이었다 — 실클릭 재현으로 반증됐다.)
//   그래서 "팝아웃 안에서 핀" 은 어떤 변형으로도 1클릭이 될 수 없다. 결론은 핀을 옮기는 것이 아니라
//   **없애는 것**이었다 — 도크에서 여는 클릭이 곧 고정이다(RightDock.handlePick).
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

  // ★ 일반 팝아웃 창에는 핀이 **없다** (Fable 설계 판정 2026-08-20).
  //   고정은 버튼이 아니라 **여는 방식**이 됐다 — 도크에서 도구를 여는 클릭이 곧 항상 위다.
  //   여기에 핀을 두면 물리적으로 1클릭이 불가능하다: 이 창의 조작은 메인 탭으로 전달되지 않고
  //   (NotAllowedError), 이 창이 직접 열면 **이 창이 소유자로 계속 살아 있어야** 해서
  //   #258 의 "창 하나 더" 가 그대로 재발한다(실측: 이 창을 닫으면 고정창도 같이 죽는다).
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
const Btn = styled.button<{ $muted?: boolean }>`
  flex-shrink: 0;
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; cursor: pointer;
  /* 고정 중(채움) vs 안내용(윤곽) — 상태가 색으로 구분된다. 안내 버튼이 "지금 고정됨" 처럼 보이면 안 된다. */
  background: ${p => p.$muted ? '#FFFFFF' : '#0F766E'};
  color: ${p => p.$muted ? '#64748B' : '#FFFFFF'};
  border: 1px solid ${p => p.$muted ? '#CBD5E1' : '#0F766E'};
  transition: filter 0.12s, border-color 0.12s, color 0.12s;
  &:hover { ${p => p.$muted ? 'border-color:#94A3B8;color:#0F172A;' : 'filter: brightness(1.08);'} }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`;
