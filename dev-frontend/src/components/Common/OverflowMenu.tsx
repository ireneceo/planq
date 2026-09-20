// 공용 오버플로 메뉴 — 헤더·툴바에서 **가끔 쓰는 액션**을 ⋯ 하나로 접는다.
//
//   Irene 2026-09-05: "서브헤더에 버튼이 너무 많아. 제목이 보이지도 않아."
//   Q docs 상세 헤더는 액션이 10개였고 그중 7개가 아이콘 전용이라, 자리는 다 먹으면서
//   무엇을 하는 버튼인지는 hover 해야 알 수 있었다. 메뉴로 접으면 자리를 돌려주고
//   **글자 라벨이 붙어** 오히려 알아보기 쉬워진다.
//
//   ★ 새로 만들지 말고 여기서 가져다 쓴다. 각자 styled 를 다시 선언하면 반드시 갈라진다
//     (알림·새 소식 드롭다운이 그랬다 — components/Common/dropdownShell.ts 주석 참조).
//   메뉴는 createPortal 로 body 에 띄운다 — 헤더의 overflow 에 잘리지 않게.
import React from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { usePopoverAnchor } from './popoverAnchor';

export type OverflowItem = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** 이 항목 **위에** 구분선을 그린다 (삭제처럼 성격이 다른 액션 앞) */
  dividerBefore?: boolean;
  /** 하니스 selector — 인터랙티브 요소에 부여 (CLAUDE.md 운영 안정성 17) */
  testId?: string;
  /** 택일 그룹의 현재 값 — 체크 표시가 붙는다 (기간 선택처럼 값이 하나뿐인 묶음) */
  checked?: boolean;
  /** 이 항목 **위에** 그룹 제목을 얹는다 (구분선 대신 무엇의 묶음인지 말한다) */
  groupLabel?: string;
};

type Props = {
  items: OverflowItem[];
  /** 트리거 버튼의 접근성 이름 (예: "더보기") */
  label: string;
  /** 트리거에 **보이는 글자**. 넣으면 ⋯ 점 대신 이 글자가 나온다.
   *
   *  ★ 2026-09-20 (Irene: *"... 이 뭐야? 뭔지 알 수도 없게"*) — `label` 은 `aria-label`·`title`
   *    로만 간다. `title` 은 **마우스를 올려야 뜨고 터치 기기에선 아예 안 뜬다.** 그래서 폰에서는
   *    이 버튼이 «뜻을 모르는 점 세 개» 다. CLAUDE.md 가 이미 적어 둔 문제다
   *    ("아이콘 전용 버튼은 자리는 먹고 뜻은 안 알려준다").
   *  ★ 기본값은 종전대로 ⋯ 다 — 쓰고 있는 30여 곳의 모양을 바꾸지 않는다.
   *    «메뉴 안에 뭐가 들었는지» 가 한 가지로 정해진 자리에서만 글자를 쓴다.
   *    (파일 행의 이 메뉴는 «폴더로 이동» 전용이라 지금 폴더 이름을 그대로 보여 준다 —
   *     값이 보이고 고치는 목록은 누를 때만 나오는 ChipPopover 와 같은 규칙.) */
  triggerLabel?: string;
  className?: string;
  'data-testid'?: string;
};

export default function OverflowMenu({ items, label, triggerLabel, className, ...rest }: Props) {
  const { open, toggle, close, pos, wrapRef, panelRef } = usePopoverAnchor();

  if (items.length === 0) return null;

  return (
    <Wrap ref={wrapRef} className={className}>
      <Trigger
        type="button"
        {...rest}
        $open={open}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={toggle}
      >
        {triggerLabel ? (
          <TriggerText>{triggerLabel}</TriggerText>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
          </svg>
        )}
      </Trigger>
      {open && pos && createPortal(
        <Menu ref={panelRef} role="menu" style={{ top: pos.top, right: pos.right }}>
          {items.map(it => (
            <React.Fragment key={it.key}>
              {it.dividerBefore && <MenuDivider />}
              {it.groupLabel && <MenuGroupLabel>{it.groupLabel}</MenuGroupLabel>}
              <MenuItem
                type="button"
                /* ★ 값이 하나뿐인 택일 묶음(예: "답 없으면" 기간)은 menuitemradio 다.
                   menuitem 으로 두면 스크린리더가 **무엇이 선택돼 있는지 못 읽는다** —
                   체크 표시는 눈에만 보이는 정보가 된다. */
                role={it.checked !== undefined ? 'menuitemradio' : 'menuitem'}
                aria-checked={it.checked !== undefined ? !!it.checked : undefined}
                $danger={!!it.danger}
                disabled={!!it.disabled}
                data-testid={it.testId}
                onClick={() => { close(); it.onClick(); }}
              >
                {it.icon}
                {it.label}
                {it.checked && (
                  <MenuCheck aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </MenuCheck>
                )}
              </MenuItem>
            </React.Fragment>
          ))}
        </Menu>,
        document.body,
      )}
    </Wrap>
  );
}

