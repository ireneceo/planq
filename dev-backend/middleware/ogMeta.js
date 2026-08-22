// middleware/ogMeta.js
//
// SNS 공유 봇 (Facebook / Kakao / Slack / Twitter / LinkedIn / Discord 등) 감지 시
// 페이지별 OG meta 가 채워진 HTML 응답. 일반 사용자는 React SPA 정상 노출.
//
// 정책:
//   - /public/posts/:token        — 해당 Post 의 title/summary/og_image (post.share_token 기반)
//   - /sign/:token                — 해당 서명 문서의 title/og_image
//   - 그 외 모든 경로            — platform_settings 의 seo_* / og_image_url (기본값)
//
// OG title 형식: "PlanQ — {page_title}" (사용자 요구)
//
// platform_settings 5분 캐시 (in-memory, emailService 패턴 일관).

const path = require('path');
const fs = require('fs');

// ★ 링크 미리보기 크롤러 UA만. 카카오톡은 크롤러가 'Kakaotalk-scrap' 이고, 인앱 브라우저는
//   '...KAKAOTALK 10.x' 로 온다. bare 'KakaoTalk' 를 넣으면 인앱 브라우저(=실사용자)까지 봇으로
//   잡혀 모든 API 가 OG HTML 을 받아 랜딩이 크래시했다(#189). 크롤러만 매칭한다.
const SHARE_BOT_UA = new RegExp([
  // 링크 미리보기 크롤러
  'facebookexternalhit', 'Facebot', 'Twitterbot', 'LinkedInBot', 'Slackbot', 'SkypeUriPreview',
  'TelegramBot', 'WhatsApp', 'Kakaotalk-scrap', 'Pinterest', 'Discordbot', 'Applebot',
  'Embedly', 'Slack-ImgProxy', 'Mastodon', 'redditbot',
  // AI 크롤러 — 사용자가 링크를 AI 에 넣으면 이 UA 로 온다.
  //   ★ 전부 하이픈·접미사가 붙은 고유 토큰만 쓴다. bare 'ChatGPT'·'Claude'·'Perplexity' 는 **절대 금지** —
  //     그 앱들의 인앱 브라우저 UA 에 앱 이름이 실릴 수 있고, 그러면 실사용자가 봇으로 잡힌다.
  //     (#189: bare 'KakaoTalk' 를 넣었다가 인앱 브라우저가 전부 봇 판정돼 랜딩이 크래시했다.)
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'Claude-Web',
  'PerplexityBot', 'Perplexity-User',
  'Bytespider', 'CCBot', 'Amazonbot', 'meta-externalagent',
].join('|'), 'i');

// OG 메타는 HTML 문서 경로에만 의미가 있다. API·소켓·정적 자원은 봇이어도 스킵(HTML 주면 JS 가 깨진다).
const OG_SKIP_PREFIX = /^\/(api|socket\.io|qnote|assets|locales)\b/;

let cache = { settings: null, at: 0 };
const TTL = 5 * 60 * 1000;

async function loadSettings() {
  if (cache.settings && Date.now() - cache.at < TTL) return cache.settings;
  try {
    const { PlatformSetting } = require('../models');
    const row = await PlatformSetting.findOne({ order: [['id', 'ASC']] });
    cache = { settings: row ? row.toJSON() : null, at: Date.now() };
  } catch { /* DB 미설정 가능 — null fallback */ }
  return cache.settings;
}

