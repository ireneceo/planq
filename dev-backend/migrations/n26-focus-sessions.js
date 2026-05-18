// N+26 마이그레이션 — focus_sessions 테이블 + users 5컬럼 + businesses 3컬럼
// 직접 ALTER (sync alter Too many keys 회피)
require('dotenv').config();
const { sequelize } = require('../config/database');

async function main() {
  const queryInterface = sequelize.getQueryInterface();
  const log = (msg) => console.log(`[migration] ${msg}`);

  // 1) users 5컬럼 추가 (idempotent)
  const userCols = await queryInterface.describeTable('users');
  if (!userCols.focus_enabled) {
    await sequelize.query(`
      ALTER TABLE users
        ADD COLUMN focus_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '업무 흐름 기능 ON/OFF',
        ADD COLUMN focus_idle_min INT NOT NULL DEFAULT 15 COMMENT '유휴 감지 임계 (분)',
        ADD COLUMN focus_auto_pause_min INT NOT NULL DEFAULT 30 COMMENT '자동 일시정지 시간 (분)',
        ADD COLUMN focus_daily_prompt TINYINT(1) NOT NULL DEFAULT 1 COMMENT '아침 시작 안내 모달',
        ADD COLUMN focus_prompt_last_dismissed_date DATE NULL COMMENT '오늘 다시 보지 않기 날짜'
    `);
    log('users +5 컬럼 (focus_*)');
  } else {
    log('users focus_* 이미 존재 — skip');
  }

  // 2) businesses 3컬럼 추가
  const bizCols = await queryInterface.describeTable('businesses');
  if (!bizCols.weekly_finalize_dow) {
    await sequelize.query(`
      ALTER TABLE businesses
        ADD COLUMN weekly_finalize_dow TINYINT NOT NULL DEFAULT 1 COMMENT '자동 확정 요일 (0=일~6=토)',
        ADD COLUMN weekly_finalize_hour TINYINT NOT NULL DEFAULT 0 COMMENT '자동 확정 시각 (0-23)',
        ADD COLUMN weekly_finalize_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '자동 확정 ON/OFF'
    `);
    log('businesses +3 컬럼 (weekly_finalize_*)');
  } else {
    log('businesses weekly_finalize_* 이미 존재 — skip');
  }

  // 3) focus_sessions 테이블 (신규)
  const [tables] = await sequelize.query(`SHOW TABLES LIKE 'focus_sessions'`);
  if (tables.length === 0) {
    await sequelize.query(`
      CREATE TABLE focus_sessions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        business_id INT NOT NULL,
        task_id INT NULL,
        state ENUM('active','paused','stopped') NOT NULL DEFAULT 'active',
        started_at DATETIME NOT NULL,
        ended_at DATETIME NULL,
        pause_total_sec INT NOT NULL DEFAULT 0 COMMENT '누적 일시정지 초',
        paused_at DATETIME NULL,
        last_activity_at DATETIME NULL,
        auto_paused TINYINT(1) NOT NULL DEFAULT 0,
        end_reason VARCHAR(30) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_state (user_id, state),
        INDEX idx_user_task (user_id, task_id),
        INDEX idx_biz_date (business_id, started_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (business_id) REFERENCES businesses(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    log('focus_sessions 테이블 생성');
  } else {
    log('focus_sessions 이미 존재 — skip');
  }

  log('완료');
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
