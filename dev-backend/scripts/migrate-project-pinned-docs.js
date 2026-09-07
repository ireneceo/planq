// 프로젝트 문서 탭 핀 — 테이블 생성 (멱등).
//
// ★ 이 스크립트만 쓴다. `sync-database.js`(alter) 를 부르지 않는다 —
//   모델에 없는 운영 컬럼을 DROP 한 전례가 있고(memory feedback_sync_drops_columns_not_in_model),
//   64-key 한도에도 걸린다. 추가만 하는 변경은 추가만 하는 스크립트로 한다.
//
// 되돌리기: DROP TABLE project_pinned_docs;  (핀은 사용자 편의값이라 손실이 기능을 막지 않는다)
require('dotenv').config();
const { sequelize } = require('../config/database');

(async () => {
  try {
    const [t] = await sequelize.query("SHOW TABLES LIKE 'project_pinned_docs'");
    if (t.length) { console.log('이미 있음 — 변경 없음'); process.exit(0); }
    await sequelize.query(`
      CREATE TABLE project_pinned_docs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        project_id INT NOT NULL,
        post_id INT NOT NULL,
        order_index INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ppd_user_project_post (user_id, project_id, post_id),
        KEY ix_ppd_user_project (user_id, project_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('project_pinned_docs 생성 완료');
    process.exit(0);
  } catch (e) {
    console.error('실패:', e.message);
    process.exit(1);
  }
})();
