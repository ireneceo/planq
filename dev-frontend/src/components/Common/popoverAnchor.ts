// 팝오버 앵커 — 트리거 버튼 아래에 portal 패널을 띄우는 좌표·닫기 로직 한 벌.
//
// ★ 새로 만들지 말고 여기서 가져다 쓴다. OverflowMenu 와 ChipPopover 가 각자 좌표를 계산하면
//   반드시 갈라진다(알림·새 소식 드롭다운이 그랬다 — components/Common/dropdownShell.ts 주석).
//   여기서는 **좌표와 열림 상태만** 다룬다. 생김새는 각자의 styled 가 정한다.
//
// 좌표는 트리거의 **오른쪽 끝에 맞춰** 편다 — right 로 잡으면 패널 폭을 재지 않아도 된다.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEscapeStack } from '../../hooks/useEscapeStack';

// ★ 기본은 «트리거 아래 · 오른쪽 끝 맞춤» — 쓰는 곳 대부분이 이것이다.
//   placement 'up' = 트리거 **위로** 편다(화면 맨 아래 입력줄 — 아래로 펴면 화면 밖이다, 2026-10-23 채팅 + 메뉴).
//   align 'start' = 트리거 **왼쪽 끝**에 맞춘다(트리거가 줄 왼쪽에 있을 때 — 오른쪽 맞춤이면 옆 패널을 덮는다).
export type AnchorPos = { top?: number; bottom?: number; right?: number; left?: number; maxHeight?: number };
export type AnchorOptions = { placement?: 'down' | 'up'; align?: 'end' | 'start' };

// ═══ 떠 있는 메뉴의 자리 — **한 함수** (2026-10-27, Irene «추진과제 그룹 드롭다운이 맨 아래 업무에서 잘려버려 … 여기 저기 같은 문제») ═══
//   메뉴마다 «아래로 펴기» 를 각자 계산해 왔다(그룹 이동·행 ⋯·서식·셀 채움·채팅 ⋯ … 10곳 넘게). 그중 일부만
//   위로 뒤집었고, **위아래 둘 다 모자랄 때 높이를 줄여 메뉴 안에서 스크롤** 하는 곳은 거의 없었다 — 항목이 많으면
//   뒤집어도 위쪽이 잘렸다. 규칙은 하나다:
//     ① 아래(또는 prefer 쪽)에 다 들어가면 그쪽 ② 아니면 반대쪽에 다 들어가면 반대쪽
//     ③ 둘 다 모자라면 **넓은 쪽**에 펴고 높이를 그 칸에 맞춘다(넘는 항목은 메뉴 안에서 스크롤)
//     ④ 가로는 화면 안으로 접는다.
//   기준 화면은 **보이는 화면**(visualViewport) — 폰 키보드가 올라와도 innerHeight 는 그대로라 키보드 뒤로 편다(TagQuickMenu 실측).
//   자르는 조상(overflow:hidden·auto)을 피하려면 메뉴는 body 로 포털해 position:fixed 로 그린다 — 아래 useFloatingPanel.
const EDGE = 8;
export type FloatAlign = 'start' | 'end' | 'center';
export function placeFloating(
  anchor: { top: number; bottom: number; left: number; right: number },
  panel: { width: number; height: number },
  { align = 'start', gap = 4, prefer = 'down' }: { align?: FloatAlign; gap?: number; prefer?: 'down' | 'up' } = {},
): { top?: number; bottom?: number; left: number; maxHeight?: number } {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const viewTop = vv ? vv.offsetTop : 0;
  const viewBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const below = viewBottom - anchor.bottom - gap - EDGE;
  const above = anchor.top - viewTop - gap - EDGE;
  const first = prefer === 'up' ? above : below;
  const second = prefer === 'up' ? below : above;
  let up: boolean;
  if (panel.height <= first) up = prefer === 'up';
  else if (panel.height <= second) up = prefer !== 'up';
  else up = above > below;
  const room = Math.max(0, up ? above : below);
  const maxHeight = panel.height > room ? room : undefined;
  const vw = window.innerWidth;
  const raw = align === 'end' ? anchor.right - panel.width
    : align === 'center' ? anchor.left + (anchor.right - anchor.left) / 2 - panel.width / 2
    : anchor.left;
  const left = Math.max(EDGE, Math.min(raw, vw - panel.width - EDGE));
  return up
    ? { bottom: window.innerHeight - anchor.top + gap, left, maxHeight }
    : { top: anchor.bottom + gap, left, maxHeight };
}

