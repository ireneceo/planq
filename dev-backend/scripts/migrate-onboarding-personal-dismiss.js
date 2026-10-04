// 온보딩 «나» 묶음 닫기 — business_members.onboarding_dismissed_at. 멱등 (매 배포 실행 안전).
//
//   `ALTER TABLE business_members ADD COLUMN onboarding_dismissed_at DATETIME NULL DEFAULT NULL`
//
// 왜 (docs/AI_AGENT_M3_DESIGN.md §3.3 D3) — 온보딩이 두 묶음이 됐다.
//   워크스페이스 묶음(고객·대화·업무·메일 계정)은 워크스페이스 하나에 하나라 businesses 에 닫기를 둔다(기존).
//   «나» 묶음(알림·캘린더·앱·AI 앱)은 각자 자기 기기·계정에서만 할 수 있는 일이라 **사람×워크스페이스** 로 닫는다.
//
// ★ sync-database 에 맡기지 않는다 — business_members 도 인덱스가 많은 표이고, alter 가 조용히 실패하면
//   모델이 없는 컬럼을 SELECT 해 온보딩(그리고 BusinessMember 를 읽는 모든 라우트)이 500 이 된다.
//   그래서 **PM2 reload 보다 먼저** 돌아야 한다.
//
// ★ 값의 뜻 — NULL = 아직 안 닫음. 날짜 = 그때 이 사람이 "이제 안 볼래" 를 눌렀다.
//   단계별 완료는 저장하지 않는다(실데이터로 매번 판정 — services/onboarding.js). 백필하지 않는다.
//
// 롤백: **코드만 revert.** 컬럼과 models/BusinessMember.js 선언은 남긴다 —
//   sync-database 가 "모델에 없는 컬럼" 을 DROP 할 수 있다. NULL 허용이라 남겨도 무해하다.
require('dotenv').config();
const { sequelize } = require('../config/database');

async function column(table, name) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${name}'`);
  return rows.length ? rows[0] : null;
}

async function run() {
  const existing = await column('business_members', 'onboarding_dismissed_at');
  if (existing) {
    console.log(`[migration] business_members.onboarding_dismissed_at 이미 있음 (${existing.Type}) — skip`);
    return true;
  }
  await sequelize.query(
    'ALTER TABLE `business_members` ADD COLUMN `onboarding_dismissed_at` DATETIME NULL DEFAULT NULL ' +
    "COMMENT 'personal onboarding dismissed at'"
  );
  // ★ 돌았다고 믿지 않고 다시 조회해서 판정한다.
  const after = await column('business_members', 'onboarding_dismissed_at');
  if (!after) throw new Error('ALTER 는 돌았는데 컬럼이 없다 — 판정 실패');
  const [[cnt]] = await sequelize.query(
    'SELECT COUNT(*) n, SUM(onboarding_dismissed_at IS NULL) nulls FROM business_members'
  );
  console.log(`[migration] business_members.onboarding_dismissed_at 추가 완료 (${after.Type}) · 기존 ${cnt.n}행 전부 NULL=${cnt.nulls}`);
  return true;
}

if (require.main === module) {
  run()
    .then(() => sequelize.close())
    .then(() => process.exit(0))
    .catch((e) => { console.error('[migration] 실패:', e.message); process.exit(1); });
}
module.exports = { run };
