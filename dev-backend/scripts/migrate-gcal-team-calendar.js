// 팀 Google 캘린더 «팀 일정을 올릴 캘린더» 컬럼 2개 (idempotent).
//   설계: docs/TEAM_CALENDAR_PICK_DESIGN.md §2
//   business_cloud_tokens.gcal_calendar_id VARCHAR(255) NULL · gcal_calendar_summary VARCHAR(255) NULL
//   NULL = primary — 옛 행은 그대로(백필 없음, 동작 변화 0).
//   ★ 모델이 이 컬럼을 SELECT 하므로 **코드 배포 전에** 실행한다(배포 슬롯 등록).
const { sequelize } = require('../config/database');

async function columnExists(table, column) {
  const [rows] = await sequelize.query(
    'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    { replacements: [table, column] }
  );
  return Number(rows[0].c) > 0;
}

async function run() {
  console.log('[gcal-team-calendar] 스키마 적용 시작');
  if (!(await columnExists('business_cloud_tokens', 'gcal_calendar_id'))) {
    await sequelize.query('ALTER TABLE business_cloud_tokens ADD COLUMN gcal_calendar_id VARCHAR(255) NULL');
    console.log('[gcal-team-calendar] gcal_calendar_id 추가');
  } else {
    console.log('[gcal-team-calendar] gcal_calendar_id 이미 존재 — skip');
  }
  if (!(await columnExists('business_cloud_tokens', 'gcal_calendar_summary'))) {
    await sequelize.query('ALTER TABLE business_cloud_tokens ADD COLUMN gcal_calendar_summary VARCHAR(255) NULL');
    console.log('[gcal-team-calendar] gcal_calendar_summary 추가');
  } else {
    console.log('[gcal-team-calendar] gcal_calendar_summary 이미 존재 — skip');
  }
  const [[{ c }]] = await sequelize.query("SELECT COUNT(*) AS c FROM business_cloud_tokens WHERE provider='gcal' AND gcal_calendar_id IS NOT NULL");
  console.log(`[gcal-team-calendar] 완료 — 고른 캘린더가 있는 팀 연결 ${c}건`);
}

run().then(() => sequelize.close()).catch(async (e) => {
  console.error('[gcal-team-calendar] 실패:', e.message);
  try { await sequelize.close(); } catch { /* */ }
  process.exit(1);
});
