// 팝오버 앵커 — 트리거 버튼 아래에 portal 패널을 띄우는 좌표·닫기 로직 한 벌.
//
// ★ 새로 만들지 말고 여기서 가져다 쓴다. OverflowMenu 와 ChipPopover 가 각자 좌표를 계산하면
//   반드시 갈라진다(알림·새 소식 드롭다운이 그랬다 — components/Common/dropdownShell.ts 주석).
//   여기서는 **좌표와 열림 상태만** 다룬다. 생김새는 각자의 styled 가 정한다.
//
// 좌표는 트리거의 **오른쪽 끝에 맞춰** 편다 — right 로 잡으면 패널 폭을 재지 않아도 된다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEscapeStack } from '../../hooks/useEscapeStack';

export type AnchorPos = { top: number; right: number };

export function usePopoverAnchor() {
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

  // ★ Esc 는 **프로젝트 표준 스택**으로 (CLAUDE.md 드로어 접근성 규칙).
  //   직접 document 에 keydown 을 달고 stopPropagation 으로 막던 옛 코드는 **동작하지 않았다** —
  //   stopPropagation 은 같은 요소(document)에 따로 등록된 다른 리스너를 막지 못한다
  //   (그건 stopImmediatePropagation 이다). useEscapeStack 도 document 에 붙어 있어서,
  //   드로어 안에서 팝오버를 열고 Esc 를 누르면 **팝오버와 드로어가 같이 닫혔다.**
  //   스택은 최상단 하나만 실행하므로 팝오버만 닫힌다.
  useEscapeStack(open, close);

  // ★ useLayoutEffect — DOM commit 직후 layout phase 라 여기서 바로 잰다.
  //   RAF 로 미루면 첫 paint 가 (0,0) 에 그려진 뒤 튄다 (CLAUDE.md 운영 안정성 12).
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  // ★ **왼쪽 클램프** (2026-09-18). 위 계산은 트리거의 오른쪽 끝에만 맞춘다 — 트리거가 화면
  //   **왼쪽**에 있으면 패널이 화면 밖으로 나간다. 실측: 폰 390 에서 트리거 오른쪽 끝 109px →
  //   right=281 → 220px 패널이 `x=-111` 로 통째로 안 보였다(누르면 aria-expanded 만 true 인
  //   「죽은 컨트롤」). 트리거가 늘 오른쪽에 있던 동안 드러나지 않던 잠재 결함이다.
  //   패널 폭은 렌더 뒤에야 알 수 있으므로 **한 번 더** 재서 접는다(값이 같으면 다시 쓰지 않는다).
  useLayoutEffect(() => {
    if (!open || !pos) return;
    const w = panelRef.current?.getBoundingClientRect().width;
    if (!w) return;
    const maxRight = Math.max(8, window.innerWidth - w - 8);
    if (pos.right > maxRight) setPos({ top: pos.top, right: maxRight });
  }, [open, pos]);

  const toggle = useCallback(() => setOpen(o => !o), []);

  // ★ 포커스 — 열면 패널 안 첫 컨트롤로 넣고, 닫으면 트리거로 되돌린다.
  //   없으면 키보드 사용자는 팝오버를 열어도 그 안에 닿지 못하고, 닫은 뒤 처음으로 튕긴다.
  //   좌표 계산(useLayoutEffect) 뒤 실제 렌더가 끝난 다음이라야 패널 자식이 존재한다.
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      returnTo.current = (document.activeElement as HTMLElement) || null;
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

  return { open, setOpen, toggle, close, pos, wrapRef, panelRef };
}
