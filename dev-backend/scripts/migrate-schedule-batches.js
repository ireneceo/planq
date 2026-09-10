// schedule_batches 생성 (멱등) — 일정 일괄 수정의 되돌리기 원장.
//
// ★ **코드보다 먼저 돌아야 한다.** 테이블이 없으면 일정 수정 라우트가 500 이다
//   (project_pinned_docs·guest_links.scope 와 같은 계열 — 그때마다 같은 사고가 났다).
//   배포 스크립트의 sync_database 안, restart_server 앞에 배선한다.
//
// 안전: CREATE TABLE IF NOT EXISTS — 여러 번 돌려도 무해하다. 이관할 데이터는 없다(신규 기능).
const { sequelize } = require('../config/database');

(async () => {
  console.log('▶ schedule_batches 마이그레이션');
  try {
    const [exists] = await sequelize.query(
      "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schedule_batches'",
    );
    if (Number(exists[0].c) > 0) {
      console.log('  · schedule_batches — 이미 있음(건너뜀)');
    } else {
      await sequelize.query(`
        CREATE TABLE schedule_batches (
          id BIGINT NOT NULL AUTO_INCREMENT,
          business_id INT NOT NULL,
          project_id BIGINT NOT NULL,
          created_by INT NOT NULL,
          prompt TEXT NULL,
          op VARCHAR(30) NOT NULL,
          params JSON NULL,
          items JSON NULL,
          warnings JSON NULL,
          applied_at DATETIME NULL,
          reverted_at DATETIME NULL,
          reverted_by INT NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          PRIMARY KEY (id),
          KEY schedule_batches_biz_proj (business_id, project_id),
          KEY schedule_batches_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log('  ✅ schedule_batches 생성');
    }
    const [cnt] = await sequelize.query('SELECT COUNT(*) AS c FROM schedule_batches');
    console.log(`  · 현재 원장: ${cnt[0].c}건`);
    console.log('▶ 완료');
    process.exit(0);
  } catch (e) {
    console.error('  ❌ 실패:', e.message);
    process.exit(1);
  }
})();
