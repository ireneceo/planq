import { useEffect } from 'react';

// 드로어/모달 열린 동안 body 스크롤 잠금 — iOS Safari 포함 안정 동작
export const useBodyScrollLock = (locked: boolean): void => {
  useEffect(() => {
    if (!locked) return;
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    // 스크롤바 폭 보정 (데스크탑에서 레이아웃 흔들림 방지)
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [locked]);
};
