// 서명 항목(docs/SIGNATURE_ITEMS_DESIGN.md §9) — signature_requests 에 열 2개. 멱등. **코드 배포 전에** 돈다(배포 슬롯).
//   required_items JSON — 요청 시점에 고정본에서 읽은 «이 서명자가 채울 것»
//   item_images    JSON — 서명 칸 순서대로 채운 값(그리기·이미지). 첫 칸은 signature_image_b64 에도.
//   롤백: 코드만(열은 남아도 무해).  사용: node scripts/migrate-signature-items.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');
const DRY = process.argv.includes('--dry');
const COLS = [
  ['required_items', 'JSON NULL'],
  ['item_images', 'JSON NULL'],
];
(async () => {
  let changed = 0;
  for (const [col, ddl] of COLS) {
    const [rows] = await sequelize.query('SHOW COLUMNS FROM `signature_requests` LIKE ?', { replacements: [col] });
    if (rows.length) { console.log(`[migrate-signature-items] ${col} 이미 있음 — skip`); continue; }
    const sql = `ALTER TABLE \`signature_requests\` ADD COLUMN \`${col}\` ${ddl}`;
    if (DRY) { console.log('[migrate-signature-items] (dry)', sql); changed += 1; continue; }
    await sequelize.query(sql);
    console.log(`[migrate-signature-items] ${col} 추가`);
    changed += 1;
  }
  console.log(changed ? `[migrate-signature-items] ${DRY ? '변경 예정' : '변경'} ${changed}건` : '[migrate-signature-items] 변경 0 (멱등 확인)');
  await sequelize.close();
})().catch((e) => { console.error(e); process.exit(1); });
