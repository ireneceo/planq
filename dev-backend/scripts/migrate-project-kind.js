// Layer 1 — Project.kind ENUM('client','internal') 추가 + 멱등 백필.
// 운영/개발 공용. 멱등(재실행 안전). 실행: node scripts/migrate-project-kind.js
const { Project } = require('../models');

async function columnExists(seq, table, column) {
  const [rows] = await seq.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  );
  return rows[0].n > 0;
}

(async () => {
  const seq = Project.sequelize;
  try {
    // 1) 컬럼 추가 (없을 때만)
    if (await columnExists(seq, 'projects', 'kind')) {
      console.log('✔ projects.kind 컬럼 이미 존재 — ALTER skip');
    } else {
      await seq.query(
        `ALTER TABLE projects
         ADD COLUMN kind ENUM('client','internal') NOT NULL DEFAULT 'client'
         COMMENT 'client=고객 프로젝트(매출), internal=내부 투자(비청구·수익성 제외)'
         AFTER project_type`
      );
      console.log('✔ projects.kind 컬럼 추가 완료');
    }

    // 2) 백필 — internal 로 마킹할 대상 (멱등: kind 가 아직 default 'client' 인 것만 재평가)
    //    규칙: billing_type='internal'  OR  (project_clients 연결 0 AND client_company 비어있음/placeholder)
    //    애매한 것(client_company 있음 or project_clients 있음)은 client 유지 → UI 로 사용자 확정.
    const [result] = await seq.query(`
      UPDATE projects p
      SET p.kind = 'internal'
      WHERE p.kind = 'client'
        AND (
          p.billing_type = 'internal'
          OR (
            NOT EXISTS (SELECT 1 FROM project_clients pc WHERE pc.project_id = p.id AND pc.client_id IS NOT NULL)
            AND (
              p.client_company IS NULL
              OR TRIM(p.client_company) = ''
              OR TRIM(p.client_company) = '—'
              OR p.client_company REGEXP '(내부|internal)$'
            )
          )
        )
    `);
    console.log(`✔ 백필 완료 — internal 로 마킹된 행: ${result.affectedRows ?? result.changedRows ?? 0}`);

    // 3) 분포 확인
    const [dist] = await seq.query('SELECT kind, COUNT(*) n FROM projects GROUP BY kind');
    console.log('현재 분포:', dist.map(d => `${d.kind}=${d.n}`).join(', '));

    await seq.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ 마이그레이션 실패:', e.message);
    await seq.close();
    process.exit(1);
  }
})();
