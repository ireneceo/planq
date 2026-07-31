// PinHolderView — 핀 중인 팝아웃 창의 본체 (360×132)
//   핀을 누른 팝아웃 창은 자기 PiP 를 연 뒤 **자신은 이 홀더로 줄어든다**.
//   창을 없애지 않는 이유: PiP 는 자기를 연 창에 종속돼, 그 창이 사라지면 PiP 도 죽는다(실측).
//   홀더를 닫으면 PiP 도 같이 닫힌다 — 사용자에게는 "도구를 닫았다" 로 읽히는 자연스러운 동작이다.
//   aria-modal 금지(검사 하니스가 [aria-modal] 로 모달을 스코핑한다 — CLAUDE.md §17).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { PinHost } from '../../utils/pinHost';

interface Props {
  host: PinHost;
  /** 도구 표시명 (Q Talk / Q Task / …) */
  label: string;
}

const PinHolderView: React.FC<Props> = ({ host, label }) => {
  const { t } = useTranslation('common');
  return (
    <Holder data-testid="pin-holder" role="status">
      <TitleRow>
        <IconPin />
        <Name>{label}</Name>
      </TitleRow>
      <Note>{t('popoutPin.holderNote', '항상 위 창에서 보고 있습니다')}</Note>
      <UnpinBtn
        type="button"
        data-testid="pin-holder-unpin"
        onClick={() => host.unpin()}
      >
        {t('popoutPin.unpin', '핀 해제')}
      </UnpinBtn>
    </Holder>
  );
};

export default PinHolderView;

const IconPin = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0F766E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="17" x2="12" y2="22" />
    <path d="M5 17h14l-1.7-2.6A2 2 0 0 1 17 13.3V7h1a1 1 0 0 0 0-2H6a1 1 0 0 0 0 2h1v6.3a2 2 0 0 1-.3 1.1z" />
  </svg>
);

const Holder = styled.div`
  height: 100%; min-height: 0; width: 100%;
  box-sizing: border-box;
  display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 6px;
  padding: 14px 16px;
  background: #FFFFFF;
`;
const TitleRow = styled.div`
  display: flex; align-items: center; gap: 6px;
`;
const Name = styled.span`
  font-size: 15px; font-weight: 700; letter-spacing: -0.2px; color: #0F172A;
`;
const Note = styled.p`
  margin: 0; font-size: 12px; line-height: 1.4; color: #64748B;
`;
const UnpinBtn = styled.button`
  margin-top: 2px;
  min-height: 36px; padding: 0 14px;
  display: inline-flex; align-items: center;
  background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 8px;
  font-size: 13px; font-weight: 700; color: #334155; cursor: pointer;
  &:hover { border-color: #94A3B8; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
