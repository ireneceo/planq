// services/accounts.ts — 한 기기에 로그인해 둔 여러 계정(인스타식) 화면 쪽 단일 원천.
//   설계 docs/MULTI_ACCOUNT_DESIGN.md 7절 (Fable 설계 판정 반영). 서버 정본: routes/auth_accounts.js · services/deviceAccounts.js
//
// ★ 계정 목록의 정본은 **서버가 본 쿠키**다(GET /api/auth/device-accounts). 여기 남기는 것은
//   «이 기기에 있던 계정 id» 사본 하나뿐이고, 용도는 초안 정리에서 그 계정 초안을 남기는 것뿐이다(목록 표시에 쓰지 않는다).
// ★ 전환 = 기기 전체 재부팅. 한 창만 바꾸면 localStorage·탭·초안이 두 사람 것으로 섞인다(7절 D1).

export interface DeviceAccount {
  user_id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  workspace_name: string | null;
  valid: boolean;
  active: boolean;
  unread_total: number;
}
export interface DeviceAccounts {
  active_user_id: number | null;
  accounts: DeviceAccount[];
  max: number;
  device_proof: string;
}

export const ACCOUNT_CHANNEL = 'planq:account';
const KNOWN_KEY = 'pq_device_account_ids';

// ── 이 창의 계정 (모듈 변수 — apiFetch·저장소 래퍼가 React 밖에서 읽는다) ──
let currentAccountId: number | null = null;
export function setCurrentAccountId(id: number | null): void { currentAccountId = id ? Number(id) : null; }
export function getCurrentAccountId(): number | null { return currentAccountId; }

// ── 목록 ──
let cache: { at: number; data: DeviceAccounts } | null = null;
export async function fetchDeviceAccounts(opts: { fresh?: boolean } = {}): Promise<DeviceAccounts | null> {
  if (!opts.fresh && cache && Date.now() - cache.at < 30_000) return cache.data;
  try {
    const r = await fetch('/api/auth/device-accounts', { credentials: 'include' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.success || !j.data) return null;
    cache = { at: Date.now(), data: j.data as DeviceAccounts };
    rememberKnownIds(cache.data.accounts.map((a) => a.user_id));
    return cache.data;
  } catch { return null; }
}

/** 푸시 구독에 실을 «이 기기 묶음» 증명(서버 서명 60초). 없으면 null — 서버는 종전처럼 다른 사람 행을 만료한다. */
export async function getDeviceProof(): Promise<string | null> {
  if (cache && Date.now() - cache.at < 45_000) return cache.data.device_proof;
  const d = await fetchDeviceAccounts({ fresh: true });
  return d?.device_proof || null;
}

function rememberKnownIds(ids: number[]): void {
  try { localStorage.setItem(KNOWN_KEY, JSON.stringify(ids.slice(0, 5))); } catch { /* noop */ }
}
/** 초안 정리에서 남길 계정 id(이 기기에 로그인해 둔 계정들) */
export function knownDeviceAccountIds(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KNOWN_KEY) || '[]');
    return Array.isArray(raw) ? raw.map(Number).filter(Boolean) : [];
  } catch { return []; }
}

// ── 전환 ──
export function broadcastAccountSwitch(userId: number): void {
  try {
    const ch = new BroadcastChannel(ACCOUNT_CHANNEL);
    ch.postMessage({ type: 'account:switched', user_id: Number(userId) });
    ch.close();
  } catch { /* 미지원 — 다른 창은 다음 refresh 의 409 account_stale 로 따라온다 */ }
}

/**
 * 이 기기의 지금 계정을 바꾼다 → 다른 창에 알린다 → 이 창을 다시 부팅한다.
 * @returns 실패 이유(성공이면 페이지가 떠나므로 돌아오지 않는다)
 */
export async function switchAccount(userId: number, opts: { next?: string } = {}): Promise<'relogin' | 'missing' | 'failed' | null> {
  let r: Response;
  try {
    r = await fetch('/api/auth/switch', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: Number(userId) }),
    });
  } catch { return 'failed'; }
  if (r.status === 401) return 'relogin';
  if (r.status === 404) return 'missing';
  if (!r.ok) return 'failed';
  cache = null;
  broadcastAccountSwitch(userId);
  rebootForAccount(opts.next);
  return null;
}

/** «계정 추가» — 서버에 의도를 남기고(로그인된 사람만) 로그인 화면으로. 한도면 'limit'. */
export async function beginAddAccount(token: string | null): Promise<'limit' | 'failed' | null> {
  try {
    const r = await fetch('/api/auth/accounts/add-intent', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: '{}',
    });
    if (r.status === 409) {
      const j = await r.json().catch(() => ({}));
      if (j?.code === 'account_limit') return 'limit';
    }
    if (!r.ok) return 'failed';
    return null;
  } catch { return 'failed'; }
}

/**
 * 다시 부팅 — 메인 창은 첫 화면(보던 주소의 id 는 앞 계정 것이다), 팝아웃·핀은 제자리.
 *   next 가 주어지면(알림 클릭) 그 같은 출처 경로로.
 */
export function rebootForAccount(next?: string): void {
  // 부팅 복원이 앞 계정의 탭 스냅샷을 읽지 않게(stores/tabStore LAST_SCOPE_KEY — 사람까지 적혀 있다)
  try { localStorage.removeItem('planq_tabs_v1_lastscope'); } catch { /* noop */ }
  let inFrame = false;
  try { inFrame = window.parent !== window; } catch { inFrame = true; }
  const popout = !!window.opener || inFrame || /[?&]popout=/.test(window.location.search);
  if (next && next.startsWith('/') && !next.startsWith('//')) { window.location.href = next; return; }
  if (popout) { window.location.reload(); return; }
  window.location.href = '/dashboard';
}

// ── 사람마다 다른 뜻의 저장값 (Fable 7절 6) ──
//   같은 브라우저를 두 계정이 번갈아 쓰면 «마지막 메일 계정»·«탭 목록» 같은 값이 앞 계정 것으로 남는다.
//   사람 뜻이 있는 키는 이 래퍼로 `u<id>::` 를 붙인다. 계정을 모르면(부팅 전·로그아웃) **쓰지 않는다**.
export function accountKey(base: string): string | null {
  return currentAccountId ? `u${currentAccountId}::${base}` : null;
}
export const scopedStorage = {
  get(base: string): string | null {
    const k = accountKey(base);
    if (!k) return null;
    try {
      const v = localStorage.getItem(k);
      if (v != null) return v;
      // 옛 키(사람 없음) — 이 기기에 계정이 하나뿐이면 그 사람 값이다(배포 직후 한 번 물려받기)
      return knownDeviceAccountIds().length <= 1 ? localStorage.getItem(base) : null;
    } catch { return null; }
  },
  set(base: string, value: string): void {
    const k = accountKey(base);
    if (!k) return;
    try { localStorage.setItem(k, value); } catch { /* quota·비허용 */ }
  },
  remove(base: string): void {
    const k = accountKey(base);
    if (!k) return;
    try { localStorage.removeItem(k); } catch { /* noop */ }
  },
};
