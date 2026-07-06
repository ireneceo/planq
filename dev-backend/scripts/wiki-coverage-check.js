// Q위키 커버리지 감사 — docs/Q_WIKI_MAINTENANCE.md §1 매트릭스를 코드로 검증.
// 사용자 대면 기능(카테고리)마다 발행 아티클이 최소 N건 있는지 확인. 갭 있으면 ⛔ + exit 1.
// /개발완료 게이트에서 실행. node scripts/wiki-coverage-check.js
require('dotenv').config();
const HelpArticle = require('../models/HelpArticle');

// 필수 카테고리 → 최소 발행 아티클 수 (Q_WIKI_MAINTENANCE.md §1). suggested 는 자동초안용이라 제외.
const REQUIRED = {
  'getting-started': 2,
  'qtalk': 1,
  'qtask': 1,
  'qcalendar': 1,
  'qnote': 1,
  'qmail': 1,
  'qdocs': 1,
  'qinfo': 1,
  'qfile': 1,
  'qbill': 1,
  'insights': 1,
  'qproject': 1,
  'cue': 1,
  'settings': 1,
};

(async () => {
  const seq = HelpArticle.sequelize;
  try {
    const [rows] = await seq.query(`
      SELECT hc.slug AS cat, COUNT(ha.id) AS n
      FROM help_categories hc
      LEFT JOIN help_articles ha ON ha.category_id = hc.id AND ha.is_published = 1
      GROUP BY hc.id`);
    const have = new Map(rows.map(r => [r.cat, Number(r.n)]));

    const gaps = [];
    for (const [cat, min] of Object.entries(REQUIRED)) {
      const n = have.get(cat) || 0;
      if (n < min) gaps.push({ cat, have: n, need: min, exists: have.has(cat) });
    }

    console.log('=== Q위키 커버리지 감사 ===');
    for (const [cat, min] of Object.entries(REQUIRED)) {
      const n = have.get(cat) || 0;
      const mark = n >= min ? '✅' : '⛔';
      console.log(`  ${mark} ${cat}: ${n}/${min}${have.has(cat) ? '' : ' (카테고리 없음)'}`);
    }

    if (gaps.length) {
      console.log(`\n⛔ 커버리지 갭 ${gaps.length}건 — 위키 아티클 추가 필요:`);
      gaps.forEach(g => console.log(`  - ${g.cat}: ${g.have}/${g.need} 발행${g.exists ? '' : ' (카테고리 신설 필요)'}`));
      console.log('\n조치: dev-backend/seed-wiki-content.js 에 아티클 추가 후 node seed-wiki-content.js (docs/Q_WIKI_MAINTENANCE.md §2)');
      await seq.close();
      process.exit(1);
    }
    console.log('\n✅ 커버리지 통과 — 모든 필수 기능이 위키에 문서화됨.');
    await seq.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ 감사 실패:', e.message);
    await seq.close();
    process.exit(2);
  }
})();
