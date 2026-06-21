// task_templates.embedding 컬럼 추가(멱등) + 기존 템플릿 임베딩 백필.
// 운영/개발 공통. 재실행 안전(이미 embedding 있는 행은 skip 옵션).
//   node backfill-template-embeddings.js          # embedding NULL 인 것만
//   node backfill-template-embeddings.js --all     # 전부 재계산
require('dotenv').config();
const { sequelize } = require('./config/database');
const { TaskTemplate } = require('./models');
const { recomputeTemplateEmbedding } = require('./services/templateEmbedding');

(async () => {
  const onlyMissing = !process.argv.includes('--all');

  // 1) 컬럼 멱등 추가
  const [cols] = await sequelize.query("SHOW COLUMNS FROM task_templates LIKE 'embedding'");
  if (cols.length === 0) {
    await sequelize.query('ALTER TABLE task_templates ADD COLUMN embedding BLOB NULL');
    console.log('[backfill] embedding 컬럼 추가됨');
  } else {
    console.log('[backfill] embedding 컬럼 이미 존재');
  }

  // 2) 백필
  const where = onlyMissing ? { embedding: null } : {};
  const rows = await TaskTemplate.findAll({ where, attributes: ['id', 'name'] });
  console.log(`[backfill] 대상 ${rows.length}건 (${onlyMissing ? 'embedding NULL 만' : '전부'})`);

  let ok = 0, fail = 0;
  for (const r of rows) {
    const done = await recomputeTemplateEmbedding(r.id);
    if (done) { ok++; process.stdout.write('.'); }
    else { fail++; process.stdout.write('x'); }
  }
  console.log(`\n[backfill] 완료 — 성공 ${ok} / 실패 ${fail}`);
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
