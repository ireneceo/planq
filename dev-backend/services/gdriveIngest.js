// services/gdriveIngest.js — Drive 에 직접 올린 파일을 PlanQ 파일함으로 들이는 경로 (#379 v2).
//
// ── Fable 설계 게이트가 정한 것 (이 파일이 그 정본) ───────────────────────────
// ① 범위    — 워크스페이스 root 폴더 **하위만**. 판정은 services/gdriveTree.js (fail-closed).
// ② 바이트  — 내려받아 우리가 서빙한다(dedup·미리보기·검색 유지).
//             축: storage_provider='planq'(서빙) · origin_provider='gdrive'(정본).
// ③ 쿼터    — `plan.can('upload_file', { size, external: false })`.
//             ★ external:true 로 부르면 services/plan.js:273 이 **쿼터 검사를 통째로 건너뛴다.**
//               Drive 파일이라고 external 을 물려주면 Free 1GB 워크스페이스에 수 GB 가 쌓인다.
//             커밋 시점에 usage 행을 FOR UPDATE 로 잠그고 **다시** 검사한다(동시 요청 대비).
// ④ 부분 인제스트 허용 — 파일별 한도·확장자 때문에 "전량 아니면 거부" 는 성립하지 않는다.
//             건마다 원장(GdriveSyncLog)에 남겨 무엇이 왜 빠졌는지 사용자가 볼 수 있게 한다.
// ⑤ 쿼터 초과 시 **배치를 멈춘다** — 크론이 재개할 때마다 무한 재시도하며 API 를 태우지 않게.
// ⑥ 가시성  — visibility·vlevel·security_level 을 **명시 동시 기록**. 한쪽만 쓰면 default 로 새어
//             전 멤버에게 노출된 전례가 있다(memory: 권위 컬럼 쓰기측 미기록).
// ⑦ 업로더  — 연동한 사람(BusinessCloudToken.connected_by). 그 외 후보가 없다.
//             화면에는 "연동" 임을 같이 표기해야 "내가 안 올린 파일이 내 이름으로" 신고를 막는다.
// ⑧ Google 네이티브 문서(문서/시트/슬라이드)는 제외 — 바이트 다운로드가 불가하다(export 필요).
const path = require('path');
const { File, GdriveSyncLog } = require('../models');
const gdrive = require('./gdrive');
// 확장자·네이티브 판정은 공용 모듈이 정본을 갖는다(목록이 두 벌이면 반드시 갈라진다).
const { importDriveFile, ALLOWED_EXT, GOOGLE_NATIVE_PREFIX } = require('./driveImport');
const { resolveAncestry, ensureFolderChain, newCache } = require('./gdriveTree');

function extOf(name) {
  const e = path.extname(String(name || '')).replace('.', '').toLowerCase();
  return e;
}

async function log(businessId, row) {
  try { await GdriveSyncLog.create({ business_id: businessId, direction: 'drive_to_planq', ...row }); }
  catch (e) { console.warn('[gdriveIngest] log 실패', e.message); }
}

/**
 * Drive 파일 하나를 들인다.
 * @param ctx { drive, businessId, rootFolderId, uploaderId }
 * @returns {{action:'ingest'|'skip', reason?:string, fileId?:number, blocked?:boolean}}
 *   blocked=true 면 **배치를 멈춰야 한다**(쿼터 초과).
 */
async function ingestOne(ctx, meta, cache) {
  const { drive, businessId, uploaderId } = ctx;
  const driveId = meta?.id;
  if (!driveId) return { action: 'skip', reason: 'no_file_id' };

  // ⑧ Google 네이티브 문서 — 원본 바이트가 없다.
  if (String(meta.mimeType || '').startsWith(GOOGLE_NATIVE_PREFIX)) {
    await log(businessId, { gdrive_file_id: driveId, action: 'skip', reason: 'google_native' });
    return { action: 'skip', reason: 'google_native' };
  }
  // 확장자 정책
  if (!ALLOWED_EXT.has(extOf(meta.name))) {
    await log(businessId, { gdrive_file_id: driveId, action: 'skip', reason: 'extension_not_allowed' });
    return { action: 'skip', reason: 'extension_not_allowed' };
  }
  // 이미 들인 것 — 멱등
  const already = await File.findOne({ where: { business_id: businessId, external_id: driveId } });
  if (already) return { action: 'skip', reason: 'already_ingested' };

  // ① 범위 판정 — 이것이 격리 장치다. 밖이면 사유를 그대로 남긴다(대기와 고장을 구별).
  const anc = await resolveAncestry(drive, ctx, meta, cache);
  if (!anc.inRoot) {
    await log(businessId, { gdrive_file_id: driveId, action: 'skip', reason: anc.reason });
    return { action: 'skip', reason: anc.reason };
  }

  // ③~⑥ 쿼터·내려받기·dedup·행 생성·브로드캐스트·감사는 **공용 구현**이 한다.
  //   개인 Drive 첨부(POST /me/drive/import)도 같은 함수를 부른다 — 여기에 베껴 두면
  //   한쪽에만 쿼터나 감사 로그가 남는 날이 온다.
  const folderId = await ensureFolderChain(businessId, uploaderId, anc.chain, anc.folderId);
  const r = await importDriveFile(ctx, meta, { folderId, visibility: 'L3' });
  if (!r.ok) {
    await log(businessId, {
      gdrive_file_id: driveId, action: 'skip', reason: r.reason, detail: r.detail || null,
    });
    return { action: 'skip', reason: r.reason, blocked: !!r.blocked };
  }
  if (r.reason === 'already_ingested') return { action: 'skip', reason: 'already_ingested' };

  await log(businessId, {
    gdrive_file_id: driveId, file_id: r.file.id, action: 'ingest',
    detail: { folder_id: folderId, size: r.file.file_size },
  });
  return { action: 'ingest', fileId: r.file.id };
}

/** 여러 건. 쿼터가 차면 그 자리에서 멈춘다(⑤). */
async function ingestMany(ctx, metas) {
  const cache = newCache();
  const summary = { ingested: 0, skipped: 0, byReason: {}, blocked: false };
  for (const m of metas || []) {
    const r = await ingestOne(ctx, m, cache);
    if (r.action === 'ingest') summary.ingested += 1;
    else { summary.skipped += 1; summary.byReason[r.reason] = (summary.byReason[r.reason] || 0) + 1; }
    if (r.blocked) { summary.blocked = true; break; }
  }
  return summary;
}

module.exports = { ingestOne, ingestMany, ALLOWED_EXT, GOOGLE_NATIVE_PREFIX };
