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

    // ── 랜딩 인사이트(/insights) 커버리지 — 공개 마케팅 피드가 비지 않도록. blog.js WHERE 와 동일 조건.
    const INSIGHTS_MIN = 6;
    const [[ins]] = await seq.query(`
      SELECT COUNT(*) AS n FROM help_articles
      WHERE blog_published_at IS NOT NULL AND is_published = 1 AND visibility = 'public'`);
    const insN = Number(ins.n);
    const insOk = insN >= INSIGHTS_MIN;

    // ── 이중언어 무결성 — 발행분(위키+인사이트)에 en 누락 0 (영어 서비스 대상). 누락 시 게이트 차단.
    const [[bi]] = await seq.query(`
      SELECT COUNT(*) AS n FROM help_articles
      WHERE is_published = 1
        AND (title_en IS NULL OR title_en = '' OR body_en IS NULL
             OR (blog_published_at IS NOT NULL AND (summary_en IS NULL OR summary_en = '')))`);
    const biMissing = Number(bi.n);
    const biOk = biMissing === 0;

    console.log(`\n=== 랜딩 인사이트 / 이중언어 ===`);
    console.log(`  ${insOk ? '✅' : '⛔'} /insights 발행: ${insN}/${INSIGHTS_MIN} (public)`);
    console.log(`  ${biOk ? '✅' : '⛔'} 영어 누락 발행글: ${biMissing}건`);

    if (gaps.length || !insOk || !biOk) {
      if (gaps.length) {
        console.log(`\n⛔ 커버리지 갭 ${gaps.length}건 — 위키 아티클 추가 필요:`);
        gaps.forEach(g => console.log(`  - ${g.cat}: ${g.have}/${g.need} 발행${g.exists ? '' : ' (카테고리 신설 필요)'}`));
      }
      if (!insOk) console.log(`\n⛔ 인사이트 발행 부족: ${insN}/${INSIGHTS_MIN} — seed-wiki-content.js 의 BLOG_MAP 에 how-to/insights 아티클 추가`);
      if (!biOk) console.log(`\n⛔ 영어 누락 ${biMissing}건 — 발행 아티클의 title_en/summary_en/body_en 채우기 (영어 서비스 필수)`);
      console.log('\n조치: dev-backend/seed-wiki-content.js 수정 후 node seed-wiki-content.js (docs/Q_WIKI_MAINTENANCE.md §2)');
      await seq.close();
      process.exit(1);
    }
    console.log('\n✅ 커버리지 통과 — 필수 기능 문서화 + 인사이트 발행 + 이중언어 완비.');
    await seq.close();
    process.exit(0);
  } catch (e) {
    console.error('❌ 감사 실패:', e.message);
    await seq.close();
    process.exit(2);
  }
})();
