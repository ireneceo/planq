// #63 Phase 3 — 자료 이동/내보내기 비동기 워커.
// export_jobs 를 cron 으로 드레인: transfer(이동/복사) · export(다운로드 zip).
// 본인 L1 파일 + 본인 문서 + (옵션) 본인 Q Note 세션(요약+전사 → 문서).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { ExportJob, File, Document, Post, BusinessStorageUsage } = require('../models');
const exportRoutes = require('../routes/export');
const notifications = require('../routes/notifications');
const planEngine = require('./plan');

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

// ─── Q Note 세션 → TipTap JSON ───
//   ★ HTML 을 거치지 않는다. 백엔드에 HTML→TipTap 변환기가 없어서 body_html 만 넣은 Post 는
//     본문이 빈 채로 착지한다. 세션은 이미 구조화 필드를 갖고 있으므로 직접 조립한다.
//     (zip 다운로드용 `qnoteSessionToHtml` 은 파일 산출이라 별개로 유지)
function tipHeading(text) {
  return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: String(text) }] };
}
function tipParagraphs(text) {
  // 개행은 문단으로 — 파생 평탄화 필드가 아니라 원본 문자열을 그대로 쓴다.
  return String(text).split(/\n{1,}/).filter(l => l.trim()).map(line => ({
    type: 'paragraph', content: [{ type: 'text', text: line }],
  }));
}
function qnoteSessionToTiptap(s) {
  const content = [];
  if (s.summary_full) { content.push(tipHeading('요약'), ...tipParagraphs(s.summary_full)); }
  if (Array.isArray(s.summary_key_points) && s.summary_key_points.length) {
    content.push(tipHeading('핵심 포인트'), {
      type: 'bulletList',
      content: s.summary_key_points.map(p => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: String(p) }] }],
      })),
    });
  }
  if (s.body) { content.push(tipHeading('메모'), ...tipParagraphs(s.body)); }
  if (s.transcript_text) { content.push(tipHeading('전사'), ...tipParagraphs(s.transcript_text)); }
  return content.length ? { type: 'doc', content } : null;
}

// ─── 이전 산출물 1건을 Post 로 착지 ───
//   ★ 세 가지가 동시에 맞아야 사용자가 실제로 볼 수 있다:
//     ① `content_json` 은 posts 의 **TEXT 컬럼**이다 — 객체를 그대로 넣으면 "[object Object]" 가 저장된다
//        (Document.body_json 은 JSON 컬럼이라 그냥 넣어도 됐다. ORM 표면 차이)
//     ② `status:'draft'` 만 주면 모델 hook 이 vlevel 을 L3 로 백필한다 — hook 은 status 를 보지 않는다.
//        `vlevel:'L1'` 을 **명시**해야 이전 실행 본인에게만 보인다(posts.js 생성 라우트 미러)
//     ③ `content_text` 는 posts.js 의 extractText 를 재사용 — 사본을 만들면 검색 프리뷰 규칙이 갈린다
//   본문이 없으면 만들지 않는다 — 열어도 빈 문서인 Post 를 목록에 쌓지 않는다.
async function createTransferredPost({ targetBiz, userId, title, tiptap, category, securityLevel }) {
  const { extractText } = require('../routes/posts');
  const doc = typeof tiptap === 'string' ? safeParse(tiptap) : tiptap;
  if (!doc) return null;
  const text = extractText(doc);
  if (!text) return null;
  // ★ 재시도 멱등 가드 — job 은 MAX_ATTEMPTS 3 회까지 재시도된다. 파일은 content_hash 로
  //   'exists' dedup 이 있는데 Post 엔 없어서, 부분 실패 후 재시도가 **같은 글을 중복 생성**한다.
  //   (제목+본문이 같은 내 글이 타겟에 이미 있으면 그건 앞선 시도의 산출물이다)
  const dup = await Post.findOne({
    where: { business_id: targetBiz, author_id: userId, title: String(title || '제목 없음').slice(0, 200), content_text: text },
    attributes: ['id'],
  });
  if (dup) return null;
  return Post.create({
    business_id: targetBiz,
    author_id: userId,
    title: String(title || '제목 없음').slice(0, 200),
    content_json: JSON.stringify(doc),          // ★ TEXT 컬럼 — 반드시 문자열
    content_text: text,
    category: category ? String(category).slice(0, 40) : null,
    kind: 'doc',
    status: 'draft',                            // 본인만 — 확인 후 저장하면 published 승격
    vlevel: 'L1',                               // ★ 명시 (hook 은 status 로 L1 을 추론하지 않는다)
    security_level: securityLevel || 'general',
  });
}
function safeParse(v) { try { return JSON.parse(v); } catch { return null; } }

