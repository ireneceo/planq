// services/gdriveMirrorSync.js — **PlanQ 정본 미러 사본**의 Drive(파인더) 지우기·고치기를 PlanQ 에 반영한다.
//
// 설계 정본: docs/GDRIVE_FINDER_EDIT_SYNC_DESIGN.md §4 (Fable DESIGN-READY, 2026-11-18)
// > Irene: *"지금 구글드라이브에 파일이 올라가기만 하고 삭제도 수정도 해당 파인더에서 할 수가 없으니
//   사실 무용지물인 상태야."* → «지움은 PlanQ 휴지통까지만, 고침은 새 내용·옛 판 보관» (권고대로)
//
// 대상: `storage_provider='planq'` · origin NULL · `gdrive_mirror_id = 그 Drive 파일`. Drive 정본 분기는 gdriveApply 그대로.
//
// 지움 분기표(§4.1) — **처음 맞는 것**을 한다:
//   removed → unmirror · 산 행 0 → unmirror · 산 행 ≥2 또는 문서 본문 그림 → unmirror ·
//   폴더째 지움(explicitlyTrashed≠true) → 보류(trash_held) · 10분 100건 넘김 → 보류(trash_breaker) ·
//   md5 가 아는 값과 다름(고친 뒤 지움) → 고침 먼저, 실패면 보류(Drive 사본 안 지움) ·
//   그 밖(산 행 1 · 직접 지움 · md5 같음) → PlanQ 휴지통(trashFile) + Drive 사본 영구 삭제(커밋 뒤).
//
// 지키는 것 (9월 Fable 10차까지 깨진 자리):
//   · 잠금은 **자기 행 PK 하나**만. 형제 집합을 FOR UPDATE 하지 않는다(교착).
//   · Drive 호출은 **전부 트랜잭션 밖** — 내려받기는 앞, 사본 삭제는 커밋 뒤 요청 스코프 큐.
//   · 바이트는 제자리에 덮어쓰지 않는다(dedup 으로 다른 행이 같은 경로를 쓴다) — 항상 새 경로.
//   · NULL md5 를 «바뀜» 으로 읽지 않는다 — 로컬 바이트 md5 로 비교한다.
//   ★ PlanQ 에 파일 바이트를 고치는 길이 새로 생기면 충돌 판정(§4.2 B-7)을 다시 연다.
const fs = require('fs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { File, GdriveSyncLog, BusinessStorageUsage } = require('../models');

const TRASH_BREAKER_WINDOW_MS = 10 * 60 * 1000;
const TRASH_BREAKER_LIMIT = 100;
const OLD_VERSION_WINDOW_MS = 24 * 60 * 60 * 1000;
const RUN_MAX_DOWNLOADS = 20;
const RUN_MAX_BYTES = 500 * 1024 * 1024;

/**
 * 기능 전체 스위치 — GDRIVE_FINDER_SYNC=1 일 때만 미러 사본의 지움·고침을 반영한다. **기본 꺼짐.**
 * 2026-11-18 배포 준비 방: Fable 완료 검증(§4.6 실 Drive 양성 4 · 맥 실기기)이 dev Drive 재연결을 기다리는 동안
 *   운영에는 꺼진 채 나간다(메일 한국 중계와 같은 «꺼진 채 배포»). 꺼지면 종전 동작 그대로 —
 *   지움 = 미러 해제, 고침 = 무시(gdriveApply.isMirrorRowOf 가 false). 검증 PASS 뒤 운영 .env 에 GDRIVE_FINDER_SYNC=1.
 */
function finderSyncEnabled() {
  return String(process.env.GDRIVE_FINDER_SYNC || '') === '1';
}

/** 끄는 스위치(§4.6) — GDRIVE_FINDER_TRASH=0 이면 지움은 종전대로 미러 해제만. 기본 켬(위 전체 스위치가 켜졌을 때). */
function trashEnabled() {
  return String(process.env.GDRIVE_FINDER_TRASH || '1') !== '0';
}

async function log(businessId, row) {
  try { await GdriveSyncLog.create({ business_id: businessId, direction: 'drive_to_planq', ...row }); }
  catch (e) { console.warn('[gdriveMirrorSync] log 실패', e.message); }
}

function absPath(p) { return require('./gdriveMirror').absLocalPath({ file_path: p }); }

/** 문서 본문 그림 — 경로가 곧 본문 주소라 옮기거나 지우면 문서 그림이 404 (posts.js 쌍둥이와 같은 술어). */
function isEmbedded(file) {
  return String(file.file_path || '').replace(/\\/g, '/').includes('editor-images');
}

async function liveMirrorRows(businessId, driveId, t) {
  return File.findAll({
    where: { business_id: businessId, gdrive_mirror_id: driveId, deleted_at: null, storage_provider: 'planq' },
    order: [['id', 'ASC']],
    ...(t ? { transaction: t } : {}),
  });
}

/**
 * 증빙·스냅샷으로 묶인 파일인가 (§4.2 B-제외) — 내용이 바뀌면 «그때 보낸·서명한 것» 이 달라진다.
 *   청구서·회차 세금계산서/현금영수증 · 급여 명세서 · 서명 요청 첨부 스냅샷 · 메일 첨부(주고받은 기록) · 서명 완료 사본.
 *   새 증빙 표가 files.id 를 참조하면 여기에 한 줄 더한다.
 */
async function isEvidenceBound(fileId) {
  const q = async (sql) => {
    try {
      const [rows] = await sequelize.query(sql, { replacements: { id: fileId } });
      return rows.length > 0;
    } catch (e) {
      // 표가 없거나 칸이 없으면(옛 DB) «묶였다» 로 본다 — 틀려도 «반영 안 함» 쪽이 안전하다.
      console.warn('[gdriveMirrorSync] 증빙 확인 실패 — 반영하지 않는다', e.message);
      return true;
    }
  };
  const checks = [
    'SELECT 1 FROM invoices WHERE tax_invoice_file_id = :id OR cash_receipt_file_id = :id LIMIT 1',
    'SELECT 1 FROM invoice_installments WHERE tax_invoice_file_id = :id OR cash_receipt_file_id = :id LIMIT 1',
    'SELECT 1 FROM payroll_runs WHERE statement_file_id = :id LIMIT 1',
    'SELECT 1 FROM email_attachments WHERE file_id = :id LIMIT 1',
    "SELECT 1 FROM signature_requests WHERE JSON_CONTAINS(attachments_snapshot, JSON_OBJECT('file_id', :id)) LIMIT 1",
    // 서명 완료 문서 «파일로 저장» 사본(2026-11-27, services/signedPdfSave) — 서명본 증빙이라 Drive 고침을 덮어쓰지 않는다.
    "SELECT 1 FROM files WHERE id = :id AND source_key LIKE 'signed-post:%' LIMIT 1",
  ];
  for (const sql of checks) { if (await q(sql)) return true; }
  return false;
}

function md5OfFile(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(p).on('error', reject).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * «우리가 아는 그 사본의 md5» (§4.2 B-1). `drive_md5` 가 있으면 그것, 없으면(옛 미러) 로컬 바이트 md5.
 * 로컬 바이트가 없으면 null — 호출부가 `local_missing` 으로 멈춘다.
 */
async function knownMd5(file) {
  if (file.drive_md5) return file.drive_md5;
  const abs = absPath(file.file_path);
  if (!abs || !fs.existsSync(abs)) return null;
  return md5OfFile(abs);
}

async function setIssue(file, issue) {
  if ((file.drive_sync_issue || null) === (issue || null)) return;
  try { await File.update({ drive_sync_issue: issue || null }, { where: { id: file.id }, hooks: false }); file.drive_sync_issue = issue || null; }
  catch (e) { console.warn('[gdriveMirrorSync] 표시 기록 실패', file.id, e.message); }
}

/** Drive 이메일 → 이 워크스페이스 **활성 직원 멤버** user id. 아니면 null(바깥 사람 이메일은 어디에도 적지 않는다). */
async function memberIdByEmail(businessId, email) {
  if (!email) return null;
  try {
    const { User, BusinessMember } = require('../models');
    const u = await User.findOne({ where: { email: String(email).toLowerCase() }, attributes: ['id'] });
    if (!u) return null;
    const m = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: u.id, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
      attributes: ['user_id'],
    });
    return m ? u.id : null;
  } catch { return null; }
}

