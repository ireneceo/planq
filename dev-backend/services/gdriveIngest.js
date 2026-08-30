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
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sequelize } = require('../config/database');
const { File, BusinessStorageUsage, GdriveSyncLog } = require('../models');
const planEngine = require('./plan');
const gdrive = require('./gdrive');
const { resolveAncestry, ensureFolderChain, newCache } = require('./gdriveTree');

// CLAUDE.md 파일 저장 정책의 허용 확장자. Drive 엔 무엇이든 있으므로 같은 문을 통과시킨다.
const ALLOWED_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'ppt', 'pptx', 'zip', 'txt',
]);
const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';

function extOf(name) {
  const e = path.extname(String(name || '')).replace('.', '').toLowerCase();
  return e;
}

async function log(businessId, row) {
  try { await GdriveSyncLog.create({ business_id: businessId, direction: 'drive_to_planq', ...row }); }
  catch (e) { console.warn('[gdriveIngest] log 실패', e.message); }
}

function uploadPathFor(businessId) {
  const ym = new Date().toISOString().slice(0, 7);
  const dir = path.join(__dirname, '..', 'uploads', String(businessId), ym);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, crypto.randomUUID());
}

const { sha256OfFile } = require('../utils/fileHash');   // 해시 규칙 단일 원천

async function downloadTo(drive, fileId, dest) {
  const stream = await gdrive.getFileStream(drive, fileId);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    stream.pipe(out);
  });
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

  // ③ 쿼터 — 내려받기 **전에** 메타의 크기로 먼저 본다. 큰 파일을 받아놓고 버리지 않게.
  const size = Number(meta.size || 0);
  const gate = await planEngine.can(businessId, 'upload_file', { size, external: false });
  if (!gate.ok) {
    await log(businessId, {
      gdrive_file_id: driveId, action: 'skip', reason: gate.reason,
      detail: { limit: gate.limit, current: gate.current, size },
    });
    // ⑤ 저장공간이 찼으면 배치를 멈춘다. 파일 크기 초과는 그 파일만의 문제라 계속 간다.
    return { action: 'skip', reason: gate.reason, blocked: gate.reason === 'storage_quota_exceeded' };
  }

  // 폴더 체인 확보 (root 하위의 중간 폴더들을 PlanQ 에도 만든다)
  const folderId = await ensureFolderChain(businessId, uploaderId, anc.chain, anc.folderId);

  // 바이트 내려받기
  let temp = uploadPathFor(businessId);
  try {
    await downloadTo(drive, driveId, temp);
  } catch (e) {
    try { fs.unlinkSync(temp); } catch { /* noop */ }
    await log(businessId, { gdrive_file_id: driveId, action: 'skip', reason: 'download_failed', detail: { message: String(e.message).slice(0, 200) } });
    return { action: 'skip', reason: 'download_failed' };
  }
  const actualSize = fs.statSync(temp).size;
  const hash = await sha256OfFile(temp);

  const t = await sequelize.transaction();
  let created = null;
  try {
    await BusinessStorageUsage.findOrCreate({
      where: { business_id: businessId },
      defaults: { business_id: businessId, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
      transaction: t,
    });
    const usage = await BusinessStorageUsage.findOne({
      where: { business_id: businessId }, lock: t.LOCK.UPDATE, transaction: t,
    });

    // ③ 커밋 시점 재검증 — 메타 크기와 실제 크기가 다를 수 있고, 그 사이 다른 업로드가 있었을 수 있다.
    const limit = await planEngine.getLimit(businessId, 'storage_bytes');
    if (limit !== Infinity && Number(usage.bytes_used) + actualSize > limit) {
      await t.rollback();
      fs.unlinkSync(temp);
      await log(businessId, {
        gdrive_file_id: driveId, action: 'skip', reason: 'storage_quota_exceeded',
        detail: { limit, current: Number(usage.bytes_used), size: actualSize, at: 'commit' },
      });
      return { action: 'skip', reason: 'storage_quota_exceeded', blocked: true };
    }

    // dedup — 같은 바이트가 이미 있으면 물리 파일은 하나만 둔다(자체 업로드와 같은 규칙).
    const existing = await File.findOne({
      where: { business_id: businessId, content_hash: hash, deleted_at: null }, transaction: t,
    });

    const row = {
      business_id: businessId,
      folder_id: folderId,
      uploader_id: uploaderId,
      file_name: String(meta.name).slice(0, 255),
      file_size: actualSize,
      mime_type: meta.mimeType || 'application/octet-stream',
      storage_provider: 'planq',        // 서빙 축 — 바이트는 우리가 가진다
      origin_provider: 'gdrive',        // 정본 축 — 변경의 진실은 Drive 에 있다
      external_id: driveId,
      external_url: meta.webViewLink || null,
      drive_md5: meta.md5Checksum || null,
      content_hash: hash,               // sha256 전용 축
      ref_count: 1,
      // ⑥ 권위 컬럼 동시 기록 — 한쪽만 쓰면 default 로 새어 전 멤버에게 노출된다.
      visibility: 'L3',
      vlevel: 'L3',
      security_level: 'general',
    };

    if (existing) {
      fs.unlinkSync(temp);
      await existing.increment('ref_count', { transaction: t });
      created = await File.create({ ...row, file_path: existing.file_path }, { transaction: t });
      // 물리 바이트가 늘지 않았으므로 쿼터도 증가시키지 않는다.
    } else {
      created = await File.create({ ...row, file_path: temp }, { transaction: t });
      usage.bytes_used = Number(usage.bytes_used) + actualSize;
      usage.file_count += 1;
      await usage.save({ transaction: t });
    }
    await t.commit();
    temp = null;
  } catch (e) {
    try { await t.rollback(); } catch { /* noop */ }
    if (temp) { try { fs.unlinkSync(temp); } catch { /* noop */ } }
    await log(businessId, { gdrive_file_id: driveId, action: 'skip', reason: 'ingest_error', detail: { message: String(e.message).slice(0, 200) } });
    return { action: 'skip', reason: 'ingest_error' };
  }

  planEngine.invalidateBusinessCache(businessId);
  await log(businessId, { gdrive_file_id: driveId, file_id: created.id, action: 'ingest', detail: { folder_id: folderId, size: actualSize } });

  // 실시간 반영 (CLAUDE.md 운영 규칙 16) — 요청 컨텍스트가 없으므로 전역 io 핸들을 쓴다.
  try {
    const io = global.__planqIo || null;
    if (io) io.to(`business:${businessId}`).emit('file:new', created.toJSON());
  } catch { /* 브로드캐스트 실패가 인제스트를 죽이면 안 된다 */ }

  // 감사 — 주체가 사람이 아니라 연동임을 남긴다.
  //   ★ 요청 컨텍스트가 없으므로 req 를 받는 logAudit 가 아니라 createAuditLog 를 쓴다
  //     (없는 함수를 부르면 catch 가 삼켜 감사 로그가 조용히 0건이 된다).
  require('./auditService').createAuditLog({
    action: 'file.ingest', targetType: 'file', targetId: created.id,
    businessId, userId: uploaderId,
    newValue: { source: 'gdrive', gdrive_file_id: driveId, actor: 'integration' },
  });

  return { action: 'ingest', fileId: created.id };
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
