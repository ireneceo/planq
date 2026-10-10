// PDF 한 쪽을 PNG 로 그린다 — 고객 프로젝트 링크의 파일 «보기»(docs/GUEST_PROJECT_VIEW_DECISIONS.md §I-3).
//
// ★ 원본 PDF 바이트는 절대 내보내지 않는다 — 여기서 나가는 것은 지정 폭으로 그린 그림 한 장뿐이다.
//   «PDF 를 inline 으로 원본 그대로» 는 받기와 같다(받기는 L4 공유 파일만 — 술어가 다르다).
// ★ CPU 보호: 50MB 초과·암호화·손상 PDF 는 그리지 않는다 · 렌더 15초 제한 · 동시 2개 · 디스크 캐시.
// ★ 쪽수는 GUEST_PDF_MAX_PAGES 로 자른다 — 수백 쪽짜리를 한 장씩 다 그리게 두지 않는다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { CACHE_ROOT, ALLOWED_WIDTHS } = require('./imageResize');

const GUEST_PDF_MAX_PAGES = 20;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 15000;
const PDF_CACHE = path.join(CACHE_ROOT, 'pdf');

const MAX_CONCURRENT = 2;
let running = 0;
const waiters = [];
function acquire() {
  if (running < MAX_CONCURRENT) { running += 1; return Promise.resolve(); }
  return new Promise((resolve) => waiters.push(resolve));
}
function release() {
  const next = waiters.shift();
  if (next) next(); else running = Math.max(0, running - 1);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: RENDER_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err); else resolve(String(stdout || ''));
    });
  });
}

/** 파일 내용이 바뀌면(같은 id 라도) 다른 캐시가 되도록 content_hash 까지 키에 넣는다. */
function keyOf(file, ...parts) {
  return crypto.createHash('sha256').update([file.id, file.content_hash || file.file_size || '', ...parts].join('|')).digest('hex');
}

