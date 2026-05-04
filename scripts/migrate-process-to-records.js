#!/usr/bin/env node
// 1회 실행 스크립트 — project_process_parts → q_records 자동 마이그레이션
// 안전: 원본 process_parts/process_columns 는 손대지 않음. 동일 record 가 이미 있으면 skip.
//
// 사용:
//   cd /opt/planq/dev-backend
//   node ../scripts/migrate-process-to-records.js                 # 모든 워크스페이스
//   node ../scripts/migrate-process-to-records.js --business=5    # 특정 워크스페이스
//   node ../scripts/migrate-process-to-records.js --project=70    # 특정 프로젝트

const path = require('path');
process.chdir(path.join(__dirname, '..', 'dev-backend'));

const dotenvPath = path.join(__dirname, '..', 'dev-backend', 'node_modules', 'dotenv');
require(dotenvPath).config();
const { migrateProcessParts } = require(path.join(__dirname, '..', 'dev-backend', 'services', 'process_to_record_migration'));

const args = process.argv.slice(2);
const opts = {};
for (const a of args) {
  if (a.startsWith('--business=')) opts.businessId = Number(a.split('=')[1]);
  if (a.startsWith('--project=')) opts.projectId = Number(a.split('=')[1]);
}

(async () => {
  console.log('=== Q record 자동 마이그레이션 시작 ===');
  console.log('범위:', opts.businessId ? `business=${opts.businessId}` : opts.projectId ? `project=${opts.projectId}` : '전체');

  const summary = await migrateProcessParts(opts);

  console.log('\n=== 결과 ===');
  console.log(`프로젝트 검사: ${summary.projects_seen}`);
  console.log(`q_record 신규 생성: ${summary.records_created}`);
  console.log(`q_record_row 변환: ${summary.rows_created}`);
  console.log(`skip: ${summary.skipped.length}`);
  if (summary.skipped.length > 0) {
    console.log('  skip 사유:');
    for (const s of summary.skipped) console.log(`    - project ${s.project_id}: ${s.reason}`);
  }
  console.log('\n=== 완료 ===');
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
