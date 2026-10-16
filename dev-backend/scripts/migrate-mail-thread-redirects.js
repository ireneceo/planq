// 메일 스레드 옛 번호 → 새 번호 표 — 멱등. 2026-10-16.
//   갈라진 옛 스레드 병합(scripts/merge-split-mail-threads.js)이 지운 스레드 번호를 남겨, 이미 나간 알림·메일 링크가 새 스레드를 연다.
//   코드가 이 표를 읽지만 없으면 null 로 넘어간다(상세는 종전 404) — 그래도 배포 슬롯에서 코드보다 먼저 만든다.
// 롤백: 표는 남긴다(읽는 코드를 되돌려도 무해).
require('dotenv').config();
const { sequelize } = require('../config/database');
(async () => {
  try {
    await sequelize.query(`CREATE TABLE IF NOT EXISTS email_thread_redirects (
      old_thread_id INT NOT NULL PRIMARY KEY,
      new_thread_id INT NOT NULL,
      business_id INT NOT NULL,
      run_id VARCHAR(40) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY email_thread_redirects_new (new_thread_id),
      KEY email_thread_redirects_biz (business_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [r] = await sequelize.query(`SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_thread_redirects'`);
    if (!Number(r[0].n)) { console.error('[migrate-mail-thread-redirects] 검증 실패'); process.exit(1); }
    console.log('[migrate-mail-thread-redirects] OK');
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-mail-thread-redirects] 실패:', e.message); process.exit(1); }
})();
