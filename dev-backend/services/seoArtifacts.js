// 검색엔진용 공개 페이지 HTML + sitemap.xml 생성 (2026-09-21).
//
// 왜 필요한가 — PlanQ 는 SPA 라 모든 주소가 같은 index.html(제목 "PlanQ", 같은 설명, 빈 본문)을 받는다.
//   Google 은 자바스크립트를 돌려 뒤늦게 읽지만 네이버(Yeti)·AI 검색 봇은 사실상 빈 페이지로 본다.
//   사이트맵도 주소 5개(홈·가입·로그인·약관 2)뿐이었다.
//
// 방식 — **빌드 결과물 옆에 미리 만든 HTML** 을 둔다. nginx 는 그대로(`try_files $uri $uri/ /index.html`):
//   /features → /features/ (301) → features/index.html. 사람과 봇이 **같은 파일**을 받는다(클로킹 아님).
//   본문 요약은 <noscript> 자리에 넣는다 — 자바스크립트가 켜진 사람 화면에는 안 그려져 깜빡임이 없다.
//   공유 nginx 설정(PurpleHere 와 같은 서버)을 건드리지 않는다.
//
// ★ **운영 DB 기준으로 운영 서버에서** 만든다 — dev 빌드에서 만들면 dev 에만 있는 글이 운영에 샌다.
//   실행: 배포 직후(deploy-planq.sh) · 백엔드 시작 · 매일 0시(server.js).
// ★ 지운 글·비공개로 바뀐 글의 페이지를 남기지 않는다 — 지난번에 만든 목록(.seo-generated.json)과 비교해
//   **자기가 만든 파일만** 지운다.
const fs = require('fs');
const path = require('path');
const HelpArticle = require('../models/HelpArticle');
const { BLOG_WHERE, WIKI_PUBLIC_WHERE } = require('./publicContent');

const MANIFEST = '.seo-generated.json';

