// 메일 발신자 규칙 테이블 + EmailThread.rule_id (멱등). 운영 배포 전 선행 실행.
require('dotenv').config();
const { sequelize } = require('./config/database');
const { MailSenderRule } = require('./models');   // index 경유 — association 로드(FK CASCADE)

(async () => {
  try {
    await MailSenderRule.sync();
    const [c] = await sequelize.query('SHOW COLUMNS FROM mail_sender_rules');
    console.log('✓ mail_sender_rules:', c.map((x) => x.Field).join(', '));
    const [fk] = await sequelize.query(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mail_sender_rules' AND REFERENCED_TABLE_NAME IS NOT NULL`);
    console.log('✓ FK:', fk.length ? fk.map((f) => f.CONSTRAINT_NAME).join(', ') : '없음(경고)');

    const [t] = await sequelize.query("SHOW COLUMNS FROM email_threads LIKE 'rule_id'");
    if (t.length === 0) {
      await sequelize.query('ALTER TABLE email_threads ADD COLUMN rule_id BIGINT NULL');
      console.log('✓ email_threads.rule_id 추가');
    } else console.log('- email_threads.rule_id 이미 존재');
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
  finally { await sequelize.close(); }
})();