const Wrap = styled.div`position:relative;display:inline-flex;align-items:center;flex-shrink:0;`;
// 헤더의 다른 액션(32px)과 같은 크기·톤 — 줄이 어긋나 보이지 않게.
// 높이는 토큰 표준(36 / 폰 44) — theme/tokens.ts CONTROL. 액션 줄의 글자 버튼도 같은 36 이라
// 좌측 검색 박스(36px)와 한 줄로 선다.
const Trigger = styled.button<{ $open: boolean }>`
  /* 글자가 들어오면 폭이 늘어야 한다 — 36px 고정이면 글자가 잘린다.
     높이는 36px 그대로(한 줄 안 컨트롤 기준). 아이콘만일 때의 모양은 바뀌지 않는다. */
  min-width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;
  padding:0;max-width:100%;
  background:${p => (p.$open ? '#F0FDFA' : '#FFF')};
  border:1px solid ${p => (p.$open ? '#14B8A6' : '#E2E8F0')};border-radius:8px;
  color:${p => (p.$open ? '#0F766E' : '#475569')};cursor:pointer;
  transition:border-color 0.15s,color 0.15s,background 0.15s;
  &:hover{border-color:#14B8A6;color:#0F766E;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
  @media (max-width: 640px){ min-width:44px;height:44px; }
`;
/* 트리거에 보이는 글자 — 길면 자른다(행 폭을 밀어내면 옆 칸 정렬이 깨진다). */
const TriggerText = styled.span`
  padding:0 10px;font-size:0.75rem;font-weight:600;line-height:1;
  max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
`;
const Menu = styled.div`
  position:fixed;min-width:200px;max-height:70vh;overflow-y:auto;
  background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;
  box-shadow:0 8px 24px rgba(15,23,42,0.12);
  padding:6px;z-index:9000;display:flex;flex-direction:column;
`;
const MenuItem = styled.button<{ $danger?: boolean }>`
  display:inline-flex;align-items:center;gap:10px;
  padding:8px 12px;background:transparent;border:none;border-radius:6px;
  font-size:0.8125rem;font-weight:500;
  color:${p => (p.$danger ? '#DC2626' : '#0F172A')};
  cursor:pointer;text-align:left;white-space:nowrap;
  &:hover:not(:disabled){background:${p => (p.$danger ? '#FEF2F2' : '#F8FAFC')};}
  &:disabled{opacity:0.5;cursor:not-allowed;}
  svg{color:${p => (p.$danger ? '#DC2626' : '#64748B')};flex-shrink:0;}
  @media (max-width: 640px){ min-height:44px; }
`;
const MenuDivider = styled.div`height:1px;background:#F1F5F9;margin:4px 0;`;
// 택일 그룹 제목 — "답 없으면" 처럼 값이 하나뿐인 묶음이 무엇의 묶음인지 말한다.
const MenuGroupLabel = styled.div`
  padding:6px 12px 2px;font-size:0.6875rem;font-weight:700;color:#94A3B8;
  letter-spacing:-0.1px;white-space:nowrap;
`;
// 체크는 항목 **오른쪽 끝**에 — 라벨 길이가 달라도 한 줄에 정렬된다.
const MenuCheck = styled.span`
  margin-left:auto;padding-left:14px;display:inline-flex;align-items:center;color:#0F766E;
`;
