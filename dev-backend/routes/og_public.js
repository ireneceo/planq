// 운영 #49 — 공개 공유 페이지(/public/*, /sign/*) SNS OG 메타 서버 주입.
//   PlanQ 는 Vite SPA 라 index.html 의 OG 가 모든 페이지 동일("PlanQ") → SNS 공유 썸네일/제목이 다 같음.
//   크롤러(facebook/kakao/slack/twitter 등)는 JS 실행 안 함 → 서버가 index.html 에 페이지별 OG 를 주입해 응답.
//   nginx 가 /public/ · /sign/ 을 이 백엔드로 proxy_pass (실사용자도 같은 index.html 받고 SPA 정상 부팅).
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const APP_URL = (process.env.APP_URL || 'https://planq.kr').replace(/\/$/, '');

// 빌드된 index.html 경로 후보 (dev/prod) — server.js build-version 과 동일 패턴
const INDEX_CANDIDATES = [
  process.env.FRONTEND_INDEX_HTML,
  path.resolve(__dirname, '..', '..', 'frontend-build', 'index.html'),
  path.resolve(__dirname, '..', '..', 'dev-frontend-build', 'index.html'),
].filter(Boolean);

let _cachedHtml = null;
let _cachedMtime = 0;
function readIndexHtml() {
  for (const p of INDEX_CANDIDATES) {
    try {
      const st = fs.statSync(p);
      if (_cachedHtml && _cachedMtime === st.mtimeMs) return _cachedHtml;
      _cachedHtml = fs.readFileSync(p, 'utf8');
      _cachedMtime = st.mtimeMs;
      return _cachedHtml;
    } catch { /* try next */ }
  }
  return null;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, ' ').slice(0, 300);
}

// OG 메타를 index.html 에 주입 (title / og:title / og:description / og:url + twitter)
function injectOg(html, { title, desc, url }) {
  const fullTitle = title ? `${title} · PlanQ` : 'PlanQ';
  const d = desc || 'PlanQ — 일이 일이 되지 않게. 업무·프로젝트·고객·청구를 하나로.';
  let out = html
    .replace(/<title>[^<]*<\/title>/i, `<title>${esc(fullTitle)}</title>`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*(")/i, `$1${esc(fullTitle)}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/i, `$1${esc(d)}$2`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/i, `$1${esc(d)}$2`);
  // og:url 은 있으면 교체, 없으면 추가
  if (/<meta\s+property="og:url"/i.test(out)) {
    out = out.replace(/(<meta\s+property="og:url"\s+content=")[^"]*(")/i, `$1${esc(url)}$2`);
  } else {
    out = out.replace(/<\/head>/i, `  <meta property="og:url" content="${esc(url)}" />\n  </head>`);
  }
  // twitter 카드 — 있으면 교체, 없으면 추가 (index.html 기본 twitter 태그 보유)
  if (/twitter:title/i.test(out)) {
    out = out
      .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*(")/i, `$1${esc(fullTitle)}$2`)
      .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/i, `$1${esc(d)}$2`);
  } else {
    out = out.replace(/<\/head>/i,
      `  <meta name="twitter:card" content="summary_large_image" />\n` +
      `  <meta name="twitter:title" content="${esc(fullTitle)}" />\n` +
      `  <meta name="twitter:description" content="${esc(d)}" />\n  </head>`);
  }
  return out;
}

// type → 토큰으로 제목/설명 resolver. 실패/없음 → null (generic fallback)
function buildResolvers() {
  const m = require('../models');
  return {
    posts: async (t) => {
      const r = await m.Post.findOne({ where: { share_token: t }, attributes: ['title'] });
      return r ? { title: r.title } : null;
    },
    docs: async (t) => {
      const r = await m.Document.findOne({ where: { share_token: t }, attributes: ['title'] });
      return r ? { title: r.title } : null;
    },
    tasks: async (t) => {
      const r = await m.Task.findOne({ where: { share_token: t }, attributes: ['title'] });
      return r ? { title: r.title } : null;
    },
    files: async (t) => {
      const r = await m.File.findOne({ where: { share_token: t }, attributes: ['file_name'] });
      return r ? { title: r.file_name } : null;
    },
    kb: async (t) => {
      const r = await m.KbDocument.findOne({ where: { share_token: t }, attributes: ['title', 'file_name'] });
      return r ? { title: r.title || r.file_name } : null;
    },
    'kb-bundle': async (t) => {
      const r = await m.KbShareBundle.findOne({ where: { share_token: t }, attributes: ['title'] });
      return r ? { title: r.title } : null;
    },
    calendar: async (t) => {
      const r = await m.CalendarEvent.findOne({ where: { share_token: t }, attributes: ['title'] });
      return r ? { title: r.title } : null;
    },
    invoices: async (t) => {
      const r = await m.Invoice.findOne({ where: { share_token: t }, attributes: ['invoice_number', 'title'] });
      return r ? { title: r.title || (r.invoice_number ? `청구서 ${r.invoice_number}` : '청구서') } : null;
    },
  };
}

// type 별 generic 라벨 (entity 못 찾아도 페이지 종류는 알림)
const TYPE_LABEL = {
  posts: '문서', docs: '문서', tasks: '업무', files: '파일', kb: '지식', 'kb-bundle': '지식 모음',
  calendar: '일정', invoices: '청구서', 'qnote-sessions': 'Q Note',
};

let _resolvers = null;

async function serveWithOg(req, res, type, token) {
  const html = readIndexHtml();
  if (!html) return res.status(404).send('Not found');
  res.set('Content-Type', 'text/html; charset=utf-8');
  // 공개 페이지는 항상 최신 OG 반영 — HTML no-cache (assets 는 nginx 가 immutable 캐시)
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');

  let title = TYPE_LABEL[type] ? `PlanQ ${TYPE_LABEL[type]}` : null;
  let desc = null;
  try {
    if (!_resolvers) _resolvers = buildResolvers();
    const resolver = _resolvers[type];
    if (resolver && token) {
      const found = await resolver(token);
      if (found && found.title) { title = found.title; desc = found.desc || null; }
    }
  } catch (e) { console.warn('[og_public] resolve failed:', e.message); }

  const url = `${APP_URL}${req.originalUrl}`;
  return res.send(injectOg(html, { title, desc, url }));
}

// /public/:type/:token — 공개 공유 페이지
router.get('/public/:type/:token', (req, res) => serveWithOg(req, res, req.params.type, req.params.token));
// /sign/:token — 서명 요청 페이지
router.get('/sign/:token', (req, res) => serveWithOg(req, res, 'sign', req.params.token));

module.exports = router;
