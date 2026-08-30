// PinHolderView — 고정 중일 때 남는 작은 창의 내용.
//
//   팝아웃 위의 핀을 누르면 고정창이 뜨고, **이 창이 그 고정창의 주인**으로 남는다.
//   없앨 수가 없다: 고정창(Document PiP)은 자기를 연 창이 살아 있는 동안만 유지되고,
//   이 창을 닫으면 고정창도 같이 죽는다(실측). 그래서 최소 크기로 줄여 고정창 뒤에 숨는다.
//
//   ★ 이 화면은 **평소에 안 보이는 것이 정상**이다. 창을 끄는 순간이나 모니터를 넘는 순간처럼
//     어쩌다 드러날 때만 눈에 띈다 — 그때 어수선해 보이지 않게 **한 줄만** 둔다
//     (Irene 2026-08-20: "작은 창 글자까지 들러붙게 하지는 말자. 어쩌다 보이면 보기 이상하잖아").
//     아이콘·설명문·테두리를 걷어내고 도구 이름 한 줄 + 조용한 해제 링크만 남긴다.
//   여기서 핀을 풀면 고정창이 닫히고 이 창이 다시 원래 팝아웃 크기로 커진다(도구는 안 사라진다).
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
      <Name>{label}</Name>
      <UnpinLink type="button" data-testid="pin-holder-unpin" onClick={() => host.unpin()}>
        {t('popoutPin.unpin', '고정 해제')}
      </UnpinLink>
    </Holder>
  );
};

export default PinHolderView;

const Holder = styled.div`
  height: 100%; min-height: 0; width: 100%;
  box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 10px 12px;
  background: #FFFFFF;
  /* 글자가 창 폭을 넘지 않게 — 잘려서 삐져나온 것처럼 보이지 않는다 */
  overflow: hidden;
`;
const Name = styled.span`
  max-width: 100%;
  font-size: 0.8125rem; font-weight: 600; letter-spacing: -0.2px; color: #0F172A;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const UnpinLink = styled.button`
  padding: 2px 4px;
  font-size: 0.75rem; line-height: 1.2;
  color: #64748B; background: none; border: 0; cursor: pointer;
  &:hover { color: #0F172A; text-decoration: underline; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