/** 원본 PDF 를 로컬 경로로 — 로컬·Drive 캐시본은 그 경로, Drive 스트림은 임시 파일로 받는다(호출부가 cleanup). */
async function localPdfPath(file) {
  const { readAttachmentBody } = require('./attachmentStorage');
  const body = await readAttachmentBody(file);
  if (!body || body.ok === false) return null;
  if (body.abs) {
    if (body.size && body.size > MAX_PDF_BYTES) return null;
    return { abs: body.abs, cleanup: () => {} };
  }
  if (!body.stream) return null; // s3 redirect 등 — 그리지 않는다
  const tmp = path.join(os.tmpdir(), `pq-pdfprev-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await new Promise((resolve, reject) => {
      let bytes = 0;
      const out = fs.createWriteStream(tmp);
      body.stream.on('data', (c) => {
        bytes += c.length;
        if (bytes > MAX_PDF_BYTES) { body.stream.destroy(); out.destroy(); reject(new Error('too_large')); }
      });
      body.stream.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      body.stream.pipe(out);
    });
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* */ }
    return null;
  }
  return { abs: tmp, cleanup: () => { try { fs.unlinkSync(tmp); } catch { /* */ } } };
}

/**
 * 이 서버에 PDF 도구(poppler — pdfinfo·pdftoppm)가 있는가. 한 번 재서 기억한다.
 * ★ 2026-10-10 Fable FAIL — dev 에만 있고 운영에는 없었다(memory feedback_prod_only_system_dependency).
 *   없으면 목록이 PDF 에 «보기» 를 붙이지 않는다(눌러도 안 열리는 꼬리표는 거짓이다).
 */
let toolsOk = null;
function pdfToolsAvailable() {
  if (toolsOk !== null) return toolsOk;
  const { execFileSync } = require('child_process');
  try {
    execFileSync('pdfinfo', ['-v'], { stdio: 'ignore', timeout: 5000 });
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore', timeout: 5000 });
    toolsOk = true;
  } catch (e) {
    // -v 는 버전을 찍고 0 이 아닌 코드로 끝나는 판도 있다 — «실행은 됐다»(숫자 종료코드)면 있는 것이다.
    toolsOk = typeof e.status === 'number';
    if (!toolsOk) console.warn('[pdfPagePreview] poppler(pdfinfo/pdftoppm) 없음 — PDF 미리보기 꺼짐:', e.code || e.message);
  }
  return toolsOk;
}

/**
 * 쪽수.
 *   { pages: n }        — 읽었다
 *   { pages: 0 }        — pdfinfo 가 **실행돼서** 못 읽는다고 답했다(암호화·손상) → 캐시해도 된다
 *   { transient: true } — 도구를 못 돌렸다(ENOENT·시간 초과·신호) → **캐시하지 않는다**
 * ★ 2026-10-10 Fable FAIL — 둘을 구별하지 않아 도구가 없거나 큰 PDF 가 15초에 걸린 것까지 `pages:0` 으로 디스크에 남아
 *   나중에 도구를 설치해도 그 PDF 는 영구 404 였다(포이즌 캐시).
 */
async function countPages(abs) {
  try {
    const out = await run('pdfinfo', [abs]);
    if (/^Encrypted:\s+yes/m.test(out)) return { pages: 0 };
    const m = /^Pages:\s+(\d+)/m.exec(out);
    const n = m ? Number(m[1]) : 0;
    return { pages: n > 0 ? n : 0 };
  } catch (e) {
    // 숫자 종료코드 = 도구가 돌고 «못 읽음» 이라 답했다. 그 밖(ENOENT·killed·signal)은 일시 실패다.
    if (typeof e.code === 'number' && !e.killed && !e.signal) return { pages: 0 };
    return { transient: true };
  }
}

/**
 * PDF 한 쪽 미리보기.
 * @returns {Promise<{ ok: true, path: string, pages: number } | { ok: false }>}
 *   pages 는 **상한 적용값**(min(실제, GUEST_PDF_MAX_PAGES)).
 */
async function renderPdfPage(file, page, width) {
  if (!pdfToolsAvailable()) return { ok: false };
  if (!ALLOWED_WIDTHS.includes(width)) return { ok: false };
  if (!Number.isInteger(page) || page < 1 || page > GUEST_PDF_MAX_PAGES) return { ok: false };
  if (Number(file.file_size) > MAX_PDF_BYTES) return { ok: false };
  fs.mkdirSync(PDF_CACHE, { recursive: true });
  const pagesPath = path.join(PDF_CACHE, `${keyOf(file, 'pages')}.json`);
  const pngPath = path.join(PDF_CACHE, `${keyOf(file, page, width)}.png`);

  let pages = null;
  try { pages = JSON.parse(fs.readFileSync(pagesPath, 'utf8')).pages; } catch { pages = null; }
  if (pages === 0) return { ok: false }; // 앞서 못 읽은 파일 — 다시 그리러 가지 않는다
  if (pages && page > pages) return { ok: false };
  if (pages && fs.existsSync(pngPath)) {
    return page <= pages ? { ok: true, path: pngPath, pages } : { ok: false };
  }

  const src = await localPdfPath(file);
  if (!src) return { ok: false };
  await acquire();
  try {
    if (!pages) {
      const c = await countPages(src.abs);
      if (c.transient) return { ok: false };          // 캐시하지 않는다 — 다음 요청이 다시 잰다
      pages = c.pages ? Math.min(c.pages, GUEST_PDF_MAX_PAGES) : 0;
      try { fs.writeFileSync(pagesPath, JSON.stringify({ pages })); } catch { /* */ }
      if (!pages) return { ok: false };
    }
    if (page > pages) return { ok: false };
    if (!fs.existsSync(pngPath)) {
      const prefix = `${pngPath}.tmp-${process.pid}-${Date.now()}`;
      await run('pdftoppm', ['-f', String(page), '-l', String(page), '-scale-to-x', String(width), '-scale-to-y', '-1',
        '-png', '-singlefile', src.abs, prefix]);
      fs.renameSync(`${prefix}.png`, pngPath);
    }
    return { ok: true, path: pngPath, pages };
  } catch (e) {
    console.warn('[pdfPagePreview] render failed:', e.message);
    return { ok: false };
  } finally {
    release();
    src.cleanup();
  }
}

module.exports = { renderPdfPage, pdfToolsAvailable, GUEST_PDF_MAX_PAGES, MAX_PDF_BYTES };