/** 위 자리를 position:fixed 인라인 style 로. 메뉴 styled 가 absolute·top:100%·transform·margin 을 갖고 있어도 덮는다. */
export function anchorStyle(pos: AnchorPos | null, zIndex?: number): React.CSSProperties {
  if (!pos) return { position: 'fixed', top: 0, left: 0, visibility: 'hidden', transform: 'none', margin: 0, ...(zIndex ? { zIndex } : {}) };
  return {
    position: 'fixed',
    top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto',
    left: pos.left ?? 'auto', right: pos.right ?? 'auto',
    transform: 'none', margin: 0,
    ...(pos.maxHeight !== undefined ? { maxHeight: pos.maxHeight, overflowY: 'auto' as const } : {}),
    ...(zIndex ? { zIndex } : {}),
  };
}

// 메뉴의 «원래 높이» — 인라인 maxHeight 를 잠깐 빼고 잰다(css 의 max-height 는 그대로 걸린다 = 그 메뉴가 원하는 높이).
function naturalSize(el: HTMLElement) {
  const prev = el.style.maxHeight;
  el.style.maxHeight = '';
  const size = { width: el.offsetWidth, height: el.offsetHeight };
  el.style.maxHeight = prev;
  return size;
}

// 밑에서 스크롤하면 닫는다 — 아래 usePopoverAnchor 의 같은 이름 절 주석이 이유다(2026-10-07 순찰 실측).
function useDismissOnOuterScroll(open: boolean, panelRef: React.RefObject<HTMLElement | null>, onDismiss?: () => void) {
  // 호출부가 화살표 함수를 매번 새로 넘겨도 구독을 다시 걸지 않는다(다시 걸면 400ms 유예가 렌더마다 새로 시작된다).
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const enabled = open && !!onDismiss;
  useEffect(() => {
    if (!enabled) return;
    const since = Date.now();
    const onScroll = (e: Event) => {
      if (Date.now() - since < 400) return;
      const tgt = e.target as Node | null;
      if (tgt && panelRef.current?.contains(tgt)) return;
      const ae = document.activeElement;
      if (ae && panelRef.current?.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
      dismissRef.current?.();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [enabled, panelRef]);
}

/**
 * 열림 상태를 **호출부가 쥔** 메뉴용(목록 행의 상태·담당자·그룹 메뉴처럼 «어느 행이 열렸나» 를 목록이 들고 있는 곳).
 *   anchor = 트리거 요소(닫혀 있으면 null). 메뉴는 `createPortal(…, document.body)` 로 그리고 `ref`·`style` 을 붙인다.
 *   열림·바깥 클릭·Esc 는 호출부 것을 그대로 쓴다 — 여기서는 **자리만** 정한다. onDismiss 를 주면 밑에서 스크롤할 때 부른다.
 */
export function useFloatingPanel<T extends HTMLElement = HTMLDivElement>(
  anchor: HTMLElement | null,
  { align = 'start', gap = 4, prefer = 'down', zIndex = 9000, onDismiss, contentKey, matchWidth }:
    { align?: FloatAlign; gap?: number; prefer?: 'down' | 'up'; zIndex?: number; onDismiss?: () => void;
      /** 메뉴 안 내용이 바뀌어 높이가 달라지면(삭제 확인 줄이 펼쳐짐 등) 값을 바꿔 다시 잰다 */
      contentKey?: unknown;
      /** 기준 요소 폭만큼은 넓게(입력칸 아래 후보 목록) */
      matchWidth?: boolean } = {},
) {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<AnchorPos | null>(null);
  const [minWidth, setMinWidth] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!anchor || !el) { setPos(null); return; }
    const r = anchor.getBoundingClientRect();
    if (matchWidth) { el.style.minWidth = `${r.width}px`; setMinWidth(r.width); }
    setPos(placeFloating(r, naturalSize(el), { align, gap, prefer }));
  }, [anchor, align, gap, prefer, contentKey, matchWidth]);
  useDismissOnOuterScroll(!!anchor, ref, onDismiss);
  return { ref, style: { ...anchorStyle(pos, zIndex), ...(minWidth ? { minWidth, boxSizing: 'border-box' as const } : {}) } };
}

