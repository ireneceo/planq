// services/driveImport.js — Google Drive 파일 하나를 PlanQ File 로 들이는 **단일 구현**.
//
// 두 진입점이 이 함수를 같이 쓴다:
//   ① 워크스페이스 Drive 미러 (services/gdriveIngest.ingestOne) — 자동 동기화
//   ② 개인 Drive 에서 골라 첨부 (routes/external_connections POST /me/drive/import) — 사용자가 고름
// 베껴 두면 반드시 갈라진다(쿼터·dedup·감사·브로드캐스트가 한쪽에만 남는다).
//
// 여기가 책임지는 것: 확장자·네이티브 문서 차단 · 쿼터(사전 + 커밋 시점 재검증) ·
//   내려받기 · sha256 dedup · File 행 생성 · 사용량 갱신 · 실시간 브로드캐스트 · 감사 로그.
// 여기가 **책임지지 않는** 것: 어느 폴더에 넣을지(호출자가 정한다), 범위 판정(미러의 root 게이트).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gdrive = require('./gdrive');
const planEngine = require('./plan');
const { sequelize } = require('../config/database');
const { File, BusinessStorageUsage } = require('../models');
const { sha256OfFile } = require('../utils/fileHash');   // 해시 규칙 단일 원천 — 여기서 다시 짜면 dedup 이 조용히 안 걸린다

// CLAUDE.md "파일 저장 — 허용 확장자" 정본. **여기 하나뿐이다** — 목록이 두 벌이 되면
//   같은 파일이 경로에 따라 되기도 하고 안 되기도 한다.
const ALLOWED_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx',
  'ppt', 'pptx', 'zip', 'txt',
]);
const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';

function extOf(name) {
  const i = String(name || '').lastIndexOf('.');
  return i < 0 ? '' : String(name).slice(i + 1).toLowerCase();
}

function uploadPathFor(businessId) {
  const ym = new Date().toISOString().slice(0, 7);
  const dir = path.join(__dirname, '..', 'uploads', String(businessId), ym);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, crypto.randomUUID());
}

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

/** 들일 수 있는 파일인가 — 내려받기 **전에** 판정한다(큰 파일을 받아놓고 버리지 않게). */
function checkEligible(meta) {
  if (!meta || !meta.id) return { ok: false, reason: 'no_file_id' };
  // Google 네이티브 문서(문서·스프레드시트)는 원본 바이트가 없다.
  if (String(meta.mimeType || '').startsWith(GOOGLE_NATIVE_PREFIX)) {
    return { ok: false, reason: 'google_native' };
  }
  if (!ALLOWED_EXT.has(extOf(meta.name))) return { ok: false, reason: 'extension_not_allowed' };
  return { ok: true };
}

/**
 * Drive 파일 하나를 PlanQ 로 들인다.
 * @param ctx { drive, businessId, uploaderId }
 * @param meta Drive files.get 응답 (id·name·mimeType·size·webViewLink·md5Checksum)
 * @param opts { folderId, projectId, visibility }
 * @returns {{ ok:boolean, reason?:string, blocked?:boolean, file?:object }}
 *   blocked=true → 저장공간이 찼다. 배치라면 그 자리에서 멈춰야 한다.
 */
async function importDriveFile(ctx, meta, opts = {}) {
  const { drive, businessId, uploaderId } = ctx;
  const folderId = opts.folderId ?? null;
  const projectId = opts.projectId ?? null;
  // 미러가 들이는 것은 워크스페이스 공용(L3). 사용자가 첨부하려고 고른 것도 파일함에 남으므로
  //   같은 기본값을 쓴다 — 호출자가 좁히고 싶으면 명시한다.
  const visibility = opts.visibility || 'L3';

  const eligible = checkEligible(meta);
  if (!eligible.ok) return { ok: false, reason: eligible.reason };

  const driveId = meta.id;
  // 멱등 — 같은 Drive 파일을 두 번 들이지 않는다.
  //   ★ 개인(L1) 파일은 **업로더까지** 키에 넣는다. 안 그러면 같은 Drive 파일을 다른 사람이 들일 때
  //     남의 개인 파일 행을 그대로 돌려준다(Fable 사후 감사 2026-09-07 실측).
  //     공용(L2·L3)은 워크스페이스 자산이라 한 벌이면 된다 — 종전대로.
  const already = await File.findOne({
    where: {
      business_id: businessId, external_id: driveId, deleted_at: null,
      ...(visibility === 'L1' ? { uploader_id: uploaderId } : {}),
    },
  });
  if (already) return { ok: true, reason: 'already_ingested', file: already };

  const size = Number(meta.size || 0);
  const gate = await planEngine.can(businessId, 'upload_file', { size, external: false });
  if (!gate.ok) {
    return {
      ok: false, reason: gate.reason,
      blocked: gate.reason === 'storage_quota_exceeded',
      detail: { limit: gate.limit, current: gate.current, size },
    };
  }

  let temp = uploadPathFor(businessId);
  try {
    await downloadTo(drive, driveId, temp);
  } catch (e) {
    try { fs.unlinkSync(temp); } catch { /* noop */ }
    return { ok: false, reason: 'download_failed', detail: { message: String(e.message).slice(0, 200) } };
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

    // 커밋 시점 재검증 — 메타 크기와 실제 크기가 다를 수 있고, 그 사이 다른 업로드가 있었을 수 있다.
    const limit = await planEngine.getLimit(businessId, 'storage_bytes');
    if (limit !== Infinity && Number(usage.bytes_used) + actualSize > limit) {
      await t.rollback();
      try { fs.unlinkSync(temp); } catch { /* noop */ }
      return {
        ok: false, reason: 'storage_quota_exceeded', blocked: true,
        detail: { limit, current: Number(usage.bytes_used), size: actualSize, at: 'commit' },
      };
    }

    // dedup — 같은 바이트가 이미 있으면 물리 파일은 하나만 둔다(자체 업로드와 같은 규칙).
    const existing = await File.findOne({
      where: { business_id: businessId, content_hash: hash, deleted_at: null }, transaction: t,
    });

    const row = {
      business_id: businessId,
      project_id: projectId,
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
      content_hash: hash,
      ref_count: 1,
      // 권위 컬럼 동시 기록 — 한쪽만 쓰면 default 로 새어 전 멤버에게 노출된다.
      visibility,
      vlevel: visibility,
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
    return { ok: false, reason: 'ingest_error', detail: { message: String(e.message).slice(0, 200) } };
  }

  planEngine.invalidateBusinessCache(businessId);

  // 실시간 반영 (CLAUDE.md 운영 규칙 16)
  try {
    const io = global.__planqIo || null;
    if (io) io.to(`business:${businessId}`).emit('file:new', created.toJSON());
  } catch { /* 브로드캐스트 실패가 인제스트를 죽이면 안 된다 */ }

  // 들여온 파일도 업로드와 똑같이 본문을 색인한다 — 경로에 따라 Cue 가 아는 파일과
  //   모르는 파일이 갈리면 사용자는 "어떤 건 알고 어떤 건 모른다" 로 겪는다.
  require('./fileIndex').indexOnUpload(created.id);

  require('./auditService').createAuditLog({
    action: 'file.ingest', targetType: 'file', targetId: created.id,
    businessId, userId: uploaderId,
    newValue: { source: 'gdrive', gdrive_file_id: driveId, actor: opts.actor || 'integration' },
  });

  return { ok: true, file: created };
}

module.exports = { importDriveFile, checkEligible, ALLOWED_EXT, GOOGLE_NATIVE_PREFIX };
