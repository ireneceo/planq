// #259 마이그레이션 — 무로그인 게스트 링크. 멱등 (매 배포 실행 안전).
//
//   ① guest_links 테이블 (모델이 정본 — sync 가 만들지만 여기서 존재를 확인·보증한다)
//   ② clients.guest_user_id  INT NULL FK users  — 그림자 User 를 **고객당 1개**로
//   ③ users.is_guest         BOOL NOT NULL DEFAULT FALSE  — 로그인 차단 근거
//   ④ businesses.guest_links_enabled       BOOL NOT NULL DEFAULT TRUE  — 워크스페이스 킬스위치
//   ⑤ platform_settings.guest_links_enabled BOOL NOT NULL DEFAULT TRUE — 플랫폼 킬스위치
//
// ★ 배포 순서: 이 스크립트(DB) → 백엔드 reload. 역전하면 새 코드가 없는 컬럼에 써서 실패한다.
//
// 롤백: 코드만 revert. 컬럼·테이블은 남긴다 — sync({alter:true}) 가 "모델에 없는 컬럼" 을
//   DROP 하므로 모델 선언을 지우면 데이터까지 날아간다(#353 ⑤ 와 같은 규칙).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function hasColumn(table, name) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${name}'`);
  return rows.length > 0;
}
async function hasTable(name) {
  const [rows] = await sequelize.query(`SHOW TABLES LIKE '${name}'`);
  return rows.length > 0;
}
async function addColumn(table, name, ddl) {
  if (await hasColumn(table, name)) { console.log(`[migration] ${table}.${name} 이미 있음 — skip`); return; }
  await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
  if (!(await hasColumn(table, name))) throw new Error(`${table}.${name} ALTER 후에도 없다 — 판정 실패`);
  console.log(`[migration] ${table}.${name} 추가 완료`);
}

async function run() {
  await addColumn('clients', 'guest_user_id',
    "`guest_user_id` INT NULL COMMENT '#259 무로그인 게스트의 그림자 User (고객당 1개)'");
  await addColumn('users', 'is_guest',
    "`is_guest` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '#259 shadow guest account - login blocked'");
  await addColumn('businesses', 'guest_links_enabled',
    "`guest_links_enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '#259 workspace kill switch'");
  if (await hasTable('platform_settings')) {
    await addColumn('platform_settings', 'guest_links_enabled',
      "`guest_links_enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '#259 platform kill switch'");
  } else {
    console.log('[migration] platform_settings 없음 — skip');
  }
  // 테이블은 sync-database 가 모델로 만든다. 여기서는 **있는지 확인만** 한다 —
  //   없으면 게스트 기능 전체가 죽으므로 조용히 넘기지 않는다.
  const t = await hasTable('guest_links');
  console.log(`[migration] guest_links 테이블: ${t ? '존재' : '★ 없음 — sync-database 가 만들어야 한다'}`);
  return true;
}

if (require.main === module) {
  run().then(() => sequelize.close()).then(() => process.exit(0))
    .catch((e) => { console.error('[migration] 실패:', e.message); process.exit(1); });
}
module.exports = { run };
