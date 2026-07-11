// TaskAttachment.storage_provider ENUM 에 's3' 추가 (멱등). 운영 배포 전 선행 실행.
require('dotenv').config();
const { sequelize } = require('./config/database');
(async () => {
  try {
    const [c] = await sequelize.query("SHOW COLUMNS FROM task_attachments LIKE 'storage_provider'");
    const type = c[0]?.Type || '';
    console.log('현재 ENUM:', type);
    if (type.includes("'s3'")) { console.log('- 이미 s3 포함 (skip)'); }
    else {
      await sequelize.query("ALTER TABLE task_attachments MODIFY COLUMN storage_provider ENUM('planq','gdrive','s3') NOT NULL DEFAULT 'planq'");
      const [a] = await sequelize.query("SHOW COLUMNS FROM task_attachments LIKE 'storage_provider'");
      console.log('✓ 변경 후 ENUM:', a[0].Type);
    }
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
  finally { await sequelize.close(); }
})();
