/**
 * task_deliverable_versions 에 `review_round` 추가 + 백필 (2026-09-10)
 *
 *   Irene: "순서도 높은 버전이 최신글인데 최신댓글이 왜 옛날 버전으로 된건지…
 *           운영서버의 IPC 메뉴북 수정요청 이라는 업무가 그래."
 *
 * 원인 — **같은 값을 두 공식으로 구했다.**
 *   버전 번호(`round`)  = 그 업무 버전 목록의 max+1
 *   컨펌 라운드          = tasks.review_round (빈 제출·갇힌 라운드 복구·취소가 라운드만 소모한다)
 *   목록 API 가 두 숫자를 `==` 로 맞춰 승인/수정요청을 붙였다 → 어긋난 순간부터 남의 결과가 달린다.
 *   운영 task#257 실측: 버전 1·2·3·4 ↔ 컨펌 라운드 1·2·**4·5** (라운드 3 은 09-08 '갇힌 라운드 복구'가 소모).
 *
 * 백필 — 제출 회차와 `review_submit` 이력은 **같은 트랜잭션**에서 생기므로 시각이 사실상 동일하다.
 *   task_id 가 같고 created_at 차이가 2초 이내인 review_submit 행의 round 를 적어 넣는다.
 *   맞는 행이 없으면 NULL 로 둔다 — 그 회차는 제출본이 아니다(담당자 저장본 · 되돌리기 직전 백업).
 *
 * ★ 멱등 — 컬럼이 있으면 건너뛰고, 백필은 review_round IS NULL 인 행만 본다.
 * ★ **코드 배포 전에** 돌린다. 컬럼이 없는 상태로 새 코드가 뜨면 목록 조회가 500 이 된다.
 *
 * 실행: node scripts/migrate-deliverable-review-round.js
 */
require('dotenv').config();
const { sequelize } = require('../config/database');

const TABLE = 'task_deliverable_versions';

async function hasColumn(table, column) {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] },
  );
  return Number(rows[0].n) > 0;
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log('▶ task_deliverable_versions.review_round 마이그레이션');

    if (await hasColumn(TABLE, 'review_round')) {
      console.log('  · review_round — 이미 있음(건너뜀)');
    } else {
      await sequelize.query(
        `ALTER TABLE \`${TABLE}\` ADD COLUMN \`review_round\` INT NULL DEFAULT NULL AFTER \`round\``,
      );
      console.log('  ✅ review_round 컬럼 추가');
    }

    // 백필 — 제출 시각이 일치하는 review_submit 이력의 라운드를 적어 넣는다.
    const [res] = await sequelize.query(`
      UPDATE ${TABLE} v
         SET v.review_round = (
               SELECT h.round FROM task_status_history h
                WHERE h.task_id = v.task_id
                  AND h.event_type = 'review_submit'
                  AND h.round IS NOT NULL
                  AND ABS(TIMESTAMPDIFF(SECOND, h.created_at, v.created_at)) <= 2
                ORDER BY ABS(TIMESTAMPDIFF(SECOND, h.created_at, v.created_at)) ASC, h.id DESC
                LIMIT 1
             )
       WHERE v.review_round IS NULL
    `);
    console.log(`  ✅ 백필 완료 (영향 행 ${res?.affectedRows ?? '?'})`);

    const [[stat]] = await sequelize.query(`
      SELECT COUNT(*) AS total,
             SUM(review_round IS NOT NULL) AS linked,
             SUM(review_round IS NULL) AS unlinked
        FROM ${TABLE}
    `);
    console.log(`  · 전체 ${stat.total} · 제출본(라운드 연결) ${stat.linked} · 저장본/백업 ${stat.unlinked}`);

    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ 마이그레이션 실패:', e.message);
    try { await sequelize.close(); } catch { /* noop */ }
    process.exit(1);
  }
})();
