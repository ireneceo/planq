// #63 Phase 3 — 자료 이동/내보내기 비동기 워커.
// export_jobs 를 cron 으로 드레인: transfer(이동/복사) · export(다운로드 zip).
// 본인 L1 파일 + 본인 문서 + (옵션) 본인 Q Note 세션(요약+전사 → 문서).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { ExportJob, File, Document, BusinessStorageUsage } = require('../models');
const exportRoutes = require('../routes/export');
const notifications = require('../routes/notifications');

const UPLOAD_DIR = exportRoutes.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const EXPORT_DIR = path.join(UPLOAD_DIR, 'exports');
const MAX_ATTEMPTS = 3;
const MAX_ITEMS = 5000; // 안전 상한
const QNOTE_BASE = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
const DOWNLOAD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

// ─── Q Note 본인 세션 fetch (내부 API, 사적 공간 — user_id 본인만) ───
async function fetchQnoteSessions(businessId, userId) {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) return [];
  try {
    const r = await fetch(
      `${QNOTE_BASE}/api/sessions/internal/export?business_id=${businessId}&user_id=${userId}`,
      { headers: { 'x-internal-api-key': key }, signal: AbortSignal.timeout(20000) },
    );
    if (!r.ok) { console.warn('[exportWorker] qnote', r.status); return []; }
    const j = await r.json();
    return Array.isArray(j.data) ? j.data : [];
  } catch (e) { console.warn('[exportWorker] qnote fetch', e.message); return []; }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Q Note 세션 → 문서 본문(HTML). 요약 + 핵심포인트 + 메모 + 전사.
function qnoteSessionToHtml(s) {
  const parts = [`<h1>${esc(s.title)}</h1>`];
  if (s.summary_full) parts.push(`<h2>요약</h2><p>${esc(s.summary_full).replace(/\n/g, '<br>')}</p>`);
  if (Array.isArray(s.summary_key_points) && s.summary_key_points.length) {
    parts.push('<h2>핵심 포인트</h2><ul>' + s.summary_key_points.map(p => `<li>${esc(p)}</li>`).join('') + '</ul>');
  }
  if (s.body) parts.push(`<h2>메모</h2><p>${esc(s.body).replace(/\n/g, '<br>')}</p>`);
  if (s.transcript_text) parts.push(`<h2>전사</h2><pre style="white-space:pre-wrap">${esc(s.transcript_text)}</pre>`);
  return parts.join('\n');
}

// ─── 파일 1건 타겟 복사 (Phase 2 dedup 로직 — content_hash 공유/물리복사) ───
//  반환: 'copied' | 'skipped'. bytesAdded 는 caller 가 누적.
async function copyFileToTarget(f, targetBiz, userId) {
  if (!f.content_hash) return { status: 'skipped' };
  const mine = await File.findOne({
    where: { business_id: targetBiz, content_hash: f.content_hash, uploader_id: userId, deleted_at: null },
  });
  if (mine) return { status: 'skipped' };
  const existing = await File.findOne({
    where: { business_id: targetBiz, content_hash: f.content_hash, deleted_at: null },
  });
  if (existing) {
    await existing.increment('ref_count');
    await File.create({
      business_id: targetBiz, uploader_id: userId,
      file_name: f.file_name, file_path: existing.file_path, file_size: f.file_size,
      mime_type: f.mime_type, storage_provider: 'planq', content_hash: f.content_hash,
      ref_count: 1, visibility: 'L1', vlevel: 'L1', security_level: f.security_level,
    });
    return { status: 'copied', bytes: 0 };
  }
  if (!f.file_path || !fs.existsSync(f.file_path)) return { status: 'skipped' };
  const dir = path.join(UPLOAD_DIR, String(targetBiz), new Date().toISOString().slice(0, 7));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const newPath = path.join(dir, crypto.randomUUID() + path.extname(f.file_path));
  fs.copyFileSync(f.file_path, newPath);
  await File.create({
    business_id: targetBiz, uploader_id: userId,
    file_name: f.file_name, file_path: newPath, file_size: f.file_size,
    mime_type: f.mime_type, storage_provider: 'planq', content_hash: f.content_hash,
    ref_count: 1, visibility: 'L1', vlevel: 'L1', security_level: f.security_level,
  });
  return { status: 'copied', bytes: Number(f.file_size) || 0 };
}