function broadcast(file, event) {
  try {
    const io = global.__planqIo || null;
    if (io) io.to(`business:${file.business_id}`).emit(event, { id: file.id, business_id: file.business_id, project_id: file.project_id || null });   // 신호만
  } catch { /* 방송 실패가 반영을 죽이지 않는다 */ }
}

function audit(action, file, actorId, newValue) {
  try {
    require('./auditService').createAuditLog({
      action, targetType: 'file', targetId: file.id, businessId: file.business_id, userId: actorId || null, newValue,
    });
  } catch { /* noop */ }
}

/** 올린 사람에게 묶어서 알릴 것을 담는다 — 한 번 적용에서 같은 사람에게 여러 건이면 한 장(§4.1). */
function queueNotice(ctx, kind, file, actorId) {
  if (!ctx || !ctx.notices) return;
  if (!file.uploader_id || (actorId && actorId === file.uploader_id)) return;
  const key = `${file.business_id}:${file.uploader_id}`;
  const n = ctx.notices.get(key) || { businessId: file.business_id, userId: file.uploader_id, trashed: [], edited: [] };
  n[kind].push(file.file_name);
  ctx.notices.set(key, n);
}

// ─────────────────────────────────────────────────────────────────────────────
// B. 고침
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 사본 내용이 바뀌었으면 새 바이트를 받아 산 행을 갱신하고 옛 판을 휴지통 행으로 남긴다.
 * @returns {{ok:boolean, action:string, reason?:string}} ok=true 면 «이제 PlanQ 가 Drive 와 같다»
 */
