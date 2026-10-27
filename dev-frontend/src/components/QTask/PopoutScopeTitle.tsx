// 팝아웃 제목 = 범위 고르기 — «오늘 내 업무 ▾» 를 누르면 오늘 / 이번 주.
//
//   Irene 2026-10-12: *"상단에 덜 중요한 영역이 너무 길어. 오늘, 이번주 선택하는 걸 헤더에서
//   제목에서 가능하게 하면 어때? 기본은 오늘 내 업무."*
//   예전엔 제목 아래에 오늘/이번 주 탭 줄(36px)이 따로 있었다. 제목이 이미 범위를 말하므로
//   제목 자체가 고르는 문이 된다 — 한 줄이 통째로 빠진다.
//
//   좌표·바깥클릭·Esc 는 usePopoverAnchor, 메뉴 모양은 OverflowMenu 의 것 — 새로 그리지 않는다.
import React from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { usePopoverAnchor } from '../Common/popoverAnchor';
import { Menu, MenuItem, MenuCheck } from '../Common/OverflowMenu';

export type PopoutScope = 'today' | 'week';

interface Props {
  value: PopoutScope;
  onChange: (v: PopoutScope) => void;
  /** 범위별 제목(= 메뉴 항목 글자). 제목과 항목이 같은 글자여야 무엇을 바꾸는지 읽힌다. */
  labels: Record<PopoutScope, string>;
  ariaLabel: string;
  /** 좁은 창에서 헤더 요약이 숨을 때 제목에 걸어 둘 설명(업무 N건, 요청 M건) */
  hint?: string;
}

const PopoutScopeTitle: React.FC<Props> = ({ value, onChange, labels, ariaLabel, hint }) => {
  const { open, toggle, close, pos, style: menuStyle, wrapRef, panelRef } = usePopoverAnchor();
  const opts: PopoutScope[] = ['today', 'week'];
  return (
    <Wrap ref={wrapRef}>
      <Title>
        <TitleBtn type="button" data-testid="task-popout-scope" aria-haspopup="menu" aria-expanded={open}
          aria-label={`${labels[value]} — ${ariaLabel}`} title={hint} $open={open} onClick={toggle}>
          <span>{labels[value]}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
        </TitleBtn>
      </Title>
      {open && pos && createPortal(
        <Menu ref={panelRef} role="menu" aria-label={ariaLabel} style={menuStyle}>
          {opts.map((o) => (
            <MenuItem key={o} type="button" role="menuitemradio" aria-checked={value === o}
              data-testid={`task-popout-tab-${o}`} onClick={() => { close(); onChange(o); }}>
              {labels[o]}
              {value === o && (
                <MenuCheck aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </MenuCheck>
              )}
            </MenuItem>
          ))}
        </Menu>,
        document.body,
      )}
    </Wrap>
  );
};

const Wrap = styled.div`display:inline-flex;align-items:center;min-width:0;`;
// 제목 글자 규격은 PanelHeader 표준(18px / 700 / -0.2px) 그대로 — 버튼이 되어도 제목처럼 보여야 한다.
const Title = styled.h1`margin:0;min-width:0;display:flex;`;
const TitleBtn = styled.button<{ $open: boolean }>`
  display:inline-flex;align-items:center;gap:4px;min-width:0;
  margin-left:-6px;padding:2px 6px;border:none;border-radius:8px;
  background:${p => (p.$open ? '#F1F5F9' : 'transparent')};
  font-family:inherit;font-size:1.125rem;font-weight:700;letter-spacing:-0.2px;color:#0F172A;
  cursor:pointer;
  span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  svg{flex-shrink:0;color:#64748B;transition:transform 0.15s;transform:rotate(${p => (p.$open ? 180 : 0)}deg);}
  &:hover{background:#F1F5F9;}
  &:focus-visible{outline:2px solid rgba(15,118,110,0.5);outline-offset:2px;}
`;

export default PopoutScopeTitle;