// ─── 원본 파일 soft delete (move 모드) — 복사 성공 후에만 호출 ───
async function softDeleteSourceFile(f) {
  // ref_count 감소 — 0 도달 시 물리 파일 제거(다른 ref 없을 때)
  await f.update({ deleted_at: new Date() });
  if (f.content_hash) {
    const sibling = await File.findOne({
      where: { content_hash: f.content_hash, deleted_at: null, id: { [Op.ne]: f.id } },
    });
    if (!sibling && f.file_path && fs.existsSync(f.file_path)) {
      try { fs.unlinkSync(f.file_path); } catch { /* best-effort */ }
    }
  }
}

// ─── transfer 처리 (copy/move + qnote) ───
async function processTransfer(job) {
  const { files, docs } = await exportRoutes.collectSelf(job.business_id, job.user_id);
  const targetBiz = job.target_business_id;
  let filesCopied = 0, docsCopied = 0, qnoteCopied = 0, filesRemoved = 0, docsRemoved = 0, skipped = 0, bytesAdded = 0;

  // 파일 복사 (+ move 면 원본 정리)
  for (const f of files.slice(0, MAX_ITEMS)) {
    const r = await copyFileToTarget(f, targetBiz, job.user_id);
    if (r.status === 'copied') {
      filesCopied++; bytesAdded += r.bytes || 0;
      if (job.mode === 'move') { await softDeleteSourceFile(f); filesRemoved++; }
    } else {
      skipped++;
      // 이미 타겟에 존재(중복)면 move 시 원본은 제거 (사용자 의도 = 출발지 비우기)
      if (job.mode === 'move') { await softDeleteSourceFile(f); filesRemoved++; }
    }
  }

  // 문서 복사 (+ move 면 원본 soft delete)
  for (const d of docs.slice(0, MAX_ITEMS)) {
    await Document.create({
      business_id: targetBiz, created_by: job.user_id,
      kind: d.kind, title: d.title, body_json: d.body_json, body_html: d.body_html,
      security_level: d.security_level, status: 'draft',
    });
    docsCopied++;
    // Document 는 soft-delete(deleted_at) 미지원 → move 시 원본을 archived 처리 (활성 목록에서 제거, 비파괴).
    if (job.mode === 'move') { await d.update({ status: 'archived', archived_at: new Date() }).catch(() => {}); docsRemoved++; }
  }

  // Q Note 세션 → 문서 (복사만 — 원본 qnote 는 사적 공간이라 move 대상 아님)
  if (job.include_qnote) {
    const sessions = await fetchQnoteSessions(job.business_id, job.user_id);
    for (const s of sessions.slice(0, MAX_ITEMS)) {
      await Document.create({
        business_id: targetBiz, created_by: job.user_id,
        kind: 'meeting_note', title: s.title || 'Q Note',
        body_html: qnoteSessionToHtml(s), status: 'draft',
      });
      qnoteCopied++;
    }
  }

  // 타겟 스토리지 사용량 갱신
  if (bytesAdded > 0) {
    const [usage] = await BusinessStorageUsage.findOrCreate({
      where: { business_id: targetBiz, storage_provider: 'planq' },
      defaults: { business_id: targetBiz, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
    });
    await usage.update({ bytes_used: Number(usage.bytes_used) + bytesAdded, file_count: usage.file_count + filesCopied });
  }

  return { files_copied: filesCopied, documents_copied: docsCopied, qnote_copied: qnoteCopied,
    files_removed: filesRemoved, documents_removed: docsRemoved, skipped, bytes: bytesAdded };
}

// ─── export 처리 (다운로드 zip 생성 → 파일 저장 + 토큰) ───
async function processExport(job) {
  const archiver = require('archiver');
  const { files, docs } = await exportRoutes.collectSelf(job.business_id, job.user_id);
  let qnoteDocs = [];
  if (job.include_qnote) {
    const sessions = await fetchQnoteSessions(job.business_id, job.user_id);
    qnoteDocs = sessions.slice(0, MAX_ITEMS).map(s => ({ title: `[Q Note] ${s.title || ''}`, body_html: qnoteSessionToHtml(s), security_level: 'general' }));
  }
  if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const token = crypto.randomBytes(24).toString('hex');
  const zipPath = path.join(EXPORT_DIR, `export-${job.id}-${token}.zip`);

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 6 } });
    out.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(out);
    const manifest = { exported_at: new Date().toISOString(), files: [], documents: [] };
    const used = new Map();
    const uniq = (m, n) => { let x = n, i = 1; while (m.has(x)) { x = n.replace(/(\.[^.]+)?$/, `_${i++}$1`); } m.set(x, 1); return x; };
    for (const f of files.slice(0, MAX_ITEMS)) {
      if (!f.file_path || !fs.existsSync(f.file_path)) continue;
      const name = uniq(used, f.file_name || `file-${f.id}`);
      archive.file(f.file_path, { name: `files/${name}` });
      manifest.files.push({ name, size: Number(f.file_size) || 0 });
    }
    const usedDocs = new Map();
    for (const d of [...docs, ...qnoteDocs].slice(0, MAX_ITEMS)) {
      const safe = String(d.title || 'untitled').replace(/[\/\\:*?"<>|\n\r]/g, '_').slice(0, 120) || 'untitled';
      const name = uniq(usedDocs, `${safe}.html`);
      archive.append(exportRoutes.renderDocHtml(d), { name: `documents/${name}` });
      manifest.documents.push({ title: d.title });
    }
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.finalize();
  });

  const stat = fs.statSync(zipPath);
  await job.update({
    download_path: zipPath, download_token: token,
    expires_at: new Date(Date.now() + DOWNLOAD_TTL_MS),
  });
  return { files: files.length, documents: docs.length + qnoteDocs.length, qnote_copied: qnoteDocs.length, bytes: stat.size };
}

