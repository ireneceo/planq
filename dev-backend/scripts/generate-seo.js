// 검색용 공개 페이지 HTML + sitemap.xml 생성 — services/seoArtifacts.js. 멱등.
//   배포 직후(deploy-planq.sh)와 수동 점검용. 서버는 시작·매일 0시에 같은 함수를 부른다.
//   사용: node scripts/generate-seo.js [--dir /path/to/frontend-build]
require('dotenv').config();
const { sequelize } = require('../config/database');
const { generateSeoArtifacts } = require('../services/seoArtifacts');
(async () => {
  const i = process.argv.indexOf('--dir');
  const r = await generateSeoArtifacts(i > -1 ? { dir: process.argv[i + 1] } : {});
  console.log('[generate-seo]', JSON.stringify(r));
  await sequelize.close();
  process.exit(r.ok ? 0 : 1);
})().catch((e) => { console.error('[generate-seo] 실패:', e.message); process.exit(1); });