// ─── 이전된 글의 첨부 재링크 ───
//   본문만 옮기고 첨부를 끊으면 반쪽이다. 같은 job 에서 파일도 복사되므로(본인 L1 첨부라면)
//   타겟에 같은 `content_hash` 의 내 File 이 이미 있다 — 그걸 찾아 링크만 다시 건다.
//   타겟에 없는 첨부(남의 파일·L1 아님·쿼터 초과로 미복사)는 조용히 건너뛴다 —
//   없는 파일을 가리키는 죽은 링크를 만드는 것보다 낫다.
async function relinkAttachments(sourcePostId, newPostId, targetBiz, userId) {
  try {
    const { PostAttachment } = require('../models');
    const links = await PostAttachment.findAll({
      where: { post_id: sourcePostId },
      include: [{ model: File, as: 'file', attributes: ['id', 'content_hash'], required: true }],
      order: [['sort_order', 'ASC']],
    });
    let order = 0;
    for (const l of links) {
      if (!l.file?.content_hash) continue;
      const mine = await File.findOne({
        where: { business_id: targetBiz, uploader_id: userId, content_hash: l.file.content_hash, deleted_at: null },
        attributes: ['id'],
      });
      if (!mine) continue;
      await PostAttachment.findOrCreate({
        where: { post_id: newPostId, file_id: mine.id },
        defaults: { post_id: newPostId, file_id: mine.id, sort_order: order++ },
      });
    }
  } catch (e) {
    // 첨부 재링크 실패가 본문 이전을 되돌리게 두지 않는다 — 다만 조용히 넘기지는 않는다.
    console.warn('[exportWorker] relinkAttachments', sourcePostId, '→', newPostId, e.message);
  }
}

// ─── 파일 1건 타겟 복사 (Phase 2 dedup 로직 — content_hash 공유/물리복사) ───
//  반환: 'copied' | 'skipped'(+reason). bytesAdded 는 caller 가 누적.
//  quotaCtx={remaining} — 물리 신규 복사 시 타겟 쿼터 예산 차감/초과검사 (업로드 경로와 동일 정책).
async function copyFileToTarget(f, targetBiz, userId, quotaCtx) {
  if (!f.content_hash) return { status: 'skipped', reason: 'no_hash' };
  const mine = await File.findOne({
    where: { business_id: targetBiz, content_hash: f.content_hash, uploader_id: userId, deleted_at: null },
  });
  if (mine) return { status: 'skipped', reason: 'exists' };
  const existing = await File.findOne({
    where: { business_id: targetBiz, content_hash: f.content_hash, deleted_at: null },
  });
  if (existing) {
    // dedup-share — 물리 0바이트 추가라 쿼터 영향 없음
    await existing.increment('ref_count');
    await File.create({
      business_id: targetBiz, uploader_id: userId,
      file_name: f.file_name, file_path: existing.file_path, file_size: f.file_size,
      mime_type: f.mime_type, storage_provider: 'planq', content_hash: f.content_hash,
      ref_count: 1, visibility: 'L1', vlevel: 'L1', security_level: f.security_level,
    });
    return { status: 'copied', bytes: 0 };
  }
  if (!f.file_path || !fs.existsSync(f.file_path)) return { status: 'skipped', reason: 'no_file' };
  // 신규 물리 복사 — 타겟 쿼터 검사 (초과 시 복사 안 함, 우회 차단)
  const sz = Number(f.file_size) || 0;
  if (quotaCtx && quotaCtx.remaining !== Infinity && sz > quotaCtx.remaining) {
    return { status: 'skipped', reason: 'quota' };
  }
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
  if (quotaCtx && quotaCtx.remaining !== Infinity) quotaCtx.remaining -= sz;
  return { status: 'copied', bytes: sz };
}

