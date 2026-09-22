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

/** 위키 본문 블록 → 평문 문단들. ★ 2026-09-22 — 1,500자에서 자르던 것을 **본문 전체**로.
 *  AI 답변 엔진은 본문을 읽어야 인용한다. 자르면 뒤쪽의 답이 영영 안 읽힌다. */
function blocksToParagraphs(body, lang = 'ko', max = 20000) {
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


// ── 랜딩 문구 → 검색용 본문 (2026-09-22) ─────────────────────────────
// 화면이 쓰는 **같은 문구**(빌드에 실린 locales/ko/landing.json)를 읽는다 — 봇과 사람에게 다른 내용을 주지 않는다.
// 화면 조작용 짧은 글자(버튼·자리표시·로딩)는 뺀다.
const SKIP_KEY = /^(shotAlt|alt|placeholder|searchPlaceholder|loading|error|empty|noResults|readMinutes|anchors|form|icon|href|url|img|image)$/i;
const HEAD_KEY = /^(title|title1|title2|titleTop|name|head|headline1|headline2)$/;

function pick(obj, dotted) {
  return String(dotted).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}
const stripTags = (t) => String(t).replace(/<\/?\d+>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** 섹션 → [{ tag: 'h2'|'h3'|'p'|'li', text }] (문서 순서 그대로, 중복 제거) */
function sectionBlocks(landing, sections) {
  const out = []; const seen = new Set();
  const walk = (v, key) => {
    if (key && SKIP_KEY.test(key)) return;
    if (typeof v === 'string') {
      if (v.includes('{{')) return;
      const t = stripTags(v);
      if (t.length < 2 || seen.has(t)) return;
      seen.add(t);
      out.push({ tag: HEAD_KEY.test(key || '') ? 'h2' : (key === 'q' || /^q\d+$/.test(key || '')) ? 'h3' : 'p', text: t });
    } else if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x === 'string') { const t = stripTags(x); if (t.length >= 2 && !seen.has(t) && !t.includes('{{')) { seen.add(t); out.push({ tag: 'li', text: t }); } }
        else walk(x, key);
      }
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, k);
    }
  };
  for (const sec of sections || []) walk(pick(landing, sec), String(sec).split('.').pop());
  return out;
}

/** FAQ 출처 → [{q,a}]. 두 모양을 읽는다: { key: {q,a} } 와 { q1, a1, q2, a2 } */
function faqPairs(landing, dotted) {
  const v = pick(landing, dotted);
  if (!v || typeof v !== 'object') return [];
  const out = [];
  for (const x of Object.values(v)) if (x && typeof x === 'object' && x.q && x.a) out.push({ q: stripTags(x.q), a: stripTags(x.a) });
  for (let i = 1; i < 50; i++) if (typeof v[`q${i}`] === 'string' && typeof v[`a${i}`] === 'string') out.push({ q: stripTags(v[`q${i}`]), a: stripTags(v[`a${i}`]) });
  return out;
}


/** 글 본문 블록 → 검색용 HTML 블록(소제목은 h2, 단계는 li) + FAQ 쌍.
 *  «?» 로 끝나는 소제목과 그 아래 문단을 질문·답으로 읽는다 — 글쓴이가 따로 표시하지 않아도
 *  업무 가이드의 «자주 묻는 질문» 이 FAQPage 로 나간다(AI 답변 엔진이 가장 잘 가져가는 형식). */
