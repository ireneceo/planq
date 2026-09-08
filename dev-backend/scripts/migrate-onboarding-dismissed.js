// 온보딩 안내 카드 — businesses.onboarding_dismissed_at. 멱등 (매 배포 실행 안전).
//
//   `ALTER TABLE businesses ADD COLUMN onboarding_dismissed_at DATETIME NULL DEFAULT NULL`
//
// ★ 왜 sync-database 에 맡기지 않는가 — 맡겨도 되는 모양(단순 NULL 컬럼)이고 dev 에서는
//   실제로 sync 가 넣었다. 그런데 businesses 는 키가 많은 표라 Sequelize alter 가
//   "Too many keys" 로 죽은 전례가 있다(memory feedback_sync_alter_too_many_keys).
//   그때 조용히 실패하면 온보딩 라우트가 없는 컬럼을 읽어 **기능 전체가 죽은 채 배포된다.**
//
// ★ 값의 뜻 — NULL = 아직 안 닫음. 날짜 = 그때 사용자가 "이제 안 볼래" 를 눌렀다.
//   **단계별 완료는 여기 저장하지 않는다.** 고객·대화·업무·알림 실데이터로 매번 판정한다
//   (services/onboarding.js). 완료 플래그를 들면 데이터와 갈라진다.
//
// ★ 백필하지 않는다 — 기존 워크스페이스도 카드를 한 번은 본다. 이미 다 한 곳은
//   네 단계가 전부 done 이라 자동으로 사라진다(닫을 일조차 없다).
//
// 롤백: **코드만 revert.** 컬럼과 models/Business.js 선언은 남긴다 —
//   sync-database 가 "모델에 없는 컬럼" 을 DROP 할 수 있다. NULL 허용이라 남겨도 무해하다.
require('dotenv').config();
const { sequelize } = require('../config/database');

async function column(table, name) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${name}'`);
  return rows.length ? rows[0] : null;
}

async function run() {
  const existing = await column('businesses', 'onboarding_dismissed_at');
  if (existing) {
    console.log(`[migration] businesses.onboarding_dismissed_at 이미 있음 (${existing.Type}) — skip`);
    return true;
  }
  await sequelize.query(
    'ALTER TABLE `businesses` ADD COLUMN `onboarding_dismissed_at` DATETIME NULL DEFAULT NULL ' +
    "COMMENT 'onboarding card dismissed at (NULL = still showing)'"
  );
  // ★ 돌았다고 믿지 않고 다시 조회해서 판정한다.
  const after = await column('businesses', 'onboarding_dismissed_at');
  if (!after) throw new Error('ALTER 는 돌았는데 컬럼이 없다 — 판정 실패');
  const [[cnt]] = await sequelize.query(
    'SELECT COUNT(*) n, SUM(onboarding_dismissed_at IS NULL) nulls FROM businesses'
  );
  console.log(`[migration] businesses.onboarding_dismissed_at 추가 완료 (${after.Type}) · 기존 ${cnt.n}행 전부 NULL=${cnt.nulls}`);
  return true;
}

if (require.main === module) {
  run()
    .then(() => sequelize.close())
    .then(() => process.exit(0))
    .catch((e) => { console.error('[migration] 실패:', e.message); process.exit(1); });
}
module.exports = { run };
