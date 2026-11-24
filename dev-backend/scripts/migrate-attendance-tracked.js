// 멤버별 «출퇴근 안 함» — business_members.attendance_tracked BOOLEAN NOT NULL DEFAULT 1
//   + attendance_tracked_since DATE NULL(다시 켠 날 — 그 다음 날부터 지각·미출근 판정, 꺼 둔 동안이 미출근으로 뜨지 않게). 멱등. 2026-11-24.
//   docs/ATTENDANCE_MEMBER_TRACKING_DESIGN.md D1 — 기본 1 = 지금 동작 그대로(모든 기존 행이 «출퇴근 함»).
// sync-database(alter) 가 먼저 만들어도 여기서 skip 된다. 스키마를 재조회해 판정하고 미충족이면 exit 1.
// 롤백: additive 컬럼(기본값 있음)이라 옛 코드에 무해하다. **코드만 되돌리고 컬럼은 남긴다**
//   (모델 선언까지 되돌리면 sync 가 컬럼을 DROP 해 관리자가 정한 «출퇴근 안 함» 이 사라진다).
require('dotenv').config();
const { sequelize } = require('../config/database');

async function has(col) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_members' AND COLUMN_NAME = ?`, { replacements: [col] });
  return rows.length > 0;
}

(async () => {
  try {
    if (!(await has('attendance_tracked'))) {
      await sequelize.query('ALTER TABLE business_members ADD COLUMN attendance_tracked TINYINT(1) NOT NULL DEFAULT 1');
      console.log('[migrate-attendance-tracked] business_members.attendance_tracked 추가');
    } else {
      console.log('[migrate-attendance-tracked] business_members.attendance_tracked 이미 있음 — skip');
    }
    if (!(await has('attendance_tracked_since'))) {
      await sequelize.query('ALTER TABLE business_members ADD COLUMN attendance_tracked_since DATE NULL');
      console.log('[migrate-attendance-tracked] business_members.attendance_tracked_since 추가');
    } else {
      console.log('[migrate-attendance-tracked] business_members.attendance_tracked_since 이미 있음 — skip');
    }
    if (!(await has('attendance_tracked_since'))) { console.error('[migrate-attendance-tracked] 검증 실패 — since 칸 없음'); process.exit(1); }
    if (!(await has('attendance_tracked'))) { console.error('[migrate-attendance-tracked] 검증 실패 — 컬럼 없음'); process.exit(1); }
    const [[c]] = await sequelize.query('SELECT SUM(attendance_tracked = 0) AS off_cnt, COUNT(*) AS total FROM business_members');
    console.log(`[migrate-attendance-tracked] OK — 출퇴근 안 함 ${c.off_cnt || 0} / ${c.total}`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-attendance-tracked] 실패:', e.message);
    process.exit(1);
  }
})();
