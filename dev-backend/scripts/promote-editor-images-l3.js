// scripts/promote-editor-images-l3.js
//
// 사이클 N+22: 본문 인라인 이미지(`uploads/editor-images/`)의 visibility 를 L1 → L3 으로 promote.
//
// 배경: 본문 인라인 이미지는 그 본문과 동일 노출 범위 (워크스페이스) 가 자연스러운데,
//       옛 정책이 L1(개인 보관함) default 라 사용자가 Q File 리스트에서 본문 이미지를 못 찾는 회귀.
//
// 사용:
//   cd dev-backend && node scripts/promote-editor-images-l3.js          # dry-run
//   cd dev-backend && node scripts/promote-editor-images-l3.js --apply  # 실제 update

require('dotenv').config();
const { File } = require('../models');
const { Op } = require('sequelize');

const APPLY = process.argv.includes('--apply');

(async () => {
  const rows = await File.findAll({
    where: {
      visibility: 'L1',
      file_path: { [Op.like]: '%/editor-images/%' },
    },
    raw: true,
  });
  console.log(`Found ${rows.length} editor-image rows with visibility=L1`);
  for (const r of rows.slice(0, 5)) {
    console.log(`  File#${r.id} biz=${r.business_id} '${r.file_name}'`);
  }
  if (APPLY && rows.length > 0) {
    const [count] = await File.update(
      { visibility: 'L3' },
      { where: { id: rows.map(r => r.id) } }
    );
    console.log(`Updated ${count} rows → L3`);
  } else if (rows.length > 0) {
    console.log('(dry-run — use --apply to update)');
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
