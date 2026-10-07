// 우측 패널 — 탭 막대를 눌러도 닫힌다(2026-10-07 Irene: «우측패널 열렸을 때 밖에 클릭하면 닫히는데 탭부분 클릭하면 안닫혀»).
//   패널의 바깥 덮개(백드롭)는 탭 막대 **아래**부터 깔린다(오버레이 기준선 계약 — 탭 막대는 덮지 않는다).
//   그래서 탭 막대를 누르면 덮개가 클릭을 못 받았다. 덮개를 탭 위로 올리면 탭을 못 누르니, 클릭은 탭에 그대로 가게 두고
//   **같은 순간 패널만 닫는다**(탭 전환도 정상으로 일어난다).
import { useEffect, useRef } from 'react';

export function useCloseOnTabStripClick(open: boolean, onClose: () => void) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && typeof t.closest === 'function' && t.closest('[data-testid="tabstrip"]')) cb.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);
}
