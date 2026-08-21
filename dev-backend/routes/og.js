// SNS 링크 미리보기(Open Graph) 서버 렌더 — 피드백 #362
//
// 문제: SPA 라 어떤 링크를 공유해도 index.html 의 **고정 OG 태그**만 크롤러에 노출된다.
//       카카오·슬랙·링크드인 어디에 붙여도 "PlanQ — 일이 일이 되지 않게 / 업무, 프로젝트…" 만 나온다.
//       크롤러는 자바스크립트를 실행하지 않으므로 프론트에서 고칠 수 없다.
//
// 방식: 공개 경로만 nginx 가 이 백엔드로 넘기고, 여기서 빌드된 index.html 을 읽어
//       og:title / og:description / og:url / <title> 만 치환해 돌려준다.
//       나머지는 원본 그대로라 SPA 는 평소처럼 부팅한다 (사용자 경험 무변경).
//
// 공개 범위 원칙 (중요):
//   - 이미 공개 링크를 가진 사람에게만 보이는 정보의 **제목 수준**만 노출한다.
//   - 금액·본문·첨부 같은 내용은 절대 넣지 않는다 (링크가 채팅방에 붙는 순간 참여자 전원이 본다).
//   - 대상을 못 찾으면 기본 index.html 을 **그대로** 돌려준다 (존재 여부조차 흘리지 않는다).
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
// 빌드 산출물 위치. dev-backend/../dev-frontend-build/index.html
const INDEX_HTML = process.env.SPA_INDEX_PATH
  || path.join(__dirname, '..', '..', 'dev-frontend-build', 'index.html');

// 속성값에 들어가므로 인용부호·꺾쇠를 반드시 막는다 (meta content 이스케이프).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clip(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

let cachedHtml = null;
let cachedMtime = 0;
function readIndexHtml() {
  try {
    const st = fs.statSync(INDEX_HTML);
    if (!cachedHtml || st.mtimeMs !== cachedMtime) {
      cachedHtml = fs.readFileSync(INDEX_HTML, 'utf8');
      cachedMtime = st.mtimeMs;
    }
    return cachedHtml;
  } catch {
    return null;   // 빌드 산출물이 없으면 이 경로는 아무 것도 못 한다 → 상위에서 404 처리
  }
}

// index.html 의 기존 태그를 치환한다. 없으면 넣지 않는다 (원본 구조 존중).
function injectMeta(html, { title, description, url }) {
  let out = html;
  if (title) {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
    out = out.replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/i, `$1${esc(title)}$2`);
    out = out.replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/i, `$1${esc(title)}$2`);
  }
  if (description) {
    out = out.replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i, `$1${esc(description)}$2`);
    out = out.replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/i, `$1${esc(description)}$2`);
    out = out.replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/i, `$1${esc(description)}$2`);
  }
  if (url) {
    out = out.replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/i, `$1${esc(url)}$2`);
  }
  return out;
}

// 공통 응답 — meta 가 null 이면 기본 index.html 그대로.
function sendHtml(res, meta) {
  const html = readIndexHtml();
  if (!html) return res.status(404).type('text/plain').send('not found');
  // 크롤러가 오래된 제목을 물고 있지 않게 짧은 캐시만.
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(meta ? injectMeta(html, meta) : html);
}

// ── 랜딩 인사이트(블로그) ─────────────────────────────────────────
// 공개 발행 글만. routes/blog.js 의 BLOG_WHERE 와 같은 조건을 쓴다.
router.get('/insights/:slug', async (req, res) => {
  try {
    const HelpArticle = require('../models/HelpArticle');
    const a = await HelpArticle.findOne({
      where: {
        slug: String(req.params.slug || '').slice(0, 200),
        blog_published_at: { [Op.ne]: null },
        is_published: true,
        visibility: 'public',
      },
      attributes: ['slug', 'title_ko', 'title_en', 'summary_ko', 'summary_en'],
    });
    if (!a) return sendHtml(res, null);
    const title = a.title_ko || a.title_en;
    const desc = a.summary_ko || a.summary_en;
    return sendHtml(res, {
      title: title ? `${clip(title, 90)} · PlanQ` : null,
      description: desc ? clip(desc, 200) : null,
      url: `${APP_URL}/insights/${a.slug}`,
    });
  } catch { return sendHtml(res, null); }
});

// ── 공개 문서(포스팅) ─────────────────────────────────────────────
router.get('/public/posts/:token', async (req, res) => {
  try {
    const { Post } = require('../models');
    const token = String(req.params.token || '').slice(0, 100);
    if (!token) return sendHtml(res, null);
    const p = await Post.findOne({
      where: { share_token: token },
      attributes: ['id', 'title', 'share_token'],
    });
    if (!p) return sendHtml(res, null);
    return sendHtml(res, {
      title: `${clip(p.title, 90)} · PlanQ`,
      description: null,   // 본문은 노출하지 않는다 — 제목까지만
      url: `${APP_URL}/public/posts/${p.share_token}`,
    });
  } catch { return sendHtml(res, null); }
});

// ── 공개 문서(Q docs 문서) ────────────────────────────────────────
router.get('/public/docs/:token', async (req, res) => {
  try {
    const { Document } = require('../models');
    const token = String(req.params.token || '').slice(0, 100);
    if (!token) return sendHtml(res, null);
    const d = await Document.findOne({
      where: { share_token: token },
      attributes: ['id', 'title', 'share_token'],
    });
    if (!d) return sendHtml(res, null);
    return sendHtml(res, {
      title: `${clip(d.title, 90)} · PlanQ`,
      description: null,
      url: `${APP_URL}/public/docs/${d.share_token}`,
    });
  } catch { return sendHtml(res, null); }
});

module.exports = router;
