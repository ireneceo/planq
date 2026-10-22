// 편집기 툴바 «한 줄 + 옆으로 밀기» — 문서·메모(PostEditor)와 메일(RichEditor) 툴바가 같이 쓴다.
//
// 2026-10-20 Irene: «상단 에디터기능들이 왜 2줄 3줄 이렇게 반응형에 안맞게 늘어나는 거야? 옆으로 이동해서 보게 해야 하는 거 아냐?»
//   10-16 에 폰(≤640px)만 한 줄로 바꿨는데, 툴바 폭을 정하는 것은 화면이 아니라 **편집기 칸**이다 —
//   데스크탑에서도 목록·우측 패널 옆 칸은 1000px 이 안 돼 버튼 30여 개가 2~3줄로 감겼다.
//   그래서 폭과 무관하게 한 줄이다(CKEditor·Google Docs 처럼 감기지 않는다).
// ★ 스크롤바를 숨기면 마우스 사용자는 옆으로 갈 길이 없다 — 넘친 쪽에만 ‹ › 를 두고, 툴바 위 세로 휠도 옆으로 돌린다.
// ★ 툴바가 overflow 를 가지므로 툴바 안에서 펼치는 메뉴는 position:absolute 면 잘린다 — 포털 + fixed 로 띄운다
//   (TextStyleButton·CellFillButton·EditorSignatureButton).
import React, { useCallback, useEffect, useState } from 'react';
import styled, { css } from 'styled-components';
import { useTranslation } from 'react-i18next';

export const toolbarScrollCss = css`
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
  & > * { flex-shrink: 0; }
`;

/** 넘친 방향 + 세로 휠 → 가로. 돌려준 ref 를 툴바(스크롤 상자)에 단다.
 *  콜백 ref 다 — 편집기가 늦게 떠서(첫 렌더 null) 툴바가 나중에 붙어도 그때 감시를 건다. */
export function useToolbarHScroll() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    if (!el) return undefined;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { start: el.scrollLeft > 1, end: max - el.scrollLeft > 1 };
      setEdges((p) => (p.start === next.start && p.end === next.end ? p : next));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // 버튼이 늘고 주는 것(표 안에서만 보이는 도구 등)은 크기가 아니라 내용이 바뀐다
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(measure) : null;
    mo?.observe(el, { childList: true, subtree: true });
    // React onWheel 은 passive 라 preventDefault 가 안 먹는다 — 직접 붙인다
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      // 끝에 닿았으면 휠을 문서에 돌려준다 — 툴바가 sticky 라 그 위에 커서가 있으면 문서를 영영 못 내린다(Fable 2026-10-22)
      const max = el.scrollWidth - el.clientWidth;
      if ((e.deltaY > 0 && el.scrollLeft >= max - 1) || (e.deltaY < 0 && el.scrollLeft <= 0)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [el]);

  const step = useCallback((dir: -1 | 1) => {
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' });
  }, [el]);

  return { ref: setEl as (node: HTMLDivElement | null) => void, ...edges, step };
}

/** 툴바의 첫 자식(side=start)·마지막 자식(side=end)으로 둔다 — 자리를 차지하지 않고 끝에 붙어 있다. */
export const ToolbarEdgeArrow: React.FC<{ side: 'start' | 'end'; show: boolean; onStep: (dir: -1 | 1) => void }> = ({ side, show, onStep }) => {
  const { t } = useTranslation('common');
  const label = (side === 'start'
    ? t('editorToolbar.scrollLeft', { defaultValue: '앞 도구 보기' })
    : t('editorToolbar.scrollRight', { defaultValue: '뒤 도구 보기' })) as string;
  return (
    <Arrow type="button" $side={side} $show={show} tabIndex={-1} aria-hidden={!show}
      aria-label={label} title={label} data-testid={`editor-toolbar-scroll-${side}`}
      onMouseDown={(e) => { e.preventDefault(); onStep(side === 'start' ? -1 : 1); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {side === 'start' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </Arrow>
  );
};

const ARROW_W = 28;
const Arrow = styled.button<{ $side: 'start' | 'end'; $show: boolean }>`
  all: unset; box-sizing: border-box;
  position: sticky; z-index: 2;
  ${(p) => (p.$side === 'start'
    ? `left: 0; margin-right: -${ARROW_W}px; justify-content: flex-start; padding-left: 2px;
       background: linear-gradient(to right, #F8FAFC 60%, rgba(248,250,252,0));`
    : `right: 0; margin-left: -${ARROW_W}px; justify-content: flex-end; padding-right: 2px;
       background: linear-gradient(to left, #F8FAFC 60%, rgba(248,250,252,0));`)}
  width: ${ARROW_W}px; align-self: stretch; flex-shrink: 0;
  display: inline-flex; align-items: center;
  color: #475569; cursor: pointer;
  visibility: ${(p) => (p.$show ? 'visible' : 'hidden')};
  &:hover { color: #0F172A; }
`;