// ─── 원본 파일 제거 (move 모드) — 복사 성공 후에만 호출 ───
//   ★ 이건 "삭제" 가 아니라 **이동**이다. 바이트는 이미 대상 워크스페이스로 복사됐으므로
//     원본을 지우는 것이 move 의 정의다 — 휴지통(routes/files.js trashFile)에 넣지 않는다.
//     휴지통에 넣으면 같은 파일이 두 워크스페이스에 동시에 살아 있는 것처럼 보인다.
//   정책: deleted_at + ref_count 감소 + (0 도달·sibling 없음) 물리삭제
//   + 출발 워크스페이스 쿼터 반환(bytes_used·file_count). 쿼터 차감 누락 시 출발지 용량 부풀려짐.
async function softDeleteSourceFile(f) {
  await f.update({ deleted_at: new Date() });
  await f.decrement('ref_count');
  await f.reload();
  if (f.ref_count <= 0 && f.storage_provider === 'planq') {
    const siblings = await File.count({
      where: { file_path: f.file_path, deleted_at: null, id: { [Op.ne]: f.id } },
    });
    if (siblings === 0 && f.file_path && fs.existsSync(f.file_path)) {
      try { fs.unlinkSync(f.file_path); } catch { /* best-effort */ }
    }
  }
  // 출발 워크스페이스 쿼터 반환 (자체 스토리지만)
  if (f.storage_provider === 'planq') {
    const [usage] = await BusinessStorageUsage.findOrCreate({
      where: { business_id: f.business_id, storage_provider: 'planq' },
      defaults: { business_id: f.business_id, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
    });
    await usage.update({
      bytes_used: Math.max(0, Number(usage.bytes_used) - (Number(f.file_size) || 0)),
      file_count: Math.max(0, usage.file_count - 1),
    });
  }
}

// ─── transfer 처리 (copy/move + qnote) ───
async function processTransfer(job) {
  const { files, docs } = await exportRoutes.collectSelf(job.business_id, job.user_id);
  const targetBiz = job.target_business_id;
  let filesCopied = 0, docsCopied = 0, qnoteCopied = 0, filesRemoved = 0, docsRemoved = 0, skipped = 0, skippedQuota = 0, bytesAdded = 0;

  // 타겟 워크스페이스 쿼터 예산 (업로드 경로와 동일 정책 — 우회 차단)
  let quotaCtx = { remaining: Infinity };
  try {
    const limit = await planEngine.getLimit(targetBiz, 'storage_bytes');
    if (limit !== Infinity) {
      const [tu] = await BusinessStorageUsage.findOrCreate({
        where: { business_id: targetBiz, storage_provider: 'planq' },
        defaults: { business_id: targetBiz, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
      });
      quotaCtx.remaining = Math.max(0, limit - Number(tu.bytes_used));
    }
  } catch { /* best-effort — 실패 시 무제한 처리 */ }

  // 파일 복사 (+ move 면 원본 정리). 쿼터 초과분은 복사 안 함(move 라도 원본 보존 — 데이터 유실 방지).
  for (const f of files.slice(0, MAX_ITEMS)) {
    const r = await copyFileToTarget(f, targetBiz, job.user_id, quotaCtx);
    if (r.status === 'copied') {
      filesCopied++; bytesAdded += r.bytes || 0;
      if (job.mode === 'move') { await softDeleteSourceFile(f); filesRemoved++; }
    } else if (r.reason === 'quota') {
      skippedQuota++; // 타겟 쿼터 부족 → 복사 실패. move 라도 원본 유지(유실 방지).
    } else if (r.reason === 'exists') {
      skipped++;
      // 이미 타겟에 본인 사본 존재 → move 시 원본 제거 (사용자 의도 = 출발지 비우기, 타겟에 사본 보존됨)
      if (job.mode === 'move') { await softDeleteSourceFile(f); filesRemoved++; }
    } else {
      skipped++;
      // no_hash / no_file 등 — 타겟에 사본 없음. move 라도 원본 보존 (유실 방지).
    }
  }

  // 문서 복사 (+ move 면 원본 soft delete)
  //
  // ★ 산출물은 **Post** 다 (#250 후속, Fable 설계 게이트 2026-08-08).
  //   옛 코드는 `Document.create` 했는데, Document 를 여는 화면이 제품에 **존재하지 않는다**
  //   (DocumentEditorPage/NewDocumentModal 은 한 번도 라우팅된 적 없는 죽은 파일이었다).
  //   즉 이전을 실행하면 "문서 N건 복사됨" 이라고 보고하면서 **사용자가 영영 못 여는 행**을 만들었다.
  //   살아있는 문서 표면은 Post(QDocsPage → PostsPage) 하나뿐이라 그쪽으로 착지시킨다.
  //   운영 documents=0 이라 전환 비용이 0인 시점이다.
  for (const d of docs.slice(0, MAX_ITEMS)) {
    const created = await createTransferredPost({
      targetBiz, userId: job.user_id,
      // ★ 소스가 Post 다 — `body_json`/`kind` 를 넘기면 본문이 비고(필드 부재)
      //   category 가 Post.kind('doc') 로 오염된다.
      title: d.title, tiptap: d.content_json,
      category: d.category || null, securityLevel: d.security_level,
    });
    if (!created) { skipped++; continue; }   // 본문 없거나 이미 복사된 건은 새로 만들지 않는다
    docsCopied++;
    await relinkAttachments(d.id, created.id, targetBiz, job.user_id);
    // ★ move 라도 **문서는 원본을 지우지 않는다**(copy-only).
    //   Post 는 `archived` status 도 soft-delete 도 없다 — ENUM 은 draft|published 뿐이고 삭제는 hard DELETE 다.
    //   백그라운드 워커가 사용자 자산을 복구 불가하게 지우는 것은 허용할 수 없고,
    //   ENUM 밖 값을 쓰면 `.catch(()=>{})` 가 실패를 삼킨 채 카운터만 올라 **거짓 보고**가 된다.
    //   파일은 `deleted_at` 을 지원하므로 현행대로 move 시 soft delete 유지.
  }

  // Q Note 세션 → 문서 (복사만 — 원본 qnote 는 사적 공간이라 move 대상 아님)
  //   ★ HTML 을 거치지 않는다 — 백엔드에 HTML→TipTap 변환기가 없어서 body_html 로 만든 Post 는
  //     본문이 빈 채로 착지한다. 구조화 필드에서 TipTap JSON 을 직접 조립한다(Fable 설계 조건 5).
  //     export zip 의 `qnoteSessionToHtml`(파일 산출) 경로는 그대로 둔다.
  if (job.include_qnote) {
    const sessions = await fetchQnoteSessions(job.business_id, job.user_id);
    for (const s of sessions.slice(0, MAX_ITEMS)) {
      const created = await createTransferredPost({
        targetBiz, userId: job.user_id,
        title: s.title || 'Q Note', tiptap: qnoteSessionToTiptap(s),
        category: 'meeting_note', securityLevel: null,
      });
      if (created) qnoteCopied++;
    }
  }

  // 타겟 스토리지 사용량 갱신 (dedup-share 만 복사돼 bytesAdded=0 이어도 File row 는 늘어 file_count 증가 필요)
  if (filesCopied > 0) {
    const [usage] = await BusinessStorageUsage.findOrCreate({
      where: { business_id: targetBiz, storage_provider: 'planq' },
      defaults: { business_id: targetBiz, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
    });
    await usage.update({ bytes_used: Number(usage.bytes_used) + bytesAdded, file_count: usage.file_count + filesCopied });
  }

  return { files_copied: filesCopied, documents_copied: docsCopied, qnote_copied: qnoteCopied,
    files_removed: filesRemoved, documents_removed: docsRemoved, skipped, skipped_quota: skippedQuota, bytes: bytesAdded };
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

// createTransferredPost 는 동기 `POST /me/transfer`(routes/export.js) 도 쓴다 — 두 경로가
//   같은 착지 규칙(TEXT 직렬화·vlevel L1 명시·extractText 재사용)을 공유해야 반쪽 전환이 안 된다.
module.exports = { runExportJobTick, drainOnce, cleanupExpiredExports, createTransferredPost, relinkAttachments, EXPORT_DIR };
