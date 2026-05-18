// scripts/fix-filename-mojibake.js
//
// multer 2.x 의 latin1 originalname 으로 인해 garbled 저장된 파일명을 일괄 복구.
//
// 운영 배포 시 1회 실행 (dev 검증 → /배포 → 운영 backend 에서 실행).
//
// 사용:
//   cd dev-backend && node scripts/fix-filename-mojibake.js          # dry-run
//   cd dev-backend && node scripts/fix-filename-mojibake.js --apply  # 실제 update

require('dotenv').config();
const { File, MessageAttachment, TaskAttachment, KbDocument } = require('../models');
const { decodeOriginalName } = require('../services/filename');

const APPLY = process.argv.includes('--apply');

const TARGETS = [
  { model: File, name: 'File', col: 'file_name' },
  { model: MessageAttachment, name: 'MessageAttachment', col: 'file_name' },
  { model: TaskAttachment, name: 'TaskAttachment', col: 'original_name' },
  { model: KbDocument, name: 'KbDocument', col: 'file_name' },
];

(async () => {
  let total = 0;
  for (const { model, name, col } of TARGETS) {
    const rows = await model.findAll({ raw: true });
    let changed = 0;
    for (const r of rows) {
      const orig = r[col];
      if (!orig) continue;
      const decoded = decodeOriginalName(orig);
      if (decoded === orig) continue;
      changed++;
      if (changed <= 5) {
        console.log(`  ${name}#${r.id}: '${orig}' → '${decoded}'`);
      }
      if (APPLY) {
        await model.update({ [col]: decoded }, { where: { id: r.id } });
      }
    }
    console.log(`${name}.${col}: ${changed} ${APPLY ? 'updated' : 'would change'}`);
    total += changed;
  }
  console.log(`TOTAL: ${total} ${APPLY ? 'updated' : 'would change (dry-run, use --apply)'}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
