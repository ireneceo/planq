// 앱 알림 탭 → «연결 안 됨» 화면 추적 장치 (2026-10-22, Irene: *"가끔 알림누르면 모바일앱에서 낫커넥티드 떠.
//   원인불명인데 … 누가 이렇게 연결되면 기록되서 파악할 방법 없어?"*)
//
// 왜 지금까지 흔적이 0 이었나: 그 화면은 앱 번들 안 로컬 파일(www-placeholder/index.html, Capacitor errorPath)이다.
//   메인 프레임 로드가 실패하는 순간 우리 JS·소켓·크래시 보고가 전부 사라진다. 그래서 **죽기 전에 적어 두고,
//   다음 문서가 뜰 때 읽어서** 보고한다.
//   · 알림 탭 일지 — localStorage(서버 출처라 앱 재시작·오프라인 화면 왕복에도 남는다) 최근 5건
//   · 도착하면 지운다 / 일부러 문서를 다시 여는 단계(전체 이동·워크스페이스 전환)는 표시만 한다
//   · 부팅 때 «앞 문서에서 눌렀는데 목적지에 못 간» 항목 = 1건 보고(한 번만) → `POST /api/app-diag`
//   · 오프라인 화면이 돌아올 때 `?pq_offline=` 를 실어 오면(새 앱 빌드부터) 그것도 같이 보고하고 주소에서 지운다
// 담는 것: 알림 링크(경로)·시각·화면 상태·연결 종류·직전 자동 새로고침. 본문·이메일·토큰은 담지 않는다.
import { apiFetch } from '../contexts/AuthContext';

const JOURNAL_KEY = 'pq_push_journal';
const RELOAD_KEY = 'pq_last_reload';
const MAX_ENTRIES = 5;
const STALE_MS = 10 * 60 * 1000;        // 10분 넘은 탭은 보고하지 않는다(앱을 그냥 닫은 것과 갈리지 않는다)

type Step = 'full_load' | 'ws_reload';
interface TapEntry {
  id: string;
  link: string;
  tapAt: number;
  cold: boolean;          // 탭이 왔을 때 브리지(라우터)가 아직 없었다 = 콜드 스타트
  vis: string;            // document.visibilityState
  online: boolean | null;
  conn: string | null;    // navigator.connection.effectiveType (안드로이드만)
  docAge: number;         // 이 문서가 뜬 지 몇 ms 뒤에 탭이 왔나
  steps?: Partial<Record<Step, number>>;
  arrivedAt?: number;
}

// 이 문서가 뜬 시각 — 그보다 앞의 탭은 «앞 문서» 의 것이다.
const bootAt = Math.round((typeof performance !== 'undefined' && performance.timeOrigin) || Date.now());
let bridgeReady = false;

// 오프라인 화면이 실어 온 표식 — 루트 리다이렉트가 주소를 바꾸기 전에(모듈 평가 시점) 읽고 지운다.
let offlineMark: string | null = null;
try {
  const u = new URL(window.location.href);
  const v = u.searchParams.get('pq_offline');
  if (v != null) {
    offlineMark = v.slice(0, 600);
    u.searchParams.delete('pq_offline');
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
  }
} catch { /* 무시 */ }

function read(): TapEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(JOURNAL_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function write(list: TapEntry[]): void {
  try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(list.slice(-MAX_ENTRIES))); } catch { /* 무시 */ }
}
function cleanPath(p: string): string {
  // 비교·기록은 경로+쿼리만 (해시·?ws= 는 뗀다 — 워크스페이스 전환 뒤 주소에는 없다)
  try {
    const u = new URL(p, window.location.origin);
    u.searchParams.delete('ws');
    return u.pathname + u.search;
  } catch { return p; }
}

export function markBridgeReady(): void { bridgeReady = true; }

/** 알림 탭 — nativePush.handleTap 에서 */
export function journalTap(link: string): void {
  const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
  const now = Date.now();
  const list = read();
  list.push({
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    link: cleanPath(link).slice(0, 200),
    tapAt: now,
    cold: !bridgeReady,
    vis: document.visibilityState,
    online: typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
    conn: nav.connection?.effectiveType || null,
    docAge: now - bootAt,
  });
  write(list);
}

function lastOpen(list: TapEntry[], link?: string): TapEntry | undefined {
  const want = link ? cleanPath(link) : null;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.arrivedAt) continue;
    if (!want || e.link === want) return e;
  }
  return undefined;
}

/** 목적지 도착 — nativePush.markDeepLinkArrived 에서 */
export function journalArrived(link: string): void {
  const list = read();
  const e = lastOpen(list, link);
  if (!e) return;
  e.arrivedAt = Date.now();
  write(list.filter(x => !x.arrivedAt));
}

/** 일부러 문서를 다시 여는 단계 — 다음 문서가 목적지에 있으면 정상이다 */
export function journalStep(step: Step, link?: string): void {
  const list = read();
  const e = lastOpen(list, link) || lastOpen(list);
  if (!e) return;
  e.steps = { ...(e.steps || {}), [step]: Date.now() };
  write(list);
}

/** 앱이 스스로 새로고침하기 직전 — BuildVersionGuard 에서 (숨김 상태 새로고침이 다음 탭을 망가뜨리는지 보려고) */
export function noteReload(why: string): void {
  try {
    localStorage.setItem(RELOAD_KEY, JSON.stringify({ at: Date.now(), why, vis: document.visibilityState }));
  } catch { /* 무시 */ }
}

let reported = false;
/**
 * 부팅 뒤 한 번 — 앞 문서에서 눌렀는데 목적지에 못 간 탭이 있으면 보고한다.
 * 로그인된 뒤에 부른다(보고 라우트는 인증 필수 — 무인증 표면을 늘리지 않는다).
 */
export async function reportStaleTaps(businessId: number | null): Promise<void> {
  if (reported) return;
  reported = true;
  const now = Date.now();
  const here = cleanPath(window.location.pathname + window.location.search);
  const all = read();
  const keep: TapEntry[] = [];
  const failed: TapEntry[] = [];
  for (const e of all) {
    if (e.arrivedAt) continue;
    if (e.tapAt >= bootAt) { keep.push(e); continue; }        // 이 문서의 탭 — 아직 진행 중
    if (now - e.tapAt > STALE_MS) continue;                    // 너무 오래됨 — 버린다
    if (e.link === here) continue;                             // 다시 연 문서가 목적지 = 정상(전체 이동·전환)
    failed.push(e);
  }
  write(keep);
  if (!failed.length && offlineMark == null) return;

  let lastReload: unknown = null;
  try {
    const r = JSON.parse(localStorage.getItem(RELOAD_KEY) || 'null');
    if (r && now - Number(r.at) < STALE_MS) lastReload = { ...r, ago: now - Number(r.at) };
  } catch { /* 무시 */ }
  const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
  try {
    await apiFetch('/api/app-diag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: failed.length ? 'push_nav_fail' : 'offline_return',
        business_id: businessId,
        taps: failed.map(e => ({ ...e, ago: now - e.tapAt, bootGap: bootAt - e.tapAt })),
        offline: offlineMark,
        last_reload: lastReload,
        landed: here.slice(0, 200),
        boot_ms: now - bootAt,
        online: typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
        conn: nav.connection?.effectiveType || null,
        build: (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BUILD_ID || null,
      }),
    });
  } catch { /* 보고가 실패해도 화면엔 영향 없음 */ }
}
