// Cue 질문 분석 테이블 2개 — 멱등 (2026-10-07, Fable 판정 B5).
//   cue_question_topics(주제 통계 — user/business id 없음) · cue_question_raw(가명처리 원문 30일).
//   워크스페이스 스위치는 businesses.permissions JSON 의 cue_analysis 칸이라 컬럼 변경 없음(없으면 기본값: 주제 켬·원문 끔).
//   재조회로 판정하고 없으면 exit 1. 롤백: 코드만 — 표는 남겨도 무해.
require('dotenv').config();
const { sequelize } = require('../config/database');
const SQL = [
  `CREATE TABLE IF NOT EXISTS cue_question_topics (
     id BIGINT AUTO_INCREMENT PRIMARY KEY,
     stat_date DATE NOT NULL,
     topic VARCHAR(40) NOT NULL,
     intent VARCHAR(20) NULL,
     classified TINYINT(1) NOT NULL DEFAULT 0,
     answered TINYINT(1) NOT NULL DEFAULT 0,
     mode VARCHAR(12) NOT NULL,
     plan_tier VARCHAR(20) NULL,
     lang VARCHAR(5) NULL,
     ws_day_hash CHAR(32) NULL,
     created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
     KEY idx_cqt_date (stat_date), KEY idx_cqt_topic_date (topic, stat_date)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS cue_question_raw (
     id BIGINT AUTO_INCREMENT PRIMARY KEY,
     topic_row_id BIGINT NULL,
     question VARCHAR(1000) NOT NULL,
     lang VARCHAR(5) NULL,
     created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
     KEY idx_cqr_created (created_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];
(async () => {
  try {
    for (const q of SQL) await sequelize.query(q);
    const [r] = await sequelize.query(`SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('cue_question_topics','cue_question_raw')`);
    if (r.length !== 2) { console.error('[migrate-cue-question-analysis] 검증 실패', r); process.exit(1); }
    console.log('[migrate-cue-question-analysis] OK', r.map((x) => x.t).join(','));
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-cue-question-analysis] 실패:', e.message); process.exit(1); }
})();
