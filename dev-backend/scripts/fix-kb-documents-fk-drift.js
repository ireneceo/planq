#!/usr/bin/env node
/**
 * kb_documents 스키마 드리프트 정합 — project_id INT → BIGINT + 누락 FK 2개 생성
 *
 * 배경(2026-07-31 실측):
 *   운영은 이미 정상이다 — project_id bigint · project_id/client_id FK 존재(둘 다 ON DELETE SET NULL) · 고아 0건.
 *   문제는 **dev DB 만** project_id 가 int 로 남아 있는 것이다. projects.id 는 bigint 라
 *   타입이 안 맞아 sync-database 가 FK 를 만들지 못하고 매번 조용히 실패해 왔다.
 *   모델도 INTEGER 로 선언돼 있어 운영 실제와 어긋나 있었다(같이 수정).
 *
 * 고아 처리 근거:
 *   dev 에 없는 프로젝트를 참조하는 행이 있으면 FK 생성이 거부된다. 그 행들의 project_id 를 NULL 로 만드는데,
 *   이는 임의 변경이 아니라 **FK 가 처음부터 있었다면 프로젝트 삭제 시점에 이미 일어났을 일**이다
 *   (운영 FK 의 DELETE_RULE = SET NULL). 조회 쿼리도 `project_id IN (내 프로젝트들)` 이라
 *   존재하지 않는 프로젝트를 가리키는 행은 이미 아무에게도 안 보인다 — 관측되는 변화 없음.
 *
 * 멱등: 이미 bigint 이고 FK 가 있으면 아무것도 하지 않는다(운영에서 돌려도 변경 0).
 *
 * 사용
 *   node scripts/fix-kb-documents-fk-drift.js            # 진단만 (dry-run)
 *   node scripts/fix-kb-documents-fk-drift.js --apply
 */
const { sequelize } = require('../config/database');

const APPLY = process.argv.includes('--apply');

async function colType() {
  const [r] = await sequelize.query(
    "SELECT COLUMN_TYPE t, IS_NULLABLE n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kb_documents' AND COLUMN_NAME='project_id'");
  return r[0] || null;
}
async function fkOn(column) {
  const [r] = await sequelize.query(
    "SELECT CONSTRAINT_NAME c FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='kb_documents' AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL",
    { replacements: [column] });
  return r[0]?.c || null;
}
async function orphans(column, refTable) {
  const [r] = await sequelize.query(
    `SELECT k.id, k.${column} v, k.title FROM kb_documents k LEFT JOIN ${refTable} p ON p.id = k.${column} WHERE k.${column} IS NOT NULL AND p.id IS NULL`);
  return r;
}

(async () => {
  const before = await colType();
  const fkP = await fkOn('project_id');
  const fkC = await fkOn('client_id');
  const orphP = await orphans('project_id', 'projects');
  const orphC = await orphans('client_id', 'clients');

  console.log('진단:');
  console.log(`  project_id 타입: ${before?.t} (목표 bigint)`);
  console.log(`  project_id FK: ${fkP || '없음'} · client_id FK: ${fkC || '없음'}`);
  console.log(`  고아 — project_id ${orphP.length}건${orphP.length ? ' ' + JSON.stringify(orphP.map((o) => ({ id: o.id, project_id: o.v }))) : ''} · client_id ${orphC.length}건`);

  const needType = before && !/^bigint/i.test(before.t);
  const todo = [];
  if (orphP.length) todo.push(`고아 ${orphP.length}건 project_id → NULL`);
  if (needType) todo.push('project_id INT → BIGINT');
  if (!fkP) todo.push('project_id FK 생성 (ON DELETE SET NULL)');
  if (!fkC) todo.push('client_id FK 생성 (ON DELETE SET NULL)');

  if (!todo.length) { console.log('\n할 일 없음 — 이미 정합 상태다.'); await sequelize.close(); return; }
  console.log(`\n할 일 ${todo.length}건:${APPLY ? '' : '  [dry-run — 쓰기 없음]'}`);
  todo.forEach((s) => console.log('  - ' + s));
  if (!APPLY) { console.log('\n적용하려면 --apply'); await sequelize.close(); return; }

  if (orphP.length) {
    await sequelize.query(
      'UPDATE kb_documents k LEFT JOIN projects p ON p.id = k.project_id SET k.project_id = NULL WHERE k.project_id IS NOT NULL AND p.id IS NULL');
    console.log(`  ✓ 고아 ${orphP.length}건 NULL 처리`);
  }
  if (needType) {
    await sequelize.query('ALTER TABLE kb_documents MODIFY COLUMN project_id BIGINT NULL');
    console.log('  ✓ project_id → BIGINT');
  }
  if (!fkP) {
    await sequelize.query('ALTER TABLE kb_documents ADD CONSTRAINT kb_documents_project_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL ON UPDATE CASCADE');
    console.log('  ✓ project_id FK 생성');
  }
  if (!fkC) {
    await sequelize.query('ALTER TABLE kb_documents ADD CONSTRAINT kb_documents_client_id_fk FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL ON UPDATE CASCADE');
    console.log('  ✓ client_id FK 생성');
  }

  const after = await colType();
  console.log(`\n결과 — project_id ${after?.t} · FK project=${await fkOn('project_id')} client=${await fkOn('client_id')}`);
  await sequelize.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
