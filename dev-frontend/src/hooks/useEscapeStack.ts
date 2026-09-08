import { useEffect } from 'react';

// 모듈 레벨 스택 — 드로어/모달이 중첩 열렸을 때 최상단만 Esc 처리
const stack: Array<{ id: number; handler: () => void }> = [];
let seq = 0;

// ── 그 Esc 가 **열려 있던 드롭다운의 몫**인가 ──────────────────────────────
// 2026-09-08 실측: 드로어 안 셀렉트를 열고 Esc 를 한 번 누르면 드롭다운만 닫히면 될 것이
//   **드로어까지 같이 닫혔다.** 드롭다운만 닫으려던 사람이 보던 화면을 통째로 잃는다.
//
// ★ 판정은 **capture 시점에만** 가능하다. bubble 까지 오면 react-select 가 이미 메뉴를 닫아
//   흔적이 없다(같은 이벤트를 capture/bubble 에서 재보면 열림 흔적이 capture 에만 있다).
// ★ `defaultPrevented` 로 판정하면 안 된다 — 처음에 그렇게 했다가 음성 대조군에서 걸렸다.
//   react-select 는 **메뉴가 닫혀 있어도** Esc 에 preventDefault() 를 건다(번들 확인:
//   onKeyDown 의 switch 를 빠져나오며 무조건 호출). 그러면 포커스가 셀렉트에 있는 한
//   Esc 로 드로어를 **영영 못 닫는다.** 기능을 죽이는 쪽이 더 나쁘다.
// ★ 판정은 ARIA 로 한다 — emotion 이 만드는 클래스 이름(css-xxx-menu)에 기대지 않는다.
const consumedByOverlay = new WeakSet<Event>();
const OPEN_OVERLAY = '[role="combobox"][aria-expanded="true"], [role="listbox"]';
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector(OPEN_OVERLAY)) consumedByOverlay.add(e);
  }, true);
}

/**
 * 이 Esc 가 그 순간 열려 있던 드롭다운(셀렉트 등)의 몫이면 true.
 * 패널·드로어를 닫는 쪽은 **이 함수를 부른 뒤** 닫는다. 각자 판정하면 반드시 갈라진다 —
 * 실제로 Q Task 화면은 Esc 를 세 곳에서 듣고 있었고 그중 둘이 이 사실을 몰랐다.
 */
export function escapeConsumedByOverlay(e: Event): boolean {
  return consumedByOverlay.has(e);
}

const attachKeyOnce = (() => {
  let attached = false;
  return () => {
    if (attached) return;
    attached = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (stack.length === 0) return;
      // 열려 있던 드롭다운의 몫이면 여기서는 아무것도 하지 않는다 (위 설명 참조).
      if (escapeConsumedByOverlay(e)) return;
      // 최상단만 실행
      const top = stack[stack.length - 1];
      top.handler();
    });
  };
})();

/**
 * Esc 키 닫기 핸들러를 전역 스택에 등록.
 * 중첩 드로어 열림 시 가장 최근 것만 닫히고, 이전 것은 유지됨.
 *
 * @example
 *   useEscapeStack(open, onClose);
 */
export const useEscapeStack = (active: boolean, onClose: () => void): void => {
  useEffect(() => {
    if (!active) return;
    attachKeyOnce();
    const entry = { id: ++seq, handler: onClose };
    stack.push(entry);
    return () => {
      const idx = stack.findIndex((x) => x.id === entry.id);
      if (idx >= 0) stack.splice(idx, 1);
    };
  }, [active, onClose]);
};
