// services/filePurge.js — 파일 **영구 삭제**의 단일 착지점.
//
// 왜 서비스로 뽑았나: 영구 삭제는 두 곳에서 일어난다 —
//   ① 사용자가 휴지통에서 "영구 삭제"/"휴지통 비우기" (routes/files.js)
//   ② 보존기간(30일)이 지나 자동 정리 (services/uploadCleanup.js)
//   각자 구현하면 반드시 갈라진다. 실제로 그랬다: cron 은 `ref_count <= 0` 인 행만 골랐는데,
//   휴지통 도입 후 삭제는 ref_count 를 줄이지 않으므로 **cron 이 휴지통을 영영 비우지 못했다.**
//
// 계약: 바이트(자체/원격)를 제거하고 purged_at 을 찍는다. **행은 남긴다** — 무엇이 언제
//   사라졌는지는 감사 기록이다. 휴지통 목록은 purged_at IS NULL 로 걸러 이 행들을 보이지 않게 한다.
//   쿼터는 여기서 손대지 않는다 — 삭제(trashFile) 시점에 이미 반환했다. 여기서 또 빼면 두 번 빠진다.
const fs = require('fs');
const { Op } = require('sequelize');
const { File, BusinessCloudToken } = require('../models');
const gdrive = require('./gdrive');

async function purgeFile(file, transaction) {
  // 바이트가 사라졌음을 기록 — 휴지통 목록이 SQL 로 이것을 걸러낸다.
  file.purged_at = new Date();
  await file.save({ transaction });
  // ref_count 감소 + 0이면 물리 파일 제거
  await file.decrement('ref_count', { transaction });
  await file.reload({ transaction });

  if (file.ref_count <= 0) {
    if (file.storage_provider === 'planq') {
      // 동일 file_path 를 참조하는 다른 활성 레코드 존재 여부 확인
      const siblings = await File.count({
        where: { file_path: file.file_path, deleted_at: null, id: { [Op.ne]: file.id } },
        transaction
      });
      // 문서 버전 기록이 참조하면 바이트를 남긴다 — 판정은 services/fileRetention 에 모았다
      //   (라우트에 두면 같은 규칙이 삭제 경로마다 갈라진다).
      const referencedByRevision = await require('./fileRetention')
        .isReferencedByPostRevision(file, transaction);
      if (siblings === 0 && !referencedByRevision && fs.existsSync(file.file_path)) {
        fs.unlinkSync(file.file_path);
      }
    } else if (file.storage_provider === 'gdrive' && file.external_id) {
      try {
        const cloudToken = await BusinessCloudToken.findOne({
          where: { business_id: file.business_id, provider: 'gdrive' }, transaction
        });
        if (cloudToken) {
          const drive = await gdrive.getDriveClient(cloudToken);
          await gdrive.deleteFile(drive, file.external_id);
        }
      } catch (e) { console.error('[files] gdrive delete failed:', e.message); }
    } else if (file.storage_provider === 's3' && file.external_id) {
      try {
        const { WorkspaceStorageConfig } = require('../models');
        const cfg = await WorkspaceStorageConfig.findOne({ where: { business_id: file.business_id }, transaction });
        if (cfg) await require('./s3Storage').deleteObject(cfg, file.external_id);
      } catch (e) { console.error('[files] s3 delete failed:', e.message); }
    }
  }
  // 쿼터는 trashFile 에서 이미 반환했다 — 여기서 또 빼면 두 번 빠진다.
}

module.exports = { purgeFile };
