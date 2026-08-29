// 휴지통 자동 비우기 cron — 보존기간(30일)이 지난 삭제 파일의 **바이트를 제거**한다.
//
// 정책:
//   - 사용자 삭제 = 휴지통행(routes/files.js trashFile). deleted_at 만 찍고 바이트는 그대로 둔다.
//   - 30일이 지나면 여기서 영구 삭제 — **services/filePurge.js 의 같은 함수**를 부른다.
//   - 행은 남긴다(purged_at 이 찍힌다). 무엇이 언제 사라졌는지는 감사 기록이다.
//     휴지통 목록은 purged_at IS NULL 로 걸러 이 행들을 보이지 않게 한다.
//
// ★ 여기가 한 번 갈라졌던 자리다: 옛 조건이 `ref_count <= 0` 이었는데, 휴지통 도입으로
//   삭제가 ref_count 를 줄이지 않게 되면서 **이 cron 이 휴지통을 영영 비우지 못하는** 상태가
//   됐다. 조건을 "보존기간 지남 + 아직 안 지워짐" 으로 바꾸고 삭제 자체는 단일 착지점에 위임한다.
//
// 멱등: 같은 날 여러 번 호출돼도 안전 (purged_at 이 찍힌 행은 다시 안 잡힌다).
// 안전: 한 row 실패해도 나머지 계속 진행.

const { Op } = require('sequelize');
const logger = require('../lib/logger');

async function runUploadCleanup(today = new Date()) {
  const { File } = require('../models');
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - 30);

  const expired = await File.findAll({
    where: {
      deleted_at: { [Op.ne]: null, [Op.lt]: cutoff },
      purged_at: null,
    },
    limit: 500,  // 한 번에 너무 많이 삭제 안 하게 (운영 디스크 IO 보호)
  });

  const { sequelize } = require('../config/database');
  const { purgeFile } = require('./filePurge');
  let removed = 0; let failed = 0;
  for (const f of expired) {
    const t = await sequelize.transaction();
    try {
      await purgeFile(f, t);
      await t.commit();
      removed += 1;
    } catch (e) {
      await t.rollback().catch(() => {});
      failed += 1;
      logger.warn({ file_id: f.id, err: e.message }, 'trash purge failed');
    }
  }
  return { scanned: expired.length, removed, failed };
}

module.exports = { runUploadCleanup };
