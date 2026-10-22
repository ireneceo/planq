// 2026-10-22 메일 알림 주소별·사람별 (docs/MAIL_NOTIFY_PER_ADDRESS_DESIGN.md D1·D6) — 멱등.
//
//   email_account_notify_prefs 표 (CREATE TABLE IF NOT EXISTS) + UNIQUE 1 + 인덱스 1 + FK 3(CASCADE).
//   행 없음 = 계정 기본값 — 백필 없음, ENUM ALTER 없음.
//   ★ **코드보다 먼저** 돈다(배포 슬롯 PM2 reload 앞) — mailNotify 가 이 표를 SELECT 한다.
//     표가 없으면 cron 의 catch 가 삼켜 메일 알림 전체가 조용히 0 이 된다.
//   롤백: 코드 revert 만. 표 잔존은 무해(옛 코드는 읽지 않는다).
//
//   사용: node scripts/migrate-mail-notify-per-user.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const TAG = '[migrate-mail-notify-per-user]';
const TABLE = 'email_account_notify_prefs';

async function ensureTable() {
  const [t] = await sequelize.query(`SHOW TABLES LIKE '${TABLE}'`);
  if (t.length) { console.log(`${TAG} ${TABLE} 이미 있음 — skip`); return false; }
  const sql = `CREATE TABLE IF NOT EXISTS ${TABLE} (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    business_id INT NOT NULL,
    email_account_id INT NOT NULL,
    user_id INT NOT NULL,
    notify_scope ENUM('off','reply_only','recommended','all') NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_mail_notify_pref_account_user (email_account_id, user_id),
    INDEX mail_notify_pref_user_biz (user_id, business_id),
    CONSTRAINT mail_notify_pref_biz_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
    CONSTRAINT mail_notify_pref_acct_fk FOREIGN KEY (email_account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
    CONSTRAINT mail_notify_pref_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  if (DRY) { console.log(`${TAG} (dry) CREATE TABLE ${TABLE}`); return true; }
  await sequelize.query(sql);
  console.log(`${TAG} ${TABLE} 생성`);
  return true;
}

async function verify() {
  const [t] = await sequelize.query(`SHOW TABLES LIKE '${TABLE}'`);
  if (!t.length) throw new Error(`${TABLE} 없음`);
  const [idx] = await sequelize.query(`SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME='uq_mail_notify_pref_account_user' AND NON_UNIQUE=0`, { replacements: [TABLE] });
  if (Number(idx[0].n) < 1) throw new Error('UNIQUE(email_account_id,user_id) 없음');
  const [fk] = await sequelize.query(`SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_TYPE='FOREIGN KEY'`, { replacements: [TABLE] });
  if (Number(fk[0].n) < 3) throw new Error(`FK ${fk[0].n}/3`);
  const [cnt] = await sequelize.query(`SELECT COUNT(*) n FROM ${TABLE}`);
  console.log(`${TAG} 검증 OK — UNIQUE·FK ${fk[0].n} · 행 ${cnt[0].n}`);
}

(async () => {
  try {
    await sequelize.authenticate();
    await ensureTable();
    if (!DRY) await verify();
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error(`${TAG} 실패:`, e.message);
    try { await sequelize.close(); } catch { /* ignore */ }
    process.exit(1);
  }
})();
