// 빈 공간을 끌어 여러 개 고르기 — 탐색기·파인더의 그 동작.
//
// Irene 2026-09-20: *"드래그해서 여러 개 선택하는 것도 안되는데"* — 없던 기능이다.
// 선택은 «선택모드를 켜고 체크박스를 하나씩» 뿐이었다. 파일이 수십 개면 쓸 수 없다.
//
// ★ 파일 카드 위에서 시작한 드래그는 **건드리지 않는다.** 그건 폴더로 옮기는 드래그다
//   (HTML5 drag). 두 동작이 같은 제스처를 다투면 둘 다 고장 난다 — 그래서 시작점이
//   «빈 공간인가» 로만 가른다.
// ★ 임계값(6px)을 넘기 전에는 아무 일도 하지 않는다. 안 그러면 **빈 곳 클릭 한 번이
//   선택 해제로 읽혀** 방금 고른 것이 사라진다.
import { useCallback, useEffect, useRef, useState } from 'react';

export type MarqueeRect = { x: number; y: number; w: number; h: number };
const THRESHOLD = 6;

type Opts = {
  /** 이 요소 안에서만 동작한다(스크롤 컨테이너). */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 선택 대상의 선택자 — 각 요소는 `data-file-id` 를 갖는다. */
  itemSelector: string;
  /** 사각형과 겹친 id 들. `additive` 면 기존 선택에 더한다(Shift/Ctrl). */
  onSelect: (ids: string[], additive: boolean) => void;
  enabled?: boolean;
};

export function useMarqueeSelect({ containerRef, itemSelector, onSelect, enabled = true }: Opts) {
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const start = useRef<{ x: number; y: number; additive: boolean } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // 카드·행·버튼·입력 위에서 시작한 것은 마퀴가 아니다(그쪽 동작을 뺏지 않는다).
      if (target.closest(`${itemSelector}, button, a, input, textarea, [role="button"], [draggable="true"]`)) return;
      start.current = { x: e.clientX, y: e.clientY, additive: e.shiftKey || e.metaKey || e.ctrlKey };
      moved.current = false;
    };
    const onMove = (e: MouseEvent) => {
      const s = start.current;
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!moved.current && Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      moved.current = true;
      e.preventDefault();               // 드래그 중 글자 선택 방지
      setRect({ x: Math.min(s.x, e.clientX), y: Math.min(s.y, e.clientY), w: Math.abs(dx), h: Math.abs(dy) });
    };
    const onUp = () => {
      const s = start.current;
      start.current = null;
      if (!s || !moved.current) { setRect(null); return; }
      setRect((r) => {
        if (r) {
          const hit: string[] = [];
          document.querySelectorAll(itemSelector).forEach((node) => {
            const b = (node as HTMLElement).getBoundingClientRect();
            const overlap = b.left < r.x + r.w && b.right > r.x && b.top < r.y + r.h && b.bottom > r.y;
            const id = (node as HTMLElement).dataset.fileId;
            if (overlap && id) hit.push(id);
          });
          onSelect(hit, s.additive);
        }
        return null;
      });
      moved.current = false;
    };

    el.addEventListener('mousedown', onDown);
    // move/up 은 **문서**에 건다 — 컨테이너 밖으로 나가도 사각형이 따라와야 한다.
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [containerRef, itemSelector, onSelect, enabled]);

  const clear = useCallback(() => setRect(null), []);
  return { rect, clear };
}
