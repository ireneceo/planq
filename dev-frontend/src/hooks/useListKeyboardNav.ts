import { useEffect } from 'react';

interface Options<T extends string | number> {
  itemIds: T[];
  activeId: T | null;
  onChange: (id: T) => void;
  enabled?: boolean;
  itemSelector?: (id: T) => string;
}

export function useListKeyboardNav<T extends string | number>(options: Options<T>) {
  const { itemIds, activeId, onChange, enabled = true, itemSelector } = options;

  useEffect(() => {
    if (!enabled || itemIds.length === 0) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
        if (target.closest('[role="dialog"]')) return;
      }

      e.preventDefault();

      const currentIdx = activeId !== null ? itemIds.indexOf(activeId) : -1;
      let nextIdx: number;
      if (e.key === 'ArrowDown') {
        nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, itemIds.length - 1);
      } else if (e.key === 'ArrowUp') {
        nextIdx = currentIdx < 0 ? itemIds.length - 1 : Math.max(currentIdx - 1, 0);
      } else if (e.key === 'Home') {
        nextIdx = 0;
      } else {
        nextIdx = itemIds.length - 1;
      }
      const nextId = itemIds[nextIdx];
      if (nextId === activeId) return;
      onChange(nextId);

      if (itemSelector) {
        requestAnimationFrame(() => {
          const el = document.querySelector(itemSelector(nextId)) as HTMLElement | null;
          if (el) el.scrollIntoView({ block: 'nearest' });
        });
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, itemIds, activeId, onChange, itemSelector]);
}
