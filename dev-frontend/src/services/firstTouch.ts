// 가입 출처 — 처음 들어온 곳을 이 브라우저에 한 번 적어 두고, 가입 직후 로그인되면 한 번 보낸다 (2026-10-01).
//   서버: dev-backend/routes/landing_visits.js POST /api/landing-visits/signup-source
//   (가입 24시간 안 + 아직 비어 있을 때만 쓴다 — 기존 계정이 보내는 값은 서버가 버린다).
//
// ★ 가입 라우트마다 출처를 받지 않는 이유: 이메일 가입과 구글·애플 가입(리다이렉트)이 다른 길이라
//   한쪽이 반드시 빠진다. 로그인된 뒤의 «한 문» 으로 모은다.
// ★ 저장하는 것은 referrer 의 **origin 하나**(경로·쿼리 버림 — 토큰이 섞일 수 있다)와 utm_source 뿐이다.
//   쿠키·IP 없음. 보고가 끝나면 다시는 적지 않는다(done 표식).
import { apiFetch } from '../contexts/AuthContext';

const KEY = 'planq:first-touch';
const DONE = 'planq:first-touch-done';
const TTL_MS = 30 * 24 * 3600 * 1000;

interface FirstTouch { r: string; utm: string; at: number }

function read(): FirstTouch | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as FirstTouch;
    if (!v || typeof v.at !== 'number' || Date.now() - v.at > TTL_MS) return null;
    return v;
  } catch { return null; }
}

/** 앱이 처음 뜰 때 부른다. 이미 적어 뒀거나(30일 안) 보고를 마친 브라우저면 아무것도 안 한다. */
export function captureFirstTouch(): void {
  try {
    if (localStorage.getItem(DONE) === '1') return;
    if (read()) return;
    let r = '';
    try {
      if (document.referrer) {
        const u = new URL(document.referrer);
        if (u.host !== window.location.host) r = u.origin;
      }
    } catch { r = ''; }
    const utm = (new URLSearchParams(window.location.search).get('utm_source') || '').slice(0, 40);
    localStorage.setItem(KEY, JSON.stringify({ r, utm, at: Date.now() } satisfies FirstTouch));
  } catch { /* 저장소를 못 쓰면 출처를 모를 뿐이다 */ }
}

let sending = false;
/** 로그인된 뒤 한 번 부른다. 성공하면 다시 보내지 않는다(서버도 한 번만 쓴다). */
export async function reportFirstTouch(): Promise<void> {
  if (sending) return;
  try { if (localStorage.getItem(DONE) === '1') return; } catch { return; }
  const v = read();
  if (!v) return;
  sending = true;
  try {
    const r = await apiFetch('/api/landing-visits/signup-source', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ r: v.r, utm: v.utm }),
    });
    if (r.ok) {
      try { localStorage.removeItem(KEY); localStorage.setItem(DONE, '1'); } catch { /* noop */ }
    }
  } catch { /* 다음 로그인 때 다시 */ } finally { sending = false; }
}