// ─── 완료 알림 ───
async function notifyDone(job, ok) {
  try {
    const link = '/settings/data-export';
    if (job.kind === 'transfer') {
      await notifications.notify({
        userId: job.user_id, businessId: job.business_id, eventKind: 'feedback',
        title: ok ? '자료 이동 완료' : '자료 이동 실패',
        body: ok ? `파일 ${job.result?.files_copied || 0}건·문서 ${(job.result?.documents_copied || 0) + (job.result?.qnote_copied || 0)}건 처리됐어요.` : '잠시 후 다시 시도해주세요.',
        link, tag: `exportjob-${job.id}`, entityType: 'export_job', entityId: job.id,
        ioApp: global.__io || null,
      });
    } else {
      await notifications.notify({
        userId: job.user_id, businessId: job.business_id, eventKind: 'feedback',
        title: ok ? '내보내기 준비 완료' : '내보내기 실패',
        body: ok ? '설정 > 데이터 내보내기에서 다운로드하세요 (30일간 유효).' : '잠시 후 다시 시도해주세요.',
        link, tag: `exportjob-${job.id}`, entityType: 'export_job', entityId: job.id,
        ioApp: global.__io || null,
      });
    }
  } catch (e) { console.warn('[exportWorker] notify', e.message); }
}

// ─── 1건 드레인 ───
async function drainOnce() {
  const job = await ExportJob.findOne({ where: { status: 'queued' }, order: [['id', 'ASC']] });
  if (!job) return false;
  await job.update({ status: 'running', started_at: job.started_at || new Date(), attempts: job.attempts + 1 });
  try {
    const result = job.kind === 'transfer' ? await processTransfer(job) : await processExport(job);
    await job.update({ status: 'done', result: { ...(job.result || {}), ...result }, done_at: new Date(), error: null });
    await notifyDone(job, true);
    console.log(`[exportWorker] job#${job.id} ${job.kind} done`, result);
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 1000);
    if (job.attempts >= MAX_ATTEMPTS) {
      await job.update({ status: 'failed', error: msg, done_at: new Date() });
      await notifyDone(job, false);
      console.error(`[exportWorker] job#${job.id} failed (final)`, msg);
    } else {
      await job.update({ status: 'queued', error: msg }); // 다음 tick 재시도
      console.warn(`[exportWorker] job#${job.id} retry (attempt ${job.attempts})`, msg);
    }
  }
  return true;
}

// ─── cron tick — 1 tick 당 최대 3건 처리(폭주 방지) ───
let running = false;
async function runExportJobTick() {
  if (running) return;
  running = true;
  try {
    for (let i = 0; i < 3; i++) { const did = await drainOnce(); if (!did) break; }
  } catch (e) { console.error('[exportWorker] tick', e.message); }
  finally { running = false; }
}

// 만료된 export zip 정리 (하루 1회 호출 권장)
async function cleanupExpiredExports() {
  try {
    const expired = await ExportJob.findAll({
      where: { kind: 'export', download_path: { [Op.ne]: null }, expires_at: { [Op.lt]: new Date() } },
    });
    for (const j of expired) {
      if (j.download_path && fs.existsSync(j.download_path)) { try { fs.unlinkSync(j.download_path); } catch { /* */ } }
      await j.update({ download_path: null, download_token: null });
    }
    return expired.length;
  } catch (e) { console.warn('[exportWorker] cleanup', e.message); return 0; }
}

module.exports = { runExportJobTick, drainOnce, cleanupExpiredExports, EXPORT_DIR };
