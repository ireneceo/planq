// 옛 삭제분에 purged_at 을 박는다 — 휴지통이 "되돌릴 수 있는 것" 만 담게 하려고.
//
// 배경: 이 변경 전의 삭제는 DB 행만 남기고 **바이트를 지웠다.** 그 행들을 그대로 두면
//   휴지통을 열었을 때 복구 안 되는 항목 수백 개가 목록을 채운다(dev 실측 845건).
//   그렇다고 전부 일괄 stamp 하면 안 된다 — 옛 코드도 ref_count 가 남아 있거나 sibling 이
//   있으면 물리 삭제를 **보류**했으므로, 실제로 되살릴 수 있는 것이 섞여 있다.
//   그래서 **디스크를 실제로 확인해서** 없는 것만 stamp 한다.
//
// 멱등: 이미 purged_at 이 있는 행은 건드리지 않는다. --apply 없으면 dry-run.
const fs = require('fs');
const { sequelize } = require('../config/database');
const { File } = require('../models');
const { Op } = require('sequelize');

const APPLY = process.argv.includes('--apply');

(async () => {
  const rows = await File.findAll({
    where: { deleted_at: { [Op.ne]: null }, purged_at: null },
    attributes: ['id', 'file_path', 'storage_provider', 'deleted_at'],
  });
  let gone = 0, alive = 0;
  const goneIds = [];
  for (const f of rows) {
    // 외부 저장소(gdrive/s3)는 우리가 확인할 수 없다 — 건드리지 않고 남긴다(복구 시도에서 판정).
    if (f.storage_provider !== 'planq') { alive++; continue; }
    let exists = false;
    try { exists = !!f.file_path && fs.existsSync(f.file_path); } catch { exists = false; }
    if (exists) { alive++; continue; }
    gone++; goneIds.push(f.id);
  }
  console.log(`검사 ${rows.length}건 · 바이트 없음(=stamp 대상) ${gone}건 · 남아있음 ${alive}건`);
  if (!APPLY) { console.log('dry-run — --apply 로 적용'); process.exit(0); }
  if (goneIds.length) {
    // purged_at 은 "언제 사라졌는지" 를 모르므로 deleted_at 을 쓴다 — 옛 코드는 삭제 시점에 지웠다.
    await sequelize.query(
      'UPDATE files SET purged_at = deleted_at WHERE id IN (:ids) AND purged_at IS NULL',
      { replacements: { ids: goneIds } });
  }
  console.log(`적용 완료 — ${goneIds.length}건 stamp`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
