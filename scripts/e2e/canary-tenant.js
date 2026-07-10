// scripts/e2e/canary-tenant.js — 멀티테넌트 격리 런타임 카나리 (cross-tenant 403 실증).
//   CLAUDE.md 멀티테넌트 격리("모든 쿼리 WHERE business_id") 는 Sequelize 수동 강제라
//   정적 가드(guard-invariants tenant 래칫)만으론 라우트 우회를 못 잡는다. 이 카나리는
//   실 HTTP 호출로 "비멤버 워크스페이스 접근 → 403" 을 매 게이트마다 증명한다.
//   대조군(본인 워크스페이스 → 200) 동시 검증 — 라우트 rename/404 로 테스트가 공허해지는 것 차단.
//   시드 불필요 (읽기 전용 GET 만) — 데이터 원복 이슈 없음.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const m = require('/opt/planq/dev-backend/models');

const BACKEND = process.env.CANARY_BACKEND || 'http://localhost:3003';
const EMAIL = 'health-check@planq.kr';
const PASSWORD = 'HealthCheck2026!';
const TOKEN_CACHE_PATH = '/tmp/.planq-health-token.json'; // health-check.js 와 공유 (login rate-limit 회피)

async function getToken() {
  try {
    const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
    if (cached.expires_at > Date.now() && cached.token) return cached.token;
  } catch { /* no cache */ }
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  const data = await res.json();
  try {
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify({
      token: data.data.token, user_id: data.data.user?.id,
      business_id: data.data.user?.business_id, expires_at: Date.now() + 12 * 60 * 1000,
    }));
  } catch { /* ignore */ }
  return data.data.token;
}

async function hit(token, path) {
  const res = await fetch(`${BACKEND}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.status;
}

async function run() {
  const results = [];
  const user = await m.User.findOne({ where: { email: EMAIL } });
  if (!user) return [{ route: 'canary-tenant', error: `테스트 계정(${EMAIL}) 없음` }];
  if (user.platform_role === 'platform_admin') {
    return [{ route: 'canary-tenant', error: 'health-check 계정이 platform_admin — 403 검증 불가 (계정 role 원복 필요)' }];
  }

  // 내 워크스페이스 1개 + 비멤버(foreign) 워크스페이스 1개 해석
  const myBms = await m.BusinessMember.findAll({ where: { user_id: user.id }, attributes: ['business_id'] });
  const myBizIds = new Set(myBms.map((r) => r.business_id));
  const owned = await m.Business.findAll({ where: { owner_id: user.id }, attributes: ['id'] });
  owned.forEach((b) => myBizIds.add(b.id));
  if (myBizIds.size === 0) return [{ route: 'canary-tenant', error: '테스트 계정 소속 워크스페이스 없음' }];
  const myBiz = [...myBizIds][0];
  const foreign = await m.Business.findOne({
    where: { id: { [require('/opt/planq/dev-backend/node_modules/sequelize').Op.notIn]: [...myBizIds] } },
    order: [['id', 'ASC']],
    attributes: ['id'],
  });
  if (!foreign) return [{ route: 'canary-tenant', error: '타 워크스페이스 없음 — 단일 워크스페이스 DB (검증 불가)' }];

  const token = await getToken();

  // 공격 표면: checkBusinessAccess(=attachWorkspaceScope memberOnly) 경유 대표 GET 라우트.
  // [대조군 path(내 biz, 기대 200), 공격 path(foreign biz, 기대 403)]
  const SURFACES = [
    ['tasks by-business search', `/api/tasks/by-business/${myBiz}/search?q=x`, `/api/tasks/by-business/${foreign.id}/search?q=x`],
    ['files storage', `/api/files/${myBiz}/storage`, `/api/files/${foreign.id}/storage`],
  ];

  for (const [name, minePath, foreignPath] of SURFACES) {
    try {
      const mine = await hit(token, minePath);
      const theirs = await hit(token, foreignPath);
      const vacuous = mine !== 200;              // 대조군이 200 아니면 라우트 자체가 죽음 — 공허 테스트
      const leaked = theirs === 200;             // 비멤버인데 200 = 격리 붕괴 (치명)
      const weird = !leaked && theirs !== 403;   // 403 외 코드 (404 등) — 정보로 기록
      results.push({
        route: name,
        leaked,
        error: vacuous ? `대조군(내 biz) ${mine} ≠ 200 — 라우트 변경? SURFACES 갱신 필요` : undefined,
        detail: `내 biz(${myBiz})=${mine} · 타 biz(${foreign.id})=${theirs}` +
          (leaked ? ' ← ❌ cross-tenant 누출' : weird ? ' (403 아닌 거부 — 허용)' : ''),
      });
    } catch (e) { results.push({ route: name, error: e.message.slice(0, 80) }); }
  }
  return results;
}

module.exports = { run, name: 'canary-tenant' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== 멀티테넌트 격리 카나리 (비멤버 워크스페이스 403 실증) ===\n');
    for (const r of res) {
      if (r.error) { console.log(`⚠️ ${r.route} — ${r.error}`); bad++; continue; }
      console.log(`${r.leaked ? '❌ 누출' : '✅'}  ${r.route} — ${r.detail}`);
      if (r.leaked) bad++;
    }
    console.log(`\n총 문제: ${bad}`);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
