// 4단계 Visibility 마이그레이션 — 기존 데이터 백필 (사이클 N+9)
//
// 정책 (VISIBILITY_VOCABULARY.md §3):
//   files / posts: project_id NULL → L3 (워크스페이스 공개, 사용자 충격 0)
//                  project_id NOT NULL → L2 (프로젝트 멤버 권한)
//   invoices: owner_user_id NULL → created_by 백필
//
// 실행: cd dev-backend && node scripts/migrate-visibility-l-levels.js [--dry-run]

const { Op } = require('sequelize');
const models = require('../models');

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const seq = models.sequelize || models.User.sequelize;

  console.log('=== Visibility L1~L4 백필 시작' + (dryRun ? ' [DRY RUN]' : '') + ' ===');

  // 1) files
  const filesL3 = await models.File.count({ where: { visibility: null, project_id: null } });
  const filesL2 = await models.File.count({ where: { visibility: null, project_id: { [Op.ne]: null } } });
  console.log(`[files] visibility NULL 대상 — project_id NULL=${filesL3} → L3 / NOT NULL=${filesL2} → L2`);
  if (!dryRun) {
    const [r1] = await seq.query(`UPDATE files SET visibility='L3' WHERE visibility IS NULL AND project_id IS NULL`);
    const [r2] = await seq.query(`UPDATE files SET visibility='L2' WHERE visibility IS NULL AND project_id IS NOT NULL`);
    console.log(`  updated L3=${r1.affectedRows}, L2=${r2.affectedRows}`);
  }

  // 2) posts (vlevel)
  const postsL3 = await models.Post.count({ where: { vlevel: null, project_id: null } });
  const postsL2 = await models.Post.count({ where: { vlevel: null, project_id: { [Op.ne]: null } } });
  console.log(`[posts] vlevel NULL 대상 — project_id NULL=${postsL3} → L3 / NOT NULL=${postsL2} → L2`);
  if (!dryRun) {
    const [r3] = await seq.query(`UPDATE posts SET vlevel='L3' WHERE vlevel IS NULL AND project_id IS NULL`);
    const [r4] = await seq.query(`UPDATE posts SET vlevel='L2' WHERE vlevel IS NULL AND project_id IS NOT NULL`);
    console.log(`  updated L3=${r3.affectedRows}, L2=${r4.affectedRows}`);
  }

  // 3) invoices.owner_user_id ← created_by 백필
  const invNull = await models.Invoice.count({ where: { owner_user_id: null } });
  console.log(`[invoices] owner_user_id NULL=${invNull} → created_by 백필`);
  if (!dryRun) {
    const [r5] = await seq.query(`UPDATE invoices SET owner_user_id = created_by WHERE owner_user_id IS NULL`);
    console.log(`  updated=${r5.affectedRows}`);
  }

  // 4) kb_documents: 'private' 옵션은 새로 추가 — 기존 row 변경 없음.
  console.log('[kb_documents] scope ENUM 에 private 추가 (DB sync 처리). 기존 row 변경 없음.');

  // 5) 결과 요약
  if (!dryRun) {
    const filesAfter = await models.File.count({ where: { visibility: null } });
    const postsAfter = await models.Post.count({ where: { vlevel: null } });
    const invAfter = await models.Invoice.count({ where: { owner_user_id: null } });
    console.log('=== 백필 완료 ===');
    console.log(`  files.visibility NULL 잔존: ${filesAfter}`);
    console.log(`  posts.vlevel NULL 잔존: ${postsAfter}`);
    console.log(`  invoices.owner_user_id NULL 잔존: ${invAfter}`);
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