function articleStructure(body, lang = 'ko') {
  let arr = body;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = []; } }
  if (!Array.isArray(arr)) return { blocks: [], faq: [] };
  const blocks = []; const faq = []; let q = null;
  for (const b of arr) {
    const raw = b && (b[`text_${lang}`] || b.text);
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const text = stripTags(raw.replace(/\*\*/g, ''));
    if (b.type === 'heading') {
      blocks.push({ tag: 'h2', text });
      q = /[?？]$/.test(text) ? { q: text, a: [] } : null;
      if (q) faq.push(q);
    } else {
      blocks.push({ tag: b.type === 'step' ? 'li' : 'p', text });
      if (q) q.a.push(text);
    }
  }
  return { blocks, faq: faq.filter((f) => f.a.length).map((f) => ({ q: f.q, a: f.a.join(' ') })) };
}
const faqLd = (faq) => ({ '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });

const breadcrumb = (origin, trail) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: origin + t.path })),
});

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
  const navHtml = `<nav>${(p.nav || []).map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(' · ')}</nav>`;
  const body = [
    `<h1>${esc(p.h1 || p.title)}</h1>`,
    ...(p.paragraphs || []).map((t) => `<p>${esc(t)}</p>`),
    navHtml,
  ].join('\n      ');
  h = h.replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>\n      ${body}\n    </noscript>`);
  // ★ 2026-09-22 — 본문을 <div id="root"> **안에도** 넣는다. <noscript> 는 구글이 가볍게 보고 AI 크롤러의
  //   본문 추출기는 버린다(네이버·GPTBot·Perplexity 는 JS 를 대개 돌리지 않는다 → 그동안 제목 한 줄만 봤다).
  //   화면에는 안 보이고(시각 숨김), 앱이 뜨면 React(createRoot)가 root 를 통째로 갈아끼워 사라진다 —
  //   렌더된 DOM 에는 남지 않으므로 사람과 봇이 보는 내용이 다르지 않다(같은 문구에서 뽑았다).
  const blocks = (p.blocks && p.blocks.length) ? p.blocks : (p.paragraphs || []).map((t) => ({ tag: 'p', text: t }));
  const rich = [
    `<h1>${esc(p.h1 || p.title)}</h1>`,
    ...blocks.map((b) => (b.tag === 'a' ? `<p><a href="${esc(b.href)}">${esc(b.text)}</a>${b.sub ? ` — ${esc(b.sub)}` : ''}</p>`
      : b.tag === 'li' ? `<ul><li>${esc(b.text)}</li></ul>` : `<${b.tag}>${esc(b.text)}</${b.tag}>`)),
    navHtml,
  ].join('\n        ');
  const SR = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
  h = h.replace(/<div id="root"><\/div>/, `<div id="root"><main id="seo-prerender" style="${SR}">\n        ${rich}\n      </main></div>`);
  return h;
}

function writeAtomic(file, content, { gz = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
  // ★ 2026-09-22 — nginx 가 gzip_static 이다. 빌드가 만든 옛 `index.html.gz` 가 옆에 있으면 압축을 받는 쪽
  //   (브라우저·구글봇 등 대부분의 크롤러)은 **새로 쓴 파일이 아니라 옛 압축본**을 받는다 — curl 로 재면 멀쩡해 보인다.
  //   그래서 생성물은 압축본도 같이 쓴다(원본과 늘 짝).
  if (gz) {
    const tz = `${file}.gz.tmp-${process.pid}`;
    fs.writeFileSync(tz, require('zlib').gzipSync(Buffer.from(content), { level: 9 }));
    fs.renameSync(tz, `${file}.gz`);
  }
}

const isoDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : undefined);

async function generateSeoArtifacts({ dir = frontendDir(), log = console } = {}) {
  const templatePath = path.join(dir, 'index.html');
  const pagesPath = path.join(dir, 'seo-pages.json');
  if (!fs.existsSync(templatePath) || !fs.existsSync(pagesPath)) {
    return { ok: false, reason: 'build_missing', dir };
  }
  // ★ 2026-09-22 — 홈(루트 index.html)도 생성한다. 그러려면 빌드 원본을 **따로 보관**해야 한다:
  //   생성본을 다시 틀로 쓰면 태그가 겹친다. 새 빌드(생성 표시 없음)가 오면 그것을 원본으로 저장하고,
  //   생성본만 남아 있으면(서버 재시작·자정) 보관한 원본을 쓴다.
  const pristinePath = path.join(dir, 'index.template.html');
  let template = fs.readFileSync(templatePath, 'utf8');
  if (!template.includes('data-seo-generated')) {
    writeAtomic(pristinePath, template);
  } else if (fs.existsSync(pristinePath)) {
    template = fs.readFileSync(pristinePath, 'utf8');
    if (template.includes('data-seo-generated')) return { ok: false, reason: 'template_is_generated', dir };
  } else {
    return { ok: false, reason: 'template_is_generated', dir };
  }
  let landing = {};
  try { landing = JSON.parse(fs.readFileSync(path.join(dir, 'locales', 'ko', 'landing.json'), 'utf8')); } catch { landing = {}; }
  const cfg = JSON.parse(fs.readFileSync(pagesPath, 'utf8'));
  const origin = cfg.origin || 'https://planq.kr';

  const nav = cfg.pages.filter((p) => !p.noPrerender).map((p) => ({ href: p.path, label: p.label || (p.h1 && p.h1.ko) || p.title.ko }));
  const org = { '@type': 'Organization', name: 'PlanQ', url: origin, logo: `${origin}/icon-512.png` };

  const out = [];      // { rel: 'features/index.html', html }
  const urls = [];     // sitemap 항목

  // 글 목록은 목록 페이지(/insights/ · /wiki/)의 본문 링크로도 쓴다 — 크롤러가 글로 따라 들어가게
  const blog = await HelpArticle.findAll({ where: BLOG_WHERE, attributes: ['slug', 'title_ko', 'summary_ko', 'body_ko', 'blog_published_at', 'updatedAt'] });
  const wiki = await HelpArticle.findAll({ where: WIKI_PUBLIC_WHERE, attributes: ['slug', 'title_ko', 'summary_ko', 'body_ko', 'updatedAt'] });
  const blogSlugSet = new Set(blog.map((a) => a.slug));
  const listBlocks = (kind) => (kind === 'insights'
    ? blog.slice().sort((x, y) => new Date(y.blog_published_at) - new Date(x.blog_published_at))
      .map((a) => ({ tag: 'a', href: `/insights/${encodeURIComponent(a.slug)}/`, text: a.title_ko, sub: a.summary_ko || '' }))
    : wiki.filter((a) => !blogSlugSet.has(a.slug))
      .map((a) => ({ tag: 'a', href: `/wiki/a/${encodeURIComponent(a.slug)}/`, text: a.title_ko, sub: a.summary_ko || '' })));

  // ① 공개 정적 페이지 (홈 포함)
  for (const p of cfg.pages) {
    const loc = origin + p.path;
    urls.push({ loc, changefreq: p.changefreq, priority: p.priority });
    if (p.noPrerender) continue;
    const intro = ((p.intro && p.intro.ko) || []).map((t) => ({ tag: 'p', text: t }));
    const blocks = [...intro, ...sectionBlocks(landing, p.sections), ...(p.list ? listBlocks(p.list) : [])];
    const faq = p.faq ? faqPairs(landing, p.faq) : [];
    const graph = [
      { '@type': 'WebPage', name: p.title.ko, description: p.description.ko, url: loc, inLanguage: 'ko', isPartOf: { '@type': 'WebSite', name: 'PlanQ', url: origin }, publisher: org },
      ...(p.path === '/' ? [] : [breadcrumb(origin, [{ name: 'PlanQ', path: '/' }, { name: p.label || p.title.ko, path: p.path }])]),
      ...(faq.length ? [{ '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }] : []),
    ];
    let html = renderPage(template, {
      title: p.title.ko, description: p.description.ko, url: loc, canonical: loc,
      h1: p.h1 && p.h1.ko, paragraphs: (p.intro && p.intro.ko) || [], blocks, nav,
      jsonld: { '@context': 'https://schema.org', '@graph': graph },
    });
    if (p.path === '/') {
      // 홈의 머리(제목·설명·기존 JSON-LD)는 index.html 원본이 정본이다 — 본문만 채운다
      html = template.replace(/<div id="root"><\/div>/, (html.match(/<div id="root">[\s\S]*?<\/main><\/div>/) || ['<div id="root"></div>'])[0]);
      html = html.replace(/<\/head>/, `    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph.slice(1).length ? graph.slice(1) : [graph[0]] }).replace(/</g, '\\u003c')}</script>\n  </head>`);
    }
    out.push({
      rel: p.path === '/' ? 'index.html' : path.join(p.path.replace(/^\/|\/$/g, ''), 'index.html'),
      html: html.replace('<html lang="ko">', '<html lang="ko" data-seo-generated="1">'),
    });
  }

  // ② 인사이트 글 — 위키와 같은 글이면 **대표 주소는 여기** (중복 페이지 방지)
  const blogSlugs = new Set();
  for (const a of blog) {
    blogSlugs.add(a.slug);
    const loc = `${origin}/insights/${encodeURIComponent(a.slug)}/`;
    const desc = a.summary_ko || blocksToParagraphs(a.body_ko, 'ko', 160)[0] || '';
    const st = articleStructure(a.body_ko);
    urls.push({ loc, lastmod: isoDate(a.updatedAt || a.blog_published_at), changefreq: 'monthly', priority: '0.6' });
    out.push({
      rel: path.join('insights', a.slug, 'index.html'),
      html: renderPage(template, {
        title: `${a.title_ko} | PlanQ`, description: desc, url: loc, canonical: loc, ogType: 'article',
        h1: a.title_ko, paragraphs: [a.summary_ko, ...blocksToParagraphs(a.body_ko)].filter(Boolean), nav,
        blocks: [...(a.summary_ko ? [{ tag: 'p', text: a.summary_ko }] : []), ...st.blocks],
        jsonld: { '@context': 'https://schema.org', '@graph': [
          ...(st.faq.length ? [faqLd(st.faq)] : []),
          { '@type': 'Article', headline: a.title_ko, description: desc, url: loc, inLanguage: 'ko', datePublished: a.blog_published_at, dateModified: a.updatedAt, author: org, publisher: org },
          breadcrumb(origin, [{ name: 'PlanQ', path: '/' }, { name: '인사이트', path: '/insights/' }, { name: a.title_ko, path: `/insights/${encodeURIComponent(a.slug)}/` }]),
        ] },
      }).replace('<html lang="ko">', '<html lang="ko" data-seo-generated="1">'),
    });
  }

  // ③ 위키 글 (게스트 공개분만)
  for (const a of wiki) {
    const own = `${origin}/wiki/a/${encodeURIComponent(a.slug)}/`;
    const canonical = blogSlugs.has(a.slug) ? `${origin}/insights/${encodeURIComponent(a.slug)}/` : own;
    const desc = a.summary_ko || blocksToParagraphs(a.body_ko, 'ko', 160)[0] || '';
    const st = articleStructure(a.body_ko);
    if (canonical === own) urls.push({ loc: own, lastmod: isoDate(a.updatedAt), changefreq: 'monthly', priority: '0.5' });
    out.push({
      rel: path.join('wiki', 'a', a.slug, 'index.html'),
      html: renderPage(template, {
        title: `${a.title_ko} | Q위키 — PlanQ`, description: desc, url: own, canonical, ogType: 'article',
        h1: a.title_ko, paragraphs: [a.summary_ko, ...blocksToParagraphs(a.body_ko)].filter(Boolean), nav,
        blocks: [...(a.summary_ko ? [{ tag: 'p', text: a.summary_ko }] : []), ...st.blocks],
        jsonld: { '@context': 'https://schema.org', '@graph': [
          // 같은 글이 인사이트에 있으면 FAQ 는 대표 주소(인사이트) 한 곳에만 — 중복 FAQ 는 검색엔진이 싫어한다
          ...(st.faq.length && canonical === own ? [faqLd(st.faq)] : []),
          { '@type': 'TechArticle', headline: a.title_ko, description: desc, url: canonical, inLanguage: 'ko', dateModified: a.updatedAt, publisher: org },
          breadcrumb(origin, [{ name: 'PlanQ', path: '/' }, { name: 'Q위키', path: '/wiki/' }, { name: a.title_ko, path: `/wiki/a/${encodeURIComponent(a.slug)}/` }]),
        ] },
      }).replace('<html lang="ko">', '<html lang="ko" data-seo-generated="1">'),
    });
  }

  // 슬러그에 경로 문자가 섞이면 쓰지 않는다(빌드 폴더 밖으로 나가지 않게)
  const safe = out.filter((o) => {
    const abs = path.resolve(dir, o.rel);
    return abs.startsWith(path.resolve(dir) + path.sep) && !o.rel.split(path.sep).includes('..');
  });
  for (const o of safe) writeAtomic(path.join(dir, o.rel), o.html, { gz: true });

  // sitemap.xml
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ''}${u.priority ? `<priority>${u.priority}</priority>` : ''}</url>`),
    '</urlset>', ''].join('\n');
  writeAtomic(path.join(dir, 'sitemap.xml'), xml, { gz: true });

  // rss.xml — 인사이트 글(최신 30). 네이버 서치어드바이저 «RSS 제출» 용 (2026-09-21).
  //   사이트맵과 같은 조건(BLOG_WHERE)·같은 대표 주소를 쓴다 — 둘이 다른 주소를 가리키면 중복 색인이 된다.
  const rfc822 = (d) => new Date(d).toUTCString();
  const feed = blog
    .slice()
    .sort((x, y) => new Date(y.blog_published_at) - new Date(x.blog_published_at))
    .slice(0, 30);
  const rss = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>PlanQ 인사이트</title>',
    `    <link>${esc(origin)}/insights/</link>`,
    `    <atom:link href="${esc(origin)}/rss.xml" rel="self" type="application/rss+xml" />`,
    '    <description>업무 자동화 인사이트와 PlanQ 제품 소식</description>',
    '    <language>ko</language>',
    feed.length ? `    <lastBuildDate>${rfc822(feed[0].blog_published_at)}</lastBuildDate>` : '',
    ...feed.map((a) => {
      const loc = `${origin}/insights/${encodeURIComponent(a.slug)}/`;
      const desc = a.summary_ko || blocksToParagraphs(a.body_ko, 'ko', 300).join(' ');
      return `    <item><title>${esc(a.title_ko)}</title><link>${esc(loc)}</link><guid isPermaLink="true">${esc(loc)}</guid><pubDate>${rfc822(a.blog_published_at)}</pubDate><description>${esc(desc)}</description></item>`;
    }),
    '  </channel>', '</rss>', ''].filter((l) => l !== '').join('\n');
  writeAtomic(path.join(dir, 'rss.xml'), rss, { gz: true });

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
      try { fs.unlinkSync(`${abs}.gz`); } catch { /* 압축본 없음 */ }
      try { fs.rmdirSync(path.dirname(abs)); } catch { /* 비어 있지 않으면 둔다 */ }
    } catch { /* 이미 없음 */ }
  }
  writeAtomic(manifestPath, JSON.stringify({ generated_at: new Date().toISOString(), files: [...now] }, null, 2));

  const r = { ok: true, dir, pages: safe.length, sitemap_urls: urls.length, rss_items: feed.length, removed };
  if (log && log.log) log.log('[seo-artifacts]', JSON.stringify(r));
  return r;
}

module.exports = { generateSeoArtifacts, renderPage, blocksToParagraphs, frontendDir, _test: { sectionBlocks, faqPairs, articleStructure } };
