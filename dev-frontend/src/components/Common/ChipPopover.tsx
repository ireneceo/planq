// 칩 팝오버 — 상세 헤더의 **메타 값**(담당자·라벨처럼 값이 붙어 있는 것)을 칩 하나로 접고,
// 누르면 그 값을 고치는 컨트롤이 아래에 펼쳐진다.
//
//   Irene 2026-09-06: "이 영역의 모든 게 잘 정돈되어서 2줄에서 끝날 방법 없어?"
//   Q Mail 상세 툴바는 셀렉트 2개(담당자 150px · 답없으면 150px)와 라벨 마스터 전체 나열로
//   600px 패널에서 **137px 3줄**이 됐다. 값은 칩으로 접고(현재 값이 그대로 보인다) 고치는
//   컨트롤은 누를 때만 꺼내면, 같은 정보가 한 줄에 선다.
//
// ★ 좌표·닫기는 usePopoverAnchor 한 곳에서 온다 — OverflowMenu 와 같은 규격이라
//   두 팝오버가 서로 다른 위치에 뜨는 일이 없다.
import React from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { usePopoverAnchor } from './popoverAnchor';

type Props = {
  /** 칩에 보이는 현재 값 (예: "담당 없음", "김담당") */
  label: string;
  /** 값이 실제로 채워져 있는가 — 채워지면 민트 톤으로 "설정됨" 을 형태로 알린다 */
  active?: boolean;
  /** 칩 앞에 붙는 작은 회색 접두어 (예: "담당") */
  prefix?: string;
  /** 접근성 이름 — 칩 글자만으로 무엇을 여는지 모를 때 */
  ariaLabel?: string;
  /** 팝오버 폭 (기본 240) */
  width?: number;
  /** 하니스 selector (CLAUDE.md 운영 안정성 17) */
  'data-testid'?: string;
  className?: string;
  /** 팝오버 내용. `close` 를 받아 값 선택 직후 닫을 수 있다. */
  children: (close: () => void) => React.ReactNode;
};

export default function ChipPopover({
  label, active, prefix, ariaLabel, width = 240, className, children, ...rest
}: Props) {
  const { open, toggle, close, pos, wrapRef, panelRef } = usePopoverAnchor();
  return (
    <Wrap ref={wrapRef} className={className}>
      <Chip
        type="button"
        {...rest}
        $on={!!active}
        $open={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel || label}
        onClick={toggle}
      >
        {prefix && <ChipPrefix>{prefix}</ChipPrefix>}
        <ChipValue>{label}</ChipValue>
        <ChipCaret $open={open} aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
        </ChipCaret>
      </Chip>
      {open && pos && createPortal(
        <Panel ref={panelRef} role="dialog" aria-label={ariaLabel || label} style={{ top: pos.top, right: pos.right, width }}>
          {children(close)}
        </Panel>,
        document.body,
      )}
    </Wrap>
  );
}

const Wrap = styled.div`position:relative;display:inline-flex;align-items:center;flex-shrink:0;`;
// 알약 칩 — 같은 줄의 CtrlBtn(28px) 과 높이를 맞춘다. 값이 있으면 민트, 없으면 회색.
const Chip = styled.button<{ $on: boolean; $open: boolean }>`
  display:inline-flex;align-items:center;gap:5px;
  height:28px;max-width:180px;padding:0 8px 0 10px;
  border-radius:999px;cursor:pointer;
  font-size:0.75rem;font-weight:600;
  border:1px solid ${p => (p.$open || p.$on ? '#5EEAD4' : '#E2E8F0')};
  background:${p => (p.$open ? '#F0FDFA' : p.$on ? '#F0FDFA' : '#FFFFFF')};
  color:${p => (p.$on ? '#0F766E' : '#64748B')};
  transition:background 0.12s,border-color 0.12s;
  &:hover{border-color:#5EEAD4;}
  &:focus-visible{outline:2px solid #5EEAD4;outline-offset:2px;}
  /* 폰 터치 타깃 — 반응형 원칙 최소 40 */
  @media (max-width: 640px){height:40px;max-width:100%;padding:0 10px 0 12px;}
`;
const ChipPrefix = styled.span`color:#94A3B8;font-weight:500;flex-shrink:0;`;
// 값은 길면 줄인다 — 칩이 자라서 줄을 밀어내지 않게.
const ChipValue = styled.span`min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
const ChipCaret = styled.span<{ $open: boolean }>`
  display:inline-flex;flex-shrink:0;color:#94A3B8;
  transform:rotate(${p => (p.$open ? '180deg' : '0deg')});
  transition:transform 0.18s ease;
  @media (prefers-reduced-motion: reduce){transition:none;}
`;
const Panel = styled.div`
  position:fixed;max-height:70vh;overflow-y:auto;
  background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;
  box-shadow:0 8px 24px rgba(15,23,42,0.12);
  padding:10px;z-index:9000;
  display:flex;flex-direction:column;gap:8px;
`;
