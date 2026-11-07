// 데스크탑 앱 세션 종류 — refresh_tokens.client_kind ENUM 끝에 'desktop' (2026-11-06, 멱등).
//   설계 docs/DESKTOP_APP_DESIGN.md §3-2. 'pwa' 를 재사용하지 않는다 — PWA 와 데스크탑 앱 세션을 갈라 재야 한다.
//   ★ PM2 reload 전: 새 코드는 'desktop' 을 저장하는데 ENUM 에 없으면 로그인·갱신이 ENUM 위반 500.
//   롤백은 코드만(값은 남겨도 무해 — 옛 코드는 모르는 값을 web 으로 읽는다).
const { sequelize } = require('../config/database');

async function run() {
  const [rk] = await sequelize.query("SHOW COLUMNS FROM refresh_tokens LIKE 'client_kind'");
  const t = (rk[0] && rk[0].Type) || '';
  if (!t) throw new Error('refresh_tokens.client_kind 없음');
  if (t.includes("'desktop'")) {
    console.log('[desktop-kind] 이미 있음 — skip');
    return;
  }
  // 지금 값 목록을 그대로 두고 끝에만 붙인다(순서를 바꾸면 기존 행 값이 흔들린다)
  const vals = [...t.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const next = [...vals, 'desktop'].map((v) => `'${v}'`).join(',');
  await sequelize.query(`ALTER TABLE refresh_tokens MODIFY client_kind ENUM(${next}) NOT NULL DEFAULT 'web'`);
  console.log(`[desktop-kind] client_kind → ENUM(${next})`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[desktop-kind] 실패:', e); process.exit(1); });
