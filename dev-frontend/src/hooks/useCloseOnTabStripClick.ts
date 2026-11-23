// 우측 패널 — 탭 막대의 «빈 곳·지금 탭» 을 누르면 닫힌다(2026-10-07 Irene: «우측패널 열렸을 때 밖에 클릭하면 닫히는데 탭부분 클릭하면 안닫혀»).
//   패널의 바깥 덮개(백드롭)는 탭 막대 **아래**부터 깔린다(오버레이 기준선 계약 — 탭 막대는 덮지 않는다).
//   그래서 탭 막대를 누르면 덮개가 클릭을 못 받았다. 덮개를 탭 위로 올리면 탭을 못 누르니, 클릭은 탭에 그대로 가게 두고
//   **같은 순간 패널만 닫는다**.
//
// ★ 2026-11-23 — **다른 탭으로 옮기는 것은 «바깥 클릭» 이 아니다.** 닫지 않는다.
//   Irene: «탭을 이동한다고 해서 왜 우측 패널 열어둔게 닫혀? 내용 입력하던 거 임시저장도 안되고 패널도 닫혀버리고. 항상 다 날라가잖아.»
//   탭 pane 은 keep-alive(display:none + inert, 언마운트 없음)라 패널을 열어 둔 채 숨겼다가 돌아오면 쓰던 그대로 보인다.
//   여기서 닫으면 그 보존을 우리가 깨는 것이었다(만들던 업무·일정 입력이 통째로 사라졌다).
//   그래서 «다른 탭 누르기 · 다른 탭 닫기 · + 새 탭» 은 건너뛰고, 지금 탭·빈 곳·뒤로 버튼만 바깥 클릭으로 본다.
import { useEffect, useRef } from 'react';

/** 이 누름이 «다른 탭으로 옮겨 가는» 동작인가 — 패널을 남겨 둔다 */
export function isTabSwitchPress(t: Element): boolean {
  if (t.closest('[data-testid="tabstrip-new"]')) return true;
  const chip = t.closest('[role="tab"]');
  return !!chip && chip.getAttribute('aria-selected') !== 'true';
}

export function useCloseOnTabStripClick(open: boolean, onClose: () => void) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || typeof t.closest !== 'function' || !t.closest('[data-testid="tabstrip"]')) return;
      if (isTabSwitchPress(t)) return;
      cb.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
}
