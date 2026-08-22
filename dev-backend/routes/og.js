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
// 빌드 산출물 위치 — **후보를 순서대로 찾는다.**
//   ★ 여기 단일 dev 경로(`dev-frontend-build`)를 박아둔 탓에 운영에서 `/insights/:slug` 가
//     사람·크롤러 모두 404 로 죽었다(#374, 2026-08-22 실측). 운영 빌드는 `frontend-build` 다.
//     nginx 가 이 경로를 백엔드로 넘기기 시작한 순간, 설정 한 줄이 곧바로 페이지 다운이 됐다.
//   같은 저장소의 middleware/ogMeta.js·services/emailService.js 가 이미 쓰던 후보배열 방식으로 맞춘다 —
//   운영에 env 를 넣지 않아도 동작하고, env 누락이 장애가 되지 않는다.
const INDEX_CANDIDATES = [
  process.env.SPA_INDEX_PATH,
  process.env.FRONTEND_INDEX_HTML,
  path.resolve(__dirname, '..', '..', 'frontend-build', 'index.html'),
  path.resolve(__dirname, '..', '..', 'dev-frontend-build', 'index.html'),
].filter(Boolean);

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
let cachedPath = null;
let cachedMtime = 0;
function readIndexHtml() {
  for (const p of INDEX_CANDIDATES) {
    try {
      const st = fs.statSync(p);
      if (!cachedHtml || cachedPath !== p || st.mtimeMs !== cachedMtime) {
        cachedHtml = fs.readFileSync(p, 'utf8');
        cachedMtime = st.mtimeMs;
        cachedPath = p;
      }
      return cachedHtml;
    } catch { /* 다음 후보 */ }
  }
  return null;   // 어느 후보에도 없다 → 호출부가 next() 로 정적 서빙에 맡긴다
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
// ★ 읽기 실패는 **404 가 아니라 next()** 다(#374).
//   이 라우트의 목적은 "SPA 를 그대로 돌려주되 og 태그만 갈아끼운다" 이므로,
//   index.html 을 못 읽었다면 우리가 할 일이 없을 뿐 페이지가 없는 것은 아니다.
//   404 를 내면 부가 기능의 실패가 사용자에게 페이지 없음으로 보인다 — 정적 폴백에 넘긴다.
function sendHtml(res, meta, next) {
  const html = readIndexHtml();
  if (!html) return typeof next === 'function' ? next() : res.status(404).type('text/plain').send('not found');
  // 크롤러가 오래된 제목을 물고 있지 않게 짧은 캐시만.
  res.set('Cache-Control', 'public, max-age=300');
  res.type('html').send(meta ? injectMeta(html, meta) : html);
}

// ── 랜딩 인사이트(블로그) ─────────────────────────────────────────
// 공개 발행 글만. routes/blog.js 의 BLOG_WHERE 와 같은 조건을 쓴다.
router.get('/insights/:slug', async (req, res, next) => {
  try {
    // 공개 판정은 services/ogSources 한 곳 — 크롤러 경로(middleware/ogMeta.js)와 같은 술어를 쓴다.
    const a = await require('../services/ogSources').resolveInsight(req.params.slug);
    if (!a) return sendHtml(res, null, next);
    return sendHtml(res, {
      title: `${clip(a.title, 90)} · PlanQ`,
      description: a.description ? clip(a.description, 200) : null,
      url: `${APP_URL}/insights/${a.slug}`,
    }, next);
  } catch { return sendHtml(res, null, next); }
});

// ── 공개 문서(포스팅) ─────────────────────────────────────────────
router.get('/public/posts/:token', async (req, res, next) => {
  try {
    const { Post } = require('../models');
    const token = String(req.params.token || '').slice(0, 100);
    if (!token) return sendHtml(res, null, next);
    const p = await Post.findOne({
      where: { share_token: token },
      attributes: ['id', 'title', 'share_token'],
    });
    if (!p) return sendHtml(res, null, next);
    return sendHtml(res, {
      title: `${clip(p.title, 90)} · PlanQ`,
      description: null,   // 본문은 노출하지 않는다 — 제목까지만
      url: `${APP_URL}/public/posts/${p.share_token}`,
    }, next);
  } catch { return sendHtml(res, null, next); }
});

// ── 공개 문서(Q docs 문서) ────────────────────────────────────────
router.get('/public/docs/:token', async (req, res, next) => {
  try {
    const { Document } = require('../models');
    const token = String(req.params.token || '').slice(0, 100);
    if (!token) return sendHtml(res, null, next);
    const d = await Document.findOne({
      where: { share_token: token },
      attributes: ['id', 'title', 'share_token'],
    });
    if (!d) return sendHtml(res, null, next);
    return sendHtml(res, {
      title: `${clip(d.title, 90)} · PlanQ`,
      description: null,
      url: `${APP_URL}/public/docs/${d.share_token}`,
    }, next);
  } catch { return sendHtml(res, null, next); }
});

module.exports = router;
