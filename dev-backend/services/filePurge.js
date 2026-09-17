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

/**
 * @param {Array} externalQueue  **되돌릴 수 없는 외부 호출**(Drive/S3 삭제·미러 회수)을 담아
 *   두는 배열. 호출측이 만들어 넘기고 **커밋한 뒤** `flushPurgeExternals(queue)` 로 비운다.
 *
 * ★ 왜 트랜잭션 밖으로 뺐나 (2026-09-17, Fable N10):
 *   옛 코드는 Drive `files.delete` 를 트랜잭션 **안**에서 쳤다. 그러면 ①네트워크가 느린 동안
 *   DB 트랜잭션을 붙잡고 있고 ②그 뒤 무엇이든 실패해 롤백되면 **DB 는 안 지워졌는데 Drive 원본만
 *   사라진다** — 되돌릴 수 없는 쪽이 되돌릴 수 있는 쪽 안에 들어가 있었다.
 *   `routes/files.js` 의 `flushMirrorRecalls` 와 **같은 방식**이다(큐를 호출측이 만든다 —
 *   모듈 전역에 두면 요청끼리 섞여 산 파일의 사본을 지운다. Fable 9차 N1).
 */
async function purgeFile(file, transaction, externalQueue) {
  // 큐를 안 받았으면 경고하고 **적어도 트랜잭션 밖(다음 틱)** 으로 미룬다.
  // 조용히 안쪽에서 치면 이 계약이 새 호출부에서 그대로 사라진다.
  const queue = externalQueue || null;
  const defer = (fn) => {
    if (queue) { queue.push(fn); return; }
    console.warn('[filePurge] externalQueue 없이 호출됨 — 외부 삭제를 트랜잭션 밖으로 미룬다', file.id);
    setImmediate(() => { Promise.resolve().then(fn).catch(() => {}); });
  };
  // 바이트가 사라졌음을 기록 — 휴지통 목록이 SQL 로 이것을 걸러낸다.
  file.purged_at = new Date();
  await file.save({ transaction });
  // ref_count 감소 + 0이면 물리 파일 제거
  await file.decrement('ref_count', { transaction });
  await file.reload({ transaction });

  if (file.ref_count <= 0) {
    if (file.storage_provider === 'planq') {
      // ★ 산 참조 판정은 `services/fileRefs.countLiveRefs` **한 곳**이다
      //   (2026-09-17, Fable 10차 #2·#3). 옛 코드는 여기서만 File 형제와 첨부를 따로 셌고,
      //   `file_path` 완전일치로 비교해 **첨부 보호가 한 번도 참이 되지 않았다** —
      //   첨부 테이블은 상대경로로도 저장된다(Fable 운영 실측: 링크 채팅첨부 7건 중 일치 0/7).
      //   즉 살아 있는 첨부의 바이트를 이 경로가 지울 수 있었다.
      //   ★ 여기는 **물리삭제** 자리라 «바이트가 아직 필요한가» 로 묻는다 (Fable 11차 D3) —
      //     휴지통에 있어도 복구 가능한(`purged_at IS NULL`) 형제는 그 바이트가 있어야 한다.
      const refs = await require('./fileRefs')
        .countLiveRefs(file, transaction, { siblingScope: 'unpurged' });
      const siblings = refs.fileSiblings;
      const attachRefs = refs.taskAttachments + refs.messageAttachments;
      // 문서 버전 기록이 참조하면 바이트를 남긴다 — 판정은 services/fileRetention 에 모았다
      //   (라우트에 두면 같은 규칙이 삭제 경로마다 갈라진다).
      const referencedByRevision = await require('./fileRetention')
        .isReferencedByPostRevision(file, transaction);
      if (siblings === 0 && !referencedByRevision && attachRefs === 0 && fs.existsSync(file.file_path)) {
        fs.unlinkSync(file.file_path);
      }
    } else if (file.storage_provider === 'gdrive' && file.external_id) {
      const bizId = file.business_id, extId = file.external_id;
      defer(async () => {
        try {
          const cloudToken = await BusinessCloudToken.findOne({ where: { business_id: bizId, provider: 'gdrive' } });
          if (cloudToken) {
            const drive = await gdrive.getDriveClient(cloudToken);
            await gdrive.deleteFile(drive, extId);
          }
        } catch (e) { console.error('[files] gdrive delete failed:', e.message); }
      });
    } else if (file.storage_provider === 's3' && file.external_id) {
      const bizId = file.business_id, extId = file.external_id;
      defer(async () => {
        try {
          const { WorkspaceStorageConfig } = require('../models');
          const cfg = await WorkspaceStorageConfig.findOne({ where: { business_id: bizId } });
          if (cfg) await require('./s3Storage').deleteObject(cfg, extId);
        } catch (e) { console.error('[files] s3 delete failed:', e.message); }
      });
    }
  }
  // ★ 2026-09-17 (Fable 게이트 #57 2차) — **Drive 미러 사본도 거둔다.**
  //   주 회수는 이제 **trash 시점**이다(routes/files.js trashFile) — 보존기간 동안 사본이
  //   공유 폴더에 남는 창을 닫기 위해서다. 여기는 **그물**이다: trash 를 거치지 않고 온 경로,
  //   회수가 실패했던 행, 옛 데이터가 여기서 마지막으로 정리된다.
  //   회수는 `services/driveMirrorRecall` 한 곳이다(라우트마다 적으면 반드시 한 곳이 빠진다).
  if (file.gdrive_mirror_id && file.storage_provider === 'planq') {
    defer(async () => {
      const patch = {};
      const r = await require('./driveMirrorRecall').recallDriveMirror(file, patch);
      if (r === 'removed' || r === 'shared') {
        // 커밋 뒤이므로 트랜잭션 없이 쓴다(그 행은 이미 purged_at 이 찍혀 확정됐다).
        try { await file.update(patch); }
        catch (e) { console.warn('[filePurge] 미러 컬럼 정리 실패', file.id, e.message); }
      }
    });
  }
  // 쿼터는 trashFile 에서 이미 반환했다 — 여기서 또 빼면 두 번 빠진다.
}

/** 커밋 뒤에 부른다 — 큐에 쌓인 외부 삭제를 순서대로 처리한다(하나가 실패해도 나머지는 계속). */
async function flushPurgeExternals(queue) {
  const q = queue || [];
  while (q.length) {
    const fn = q.shift();
    try { await fn(); } catch (e) { console.warn('[filePurge] 외부 정리 실패', e.message); }
  }
}

module.exports = { purgeFile, flushPurgeExternals };
