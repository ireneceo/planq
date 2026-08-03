/* D2 자가치유 반증용 미니 테스트 — stale 쿠키 재사용 시 Set-Cookie 발급 여부만 본다 */
const BASE = 'http://localhost:3003';
(async () => {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'health-check@planq.kr', password: 'HealthCheck2026!' }),
  });
  const sc = login.headers.getSetCookie();
  const C0 = sc.find(c => c.startsWith('refresh_token=')).match(/^refresh_token=([^;]*)/)[1];
  const doRefresh = (cv) => fetch(BASE + '/api/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'refresh_token=' + cv },
    body: '{}',
  });
  const r1 = await doRefresh(C0);           // 회전 → C0 stale
  const r2 = await doRefresh(C0);           // stale 재사용 (grace 내)
  const healed = r2.headers.getSetCookie().some(c => c.startsWith('refresh_token='));
  console.log('rotate=' + r1.status + ' stale_reuse=' + r2.status + ' HEAL_SET_COOKIE=' + healed);
})().catch(e => { console.error(e); process.exit(2); });
