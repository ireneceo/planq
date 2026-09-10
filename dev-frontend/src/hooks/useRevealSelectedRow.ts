// 선택된 행을 **목록 안에서 보이게** 한다 (2026-09-10)
//
//   Irene: "검색에서 문서 검색해서 문서 열면 왼쪽에 리스트에서도 선택되어 있어야 해.
//           다른 메뉴들 검색해서 이동할 때도 마찬가지야. 리스트가 같이 표시되어야지."
//
// 실측(2026-09-10, /docs?post=91): 행은 **이미 선택 표시가 되어 있었다**(민트 배경).
//   그런데 그 행의 y 가 2359 이고 목록 뷰포트는 443~1030 이라 **한 픽셀도 안 보였다.**
//   사용자에게는 "선택 안 됨" 과 구별되지 않는다 — 목록 맨 위만 보이기 때문이다.
//   (memory feedback_measure_the_screen_not_innertext — 칠해졌다고 보이는 것이 아니다.)
//
// 설계:
//   · 행에 `data-row-id={id}` 만 붙이면 된다. 화면마다 스크롤 코드를 쓰지 않는다 —
//     각자 쓰면 갈라진다(어떤 목록은 되고 어떤 목록은 안 되는 지금 상태가 그 결과다).
//   · `block: 'nearest'` — 이미 보이면 **아무 것도 하지 않는다.** 사용자가 목록을 스크롤해
//     둔 자리를 뺏지 않고, 부모 스크롤도 최소한만 움직인다.
//   · 목록은 비동기로 온다 → 행이 나타날 때까지 짧게 기다린다(최대 ~3초). 못 찾으면 조용히 끝낸다.
//   · 사용자가 목록에서 직접 누른 경우에도 안전하다(이미 보이므로 no-op).
import { useEffect } from 'react';

export function useRevealSelectedRow(
  activeId: number | string | null | undefined,
  opts: { enabled?: boolean; scope?: string } = {},
) {
  const { enabled = true, scope } = opts;
  useEffect(() => {
    if (!enabled || activeId === null || activeId === undefined || activeId === '') return;
    let cancelled = false;
    let tries = 0;
    const sel = `${scope ? `${scope} ` : ''}[data-row-id="${String(activeId)}"]`;
    const tick = () => {
      if (cancelled) return;
      const el = document.querySelector(sel);
      if (el) {
        // block:'nearest' — 보이면 그대로 둔다. 페이지 전체를 끌어당기지 않는다.
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* 구형 */ }
        return;
      }
      if (tries++ < 20) window.setTimeout(tick, 150);
    };
    // 첫 시도는 다음 프레임 — 같은 커밋에서 행이 아직 안 붙었을 수 있다.
    const raf = window.requestAnimationFrame(tick);
    return () => { cancelled = true; window.cancelAnimationFrame(raf); };
  }, [activeId, enabled, scope]);
}

export default useRevealSelectedRow;
