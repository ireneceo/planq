// 인사이트 글 SNS 카드 렌더 — HTML → PNG(+JPEG) (docs/SNS_PUBLISH_DESIGN.md §6).
//   브라우저는 PDF 와 같은 것을 빌려 쓴다(pdfService.getBrowser). ★ retainBrowser 를 newPage **앞에서** 잡고
//   finally 에서 놓는다 — PDF 쪽이 브라우저를 은퇴시켜도 이 렌더가 끝날 때까지 닫지 않는다(wikiScreenshot 선례).
//   ★ 글자 넘침은 **실패로 돌려준다** — 조용히 잘린 카드가 SNS 에 나가는 것보다 사람이 문구를 줄이는 것이 낫다.
//   JPEG 본은 Instagram(JPEG 만 받음 — Fable 지적 4)용으로 같이 만든다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { getBrowser, retainBrowser, releaseBrowser } = require('../pdfService');
const { buildCardHtml, og, SIZES } = require('./cardTemplates');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const SOCIAL_DIR = 'social';
const OG_DIR = path.join(SOCIAL_DIR, 'og');

/** uploads 아래 상대 경로 → 절대 경로. social/ 밖이면 null (경로 탈출 차단 — 공개 OG 라우트도 이 함수를 쓴다). */
function resolveSocialFile(rel) {
  if (!rel || typeof rel !== 'string') return null;
  const abs = path.resolve(UPLOAD_ROOT, rel);
  const base = path.resolve(UPLOAD_ROOT, SOCIAL_DIR) + path.sep;
  return abs.startsWith(base) ? abs : null;
}

async function withPage(fn) {
  const browser = await getBrowser();
  retainBrowser(browser);
  let page;
  try {
    page = await browser.newPage();
  } catch (e) {
    releaseBrowser(browser);
    throw e;
  }
  try {
    // 렌더 중 바깥으로 나가는 요청 0 — 템플릿은 글꼴·이미지를 받지 않는다.
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().startsWith('data:') || r.url() === 'about:blank' ? r.continue() : r.abort()));
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
    releaseBrowser(browser);
  }
}

/** HTML 한 장을 찍는다. 넘친 상자가 있으면 { overflow: [...] } 로 알린다(찍은 결과는 버린다). */
async function renderHtml(html, { w, h }) {
  return withPage(async (page) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    await page.evaluate(() => (document.fonts && document.fonts.ready) || null);
    const overflow = await page.evaluate((H) => {
      const out = [];
      document.querySelectorAll('[data-fit]').forEach((el, i) => {
        const r = el.getBoundingClientRect();
        // 한글 글꼴(Noto CJK)은 글자 상자가 줄 높이보다 커서 넘치지 않아도 scrollHeight 가 몇 px 크다 —
        //   한 줄이 넘치면 최소 줄 높이(≈1.2em)만큼 커지므로 0.5em 을 넘을 때만 넘침으로 본다.
        const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
        const tol = Math.max(2, fs * 0.5);
        if (el.scrollHeight > el.clientHeight + tol || el.scrollWidth > el.clientWidth + 2 || r.bottom > H - 100) {
          out.push({ i, text: (el.textContent || '').trim().slice(0, 40) });
        }
      });
      return out;
    }, h);
    if (overflow.length) return { overflow };
    const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
    return { png: Buffer.isBuffer(buf) ? buf : Buffer.from(buf) };
  });
}

function monthDir() {
  const d = new Date();
  return path.join(SOCIAL_DIR, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
}

async function writeFile(rel, buf) {
  const abs = path.join(UPLOAD_ROOT, rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, buf);
}

/**
 * 카드 여러 장 → 파일. 한 장이라도 넘치면 아무것도 저장하지 않고 { overflow:[{card, boxes}] } 를 돌려준다.
 * 성공: { media: [{ file, jpg, w, h, mime, template }] }
 */
async function renderCards(cards, sizeKey = 'feed') {
  const size = SIZES[sizeKey] || SIZES.feed;
  const shots = [];
  const overflow = [];
  for (let i = 0; i < cards.length; i += 1) {
    const r = await renderHtml(buildCardHtml(cards[i], sizeKey, i + 1, cards.length), size);
    if (r.overflow) overflow.push({ card: i, template: cards[i].template, boxes: r.overflow });
    else shots.push(r.png);
  }
  if (overflow.length) return { overflow };
  const dir = monthDir();
  const media = [];
  for (let i = 0; i < shots.length; i += 1) {
    const id = crypto.randomUUID();
    const file = path.join(dir, `${id}.png`);
    const jpg = path.join(dir, `${id}.jpg`);
    await writeFile(file, shots[i]);
    await writeFile(jpg, await sharp(shots[i]).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer());
    media.push({ file, jpg, w: size.w, h: size.h, mime: 'image/png', template: cards[i].template });
  }
  return { media };
}

/** 글 링크 미리보기 이미지(1200×630 JPEG). 성공: { path } · 넘침: { overflow } */
async function renderOgImage(article) {
  const r = await renderHtml(og(article), SIZES.og);
  if (r.overflow) return { overflow: r.overflow };
  const rel = path.join(OG_DIR, `${String(article.slug).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)}-${crypto.randomBytes(4).toString('hex')}.jpg`);
  await writeFile(rel, await sharp(r.png).jpeg({ quality: 88 }).toBuffer());
  return { path: rel };
}

async function removeFile(rel) {
  const abs = resolveSocialFile(rel);
  if (abs) await fs.promises.unlink(abs).catch(() => {});
}

module.exports = { renderCards, renderOgImage, resolveSocialFile, removeFile, UPLOAD_ROOT };
