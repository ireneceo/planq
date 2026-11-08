const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { sequelize } = require('./config/database');

async function syncDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established.');

    // Auto-load all models
    const modelsDir = path.join(__dirname, 'models');
    const modelFiles = fs.readdirSync(modelsDir)
      .filter(f => f.endsWith('.js') && f !== 'index.js');

    const models = {};
    for (const file of modelFiles) {
      const model = require(path.join(modelsDir, file));
      if (model && model.name) {
        models[model.name] = model;
      }
    }
    console.log(`${Object.keys(models).length} models loaded: ${Object.keys(models).join(', ')}`);

    // Load associations
    require('./models');

    // 중복 인덱스 앞 패스 — alter 보다 **먼저** 걷어야 상한(64)에 닿은 표의 alter 가 이번 배포에서 성공한다
    //   (뒤 패스만 있으면 운영 첫 배포는 alter 실패 → 다음 배포에야 새 칸이 생긴다 · Fable 2026-11-08 차단 1).
    //   ★ FOREIGN_KEY_CHECKS=1 인 상태에서 돈다 — MySQL 이 «외래 키가 쓰는 마지막 인덱스» 삭제를 거절해 주는 안전망.
    const { dropDuplicateIndexes, declaredIndexNames } = require('./utils/dedupeIndexes');
    const keepNames = declaredIndexNames(models);
    let dedupeBefore = null;
    try { dedupeBefore = await dropDuplicateIndexes(sequelize, { apply: true, keepNames }); }
    catch (e) { dedupeBefore = { error: e.message }; }

    // Disable FK checks during sync
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');

    const failed = [];
    const succeeded = [];

    for (const [name, model] of Object.entries(models)) {
      try {
        await model.sync({ alter: true });
        succeeded.push(name);
      } catch (error) {
        console.error(`Failed to sync ${name}:`, error.message);
        failed.push(name);
      }
    }

    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

    // alter 가 `unique: true` 칸마다 돌 때마다 같은 UNIQUE 인덱스를 하나 더 만든다(MySQL · Sequelize 6).
    //   쌓이면 표 상한 64개에 닿아 그 표의 alter 가 «Too many keys» 로 실패 → 새 칸이 조용히 안 생긴다(2026-11-08 dev 4개 표 상한).
    //   정의가 완전히 같은 중복만 걷는다 — 규칙 utils/dedupeIndexes.js. 실패해도 sync 결과는 그대로 보고한다.
    let dedupeLine = '';
    try {
      const r = await dropDuplicateIndexes(sequelize, { apply: true, keepNames });
      const b = dedupeBefore || {};
      const fails = [...(b.failed || []), ...r.failed];
      dedupeLine = `[dedupe-indexes] 중복 인덱스 지움 — 앞 ${b.error ? '건너뜀(' + b.error + ')' : (b.dropped || 0)}개 · 뒤 ${r.dropped}개 · 실패 ${fails.length}`
        + fails.slice(0, 5).map((f) => `\n  실패 ${f.table}.${f.index}: ${f.error}`).join('');
    } catch (e) {
      dedupeLine = `[dedupe-indexes] 뒤 패스 건너뜀: ${e.message}`;
    }

    // Show tables
    const [tables] = await sequelize.query('SHOW TABLES');
    console.log(`\nTables (${tables.length}):`);
    tables.forEach(t => console.log(`  - ${Object.values(t)[0]}`));

    // ★ 요약은 맨 끝에 — 배포(deploy-planq.sh)는 이 출력의 `tail -20` 만 보여 준다. 표 목록 뒤에 두지 않으면
    //   실패한 표가 배포 화면에 한 번도 안 보인다(2026-11-08 확인: 표 목록이 마지막 20줄을 다 차지했다).
    console.log(`\nSync complete: ${succeeded.length} succeeded, ${failed.length} failed`);
    if (failed.length > 0) console.log('Failed:', failed.join(', '));
    if (dedupeLine) console.log(dedupeLine);

    process.exit(0);
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }
}

syncDatabase();
