// #411 미팅자료 — `calendar_event_attachments` 생성. **멱등**(여러 번 돌려도 안전).
//
//   ★ 코드 배포 **전에** 돌린다. 테이블이 없는 채로 새 코드가 뜨면 일정 조회가 500 이 된다
//     (include 가 없는 테이블을 조인한다).
//   ★ 운영에는 루트 `scripts/` 가 없다 — 그래서 `dev-backend/scripts/` 에 둔다(rsync 대상).
const { sequelize } = require('../config/database');

(async () => {
  const q = sequelize.getQueryInterface();
  const tables = await q.showAllTables();
  const has = tables.map((t) => (typeof t === 'string' ? t : t.tableName)).includes('calendar_event_attachments');
  if (has) { console.log('[migrate] calendar_event_attachments 이미 있음 — 건너뜀'); await sequelize.close(); return; }

  await sequelize.query(`
    CREATE TABLE calendar_event_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      business_id INT NOT NULL,
      event_id BIGINT NOT NULL,   -- ★ calendar_events.id 가 BIGINT 다. INT 로 잡으면 FK 가 거부된다(실측)
      file_id INT NULL,
      post_id INT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_cea_event (event_id),
      INDEX idx_cea_file (file_id),
      INDEX idx_cea_post (post_id),
      INDEX idx_cea_biz (business_id),
      CONSTRAINT fk_cea_event FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
      CONSTRAINT fk_cea_file  FOREIGN KEY (file_id)  REFERENCES files(id)           ON DELETE CASCADE,
      CONSTRAINT fk_cea_post  FOREIGN KEY (post_id)  REFERENCES posts(id)           ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('[migrate] calendar_event_attachments 생성 완료');
  await sequelize.close();
})().catch((e) => { console.error('[migrate] 실패:', e.message); process.exit(1); });
