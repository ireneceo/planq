import { useEffect } from 'react';
import { useTabActive } from '../contexts/TabActiveContext';

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
  /**
   * 최초 포커스를 첫 tabbable 대신 이 셀렉터로 보낸다 (선택).
   * 문자열이라 렌더마다 identity 가 바뀌지 않는다 — 객체 옵션이면 effect 가 매번 재실행된다.
   *
   * 왜 트랩이 받는가: 트랩이 열릴 때 rAF 로 첫 tabbable 을 잡으므로, 바깥에서 따로 focus() 를 걸면
   * 누가 이기는지가 훅 선언 순서에 달린 경쟁이 된다. #206 §2-10 이 네 번 죽은 이유가 그 경쟁을
   * 추측으로 짜 맞춘 것이었다. 의도를 트랩에 넘겨 경쟁 자체를 없앤다.
   */
  initialFocusSelector?: string,
): void => {
  const tabActive = useTabActive(); // ⑥ 숨은 탭 모달은 포커스 가로채지 않음(단일탭 = 항상 활성)
  useEffect(() => {
    if (!active || !tabActive || !ref.current) return;

    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // 최초 포커스 이동 — rAF 이후에 포커스해 스크롤 튐 방지
    if (initialFocusSelector) {
      // 지정 대상이 아직 렌더 전일 수 있다(데이터 로드 후 나타나는 배너 등) → 몇 프레임 재시도.
      // 끝내 없으면 첫 tabbable 로 폴백 — 포커스가 body 로 빠지는 것보다 낫다.
      let tries = 0;
      const tryFocus = () => {
        const target = container.querySelector<HTMLElement>(initialFocusSelector);
        if (target) { target.focus(); return; }
        if (++tries < 10) { requestAnimationFrame(tryFocus); return; }
        container.querySelector<HTMLElement>(FOCUSABLE)?.focus();
      };
      requestAnimationFrame(tryFocus);
    } else {
      const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE);
      if (firstFocusable) requestAnimationFrame(() => firstFocusable.focus());
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
  }, [active, tabActive, ref, initialFocusSelector]);
};
