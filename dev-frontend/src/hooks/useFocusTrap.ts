import { useEffect } from 'react';

// 포커스 가능 요소 셀렉터
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * 드로어/모달 열린 동안 Tab 포커스를 컨테이너 내부로 순회시킴.
 * 닫힐 때 열기 직전 포커스되어있던 요소로 복귀.
 */
export const useFocusTrap = (
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
): void => {
  useEffect(() => {
    if (!active || !ref.current) return;

    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // 최초 포커스 이동 — 첫 포커스 가능 요소로
    const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE);
    if (firstFocusable) {
      // 마이크로태스크 — 애니메이션 프레임 이후에 포커스해 스크롤 튐 방지
      requestAnimationFrame(() => firstFocusable.focus());
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null); // 실제로 보이는 것만
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift+Tab — 첫 요소에서 마지막으로 래핑
        if (current === first || !container.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      // 복귀
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [active, ref]);
};
