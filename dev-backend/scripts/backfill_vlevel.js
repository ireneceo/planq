// legacy visibility → vlevel 백필 (사이클 N+74-B 박제).
//
// 운영 dev 둘 다 한 번 실행. 옛 row 의 visibility 컬럼 값을 vlevel 로 복사.
//   - visibility 'L1'/'L2'/'L3'/'L4' → 같은 값
//   - visibility NULL → vlevel = 'L3' (워크스페이스 default — 옛 SaaS 패턴 일관)
//
// idempotent: vlevel 이 이미 있으면 skip. 여러 번 실행해도 안전.
//
// 실행:
//   cd /opt/planq/dev-backend && node scripts/backfill_vlevel.js
//
// 운영:
//   ssh irene@87.106.78.146 'cd /opt/planq/backend && node scripts/backfill_vlevel.js'

require('dotenv').config();
const { sequelize } = require('../config/database');

async function main() {
  const stats = { posts: { copied: 0, default_L3: 0 }, files: { copied: 0, default_L3: 0 } };

  // posts — vlevel 이 NULL 이고 visibility 있으면 복사
  // posts 는 vlevel 컬럼 이미 있지만 옛 null row 가 있을 수 있음
  try {
    const [r1] = await sequelize.query(`
      UPDATE posts SET vlevel = visibility
      WHERE vlevel IS NULL AND visibility IS NOT NULL
    `);
    stats.posts.copied = r1.affectedRows || 0;
    const [r2] = await sequelize.query(`
      UPDATE posts SET vlevel = 'L3'
      WHERE vlevel IS NULL AND visibility IS NULL
    `);
    stats.posts.default_L3 = r2.affectedRows || 0;
  } catch (e) {
    console.error('[posts]', e.message);
  }

  // files — 신규 vlevel 컬럼 (N+74-A 추가). 옛 visibility 만 있는 row 백필
  try {
    const [r1] = await sequelize.query(`
      UPDATE files SET vlevel = visibility
      WHERE vlevel = 'L3' AND visibility IS NOT NULL AND visibility != 'L3'
    `);
    // vlevel default='L3' 라 ALTER 직후 모든 row 가 'L3'. 옛 visibility 가 다른 값이면 그걸로 덮어씀.
    stats.files.copied = r1.affectedRows || 0;
    // vlevel='L3' + visibility=NULL — default 그대로 유지 OK (옛 legacy 그대로면 워크스페이스 공개)
  } catch (e) {
    console.error('[files]', e.message);
  }

  console.log(JSON.stringify(stats, null, 2));
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