function frontendDir() {
  if (process.env.FRONTEND_BUILD_DIR) return process.env.FRONTEND_BUILD_DIR;
  return process.env.NODE_ENV === 'production' ? '/opt/planq/frontend-build' : '/opt/planq/dev-frontend-build';
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 위키 본문 블록 → 평문 문단들 (text_ko 만). 검색용 요약이라 1,500자에서 자른다. */
function blocksToParagraphs(body, lang = 'ko', max = 1500) {
  let arr = body;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
  if (!Array.isArray(arr)) return [];
  const out = []; let n = 0;
  for (const b of arr) {
    const t = b && (b[`text_${lang}`] || b.text);
    if (typeof t !== 'string' || !t.trim()) continue;
    const clean = t.replace(/\*\*/g, '').trim();
    out.push(clean); n += clean.length;
    if (n >= max) break;
  }
  return out;
}

/** 템플릿(index.html)의 머리·noscript 를 페이지 것으로 바꾼다. 템플릿에 없는 태그는 </head> 앞에 더한다. */
function renderPage(template, p) {
  let h = template;
  const set = (re, tag) => { h = re.test(h) ? h.replace(re, tag) : h.replace('</head>', `    ${tag}\n  </head>`); };
  h = h.replace(/<html lang="[^"]*">/, '<html lang="ko">');
  h = h.replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`);
  set(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(p.description)}" />`);
  set(/<meta property="og:type" content="[^"]*"\s*\/?>/, `<meta property="og:type" content="${esc(p.ogType || 'website')}" />`);
  set(/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${esc(p.title)}" />`);
  set(/<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${esc(p.description)}" />`);
  set(/<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${esc(p.url)}" />`);
  set(/<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${esc(p.title)}" />`);
  set(/<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${esc(p.description)}" />`);
  set(/<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${esc(p.canonical)}" />`);
  set(/<meta property="og:locale" content="[^"]*"\s*\/?>/, '<meta property="og:locale" content="ko_KR" />');
  if (p.jsonld) {
    // JSON-LD 안의 </script> 를 끊는다(본문에 그 문자열이 있어도 스크립트가 닫히지 않게)
    const ld = JSON.stringify(p.jsonld).replace(/</g, '\\u003c');
    h = h.replace('</head>', `    <script type="application/ld+json">${ld}</script>\n  </head>`);
  }
  const body = [
    `<h1>${esc(p.h1 || p.title)}</h1>`,
    ...(p.paragraphs || []).map((t) => `<p>${esc(t)}</p>`),
    `<nav>${(p.nav || []).map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(' · ')}</nav>`,
  ].join('\n      ');
  h = h.replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>\n      ${body}\n    </noscript>`);
  return h;
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : undefined);

async function generateSeoArtifacts({ dir = frontendDir(), log = console } = {}) {
  const templatePath = path.join(dir, 'index.html');
  const pagesPath = path.join(dir, 'seo-pages.json');
  if (!fs.existsSync(templatePath) || !fs.existsSync(pagesPath)) {
    return { ok: false, reason: 'build_missing', dir };
  }
  const template = fs.readFileSync(templatePath, 'utf8');
  // 템플릿이 이미 생성본이면(누가 루트에 덮어썼다) 멈춘다 — 생성본을 다시 템플릿으로 쓰면 태그가 겹친다
  if (template.includes('data-seo-generated')) return { ok: false, reason: 'template_is_generated', dir };
  const cfg = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
  const origin = cfg.origin || 'https://planq.kr';

  const nav = cfg.pages.filter((p) => !p.noPrerender).map((p) => ({ href: p.path, label: p.label || (p.h1 && p.h1.ko) || p.title.ko }));
  const org = { '@type': 'Organization', name: 'PlanQ', url: origin, logo: `${origin}/icon-512.png` };

  const out = [];      // { rel: 'features/index.html', html }
  const urls = [];     // sitemap 항목

  // ① 공개 정적 페이지
  for (const p of cfg.pages) {
    const loc = origin + p.path;
    urls.push({ loc, changefreq: p.changefreq, priority: p.priority });
    if (p.noPrerender || p.path === '/') continue;   // 홈은 index.html 자체(소스에 이미 홈 머리)
    out.push({
      rel: path.join(p.path.replace(/^\/|\/$/g, ''), 'index.html'),
      html: renderPage(template, {
        title: p.title.ko, description: p.description.ko, url: loc, canonical: loc,
        h1: p.h1 && p.h1.ko, paragraphs: (p.intro && p.intro.ko) || [], nav,
        jsonld: { '@context': 'https://schema.org', '@type': 'WebPage', name: p.title.ko, description: p.description.ko, url: loc, inLanguage: 'ko', isPartOf: { '@type': 'WebSite', name: 'PlanQ', url: origin }, publisher: org },
      }).replace('<html lang="ko">', '<html lang="ko" data-seo-generated="1">'),
    });
  }

  // ② 인사이트 글 — 위키와 같은 글이면 **대표 주소는 여기** (중복 페이지 방지)
  const blog = await HelpArticle.findAll({ where: BLOG_WHERE, attributes: ['slug', 'title_ko', 'summary_ko', 'body_ko', 'blog_published_at', 'updatedAt'] });
  const blogSlugs = new Set();
  for (const a of blog) {
    blogSlugs.add(a.slug);
    const loc = `${origin}/insights/${encodeURIComponent(a.slug)}/`;
    const desc = a.summary_ko || blocksToParagraphs(a.body_ko, 'ko', 160)[0] || '';
    urls.push({ loc, lastmod: isoDate(a.updatedAt || a.blog_published_at), changefreq: 'monthly', priority: '0.6' });
    out.push({
      rel: path.join('insights', a.slug, 'index.html'),
      html: renderPage(template, {
        title: `${a.title_ko} | PlanQ`, description: desc, url: loc, canonical: loc, ogType: 'article',
        h1: a.title_ko, paragraphs: [a.summary_ko, ...blocksToParagraphs(a.body_ko)].filter(Boolean), nav,
        jsonld: { '@context': 'https://schema.org', '@type': 'Article', headline: a.title_ko, description: desc, url: loc, inLanguage: 'ko', datePublished: a.blog_published_at, dateModified: a.updatedAt, author: org, publisher: org },
      }).replace('<html lang="ko">', '<html lang="ko" data-seo-generated="1">'),
    });
  }

  // ③ 위키 글 (게스트 공개분만)
  const wiki = await HelpArticle.findAll({ where: WIKI_PUBLIC_WHERE, attributes: ['slug', 'title_ko', 'summary_ko', 'body_ko', 'updatedAt'] });
  for (const a of wiki) {
    const own = `${origin}/wiki/a/${encodeURIComponent(a.slug)}/`;
    const canonical = blogSlugs.has(a.slug) ? `${origin}/insights/${encodeURIComponent(a.slug)}/` : own;
    const desc = a.summary_ko || blocksToParagraphs(a.body_ko, 'ko', 160)[0] || '';
    if (canonical === own) urls.push({ loc: own, lastmod: isoDate(a.updatedAt), changefreq: 'monthly', priority: '0.5' });
    out.push({
      rel: path.join('wiki', 'a', a.slug, 'index.html'),
      html: renderPage(template, {
        title: `${a.title_ko} | Q위키 — PlanQ`, description: desc, url: own, canonical, ogType: 'article',
        h1: a.title_ko, paragraphs: [a.summary_ko, ...blocksToParagraphs(a.body_ko)].filter(Boolean), nav,
        jsonld: { '@context': 'https://schema.org', '@type': 'TechArticle', headline: a.title_ko, description: desc, url: canonical, inLanguage: 'ko', dateModified: a.updatedAt, publisher: org },
      }).replace('<html lang="ko">', '<html lang="ko" data-seo-generated="1">'),
    });
  }

  // 슬러그에 경로 문자가 섞이면 쓰지 않는다(빌드 폴더 밖으로 나가지 않게)
  const safe = out.filter((o) => {
    const abs = path.resolve(dir, o.rel);
    return abs.startsWith(path.resolve(dir) + path.sep) && !o.rel.split(path.sep).includes('..');
  });
  for (const o of safe) writeAtomic(path.join(dir, o.rel), o.html);

  // sitemap.xml
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ''}${u.priority ? `<priority>${u.priority}</priority>` : ''}</url>`),
    '</urlset>', ''].join('\n');
  writeAtomic(path.join(dir, 'sitemap.xml'), xml);

  // 지난번에 만들었는데 이번엔 없는 페이지 — 비공개로 바뀌었거나 지운 글. **자기가 만든 파일만** 지운다.
  let removed = 0;
  const manifestPath = path.join(dir, MANIFEST);
  let prev = [];
  try { prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files || []; } catch { prev = []; }
  const now = new Set(safe.map((o) => o.rel));
  for (const rel of prev) {
    if (now.has(rel)) continue;
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(path.resolve(dir) + path.sep) || path.basename(abs) !== 'index.html') continue;
    try {
      const txt = fs.readFileSync(abs, 'utf8');
      if (!txt.includes('data-seo-generated')) continue;   // 우리가 만든 것이 아니면 손대지 않는다
      fs.unlinkSync(abs); removed++;
      try { fs.rmdirSync(path.dirname(abs)); } catch { /* 비어 있지 않으면 둔다 */ }
    } catch { /* 이미 없음 */ }
  }
  writeAtomic(manifestPath, JSON.stringify({ generated_at: new Date().toISOString(), files: [...now] }, null, 2));

  const r = { ok: true, dir, pages: safe.length, sitemap_urls: urls.length, removed };
  if (log && log.log) log.log('[seo-artifacts]', JSON.stringify(r));
  return r;
}

module.exports = { generateSeoArtifacts, renderPage, blocksToParagraphs, frontendDir };
