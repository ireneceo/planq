// PopoutPinButton — **PiP 안 헤더의 핀 해제 버튼**. (2026-08-14 재구조화)
//   옛 역할(팝아웃 창 헤더에서 핀을 켜는 토글)은 사라졌다 — 핀 진입은 이제 도크에서만 한다.
//   두 진입점이 공존하면 "PiP 는 브라우저 전역 1개" 축출 프로토콜을 두 벌 유지해야 한다(설계 §2-3).
//   그래서 이 버튼은 PiP 안에서만 보이고, 하는 일은 하나다: 메인 탭에 해제를 요청한다.
//
//   ★ 해제하면 이 도구는 **닫힌다** — 일반 창으로 되돌아가지 않는다. 이유는 utils/pinOwner.unpin 주석 참조.
//     문구도 그렇게 적는다(되돌아간다고 쓰면 거짓말이 된다).
//
// ★ 2026-08-19 실측 결론 (#258·#280·#286) — **1클릭은 브라우저가 막는다.**
//   팝아웃에서 실제 클릭으로 메시지를 보내도 메인 창의 requestWindow() 는
//   `NotAllowedError: Document PiP requires user activation` 으로 거부된다(즉시 호출·협상 후 호출 모두).
//   사용자 조작은 창을 건너 전달되지 않는다. (한때 전달된다는 측정이 있었으나 자동화 도구가
//   메인 창에도 가짜 조작을 심은 오염이었다 — 실클릭 재현으로 반증됐다.)
//   그래서 **마지막 한 번의 클릭은 메인 창에서** 해야 한다. 대신 팝아웃이 자리를 다 만들어 준다:
//   메인 창을 앞으로 가져오고, 도크를 펼치고, 그 도구의 핀을 깜빡이게 해서 **바로 누를 수 있게** 한다.
//   문단으로 설명하지 않는다 — 다음 동작 한 줄만 말한다.
import React, { useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from './ConfirmDialog';
import { PIN_CHANNEL, type PinContent, type PinArmMsg } from '../../utils/pinHost';

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
  const [armed, setArmed] = useState(false);

  // #286 — 일반 팝아웃 창에서는 여태 **핀이 아예 없었다**. 그래서 "왜 여기선 고정이 안 되지?" 가
  //   세 번(#258·#280·#286) 신고됐다. 브라우저 규칙상 이 창 자체를 고정할 수는 없지만(고정되는 창은
  //   별도 종류이고, 그 창은 자기를 연 창이 살아 있어야만 유지된다 — 그래서 예전엔 창이 2개가 됐다),
  //   **부재로 답하지 않고 방법으로 답한다**. 아이콘은 그대로 두고 누르면 안내를 연다.
  if (!pin.isPip) {
    // 녹음 중에는 고정하지 않는다 — 고정이 성사되면 이 창이 닫히고 마이크가 죽는다.
    //   막는 대신 이유를 한 줄로 말한다(예전처럼 문단으로 설명하지 않는다).
    const recording = isRecording();
    const requestPin = () => {
      if (recording) return;
      // 메인 창 도크의 해당 핀을 "누를 준비" 상태로 만든다(깜빡임). 창을 건너 고정할 수는 없다.
      try {
        const ch = new BroadcastChannel(PIN_CHANNEL);
        ch.postMessage({ type: 'pin-arm', tool: pin.tool } as PinArmMsg);
        ch.close();
      } catch { /* 미지원 — 아래 포커스만으로도 사용자가 찾을 수 있다 */ }
      try { (window.opener as Window | null)?.focus(); } catch { /* opener 없음 */ }
      setArmed(true);
      // 고정이 성사되면 이 창은 pin-engaged 를 받아 스스로 닫힌다(utils/pinHost).
      window.setTimeout(() => setArmed(false), 30000);
    };
    return (
      <>
        <Btn
          type="button"
          data-testid="popout-pin"
          aria-label={t('popoutPin.pinLabel', '항상 위 고정') as string}
          title={recording
            ? t('popoutPin.recordingBlocks', '녹음 중에는 고정할 수 없어요 — 녹음이 끝나면 눌러 주세요') as string
            : t('popoutPin.pinLabel', '항상 위 고정') as string}
          onClick={requestPin}
          disabled={recording}
          /* ★ 팝아웃 창의 핀은 **아직 고정 안 된 상태**다 — 채움(청록)은 "지금 고정됨" 을 뜻하므로
             여기서는 항상 윤곽선이어야 한다. 채움으로 두면 사용자가 이미 켜진 것으로 읽는다
             (Irene: "팝아웃 그냥 오픈하면 핀이 눌린상태라서"). 이 파일 Btn 주석의 규칙 그대로. */
          $muted
        >
          <IconPin />
        </Btn>
        {armed && (
          <HintLine role="status" aria-live="polite">
            {t('popoutPin.pressMainPin', '메인 창에서 깜빡이는 핀을 누르면 여기로 고정돼요') as string}
          </HintLine>
        )}
      </>
    );
  }

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
// #286 안내 카드 — 팝아웃 헤더 우측 아래에 떠서 "왜 여기선 고정이 안 되는지 + 어떻게 하는지" 를 말한다.
// 한 줄 힌트 — 예전의 안내 문단(GuideCard)을 대체한다. 제약을 설명하지 않고 **다음 동작만** 말한다.
const HintLine = styled.div`
  position: absolute; top: 100%; right: 0; margin-top: 6px; z-index: 20;
  padding: 5px 9px; border-radius: 8px; white-space: nowrap;
  background: #0F172A; color: #F8FAFC; font-size: 11px; font-weight: 600;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.2);
`;
