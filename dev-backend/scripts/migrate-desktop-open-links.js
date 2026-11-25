// refresh_tokens.open_links (2026-11-25, 멱등) — 데스크탑 «PlanQ 링크를 앱에서 열기» 를 받을 수 있는 껍데기 세션 표시.
//   설계: Fable 판정 4(토큰 행 표시) · services/desktopOpenLinks.js.
//   ★ PM2 reload 전: 새 코드는 로그인·회전 때 open_links 를 쓰고 /me 가 읽는다 — 컬럼이 없으면 로그인·갱신이 500.
//   컬럼 추가만(기본값 0) — 기존 행 값 불변. 롤백은 코드만(컬럼은 남겨도 무해 — 옛 코드는 안 읽는다).
const { sequelize } = require('../config/database');

async function run() {
  const [cols] = await sequelize.query("SHOW COLUMNS FROM refresh_tokens LIKE 'open_links'");
  if (cols.length) {
    console.log('[desktop-open-links] 이미 있음 — skip');
    return;
  }
  await sequelize.query('ALTER TABLE refresh_tokens ADD COLUMN open_links TINYINT(1) NOT NULL DEFAULT 0, ALGORITHM=INSTANT');
  console.log('[desktop-open-links] refresh_tokens.open_links 추가');
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[desktop-open-links] 실패:', e); process.exit(1); });
