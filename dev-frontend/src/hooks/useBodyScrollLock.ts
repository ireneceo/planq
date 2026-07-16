import { useEffect } from 'react';
import { useTabActive } from '../contexts/TabActiveContext';

// 동시에 열린 모달/드로어 카운트 — body 클래스/스타일을 단 한번만 토글하기 위해
let lockCount = 0;

// 드로어/모달 열린 동안 body 스크롤 잠금 — iOS Safari 포함 안정 동작
// 부수효과: body 에 data-overlay-open="true" 추가 → 전역 floating UI(예: Q Helper)가 CSS 로 자기를 숨길 수 있음
// ⑥ 멀티탭 — 숨은 탭에 열린 드로어가 공유 body 스크롤을 잠그지 않게 tabActive gating(단일탭 = 항상 활성).
export const useBodyScrollLock = (locked: boolean): void => {
  const tabActive = useTabActive();
  const effLocked = locked && tabActive;
  useEffect(() => {
    if (!effLocked) return;
    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    // 스크롤바 폭 보정 (데스크탑에서 레이아웃 흔들림 방지)
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    lockCount += 1;
    document.body.dataset.overlayOpen = 'true';
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) delete document.body.dataset.overlayOpen;
    };
  }, [effLocked]);
};
