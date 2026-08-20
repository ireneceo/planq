// PinHolderView — 고정 중일 때 남는 작은 창 (360×132).
//
//   팝아웃 위의 핀을 누르면 고정창이 뜨고, **이 창이 그 고정창의 주인**으로 남는다.
//   없앨 수가 없다: 고정창(Document PiP)은 자기를 연 창이 살아 있는 동안만 유지되고,
//   이 창을 닫으면 고정창도 같이 죽는다(실측). 그래서 최소 크기로 줄여 뒤로 물러나 있는다.
//
//   여기서 핀을 풀면 고정창이 닫히고 **이 창이 다시 원래 팝아웃 창 크기로 커진다**(도구는 안 사라진다).
//   이 창을 사용자가 직접 닫으면 고정창도 같이 닫힌다 — "도구를 닫았다" 로 읽히는 자연스러운 동작이다.
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
      <Note>{t('popoutPin.holderNote', '고정창에서 보고 있습니다')}</Note>
      <UnpinBtn type="button" data-testid="pin-holder-unpin" onClick={() => host.unpin()}>
        {t('popoutPin.unpin', '고정 해제')}
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
  height: 32px; padding: 0 12px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600;
  color: #0F172A; background: #FFFFFF;
  border: 1px solid #CBD5E1; border-radius: 8px; cursor: pointer;
  &:hover { border-color: #94A3B8; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