function invalidatePlatformCache() {
  cache = { settings: null, at: 0 };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// bodyParagraphs 가 있으면 본문 전문을 <article> 로 싣는다.
//   meta description 은 200자를 유지한다 — 그건 미리보기 카드용이고, 길면 카드가 지저분해진다.
//   본문은 별도 축이다 (사람이 스크립트 꺼진 채로 읽거나, AI 가 읽는 용도).
// indexable: 기본은 false — 이 함수가 만드는 HTML 은 대부분 **공유 토큰 페이지**이고,
//   그런 링크가 색인되면 의도치 않은 영구 공개가 된다. 찾아오라고 발행한 공개 글(인사이트)만
//   호출부가 true 를 준다.
function buildHtml({ url, title, description, image, siteName, bodyParagraphs, indexable }) {
  const t = escapeHtml(title || 'PlanQ');
  const d = escapeHtml(description || '');
  const img = escapeHtml(image || '');
  const u = escapeHtml(url || 'https://planq.kr');
  const sn = escapeHtml(siteName || 'PlanQ');
  const article = Array.isArray(bodyParagraphs) && bodyParagraphs.length
    ? `<article>\n${bodyParagraphs.map((x) => `<p>${escapeHtml(x)}</p>`).join('\n')}\n</article>\n`
    : '';
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>${t}</title>
<meta name="description" content="${d}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${sn}">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${u}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<link rel="canonical" href="${u}">
${indexable ? '' : '<meta name="robots" content="noindex, nofollow">\n'}</head><body>
<p>${t}</p>
<p>${d}</p>
${article}<p><a href="${u}">${u}</a></p>
</body></html>`;
}

function isShareBot(req) {
  const ua = req.headers['user-agent'] || '';
  return SHARE_BOT_UA.test(ua);
}

// 공유 만료 검사 — **이 검사가 없어서 만료된 링크의 제목·본문이 봇에게 계속 나갔다.**
//   API 는 만료 시 410 을 주는데(routes/posts.js), 미리보기 경로만 컬럼을 조회조차 안 해서
//   기간을 지정해 공유하거나 링크를 철회해도 크롤러에는 내용이 그대로 노출됐다.
//   만료면 null → 호출부가 기본 랜딩 OG 로 떨어뜨린다 (내용 0).
function isShareExpired(row, field = 'share_expires_at') {
  const v = row && row[field];
  return !!v && new Date(v) < new Date();
}

// 라우트별 OG 컨텐츠 resolver — 자기 source 우선, 없으면 platform 기본.
async function resolvePostShare(token, settings) {
  try {
    const { Post } = require('../models');
    const post = await Post.findOne({
      where: { share_token: token, status: 'published' },
      attributes: ['id', 'title', 'content_text', 'content_json', 'category', 'share_expires_at'],
    });
    if (!post) return null;
    if (isShareExpired(post)) return null;
    const baseTitle = (settings?.seo_title || settings?.brand || 'PlanQ');
    // description 은 200자 — OG 표준 길이 (미리보기 카드용).
    const preview = (post.content_text || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    // 본문은 **원본에서 다시 뽑는다.** content_text 는 검색용 파생값이라 개행이 없고 5000자에서 잘린다.
    let bodyParagraphs = [];
    try {
      const { extractBlockText } = require('../routes/posts');
      if (typeof extractBlockText === 'function') bodyParagraphs = extractBlockText(post.content_json);
    } catch (e) { console.warn('[ogMeta] extractBlockText', e.message); }
    if (!bodyParagraphs.length && post.content_text) bodyParagraphs = [String(post.content_text)];
    return {
      title: `${baseTitle} — ${post.title || (post.category || '문서')}`,
      description: preview || settings?.seo_description || `${post.category || '문서'} - PlanQ 에서 공유한 문서입니다.`,
      image: settings?.og_image_url || `${process.env.APP_URL || 'https://planq.kr'}/og-default.png`,
      siteName: settings?.brand || 'PlanQ',
      bodyParagraphs,
    };
  } catch { return null; }
}

async function resolveSignShare(token, settings) {
  try {
    const { SignatureRequest, Post, Document } = require('../models');
    // ★ 이 테이블의 공개 토큰 컬럼명은 `share_token` 이 아니라 `token` 이다.
    //   틀린 컬럼이라 매번 throw → catch 가 삼켜 **서명 공유 링크의 미리보기가 통째로 안 떴다**.
    //   (guard-invariants schemacol 이 첫 실행에서 잡아낸 실결함)
    const sr = await SignatureRequest.findOne({
      where: { token },
      attributes: ['entity_type', 'entity_id', 'expires_at', 'status'],
    });
    // 만료·취소된 서명 요청의 문서 제목이 크롤러에 계속 나가면 안 된다.
    //   (이 테이블은 만료 컬럼명이 expires_at 이고, cron 이 status='expired' 로도 마킹한다.)
    if (!sr) return null;
    if (isShareExpired(sr, 'expires_at') || sr.status === 'expired' || sr.status === 'canceled') return null;
    let entityTitle = '서명 요청';
    if (sr.entity_type === 'post' && Post) {
      const p = await Post.findByPk(sr.entity_id, { attributes: ['title'] });
      if (p?.title) entityTitle = p.title;
    } else if (sr.entity_type === 'document' && Document) {
      const d = await Document.findByPk(sr.entity_id, { attributes: ['title'] });
      if (d?.title) entityTitle = d.title;
    }
    const baseTitle = settings?.seo_title || settings?.brand || 'PlanQ';
    return {
      title: `${baseTitle} — ${entityTitle} 서명 요청`,
      description: settings?.seo_description || `${entityTitle} 문서에 서명을 요청드립니다.`,
      image: settings?.og_image_url || `${process.env.APP_URL || 'https://planq.kr'}/og-default.png`,
      siteName: settings?.brand || 'PlanQ',
    };
  } catch { return null; }
}

// 운영 #49 — posts/sign 외 모든 공개 공유 타입에도 페이지별 OG (기존엔 그 외 전부 기본 OG → "다 같은 안내내용").
function ogImage(settings) {
  return settings?.og_image_url || `${process.env.APP_URL || 'https://planq.kr'}/og-default.png`;
}
function ogPack(baseTitle, entityTitle, typeLabel, desc, settings) {
  const title = `${baseTitle} — ${entityTitle || typeLabel}`;
  return {
    title,
    description: desc || settings?.seo_description || `PlanQ 에서 공유한 ${typeLabel} 입니다.`,
    image: ogImage(settings),
    siteName: settings?.brand || 'PlanQ',
  };
}
// type → { label, resolve(token) => entityTitle|desc }. 자기 source 못 찾으면 null.
async function resolveTypedShare(type, token, settings) {
  const baseTitle = settings?.seo_title || settings?.brand || 'PlanQ';
  const M = require('../models');
  try {
    switch (type) {
      case 'docs': {
        const r = await M.Document.findOne({ where: { share_token: token }, attributes: ['title', 'share_expires_at'] });
        return (r && !isShareExpired(r)) ? ogPack(baseTitle, r.title, '문서', null, settings) : null;
      }
      case 'tasks': {
        const r = await M.Task.findOne({ where: { share_token: token }, attributes: ['title', 'description', 'share_expires_at'] });
        if (!r || isShareExpired(r)) return null;
        const preview = (r.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
        return ogPack(baseTitle, r.title, '업무', preview || `PlanQ 에서 공유한 업무: ${r.title}`, settings);
      }
      case 'files': {
        const r = await M.File.findOne({ where: { share_token: token }, attributes: ['file_name', 'share_expires_at'] });
        return (r && !isShareExpired(r)) ? ogPack(baseTitle, r.file_name, '파일', `PlanQ 에서 공유한 파일: ${r.file_name}`, settings) : null;
      }
      case 'kb': {
        const r = await M.KbDocument.findOne({ where: { share_token: token }, attributes: ['title', 'file_name', 'share_expires_at'] });
        return (r && !isShareExpired(r)) ? ogPack(baseTitle, r.title || r.file_name, '지식', null, settings) : null;
      }
      case 'kb-bundle': {
        // kb_share_bundles 도 컬럼명이 `token` 이다 (위 SignatureRequest 와 같은 계열 결함).
        //   이 테이블의 만료 컬럼명은 share_expires_at 이 아니라 expires_at 이다.
        const r = await M.KbShareBundle.findOne({ where: { token }, attributes: ['title', 'expires_at'] });
        return (r && !isShareExpired(r, 'expires_at')) ? ogPack(baseTitle, r.title, '지식 모음', null, settings) : null;
      }
      case 'calendar': {
        const r = await M.CalendarEvent.findOne({ where: { share_token: token }, attributes: ['title', 'share_expires_at'] });
        return (r && !isShareExpired(r)) ? ogPack(baseTitle, r.title, '일정', `PlanQ 에서 공유한 일정: ${r.title}`, settings) : null;
      }
      case 'invoices': {
        // ★ 청구서는 **제목·번호까지만.** 금액·계좌·고객명은 어떤 형태로도 여기 실으면 안 된다.
        //   토큰을 받은 사람이 화면에서 전액을 보는 것과, 크롤러 캐시·AI 응답에 금액이 박제되는 것은
        //   다른 문제다. attributes 에 금액 컬럼을 추가하지 말 것.
        const r = await M.Invoice.findOne({ where: { share_token: token }, attributes: ['title', 'invoice_number', 'share_expires_at'] });
        if (!r || isShareExpired(r)) return null;
        const label = r.title || (r.invoice_number ? `청구서 ${r.invoice_number}` : '청구서');
        return ogPack(baseTitle, label, '청구서', `PlanQ 에서 발행한 청구서입니다.`, settings);
      }
      case 'report':
        // App.tsx 에 라우트가 있는데 여기 case 가 없어서 기본 랜딩 OG 로 떨어지고 있었다.
        //   보고서 내용은 싣지 않는다 — 타입 라벨만.
        return ogPack(baseTitle, null, '보고서', 'PlanQ 에서 공유한 보고서입니다.', settings);
      case 'qnote-sessions':
        // Q Note 세션은 별도 FastAPI(SQLite) — Node 에서 직접 조회 불가. 타입 generic (기본보다 구체).
        return ogPack(baseTitle, null, 'Q Note 회의록', 'PlanQ Q Note 에서 공유한 회의록입니다.', settings);
      default:
        return null;
    }
  } catch { return null; }
}

// 토큰 공유 경로인가 — `/public/:type/:token` · `/sign/:token`.
//   웹서버가 이 경로를 백엔드로 넘기게 되면, **봇이 아닌 사람**도 여기 도달한다.
//   그때 next() 로 흘리면 매칭 라우트가 없어 "Cannot GET" 이 뜬다 — 사람에게는 SPA 를 돌려줘야 한다.
function isSharePath(pathOnly) {
  return /^\/public\/[a-z-]+\/[A-Za-z0-9_-]+$/.test(pathOnly) || /^\/sign\/[A-Za-z0-9_-]+$/.test(pathOnly);
}

// 검색엔진 색인 차단 — 공유 토큰이 색인되면 **의도치 않은 영구 공개**가 된다.
//   robots.txt 의 Disallow 로 막지 않는 이유: Disallow 는 크롤러가 noindex 를 못 보게 만들어
//   URL 만 색인되는 여지를 남기고, 사용자가 링크를 AI 에 넣는 즉시조회까지 막는다.
function setNoIndex(res) {
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

// 사람이 공유 링크로 들어온 경우 — SPA 를 그대로 돌려준다.
//   HTML 은 캐시하지 않는다. 캐시되면 옛 index.html 이 남아 지워진 청크를 가리키고 화면이 깨진다.
function sendSpaIndex(res) {
  const candidates = [
    process.env.FRONTEND_INDEX_HTML,
    path.resolve(__dirname, '..', '..', 'frontend-build', 'index.html'),
    path.resolve(__dirname, '..', '..', 'dev-frontend-build', 'index.html'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        setNoIndex(res);
        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.sendFile(p);
        // ★ res.sendFile 은 반환값이 없다 — 그걸 그대로 돌려주면 호출부의 `if (…) return` 이
        //   항상 거짓이 되어 응답을 보낸 뒤 next() 까지 실행된다(헤더는 이미 나간 상태).
        return true;
      }
    } catch { /* 다음 후보 */ }
  }
  return false;   // 찾지 못하면 호출부가 next() — 기존 동작 유지
}

// Express middleware — 봇이면 dynamic OG HTML, 사람이 공유 경로로 오면 SPA index.html.
// 그 외에는 next() 로 통과 (정적 서빙에 맡긴다).
async function ogMetaMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();
  if (!isShareBot(req)) {
    // 사람 — 공유 경로일 때만 SPA 를 직접 돌려준다 (웹서버가 이 경로를 백엔드로 넘기는 구성 대비).
    const p = (req.originalUrl || req.url).split('?')[0];
    if (!OG_SKIP_PREFIX.test(p) && isSharePath(p)) {
      if (sendSpaIndex(res)) return;
    }
    return next();
  }
  const url = req.originalUrl || req.url;
  // path 추출 (query string 제외)
  const pathOnly = url.split('?')[0];
  // ★ API·소켓·정적 자원은 OG HTML 대상 아님 (#189 — 크롤러 판정돼도 여기엔 HTML 주면 안 됨).
  if (OG_SKIP_PREFIX.test(pathOnly)) return next();
  const settings = await loadSettings();

  // 1) /public/posts/:token
  let m = pathOnly.match(/^\/public\/posts\/([A-Za-z0-9_-]+)$/);
  if (m) {
    const data = await resolvePostShare(m[1], settings);
    if (data) {
      setNoIndex(res);
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(buildHtml({ url: `https://planq.kr${pathOnly}`, ...data }));
    }
  }
  // 2) /sign/:token
  m = pathOnly.match(/^\/sign\/([A-Za-z0-9_-]+)$/);
  if (m) {
    const data = await resolveSignShare(m[1], settings);
    if (data) {
      setNoIndex(res);
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(buildHtml({ url: `https://planq.kr${pathOnly}`, ...data }));
    }
  }
  // 2b) 운영 #49 — 그 외 모든 공개 공유 타입 /public/:type/:token (docs·tasks·files·kb·kb-bundle·calendar·invoices·qnote-sessions)
  m = pathOnly.match(/^\/public\/([a-z-]+)\/([A-Za-z0-9_-]+)$/);
  if (m && m[1] !== 'posts') {
    const data = await resolveTypedShare(m[1], m[2], settings);
    if (data) {
      setNoIndex(res);
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(buildHtml({ url: `https://planq.kr${pathOnly}`, ...data }));
    }
  }
  // 2c) 랜딩 인사이트(블로그) `/insights/:slug` — #373
  //   ★ 이 케이스가 없어서 #362 가 절반만 동작했다. nginx 가 경로를 넘겨도, 봇 요청은 아래 3)
  //     catch-all 이 next() 없이 소진해버려 **크롤러용으로 만든 routes/og.js 에 크롤러가 영영 못 닿았다**
  //     (사람 요청만 그쪽으로 갔다). 봇 렌더의 소유자는 이 미들웨어 하나로 유지하고 케이스를 더한다.
  m = pathOnly.match(/^\/insights\/([A-Za-z0-9_-]+)$/);
  if (m) {
    const article = await require('../services/ogSources').resolveInsight(m[1]);
    if (article) {
      // ★ 여기만 noindex 를 걸지 않는다. noindex 는 **공유 토큰이 영구 공개되는 것**을 막으려는 장치인데,
      //   인사이트는 애초에 찾아오라고 발행한 공개 글이다. 색인을 막으면 발행 목적과 정면으로 어긋난다.
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(buildHtml({
        indexable: true,
        url: `https://planq.kr${pathOnly}`,
        title: `${article.title} · ${(settings && settings.brand) || 'PlanQ'}`,
        description: article.description
          ? String(article.description).replace(/\s+/g, ' ').trim().slice(0, 200)
          : (settings && settings.seo_description) || undefined,
        image: (settings && settings.og_image_url) || `${process.env.APP_URL || 'https://planq.kr'}/og-default.png`,
        siteName: (settings && settings.brand) || 'PlanQ',
      }));
    }
    // 못 찾으면 아래 기본 OG 로 떨어진다 — 존재 여부를 흘리지 않는다.
  }
  // 3) 그 외 = 기본 (랜딩) OG
  const base = settings || {};
  const data = {
    title: base.seo_title || `${base.brand || 'PlanQ'} — ${base.tagline || '일이 일이 되지 않게'}`,
    description: base.seo_description || base.tagline || '업무·프로젝트·사람·시간·고객·청구를 하나로 연결해 시간을 돈으로 바꾸는 수익성 엔진.',
    image: base.og_image_url || `${process.env.APP_URL || 'https://planq.kr'}/og-default.png`,
    siteName: base.brand || 'PlanQ',
  };
  setNoIndex(res);
  res.set('Content-Type', 'text/html; charset=utf-8');
  return res.send(buildHtml({ url: `https://planq.kr${pathOnly}`, ...data }));
}

module.exports = { ogMetaMiddleware, invalidatePlatformCache, isShareBot, SHARE_BOT_UA };