export function usePopoverAnchor({ placement = 'down', align = 'end' }: AnchorOptions = {}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<AnchorPos | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭 닫기 — 트리거와 패널 **둘 다** 바깥일 때만 닫는다.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (wrapRef.current?.contains(tgt) || panelRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  // ★ 밑에서 스크롤하면 닫는다 (2026-10-07 순찰 실측). 패널은 position:fixed 로 **연 순간의 자리**에 그려진다.
  //   폰에서 손가락으로 목록을 밀면 mousedown 이 없어 바깥클릭 닫기가 안 돌고, 패널이 **다른 행 위에 떠서**
  //   그 행의 버튼(고객 보기·메모·일정)을 덮었다. 패널 자체를 스크롤하는 것은 닫지 않는다.
  //   ★ 패널 안 입력칸에 포커스가 있으면 닫지 않는다 — 폰 키보드가 올라오며 main.tsx 가 조상을 스크롤하는데
  //     그걸 «밑에서 스크롤» 로 읽으면 검색칸을 누르는 순간 팝오버가 닫힌다. 같은 이유로 resize 는 보지 않는다.
  //   여는 순간의 스크롤(첫 칸 focus 로 인한 스크롤·관성 스크롤 끝자락)은 닫는 이유가 아니다(400ms).
  useDismissOnOuterScroll(open, panelRef, close);

  // ★ Esc 는 **프로젝트 표준 스택**으로 (CLAUDE.md 드로어 접근성 규칙).
  //   직접 document 에 keydown 을 달고 stopPropagation 으로 막던 옛 코드는 **동작하지 않았다** —
  //   stopPropagation 은 같은 요소(document)에 따로 등록된 다른 리스너를 막지 못한다
  //   (그건 stopImmediatePropagation 이다). useEscapeStack 도 document 에 붙어 있어서,
  //   드로어 안에서 팝오버를 열고 Esc 를 누르면 **팝오버와 드로어가 같이 닫혔다.**
  //   스택은 최상단 하나만 실행하므로 팝오버만 닫힌다.
  useEscapeStack(open, close);

  // ★ useLayoutEffect — DOM commit 직후 layout phase 라 여기서 바로 잰다.
  //   RAF 로 미루면 첫 paint 가 (0,0) 에 그려진 뒤 튄다 (CLAUDE.md 운영 안정성 12).
  //   1) 트리거만 보고 첫 자리를 준다(패널이 그려져야 폭·높이를 잴 수 있다)
  //   2) 그려진 패널을 재서 placeFloating 으로 확정한다 — 왼쪽/오른쪽 화면 밖 접기(2026-09-18 폰 x=-111 «죽은 컨트롤»)·
  //      아래가 모자라면 위로(2026-10-23 우측 패널 하단 ⋯ top 892)·**둘 다 모자라면 넓은 쪽에 높이를 맞춰 안에서 스크롤**(2026-10-27).
  //      확정은 열 때마다 한 번 — 값이 바뀌어 다시 도는 루프를 만들지 않는다.
  const placed = useRef(false);
  useLayoutEffect(() => {
    placed.current = false;
    if (!open) { setPos(null); return; }
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const v = placement === 'up' ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 };
    const h = align === 'start' ? { left: Math.max(8, r.left) } : { right: Math.max(8, window.innerWidth - r.right) };
    setPos({ ...v, ...h });
  }, [open, placement, align]);
  useLayoutEffect(() => {
    if (!open || !pos || placed.current) return;
    const el = panelRef.current; const r = wrapRef.current?.getBoundingClientRect();
    if (!el || !r) return;
    placed.current = true;
    setPos(placeFloating(r, naturalSize(el), { align: align === 'start' ? 'start' : 'end', gap: 6, prefer: placement }));
  }, [open, pos, placement, align]);

  const toggle = useCallback(() => setOpen(o => !o), []);

  // ★ 포커스 — 열면 패널 안 첫 컨트롤로 넣고, 닫으면 트리거로 되돌린다.
  //   없으면 키보드 사용자는 팝오버를 열어도 그 안에 닿지 못하고, 닫은 뒤 처음으로 튕긴다.
  //   좌표 계산(useLayoutEffect) 뒤 실제 렌더가 끝난 다음이라야 패널 자식이 존재한다.
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      // 자리가 확정되며 pos 가 한 번 더 바뀐다 — 그때는 이미 패널 안에 포커스가 있으니 «돌아갈 곳» 을 덮지 않는다.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && panelRef.current?.contains(ae)) return;
      returnTo.current = ae || null;
      const first = panelRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    } else if (returnTo.current) {
      // 트리거가 아직 화면에 있을 때만 되돌린다(스레드를 바꾸면 사라진다).
      if (document.body.contains(returnTo.current)) returnTo.current.focus();
      returnTo.current = null;
    }
  }, [open, pos]);

  return { open, setOpen, toggle, close, pos, style: anchorStyle(pos), wrapRef, panelRef };
}
