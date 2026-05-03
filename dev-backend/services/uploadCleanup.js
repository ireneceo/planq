// uploads 디스크 정리 cron — soft-deleted 30일+ orphan File row 영구 삭제 + 물리 파일 cleanup.
//
// 정책 (메모 project_file_storage_hybrid.md):
//   - 사용자 삭제 = soft delete (deleted_at). dedup 위해 ref_count 감소. 0 도달 시 물리 파일 삭제 (routes/files.js:430-450)
//   - 단, soft delete 후에도 File row 자체는 남음 → 30일 보관 (실수 복구) 후 영구 삭제
//   - 물리 파일이 ref_count 감소 누락 등으로 남아있으면 같이 삭제 (sibling 검사)
//   - gdrive 외부 파일은 외부 정책 위임 (여기선 row 만 정리)
//
// 멱등: 같은 날 여러 번 호출돼도 안전 (이미 사라진 row/file 은 skip).
// 안전: 한 row 실패해도 나머지 계속 진행.

const fs = require('fs');
const { Op } = require('sequelize');
const logger = require('../lib/logger');

async function runUploadCleanup(today = new Date()) {
  const { File } = require('../models');
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - 30);

  const orphans = await File.findAll({
    where: {
      deleted_at: { [Op.ne]: null, [Op.lt]: cutoff },
      ref_count: { [Op.lte]: 0 },
    },
    attributes: ['id', 'business_id', 'file_path', 'storage_provider', 'external_id'],
    limit: 500,  // 한 번에 너무 많이 삭제 안 하게 (운영 디스크 IO 보호)
  });

  let removed = 0; let physicalRemoved = 0; let failed = 0;
  for (const f of orphans) {
    try {
      // planq 자체 저장: 같은 file_path 활성 sibling 없으면 물리 파일 삭제
      if (f.storage_provider === 'planq' && f.file_path) {
        const siblings = await File.count({
          where: { file_path: f.file_path, deleted_at: null, id: { [Op.ne]: f.id } },
        });
        if (siblings === 0 && fs.existsSync(f.file_path)) {
          try { fs.unlinkSync(f.file_path); physicalRemoved += 1; }
          catch (e) { logger.warn({ file_id: f.id, path: f.file_path, err: e.message }, 'unlink failed'); }
        }
      }
      await f.destroy({ force: true });  // hard delete (paranoid 모델 아니지만 명시)
      removed += 1;
    } catch (e) {
      failed += 1;
      logger.warn({ file_id: f.id, err: e.message }, 'orphan cleanup failed');
    }
  }
  return { scanned: orphans.length, removed, physicalRemoved, failed };
}

module.exports = { runUploadCleanup };
