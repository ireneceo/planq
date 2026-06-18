// Q위키 E2E 검증 (V1~V9). JWT_SECRET 로 테스트 토큰 발급 (계정 무변경).
require('dotenv').config();
const jwt = require('jsonwebtoken');
const BASE = 'http://127.0.0.1:3003';
const SECRET = process.env.JWT_SECRET;

const userToken = jwt.sign({ userId: 1 }, SECRET, { expiresIn: '10m' });        // 일반 user
const adminToken = jwt.sign({ userId: 3 }, SECRET, { expiresIn: '10m' });        // platform_admin (irene@irenecompany)

async function call(path, { token, method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? '✅' : '❌'} ${name} — ${detail}`); };

(async () => {
  // V1 — 게스트 목록: public 만
  const v1 = await call('/api/wiki/articles?limit=100');
  const v1pub = (v1.body?.data || []).every((a) => a.visibility === 'public');
  const v1count = (v1.body?.data || []).length;
  check('V1 게스트 목록 public 전용', v1.status === 200 && v1pub && v1count > 0, `status=${v1.status} count=${v1count} allPublic=${v1pub}`);

  // V2 — 게스트가 authenticated article slug 직접 → 401
  const v2 = await call('/api/wiki/articles/create-task'); // authenticated article
  check('V2 게스트 authenticated 격리', v2.status === 401, `status=${v2.status} (기대 401)`);

  // V3 — 로그인 후 목록: public + authenticated 모두
  const v3 = await call('/api/wiki/articles?limit=100', { token: userToken });
  const v3count = (v3.body?.data || []).length;
  const v3hasAuth = (v3.body?.data || []).some((a) => a.visibility === 'authenticated');
  check('V3 로그인 목록 전체', v3.status === 200 && v3count > v1count && v3hasAuth, `status=${v3.status} count=${v3count} (게스트 ${v1count}) hasAuth=${v3hasAuth}`);

  // V4 — 검색 ko/en
  const v4ko = await call('/api/wiki/articles?q=' + encodeURIComponent('청구서'), { token: userToken });
  const v4en = await call('/api/wiki/articles?q=invoice&lang=en', { token: userToken });
  const v4kn = (v4ko.body?.data || []).length, v4en_n = (v4en.body?.data || []).length;
  check('V4 검색 ko(청구서)', v4ko.status === 200 && v4kn >= 1, `결과 ${v4kn}건`);
  check('V4 검색 en(invoice)', v4en.status === 200 && v4en_n >= 1, `결과 ${v4en_n}건`);

  // V5 — 맥락 매칭
  const v5 = await call('/api/wiki/context?path=/qtask', { token: userToken });
  const v5n = (v5.body?.data || []).length;
  const v5ok = (v5.body?.data || []).every((a) => a.linked_route && '/qtask'.startsWith(a.linked_route));
  check('V5 맥락 context?path=/qtask', v5.status === 200 && v5n >= 1 && v5ok, `결과 ${v5n}건`);

  // V6 — Cue qhelper sources[]
  const v6 = await call('/api/cue/help', { token: userToken, method: 'POST', body: { question: '청구서 어떻게 보내?', mode: 'qhelper' } });
  const v6sources = v6.body?.data?.sources || [];
  check('V6 Cue qhelper sources[]', v6.status === 200 && v6sources.length >= 1, `status=${v6.status} sources=${v6sources.length} (${v6sources.map(s=>s.slug).join(',')})`);

  // V7 — 비-platform_admin article POST → 403
  const v7 = await call('/api/admin/wiki/articles', { token: userToken, method: 'POST', body: { title_ko: 'x', title_en: 'x', category_id: 1 } });
  check('V7 비-admin POST 403', v7.status === 403, `status=${v7.status} (기대 403)`);

  // V7b — platform_admin 은 통과 (목록 조회로 권한 확인)
  const v7b = await call('/api/admin/wiki/categories', { token: adminToken });
  check('V7b platform_admin 접근', v7b.status === 200, `status=${v7b.status}`);

  // V9 — ko/en fallback (en 요청 시 title_en 노출)
  const v9 = await call('/api/wiki/articles/create-task?lang=en', { token: userToken });
  const v9title = v9.body?.data?.title;
  check('V9 en 응답 lang 적용', v9.status === 200 && v9title === v9.body?.data?.title_en, `title="${v9title}"`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n결과: ${passed}/${results.length} 통과`);
  process.exit(passed === results.length ? 0 : 1);
})();
