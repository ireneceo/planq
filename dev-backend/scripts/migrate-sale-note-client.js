// project_notes.client_id 추가 — Q sale 상담 메모(댓글)의 **기준**을 남긴다. (2026-09-14)
//
// 멱등: 컬럼·인덱스가 이미 있으면 아무것도 하지 않는다. **코드 배포 전에** 돌린다
// (컬럼이 없는 채로 새 코드가 뜨면 메모 조회가 500 이 된다).
const { sequelize } = require('../config/database');

(async () => {
  try {
    const [cols] = await sequelize.query("SHOW COLUMNS FROM project_notes LIKE 'client_id'");
    if (cols.length) {
      console.log('· project_notes.client_id 이미 있음 — 건너뜀');
    } else {
      await sequelize.query('ALTER TABLE project_notes ADD COLUMN client_id INT NULL AFTER email_thread_id');
      console.log('✓ project_notes.client_id 추가');
    }
    const [idx] = await sequelize.query("SHOW INDEX FROM project_notes WHERE Key_name = 'idx_project_notes_client'");
    if (idx.length) {
      console.log('· 인덱스 이미 있음 — 건너뜀');
    } else {
      await sequelize.query('CREATE INDEX idx_project_notes_client ON project_notes (client_id, id)');
      console.log('✓ 인덱스 idx_project_notes_client 추가');
    }
    process.exit(0);
  } catch (e) {
    console.error('✗ 마이그레이션 실패:', e.message);
    process.exit(1);
  }
})();
