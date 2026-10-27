// 목록 칸 안에서 여는 작은 메뉴(상태·담당자·그룹 ⋯ 등)를 **body 로 꺼내** 띄우는 껍데기.
//
// ★ 왜 (2026-10-27, Irene «업무가 가장 아래에 있으면 드롭다운이 잘려버려 … 여기 저기 이런 같은 문제»)
//   칸 안에 `position:absolute; top:100%` 로 붙인 메뉴는 목록 상자(overflow:auto·hidden)를 넘지 못한다 —
//   맨 아래 행에서 열면 메뉴 아래쪽이 목록 끝에서 잘리고, 목록 안 스크롤로만 보인다.
//   여기서는 메뉴 요소에 ref·style 만 얹는다: 생김새(styled)는 그대로, 자리는 공용 placeFloating 한 벌
//   (아래가 모자라면 위로 · 둘 다 모자라면 넓은 쪽에 높이를 맞춰 메뉴 안에서 스크롤 · 가로는 화면 안).
//   열림·바깥 클릭·Esc 는 호출부 것을 그대로 쓴다.
//
// 기준(anchor)을 따로 주지 않으면 **이 컴포넌트를 둔 자리의 부모 요소**(보통 트리거가 든 칸)에 붙인다.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingPanel, type FloatAlign } from './popoverAnchor';

interface Props {
  /** 메뉴 요소 하나(styled 그대로). ref·style 을 덧입힌다. */
  children: React.ReactElement<{ style?: React.CSSProperties }>;
  anchor?: HTMLElement | null;
  align?: FloatAlign;
  gap?: number;
  zIndex?: number;
  /** 밑에서 스크롤하면 부른다(메뉴는 연 순간 자리에 떠 있으므로 다른 행 위에 남지 않게). */
  onDismiss?: () => void;
  /** 메뉴 내용이 바뀌어 높이가 달라질 때 값을 바꾸면 다시 잰다 */
  contentKey?: unknown;
  /** 기준 요소 폭만큼은 넓게(입력칸 아래 후보 목록) */
  matchWidth?: boolean;
}

export default function FloatingMenu({ children, anchor, align = 'start', gap, zIndex, onDismiss, contentKey, matchWidth }: Props) {
  const probe = useRef<HTMLSpanElement>(null);
  const [parent, setParent] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (anchor === undefined) setParent(probe.current?.parentElement ?? null);
  }, [anchor]);
  const { ref, style } = useFloatingPanel(anchor === undefined ? parent : anchor, { align, gap, zIndex, onDismiss, contentKey, matchWidth });
  // 메뉴가 이미 자기 ref 를 갖고 있으면(바깥 클릭 판정 등) 둘 다 채운다 — 덮어쓰면 그쪽 판정이 조용히 죽는다.
  const own = (children as unknown as { ref?: React.Ref<HTMLDivElement> }).ref;
  const setRef = (el: HTMLDivElement | null) => {
    (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (typeof own === 'function') own(el);
    else if (own && typeof own === 'object') (own as React.MutableRefObject<HTMLDivElement | null>).current = el;
  };
  return (
    <>
      {anchor === undefined && <span ref={probe} hidden />}
      {createPortal(
        React.cloneElement(children as React.ReactElement<{ style?: React.CSSProperties; ref?: React.Ref<HTMLDivElement> }>, {
          ref: setRef,
          style: { ...(children.props.style || {}), ...style },
        }),
        document.body,
      )}
    </>
  );
}
