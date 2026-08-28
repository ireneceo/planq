// services/gdriveApply.js — Google Drive 변경을 PlanQ 파일함에 반영 (#379 역방향 동기화의 심장)
//
// 배경: 감지 파이프(watch 채널 · Changes API · 커서 · 소켓 브로드캐스트)는 이미 있었다.
//   빠져 있던 것은 **감지한 변경을 실제로 적용하는 부분**이다. 여태 "바뀌었다" 고 알리기만 했다.
//
// ── Fable 설계 게이트가 정한 정책 (이 파일이 그 정본) ─────────────────────────
// ① 정본 축 = storage_provider. **비대칭**이다.
//    · 'gdrive' (정본이 Drive)  → 이름·이동·휴지통 전부 반영
//    · 'planq'  (정본이 PlanQ, Drive 는 가시성 사본) → 이름·이동은 반영하되
//      **Drive 사본 삭제는 원본 삭제가 아니라 '미러 해제'**. 사용자가 자기 드라이브를
//      정리하다 워크스페이스 파일이 증발하는 사고를 원천 차단한다.
// ② 삭제는 **항상 soft** (deleted_at 마킹). 물리 삭제 없음 — 복구 경로가 있는 삭제만 자동화한다.
// ③ 에코 차단은 **멱등 비교가 1차**. 적용 전 DB 현재값과 비교해 diff 0 이면 아무것도 안 한다.
//    우리가 만든 변경이 Changes 로 되돌아와도 이미 DB 가 그 상태라 자연 흡수된다
//    (서버 재시작·원장 유실에도 견고 — 억제 원장 단독은 취약하다).
// ④ 충돌은 modifiedTime LWW. 병합 UI 는 만들지 않는다(실충돌 희소, 과설계).
//
// ★ 지금 scope 는 `drive.file`(앱이 만든 것만) 이다. 사용자가 Drive 에 **직접 넣은 새 파일**은
//   애초에 Changes 에 안 잡힌다 → 'create' 는 v2(Restricted `drive` scope) 로 미뤄져 있다.
//   여기서는 **우리가 아는 파일**의 변경만 적용한다. 모르는 fileId 는 skip/unknown_file 로 남긴다.
const { Op } = require('sequelize');
const { File, FileFolder, GdriveSyncLog } = require('../models');

// 적용 결과 기록 — 실패해도 본 흐름을 막지 않는다(로그가 기능을 죽이면 안 된다).
async function log(businessId, row) {
  try { await GdriveSyncLog.create({ business_id: businessId, direction: 'drive_to_planq', ...row }); }
  catch (e) { console.warn('[gdriveApply] log 실패', e.message); }
}

// Drive 파일 하나가 PlanQ 의 어느 File 인가.
//   external_id  = Drive 가 정본인 파일(v2 인제스트분)
//   gdrive_mirror_id = PlanQ 가 정본이고 Drive 엔 사본만 있는 파일(현행 미러)
async function findLocal(businessId, driveFileId) {
  return File.findOne({
    where: {
      business_id: businessId,
      [Op.or]: [{ external_id: driveFileId }, { gdrive_mirror_id: driveFileId }],
    },
  });
}

// Drive 의 부모 폴더 id → PlanQ folder_id. 매핑이 없으면 null(루트) — 폴더 트리 인제스트는 v2.
async function mapParentFolder(businessId, parents) {
  const pid = Array.isArray(parents) && parents.length ? parents[0] : null;
  if (!pid) return { known: false, folderId: null };
  try {
    const folder = await FileFolder.findOne({ where: { business_id: businessId, gdrive_folder_id: pid } });
    return folder ? { known: true, folderId: folder.id } : { known: false, folderId: null };
  } catch (e) {
    // 컬럼 마이그레이션 전이면 여기로 온다 — '모름' 으로 떨어뜨려 **이동만 보류**하고
    // 이름변경·삭제 반영은 계속 살린다. 기능 하나가 전체를 죽이지 않게.
    console.warn('[gdriveApply] 폴더 매핑 조회 실패(컬럼 미생성?)', e.message);
    return { known: false, folderId: null };
  }
}