async function applyMirrorEdit(businessId, local, f, ctx, known) {
  const driveId = local.gdrive_mirror_id;
  const fail = async (reason, issue) => {
    if (issue) await setIssue(local, issue);
    await log(businessId, { gdrive_file_id: driveId, file_id: local.id, action: 'skip', reason });
    return { ok: false, action: 'skip', reason };
  };
  if (!f.md5Checksum) return fail('no_md5', null);
  if (known && f.md5Checksum === known) {
    // 같다 — 옛 미러는 기준값만 채운다(다음부터 계산하지 않게). 표시가 있었으면 지운다.
    if (!local.drive_md5 || local.drive_sync_issue) {
      await File.update({ drive_md5: known, ...(String(local.drive_sync_issue || '').startsWith('edit_') ? { drive_sync_issue: null } : {}) },
        { where: { id: local.id }, hooks: false });
    }
    return { ok: true, action: 'skip', reason: 'no_change' };
  }

  // 제외 — 쌍둥이·문서 그림·증빙
  const live = await liveMirrorRows(businessId, driveId);
  if (live.length >= 2) return fail('shared_mirror', 'edit_not_applied');
  if (isEmbedded(local)) return fail('embedded', 'edit_not_applied');
  if (await isEvidenceBound(local.id)) return fail('evidence', 'edit_not_applied');

  // 확장자·파일당 크기 (업로드와 같은 정책) — 확장자는 **지금 이름** 기준
  const di = require('./driveImport');
  if (!di.ALLOWED_EXT.has(di.extOf(local.file_name))) return fail('extension_not_allowed', 'edit_ext');
  const plan = require('./plan');
  const limits = await plan.getEffectiveLimits(businessId);
  const perFile = Number(limits.file_size_max_bytes) || Infinity;
  const metaSize = Number(f.size || 0);
  if (metaSize > perFile) return fail('file_size_exceeded', 'edit_too_large');

  // 한 번 적용의 내려받기 몫 — 넘으면 다시 시도 대상으로 남긴다(D-2 가 잇는다)
  const budget = ctx && ctx.budget;
  if (budget && (budget.count >= RUN_MAX_DOWNLOADS || budget.bytes + metaSize > RUN_MAX_BYTES)) {
    return fail('run_budget', 'edit_download_failed');
  }

  // ── 받기 (트랜잭션 밖) ──
  const temp = di.uploadPathFor(businessId);
  let gotMd5 = null; let gotSha = null; let gotSize = 0;
  try {
    const gdrive = require('./gdrive');
    const drive = ctx && ctx.drive ? ctx.drive : await gdrive.getDriveClient(await gdrive.getTokenForBusiness(businessId));
    const stream = await gdrive.getFileStream(drive, driveId);
    const hMd5 = crypto.createHash('md5'); const hSha = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(temp);
      let over = false;
      stream.on('data', (c) => {
        gotSize += c.length;
        if (gotSize > perFile && !over) { over = true; stream.destroy(new Error('too_large')); return; }
        hMd5.update(c); hSha.update(c);
      });
      stream.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      stream.pipe(out);
    });
    gotMd5 = hMd5.digest('hex'); gotSha = hSha.digest('hex');
    if (budget) { budget.count += 1; budget.bytes += gotSize; }
  } catch (e) {
    try { fs.unlinkSync(temp); } catch { /* noop */ }
    if (String(e.message) === 'too_large') return fail('file_size_exceeded', 'edit_too_large');
    console.warn('[gdriveMirrorSync] 내려받기 실패', local.id, e.message);
    return fail('download_failed', 'edit_download_failed');
  }
  if (gotMd5 !== f.md5Checksum) {
    // 받는 사이에 또 바뀌었다 — 버린다. 다음 변경이 다시 온다.
    try { fs.unlinkSync(temp); } catch { /* noop */ }
    return fail('changed_during_download', null);
  }

  // ── 반영 (한 트랜잭션, 자기 행 PK 만 잠근다) ──
  const t = await sequelize.transaction();
  let oldPath = null; let oldVersionId = null; let actorId = null; let row = null;
  try {
    row = await File.findOne({ where: { id: local.id }, lock: t.LOCK.UPDATE, transaction: t });
    if (!row || row.deleted_at || row.gdrive_mirror_id !== driveId || (row.drive_md5 || null) !== (local.drive_md5 || null)) {
      await t.rollback();
      try { fs.unlinkSync(temp); } catch { /* noop */ }
      return fail('row_changed', null);
    }
    // 쿼터 — 옛 바이트는 마지막 산 참조일 때만 빠진다, 새 바이트는 항상 새 경로라 더한다
    await BusinessStorageUsage.findOrCreate({
      where: { business_id: businessId },
      defaults: { business_id: businessId, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
      transaction: t,
    });
    const usage = await BusinessStorageUsage.findOne({ where: { business_id: businessId }, lock: t.LOCK.UPDATE, transaction: t });
    const oldLast = await require('./fileRefs').isLastLiveRef(row, t);
    const nextUsed = Number(usage.bytes_used) - (oldLast ? Number(row.file_size) : 0) + gotSize;
    const storageLimit = Number(limits.storage_bytes);
    if (Number.isFinite(storageLimit) && nextUsed > storageLimit) {
      await t.rollback();
      try { fs.unlinkSync(temp); } catch { /* noop */ }
      return fail('storage_quota_exceeded', 'edit_quota');
    }

    actorId = await memberIdByEmail(businessId, f.lastModifyingUser && f.lastModifyingUser.emailAddress);
    oldPath = row.file_path;

    // 옛 판 — 하루 1판으로 묶는다(휴지통 행은 쿼터 밖이라 저장마다 만들면 디스크가 끝없이 는다)
    const since = new Date(Date.now() - OLD_VERSION_WINDOW_MS);
    const recent = await GdriveSyncLog.findAll({
      where: { business_id: businessId, file_id: row.id, action: 'content', created_at: { [Op.gte]: since } },
      attributes: ['detail'], transaction: t,
    });
    const hasRecentVersion = recent.some((r) => r.detail && r.detail.old_version_file_id);
    if (!hasRecentVersion) {
      const { stampFor } = require('./retentionPolicy');
      const now = new Date();
      let purgeAfter = null;
      try { purgeAfter = await stampFor(businessId, 'trash', now); } catch { purgeAfter = null; }
      const old = await File.create({
        business_id: row.business_id,
        project_id: row.project_id,
        folder_id: row.folder_id,
        client_id: row.client_id,
        uploader_id: row.uploader_id,
        file_name: versionName(row.file_name, now),
        file_path: row.file_path,
        file_size: row.file_size,
        mime_type: row.mime_type,
        description: row.description,
        tags: row.tags,
        storage_provider: 'planq',
        content_hash: row.content_hash,
        ref_count: 1,
        visibility: row.visibility,
        vlevel: row.vlevel,
        target_member_ids: row.target_member_ids,
        security_level: row.security_level,
        deleted_at: now,
        deleted_by: actorId,
        deleted_via: 'gdrive_edit',
        purge_after: purgeAfter,
        // 승계하지 않는 것: gdrive_mirror_* · drive_md5 · share_* · external_* · origin_provider · 프로젝트 연결
      }, { transaction: t });
      oldVersionId = old.id;
    }

    await row.update({
      file_path: temp,
      file_size: gotSize,
      content_hash: gotSha,
      drive_md5: gotMd5,
      drive_sync_issue: null,
      // mime_type 은 그대로 — 이름(확장자)이 안 바뀌었고 Drive 가 말한 형식은 믿지 않는다(§4.2 B-2)
    }, { transaction: t, hooks: false });
    usage.bytes_used = Math.max(0, nextUsed);
    await usage.save({ transaction: t });
    await t.commit();
  } catch (e) {
    try { await t.rollback(); } catch { /* noop */ }
    try { fs.unlinkSync(temp); } catch { /* noop */ }
    console.warn('[gdriveMirrorSync] 고침 반영 실패', local.id, e.message);
    return fail('apply_error', 'edit_download_failed');
  }

  // ── 커밋 뒤 ──
  require('./plan').invalidateBusinessCache(businessId);
  if (!oldVersionId && oldPath) {
    // 옛 판을 안 만들었으면 중간 판 바이트는 아무도 안 쓰면 지운다
    try {
      const needed = await require('./fileRefs').bytesStillNeeded({ id: -1, file_path: oldPath, storage_provider: 'planq' }, null);
      if (!needed) { const a = absPath(oldPath); if (a && fs.existsSync(a)) fs.unlinkSync(a); }
    } catch (e) { console.warn('[gdriveMirrorSync] 중간 판 정리 실패', e.message); }
  }
  try {
    const fi = require('./fileIndex');
    await fi.removeFileIndex(row.id, businessId);
    fi.indexOnUpload(row.id);
  } catch { /* 색인 실패가 반영을 되돌리지 않는다 */ }
  broadcast(row, 'file:updated');
  await log(businessId, {
    gdrive_file_id: driveId, file_id: row.id, action: 'content',
    detail: { old_version_file_id: oldVersionId, size: gotSize, actor: actorId ? 'member' : 'external' },
  });
  audit('file.content_update', row, actorId, {
    via: 'gdrive', new_sha256: gotSha, new_size: gotSize, old_version_file_id: oldVersionId, shared: !!row.share_token,
  });
  queueNotice(ctx, 'edited', row, actorId);
  return { ok: true, action: 'content' };
}

