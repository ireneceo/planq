#!/usr/bin/env node
// workspace_inquiries — 공개 페이지·창구 문의 건 표 만들기. 멱등(있으면 아무것도 안 한다).
//
//   설계: docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §5.3 · §10 P2
//
// ★ **코드 배포 전에** 돌린다 — 표가 없는 상태로 새 코드가 올라가면 문의 접수·Q sale 신규 문의가 500 이다.
// ★ sync-database.js 에 맡기지 않는다(모델에 없는 컬럼 DROP 전례 — memory feedback_sync_drops_columns_not_in_model).
// ★ 새 표만 만든다. 기존 표·행은 한 줄도 바꾸지 않는다.
//
// 사용:  node scripts/migrate-workspace-inquiries.js         (적용)
//        node scripts/migrate-workspace-inquiries.js --dry   (무엇을 할지만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[workspace-inquiries]', ...a);

const SQL = `CREATE TABLE IF NOT EXISTS workspace_inquiries (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  status ENUM('new','handled','held','spam') NOT NULL DEFAULT 'new',
  via ENUM('public_page','entry_link') NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(200) NOT NULL,
  phone VARCHAR(40) NULL,
  company VARCHAR(200) NULL,
  message TEXT NOT NULL,
  service_id VARCHAR(24) NULL,
  service_name VARCHAR(80) NULL,
  locale VARCHAR(5) NULL,
  ip_hash VARCHAR(64) NULL,
  message_hash VARCHAR(64) NULL,
  held_reason VARCHAR(40) NULL,
  client_id INT NULL,
  email_thread_id INT NULL,
  handled_by INT NULL,
  handled_at DATETIME NULL,
  ack_sent_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY ws_inq_biz_status (business_id, status, created_at),
  KEY ws_inq_email (email, created_at),
  KEY ws_inq_msg (message_hash, created_at),
  CONSTRAINT ws_inq_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

(async () => {
  try {
    const [rows] = await sequelize.query("SHOW TABLES LIKE 'workspace_inquiries'");
    if (rows.length) { log('이미 있음 — 할 일 없음'); process.exit(0); }
    if (DRY) { log('만들 것:\n' + SQL); process.exit(0); }
    await sequelize.query(SQL);
    const [after] = await sequelize.query("SHOW TABLES LIKE 'workspace_inquiries'");
    log(after.length ? '만듦 ✓' : '실패 — 표가 없다');
    process.exit(after.length ? 0 : 1);
  } catch (e) {
    console.error('[workspace-inquiries] 실패:', e.message);
    process.exit(1);
  }
})();