/**
 * Changes API 결과 한 건을 적용한다.
 * @returns {{action:string, reason?:string}} 무엇을 했는지 (로그·집계용)
 */
async function applyChange(businessId, change) {
  const driveId = change.fileId || change.file?.id;
  if (!driveId) return { action: 'skip', reason: 'no_file_id' };

  const local = await findLocal(businessId, driveId);
  if (!local) {
    // v1 에서는 정상 경로다 — 우리가 안 만든 Drive 파일은 scope 밖이라 애초에 관심 대상이 아니다.
    await log(businessId, { gdrive_file_id: driveId, action: 'skip', reason: 'unknown_file' });
    return { action: 'skip', reason: 'unknown_file' };
  }
  const isDriveMaster = local.storage_provider === 'gdrive';
  const f = change.file || {};

  // ── 삭제/휴지통 ──
  if (change.removed || f.trashed) {
    if (isDriveMaster) {
      if (local.deleted_at) return { action: 'skip', reason: 'no_change' };   // ③ 멱등
      await local.update({ deleted_at: new Date() });                         // ② soft only
      await log(businessId, { gdrive_file_id: driveId, file_id: local.id, action: 'trash' });
      return { action: 'trash' };
    }
    // ① PlanQ 가 정본 — 사본이 지워졌을 뿐이다. 원본은 건드리지 않는다.
    if (!local.gdrive_mirror_id) return { action: 'skip', reason: 'no_change' };
    await local.update({ gdrive_mirror_id: null, gdrive_mirror_url: null, gdrive_mirrored_at: null });
    await log(businessId, {
      gdrive_file_id: driveId, file_id: local.id, action: 'unmirror',
      detail: { note: 'Drive 사본이 삭제됨 — PlanQ 원본은 보존, 자동 재미러 안 함' },
    });
    return { action: 'unmirror' };
  }

  // ── 이름 변경 ──
  const patch = {};
  if (f.name && f.name !== local.file_name) patch.file_name = f.name;

  // ── 이동 (부모 폴더 변경) — 매핑을 아는 폴더로만. 모르면 건드리지 않는다(루트로 쓸어버리면 사고) ──
  if (Array.isArray(f.parents) && f.parents.length) {
    const { known, folderId } = await mapParentFolder(businessId, f.parents);
    if (known && folderId !== local.folder_id) patch.folder_id = folderId;
  }

  // ── 내용 수정 — Drive 가 정본일 때만. PlanQ 정본은 로컬이 진짜라 덮어쓰지 않는다 ──
  if (isDriveMaster && f.md5Checksum && f.md5Checksum !== local.content_hash) {
    patch.content_hash = f.md5Checksum;
    if (f.size) patch.file_size = Number(f.size);
  }

  if (Object.keys(patch).length === 0) {
    // ③ 에코 흡수 지점 — 우리가 만든 변경이 되돌아오면 여기서 조용히 끝난다.
    await log(businessId, { gdrive_file_id: driveId, file_id: local.id, action: 'skip', reason: 'no_change' });
    return { action: 'skip', reason: 'no_change' };
  }
  await local.update(patch);
  const action = patch.file_name ? 'rename' : (patch.folder_id !== undefined ? 'move' : 'content');
  await log(businessId, { gdrive_file_id: driveId, file_id: local.id, action, detail: patch });
  return { action };
}

/** 변경 목록을 순서대로 적용하고 집계를 돌려준다. 개별 실패가 전체를 막지 않는다. */
async function applyChanges(businessId, changes) {
  const summary = { applied: 0, skipped: 0, failed: 0, byAction: {} };
  for (const c of changes || []) {
    try {
      const r = await applyChange(businessId, c);
      if (r.action === 'skip') summary.skipped += 1; else summary.applied += 1;
      summary.byAction[r.action] = (summary.byAction[r.action] || 0) + 1;
    } catch (e) {
      summary.failed += 1;
      console.warn('[gdriveApply] 적용 실패', c?.fileId, e.message);
      await log(businessId, { gdrive_file_id: c?.fileId, action: 'skip', reason: 'error', detail: { message: String(e.message).slice(0, 200) } });
    }
  }
  return summary;
}

module.exports = { applyChanges, applyChange, findLocal };
