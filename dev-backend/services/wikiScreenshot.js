// Q위키 (Q Wiki) — 스크린샷 자동 캡처
// ─────────────────────────────────────────────────────────
// pdfService 의 Puppeteer 싱글톤 재사용. 캡처 전용 계정으로 로그인(refresh 쿠키 주입)
// → dev 프론트 linked_route 페이지 캡처 → File 테이블 dedup 저장 → article body 에 image 블록 연결.
// 멱등: 같은 article 재캡처 시 기존 wiki-capture 블록 교체.
//
// 필요 env (없으면 캡처 비활성 — 명확한 에러):
//   WIKI_CAPTURE_EMAIL / WIKI_CAPTURE_PASSWORD : 캡처 전용 계정 (데모 데이터 보유 워크스페이스)
//   WIKI_CAPTURE_BUSINESS_ID                   : 스크린샷 File 을 저장할 워크스페이스 id
//   WIKI_FRONTEND_URL (default https://dev.planq.kr)
//   WIKI_BACKEND_URL  (default http://127.0.0.1:3003)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const HelpArticle = require('../models/HelpArticle');
const File = require('../models/File');
const { getBrowser } = require('./pdfService');

const FRONTEND_URL = (process.env.WIKI_FRONTEND_URL || 'https://dev.planq.kr').replace(/\/+$/, '');
const BACKEND_URL = (process.env.WIKI_BACKEND_URL || 'http://127.0.0.1:3003').replace(/\/+$/, '');

function captureConfig() {
  const email = process.env.WIKI_CAPTURE_EMAIL;
  const password = process.env.WIKI_CAPTURE_PASSWORD;
  const businessId = Number(process.env.WIKI_CAPTURE_BUSINESS_ID) || null;
  if (!email || !password || !businessId) {
    throw new Error('WIKI_CAPTURE_EMAIL/PASSWORD/BUSINESS_ID 환경변수 미설정 — 캡처 비활성');
  }
  return { email, password, businessId };
}

// 백엔드 로그인 → refresh 쿠키 + access token
async function loginForCapture(email, password) {
  const r = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`capture login 실패 ${r.status}`);
  const setCookie = r.headers.get('set-cookie') || '';
  const m = setCookie.match(/refreshToken=([^;]+)/i) || setCookie.match(/refresh_token=([^;]+)/i);
  const refreshToken = m ? m[1] : null;
  const j = await r.json().catch(() => ({}));
  const accessToken = j?.data?.accessToken || j?.accessToken || j?.data?.access_token || null;
  if (!refreshToken && !accessToken) throw new Error('capture login: 토큰 없음');
  return { refreshToken, accessToken, cookieName: /refresh_token=/i.test(setCookie) ? 'refresh_token' : 'refreshToken' };
}

// File dedup 저장 (해당 워크스페이스 스코프)
async function saveScreenshotFile(buffer, businessId, fileName) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const existing = await File.findOne({ where: { business_id: businessId, content_hash: hash, deleted_at: null } });
  if (existing) {
    await existing.increment('ref_count');
    return existing;
  }
  const now = new Date();
  const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dir = path.join(__dirname, '..', 'uploads', String(businessId), yyyymm);
  fs.mkdirSync(dir, { recursive: true });
  const stored = `${crypto.randomUUID()}.png`;
  const abs = path.join(dir, stored);
  fs.writeFileSync(abs, buffer);
  return File.create({
    business_id: businessId,
    uploader_id: null,
    file_name: fileName,
    file_path: abs,
    file_size: buffer.length,
    mime_type: 'image/png',
    storage_provider: 'planq',
    content_hash: hash,
    ref_count: 1,
    visibility: 'L3',
  });
}

// body 블록 배열에 wiki-capture image 블록 1개를 교체/추가 (멱등)
function upsertCaptureBlock(body, fileId, route) {
  const blocks = Array.isArray(body) ? body.filter((b) => !(b && b.type === 'image' && b.source === 'wiki-capture')) : [];
  blocks.push({ type: 'image', source: 'wiki-capture', file_id: fileId, caption_ko: `화면 미리보기 (${route})`, caption_en: `Screen preview (${route})` });
  return blocks;
}

async function captureArticleScreenshot(articleId) {
  const article = await HelpArticle.findByPk(articleId);
  if (!article) throw new Error('article not found');
  if (!article.linked_route) throw new Error('no linked_route');

  const { email, password, businessId } = captureConfig();
  const { refreshToken, cookieName } = await loginForCapture(email, password);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    const url = new URL(FRONTEND_URL);
    if (refreshToken) {
      await page.setCookie({
        name: cookieName, value: refreshToken, domain: url.hostname, path: '/', httpOnly: true, secure: url.protocol === 'https:',
      });
    }
    const target = FRONTEND_URL + (article.linked_route.startsWith('/') ? article.linked_route : '/' + article.linked_route);
    await page.goto(target, { waitUntil: 'networkidle2', timeout: 30_000 });
    // SPA 인증 부트스트랩 + 렌더 안정화 대기
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 10_000 }).catch(() => {});
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    const png = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    const file = await saveScreenshotFile(png, businessId, `wiki-${article.slug}.png`);
    // ko/en 본문 모두에 캡처 블록 반영
    await article.update({
      body_ko: upsertCaptureBlock(article.body_ko, file.id, article.linked_route),
      body_en: upsertCaptureBlock(article.body_en, file.id, article.linked_route),
    });
    console.log(`[wikiScreenshot] article #${article.id} 캡처 완료 → file #${file.id}`);
    return { ok: true, file_id: file.id };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { captureArticleScreenshot };
