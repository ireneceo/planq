// useVerticalReorder — 세로 목록 끌어 옮기기 공용 훅 (내 순서, docs/TASK_USER_ORDER_DESIGN.md §13 · Fable 2026-10-12)
//
//   라이브러리 없이 Pointer Events. 팝아웃 안에 묻지 않고 여기 둔다 — 나중에 메인 Q task 목록이 같은 훅을 쓴다.
//   계약(DOM 표식):
//     행     data-reorder-id="<id>"  data-reorder-group="<그룹 키>"   (끌 수 없는 행에는 붙이지 않는다)
//     손잡이  handleProps(id) 를 펼친다
//   놓는 자리는 **같은 그룹 안에서만** 정한다. 다른 그룹 위에서는 자리 표시가 없고, 놓으면 원위치(onMove 안 부름).
//   ★ 4px 움직이기 전에는 끌기가 아니다 — 손잡이 클릭·포커스를 살린다.
//   ★ 키보드: 손잡이 포커스에서 Alt+↑/↓ 로 한 칸.
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface ReorderDrop { overId: number; place: 'before' | 'after' }

interface Options {
  enabled: boolean;
  /** 스크롤 상자(자동 스크롤 대상). 행들은 이 안에 있어야 한다. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 옮긴 뒤 그 그룹의 id 순서(표시 순서). 바뀌지 않았으면 부르지 않는다. */
  onMove: (movedId: number, groupIdsAfter: number[]) => void;
}

const THRESHOLD = 4;
const EDGE = 24;

function groupRows(container: HTMLElement | null, group: string): HTMLElement[] {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>('[data-reorder-id]')]
    .filter((el) => el.dataset.reorderGroup === group);
}
const idOf = (el: HTMLElement) => Number(el.dataset.reorderId);

export function useVerticalReorder({ enabled, containerRef, onMove }: Options) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [drop, setDrop] = useState<ReorderDrop | null>(null);
  const st = useRef<{ id: number; group: string; startY: number; active: boolean; pointerId: number } | null>(null);
  const dropRef = useRef<ReorderDrop | null>(null);
  const lastY = useRef(0);
  const scrollTimer = useRef<number | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const stopScroll = () => { if (scrollTimer.current) { window.clearInterval(scrollTimer.current); scrollTimer.current = null; } };
  const reset = useCallback(() => { st.current = null; dropRef.current = null; setDragId(null); setDrop(null); stopScroll(); }, []);
  useEffect(() => () => stopScroll(), []);
  useEffect(() => { if (!enabled) reset(); }, [enabled, reset]);

  const computeDrop = (y: number) => {
    const s = st.current; if (!s) return;
    const rows = groupRows(containerRef.current, s.group);
    let next: ReorderDrop | null = null;
    // 포인터가 이 그룹의 세로 범위 밖이면 놓을 자리가 없다(다른 그룹 위 = 원위치).
    if (rows.length) {
      const top = rows[0].getBoundingClientRect().top; const bottom = rows[rows.length - 1].getBoundingClientRect().bottom;
      if (y >= top - 6 && y <= bottom + 6) {
        for (const el of rows) {
          const r = el.getBoundingClientRect();
          if (y < r.top + r.height / 2) { next = { overId: idOf(el), place: 'before' }; break; }
        }
        if (!next) next = { overId: idOf(rows[rows.length - 1]), place: 'after' };
      }
    }
    dropRef.current = next; setDrop(next);
  };

  const finish = (commit: boolean) => {
    const s = st.current; const d = dropRef.current;
    if (commit && s && s.active && d) {
      const ids = groupRows(containerRef.current, s.group).map(idOf);
      const without = ids.filter((x) => x !== s.id);
      let at = without.indexOf(d.overId);
      if (d.overId === s.id) at = ids.indexOf(s.id);          // 제자리
      else if (d.place === 'after') at += 1;
      const after = [...without.slice(0, at), s.id, ...without.slice(at)];
      if (after.join(',') !== ids.join(',')) onMoveRef.current(s.id, after);
    }
    reset();
  };

  const handleProps = (id: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled || e.button !== 0) return;
      const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-reorder-id]');
      if (!row) return;
      st.current = { id, group: row.dataset.reorderGroup || '', startY: e.clientY, active: false, pointerId: e.pointerId };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = st.current; if (!s || s.pointerId !== e.pointerId) return;
      lastY.current = e.clientY;
      if (!s.active) {
        if (Math.abs(e.clientY - s.startY) < THRESHOLD) return;
        s.active = true; setDragId(s.id);
        // 가장자리 자동 스크롤 — 포인터가 상자 위·아래 24px 안에 있는 동안
        scrollTimer.current = window.setInterval(() => {
          const c = containerRef.current; if (!c || !st.current?.active) return;
          const r = c.getBoundingClientRect();
          if (lastY.current < r.top + EDGE) c.scrollTop -= 12;
          else if (lastY.current > r.bottom - EDGE) c.scrollTop += 12;
          else return;
          computeDrop(lastY.current);
        }, 30);
      }
      e.preventDefault();
      computeDrop(e.clientY);
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => { if (st.current?.pointerId === e.pointerId) finish(true); },
    onPointerCancel: () => finish(false),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (!enabled || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-reorder-id]');
      if (!row) return;
      e.preventDefault();
      const ids = groupRows(containerRef.current, row.dataset.reorderGroup || '').map(idOf);
      const i = ids.indexOf(id); const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= ids.length) return;
      const after = [...ids]; after[i] = ids[j]; after[j] = id;
      onMoveRef.current(id, after);
    },
  });

  return { dragId, drop, handleProps };
}
