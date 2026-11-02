// 태블릿·앱 «처음 열 때 느림 · 좌측 메뉴가 잘 안 눌림» 실기기 측정 (2026-11-02)
//
// Irene: *"태블릿이랑 모바일앱에서 처음 열릴 때 너무 느리고 태블릿에서 좌측메뉴 클릭할 때 제대로 안되고
//   여러 번 눌러도 제대로 반응안하고 불편한 거 해결 안되고 있어."*
//   서버 옆 브라우저(크롬 흉내·CPU ×4)로는 메뉴 누름이 매번 0.01~0.5초에 반응했다 — 아이패드 사파리 고유의
//   동작은 흉내로 재현되지 않는다. 그래서 **실기기에서** 재어 보낸다(services/navDiag 와 같은 모양·같은 라우트).
//
// 재는 것 (터치 기기·앱에서만, 문서당 한 번 보고):
//   · 시작: 문서 시작 → 앱 틀(사이드바)이 그려질 때 · 본문 글자가 붙을 때 · 처음 10초의 긴 작업 합(지원 브라우저만)
//   · 메뉴 누름(최대 12건): 손가락 닿음 → click 도착 · → 주소 바뀜 · → 다음 화면 그림
//     click 이 안 온 누름(«먹힌 탭»)과 도착 전에 같은 메뉴를 또 누른 것(«다시 누름»)을 센다.
// 담는 것: 경로·밀리초·화면 폭·연결 종류·빌드. 본문·이메일·토큰은 담지 않는다.
import { keepaliveJson } from './keepaliveFetch';

const t0 = 0; // performance.now() 기준 = 문서 시작
const isTouch = (() => {
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.()) return true;
    return window.matchMedia('(pointer: coarse)').matches;
  } catch { return false; }
})();
const native = (() => {
  try { return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(); } catch { return false; }
})();

interface Tap { href: string; at: number; click: number | null; url: number | null; paint: number | null; repeat: boolean }
const boot = { shell: null as number | null, content: null as number | null, longTotal: null as number | null, longMax: null as number | null };
const taps: Tap[] = [];
let installed = false;
let sent = false;
let bizId: number | null = null;

const ms = () => Math.round(performance.now() - t0);

function send() {
  if (sent || !isTouch) return;
  if (boot.shell == null && !taps.length) return;
  sent = true;
  const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
  keepaliveJson('/api/app-diag', 'POST', {
    kind: 'perf',
    business_id: bizId,
    native,
    vw: window.innerWidth, vh: window.innerHeight,
    boot,
    taps: taps.slice(0, 12).map(t => ({
      href: t.href, at: t.at,
      click: t.click == null ? null : t.click - t.at,
      url: t.url == null ? null : t.url - t.at,
      paint: t.paint == null ? null : t.paint - t.at,
      repeat: t.repeat,
    })),
    conn: nav.connection?.effectiveType || null,
    build: typeof __BUILD_ID__ !== 'undefined' ? String(__BUILD_ID__) : null,
  });
}

/** 사이드바(앱 틀)가 처음 그려질 때 MainLayout 이 부른다. 로그인된 뒤라 보고 라우트(인증 필수)를 쓸 수 있다. */
export function perfShellMounted(businessId: number | null): void {
  if (!isTouch || installed) return;
  installed = true;
  bizId = businessId;
  boot.shell = ms();

  // 긴 작업(사파리는 지원 안 함 → null 로 남는다)
  try {
    let total = 0; let max = 0;
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { total += e.duration; max = Math.max(max, e.duration); } });
    po.observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
    window.setTimeout(() => { boot.longTotal = Math.round(total); boot.longMax = Math.round(max); try { po.disconnect(); } catch { /* noop */ } }, 10000);
  } catch { /* 지원 안 함 */ }

  // 본문 글자가 붙는 때(탭 모드 본문 [data-pq-content] · 폰은 페이지 스크롤 슬롯)
  const until = performance.now() + 20000;
  const poll = () => {
    const el = document.querySelector('[data-pq-content]') as HTMLElement | null;
    if (el && (el.innerText || '').length > 200) { boot.content = ms(); return; }
    if (performance.now() < until) window.setTimeout(poll, 100);
  };
  poll();

  // 메뉴 누름 — 사이드바 안 링크만
  document.addEventListener('pointerdown', (e) => {
    const a = (e.target as Element | null)?.closest?.('[data-pq-sidebar] a[href]') as HTMLAnchorElement | null;
    if (!a || taps.length >= 12) return;
    const href = (a.getAttribute('href') || '').split('?')[0];
    const prev = [...taps].reverse().find(t => t.href === href);
    const tap: Tap = { href, at: ms(), click: null, url: null, paint: null, repeat: !!prev && prev.url == null && ms() - prev.at < 3000 };
    taps.push(tap);
    const onClick = (ce: Event) => {
      if ((ce.target as Element | null)?.closest?.('[data-pq-sidebar] a[href]') === a) tap.click = ms();
    };
    document.addEventListener('click', onClick, { capture: true, once: true });
    const end = performance.now() + 5000;
    const watch = () => {
      if (tap.url == null && window.location.pathname.startsWith(href)) {
        tap.url = ms();
        requestAnimationFrame(() => requestAnimationFrame(() => { tap.paint = ms(); }));
        return;
      }
      if (performance.now() < end) window.setTimeout(watch, 16);
    };
    watch();
  }, { capture: true, passive: true });

  // 보고: 처음 45초가 지나면, 또는 그 전에 창이 숨으면
  window.setTimeout(send, 45000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
  window.addEventListener('pagehide', send);
}
