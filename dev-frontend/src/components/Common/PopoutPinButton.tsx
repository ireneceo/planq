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
  const [guideOpen, setGuideOpen] = useState(false);

  // #286 — 일반 팝아웃 창에서는 여태 **핀이 아예 없었다**. 그래서 "왜 여기선 고정이 안 되지?" 가
  //   세 번(#258·#280·#286) 신고됐다. 브라우저 규칙상 이 창 자체를 고정할 수는 없지만(고정되는 창은
  //   별도 종류이고, 그 창은 자기를 연 창이 살아 있어야만 유지된다 — 그래서 예전엔 창이 2개가 됐다),
  //   **부재로 답하지 않고 방법으로 답한다**. 아이콘은 그대로 두고 누르면 안내를 연다.
  if (!pin.isPip) {
    return (
      <>
        <Btn
          type="button"
          data-testid="popout-pin-guide"
          aria-label={t('popoutPin.guideTitle', '항상 위 고정') as string}
          title={t('popoutPin.guideHint', '항상 위 고정 — 방법 보기') as string}
          onClick={() => setGuideOpen(v => !v)}
          $muted
        >
          <IconPin />
        </Btn>
        {guideOpen && (
          <GuideCard role="dialog" aria-label={t('popoutPin.guideTitle', '항상 위 고정') as string}>
            <GuideTitle>{t('popoutPin.guideTitle', '항상 위 고정')}</GuideTitle>
            <GuideBody>
              {t('popoutPin.guideBody', '브라우저 규칙상 이 창을 그대로 고정할 수는 없어요. PlanQ 메인 창 오른쪽 아래 메뉴에서 핀을 누르면 작은 고정 창이 대신 뜨고, 이 창은 자동으로 닫혀요 — 창이 2개가 되지 않아요. 녹음 중일 때는 녹음을 지키려고 이 창을 그대로 둬요.')}
            </GuideBody>
            <GuideAction
              type="button"
              onClick={() => { try { window.opener?.focus(); } catch { /* opener 없음 */ } setGuideOpen(false); }}
            >
              {t('popoutPin.guideAction', '메인 창으로 이동')}
            </GuideAction>
          </GuideCard>
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
`;
// #286 안내 카드 — 팝아웃 헤더 우측 아래에 떠서 "왜 여기선 고정이 안 되는지 + 어떻게 하는지" 를 말한다.
const GuideCard = styled.div`
  /* fixed — 이 버튼은 여러 팝아웃 헤더에 꽂히는 슬롯이라, absolute 면 부모가 position 을
     갖는지에 따라 위치가 제각각이 된다. 창 기준으로 못박는다. */
  position: fixed; top: 52px; right: 10px; z-index: 2500;
  width: min(300px, calc(100vw - 24px));
  padding: 12px 14px;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 12px 28px rgba(15,23,42,0.16);
  text-align: left;
`;
const GuideTitle = styled.div`font-size: 13px; font-weight: 700; color: #0F172A; margin-bottom: 6px;`;
const GuideBody = styled.p`margin: 0 0 10px; font-size: 12px; line-height: 1.55; color: #475569;`;
const GuideAction = styled.button`
  width: 100%; height: 32px; border-radius: 8px; cursor: pointer;
  background: #14B8A6; color: #FFFFFF; border: none;
  font-size: 12px; font-weight: 700; font-family: inherit;
  &:hover { background: #0D9488; }
`;
