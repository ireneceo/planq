// Q Note STT 과금 스키마 (C1) — idempotent 마이그레이션.
//   1) qnote_usage_events 원장 테이블 (없으면 CREATE)
//   2) qnote_usage.seconds_used 컬럼 (없으면 ADD)
// 운영 수동 실행 가이드:  node setup-qnote-billing-schema.js
//   신규 테이블이라 Too-many-keys 무관. session_id 는 SQLite 소재라 FK 미설정.
//   기존 minutes_used 백필 안 함(지금부터 집계 — cost_guard 정책 일관).
// 설계: docs/QNOTE_STT_BILLING_DESIGN.md §4
const { sequelize } = require('./config/database');

async function columnExists(table, column) {
  const [rows] = await sequelize.query(
    'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    { replacements: [table, column] }
  );
  return Number(rows[0].c) > 0;
}

async function run() {
  console.log('[qnote-billing] 스키마 적용 시작');

  // 1) 멱등 원장 테이블
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS qnote_usage_events (
      id INT NOT NULL AUTO_INCREMENT,
      stream_id VARCHAR(36) NOT NULL,
      segment_seq INT NOT NULL,
      session_id INT NOT NULL,
      business_id INT NOT NULL,
      user_id INT NOT NULL,
      seconds INT NOT NULL DEFAULT 0,
      is_stereo TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_stream_seg (stream_id, segment_seq),
      KEY idx_biz_created (business_id, created_at),
      CONSTRAINT fk_qnote_evt_business FOREIGN KEY (business_id) REFERENCES businesses(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('[qnote-billing] qnote_usage_events OK');

  // 2) qnote_usage.seconds_used
  if (!(await columnExists('qnote_usage', 'seconds_used'))) {
    await sequelize.query(
      'ALTER TABLE qnote_usage ADD COLUMN seconds_used INT NOT NULL DEFAULT 0'
    );
    console.log('[qnote-billing] qnote_usage.seconds_used 추가');
  } else {
    console.log('[qnote-billing] qnote_usage.seconds_used 이미 존재 — skip');
  }

  console.log('[qnote-billing] 완료');
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[qnote-billing] 실패:', e); process.exit(1); });