function versionName(name, at) {
  const s = String(name || 'file');
  const i = s.lastIndexOf('.');
  const pad = (n) => String(n).padStart(2, '0');
  // 서버 시각이 아니라 한국 시각으로 적는다 — 사용자 대부분이 보는 시각
  const k = new Date(at.getTime() + 9 * 3600 * 1000);
  const stamp = `${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
  const label = `(이전 판 ${stamp})`;
  const out = i > 0 ? `${s.slice(0, i)} ${label}${s.slice(i)}` : `${s} ${label}`;
  return out.slice(0, 255);
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 지움
// ─────────────────────────────────────────────────────────────────────────────

/** 기존 동작 — 사본만 사라진 것으로 보고 포인터를 비운다(PlanQ 원본 보존). gdriveApply 의 옛 분기와 같은 일. */
async function unmirror(businessId, local, reason) {
  if (!local.gdrive_mirror_id) return { action: 'skip', reason: 'no_change' };
  const mirrorId = local.gdrive_mirror_id;
  await File.update(
    { gdrive_mirror_id: null, gdrive_mirror_url: null, drive_sync_issue: null },
    { where: { business_id: businessId, gdrive_mirror_id: mirrorId }, paranoid: false },
  );
  await log(businessId, {
    gdrive_file_id: mirrorId, file_id: local.id, action: 'unmirror',
    detail: { note: 'Drive 사본이 삭제됨 — PlanQ 원본은 보존', reason: reason || null },
  });
  return { action: 'unmirror' };
}

async function hold(businessId, local, reason) {
  await setIssue(local, 'trash_held');
  await log(businessId, { gdrive_file_id: local.gdrive_mirror_id, file_id: local.id, action: 'skip', reason });
  return { action: 'skip', reason };
}

async function breakerTripped(businessId) {
  const since = new Date(Date.now() - TRASH_BREAKER_WINDOW_MS);
  const n = await GdriveSyncLog.count({ where: { business_id: businessId, action: 'trash', created_at: { [Op.gte]: since } } });
  return n >= TRASH_BREAKER_LIMIT;
}

/**
 * 미러 사본이 지워졌다(`trashed` 또는 `removed`).
 * @param local 그 Drive id 를 가리키는 행(산 행 우선 — gdriveApply.findLocal)
 */
async function applyMirrorDelete(businessId, local, change, ctx) {
  const f = change.file || {};
  if (change.removed) return unmirror(businessId, local, 'removed');            // A-4 — 접근 상실과 못 가른다
  if (local.deleted_at) return unmirror(businessId, local, 'already_trashed');  // 산 행 0 — 종전 그대로
  if (!trashEnabled()) return unmirror(businessId, local, 'switch_off');

  const live = await liveMirrorRows(businessId, local.gdrive_mirror_id);
  if (live.length === 0) return unmirror(businessId, local, 'no_live_row');
  if (live.length >= 2) return unmirror(businessId, local, 'shared_mirror');  // A-6
  if (isEmbedded(local)) return unmirror(businessId, local, 'embedded');      // A-6

  if (f.explicitlyTrashed !== true) return hold(businessId, local, 'trash_held');   // A-5a 폴더째
  if (await breakerTripped(businessId)) {                                            // A-5b
    if (ctx) ctx.breaker = (ctx.breaker || 0) + 1;
    return hold(businessId, local, 'trash_breaker');
  }

  // A-3x — 고친 뒤 지움: 먼저 새 내용을 받는다. 못 받으면 보류(Drive 사본은 우리가 안 받은 바이트의 유일본)
  const known = await knownMd5(local);
  if (!known) return hold(businessId, local, 'local_missing');
  if (!f.md5Checksum || f.md5Checksum !== known) {
    const r = await applyMirrorEdit(businessId, local, f, ctx, known);
    if (!r.ok || r.action !== 'content') {
      // 고침이 반영되지 않았으면 지우지 않는다 — 고침 쪽이 남긴 표시(edit_*)를 그대로 둔다
      await log(businessId, { gdrive_file_id: local.gdrive_mirror_id, file_id: local.id, action: 'skip', reason: 'trash_after_edit_held' });
      return { action: 'skip', reason: 'trash_after_edit_held' };
    }
    await local.reload();
  }

  // A-3 — PlanQ 휴지통 + Drive 사본 영구 삭제(커밋 뒤)
  const deletedBy = await memberIdByEmail(businessId, f.trashingUser && f.trashingUser.emailAddress);
  const filesRoute = require('../routes/files');
  const t = await sequelize.transaction();
  const mq = [];
  let row = null;
  try {
    row = await File.findOne({ where: { id: local.id }, lock: t.LOCK.UPDATE, transaction: t });
    if (!row || row.deleted_at || row.gdrive_mirror_id !== local.gdrive_mirror_id) {
      await t.rollback();
      return { action: 'skip', reason: 'row_changed' };
    }
    row.deleted_via = 'gdrive';
    row.drive_sync_issue = null;
    await filesRoute.trashFile(row, { user: { id: deletedBy } }, t, mq);
    await t.commit();
  } catch (e) {
    try { await t.rollback(); } catch { /* noop */ }
    console.warn('[gdriveMirrorSync] 휴지통 반영 실패', local.id, e.message);
    await log(businessId, { gdrive_file_id: local.gdrive_mirror_id, file_id: local.id, action: 'skip', reason: 'error', detail: { message: String(e.message).slice(0, 200) } });
    return { action: 'skip', reason: 'error' };
  }
  const driveId = local.gdrive_mirror_id;
  await filesRoute.flushMirrorRecalls(mq);   // ★ 커밋 **뒤** — 되돌릴 수 없는 외부 호출
  broadcast(row, 'file:deleted');
  await log(businessId, { gdrive_file_id: driveId, file_id: row.id, action: 'trash', detail: { via: 'gdrive', actor: deletedBy ? 'member' : 'external' } });
  audit('file.delete', row, deletedBy, { via: 'gdrive', file_name: row.file_name });
  queueNotice(ctx, 'trashed', row, deletedBy);
  return { action: 'trash' };
}

/** Drive 에서 되살렸다(`trashed=false`) — 보류 표시만 지운다(행·포인터는 그대로였다). */
async function clearHeldIfRestored(local, f) {
  if (local.drive_sync_issue === 'trash_held' && f && f.trashed === false) await setIssue(local, null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 알림 — 앱 안만(메일·푸시 없음), 한 번 적용에서 사람마다 한 장
// ─────────────────────────────────────────────────────────────────────────────
async function flushNotices(ctx) {
  if (!ctx) return;
  const { notify } = require('../routes/notifications');
  const list = (arr, lang) => {
    const head = arr.slice(0, 3).join(', ');
    const more = arr.length > 3 ? (lang === 'en' ? ` and ${arr.length - 3} more` : ` 외 ${arr.length - 3}개`) : '';
    return head + more;
  };
  for (const n of (ctx.notices ? ctx.notices.values() : [])) {
    try {
      if (n.trashed.length) {
        await notify({
          userId: n.userId, businessId: n.businessId, eventKind: 'system',
          title: (lang) => (lang === 'en' ? 'Deleted in Google Drive — moved to Trash' : 'Google Drive 에서 지워져 휴지통으로 옮겼어요'),
          body: (lang) => (lang === 'en'
            ? `${list(n.trashed, lang)}. You can restore from Trash in PlanQ.`
            : `${list(n.trashed, lang)} — PlanQ 휴지통에서 되살릴 수 있어요.`),
          link: '/files', entityType: 'file', skipChannels: ['email', 'push'], suppressEscalation: true,
        });
      }
      if (n.edited.length) {
        await notify({
          userId: n.userId, businessId: n.businessId, eventKind: 'system',
          title: (lang) => (lang === 'en' ? 'Edited in Google Drive — updated in PlanQ' : 'Google Drive 에서 고친 내용이 반영됐어요'),
          body: (lang) => (lang === 'en'
            ? `${list(n.edited, lang)}. The previous version is kept in Trash.`
            : `${list(n.edited, lang)} — 이전 판은 휴지통에 보관했어요.`),
          link: '/files', entityType: 'file', skipChannels: ['email', 'push'], suppressEscalation: true,
        });
      }
    } catch (e) { console.warn('[gdriveMirrorSync] 알림 실패', e.message); }
  }
  if (ctx.breaker && ctx.businessId) {
    try {
      const { Business } = require('../models');
      const biz = await Business.findByPk(ctx.businessId, { attributes: ['owner_id'] });
      if (biz && biz.owner_id) {
        await notify({
          userId: biz.owner_id, businessId: ctx.businessId, eventKind: 'system',
          title: (lang) => (lang === 'en' ? 'Many files deleted in Google Drive — held' : 'Google Drive 에서 파일이 한꺼번에 많이 지워져 멈췄어요'),
          body: (lang) => (lang === 'en'
            ? `${ctx.breaker} file(s) were not moved to Trash in PlanQ. They stay as they are; check Google Drive.`
            : `${ctx.breaker}개는 PlanQ 휴지통으로 옮기지 않고 그대로 두었어요. Google Drive 를 확인해 주세요.`),
          link: '/files', entityType: 'file', skipChannels: ['email', 'push'], suppressEscalation: true,
        });
      }
    } catch (e) { console.warn('[gdriveMirrorSync] 대량 보류 알림 실패', e.message); }
  }
}

function newRunCtx(businessId, drive) {
  return { businessId, drive: drive || null, notices: new Map(), budget: { count: 0, bytes: 0 }, breaker: 0 };
}

module.exports = {
  applyMirrorDelete, applyMirrorEdit, clearHeldIfRestored, knownMd5, flushNotices, newRunCtx,
  isEvidenceBound, isEmbedded, versionName, trashEnabled, finderSyncEnabled,
  _limits: { TRASH_BREAKER_LIMIT, TRASH_BREAKER_WINDOW_MS, RUN_MAX_DOWNLOADS },
};
