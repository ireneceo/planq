// 팝아웃(분리 창) 컨텍스트 마커 — 창 단위 영속.
// 분리 창(/talk-popout, /note-popout, /help-popout) 안에서 다른 라우트(/wiki 등)로
// 이동해도 그 창은 끝까지 "팝아웃"으로 취급 → 우측 하단 퀵메뉴·토스터 재노출 차단(#84).
// sessionStorage 는 창(브라우징 컨텍스트)별 격리 → window.open 분리 창에만 표시되고
// 메인 창엔 안 묻음. 한 번 set 하면 그 창 생애 동안 유지(언마운트 해도 안 지움).
const KEY = 'pq_popout';

export function markPopoutWindow(): void {
  try {
    // 진짜 분리 창에서만 마킹. 메인 탭이 실수로 /help-popout 직접 열어도(window.open 아님)
    // 오염되지 않게 가드 — window.opener(열어준 부모 존재) 또는 window.name='pq-*'(window.open 2nd arg).
    const realPopout = typeof window !== 'undefined'
      && (!!window.opener || /^pq-/.test(window.name || ''));
    if (realPopout) sessionStorage.setItem(KEY, '1');
  } catch { /* private mode 등 — best-effort */ }
}

export function isPopoutWindow(): boolean {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}
