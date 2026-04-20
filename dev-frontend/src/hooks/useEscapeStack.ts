import { useEffect } from 'react';

// 모듈 레벨 스택 — 드로어/모달이 중첩 열렸을 때 최상단만 Esc 처리
const stack: Array<{ id: number; handler: () => void }> = [];
let seq = 0;

const attachKeyOnce = (() => {
  let attached = false;
  return () => {
    if (attached) return;
    attached = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (stack.length === 0) return;
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
