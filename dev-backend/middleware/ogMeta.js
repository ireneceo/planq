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

const SHARE_BOT_UA = /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|SkypeUriPreview|TelegramBot|WhatsApp|KakaoTalk|Kakaotalk-scrap|Pinterest|Discordbot|Applebot|Embedly|Slack-ImgProxy|Mastodon|redditbot/i;

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

function buildHtml({ url, title, description, image, siteName }) {
  const t = escapeHtml(title || 'PlanQ');
  const d = escapeHtml(description || '');
  const img = escapeHtml(image || '');
  const u = escapeHtml(url || 'https://planq.kr');
  const sn = escapeHtml(siteName || 'PlanQ');
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
</head><body>
<p>${t}</p>
<p>${d}</p>
<p><a href="${u}">${u}</a></p>
</body></html>`;
}

function isShareBot(req) {
  const ua = req.headers['user-agent'] || '';
  return SHARE_BOT_UA.test(ua);
}

// 라우트별 OG 컨텐츠 resolver — 자기 source 우선, 없으면 platform 기본.
async function resolvePostShare(token, settings) {
  try {
    const { Post } = require('../models');
    const post = await Post.findOne({
      where: { share_token: token, status: 'published' },
      attributes: ['id', 'title', 'content_text', 'category'],
    });
    if (!post) return null;
    const baseTitle = (settings?.seo_title || settings?.brand || 'PlanQ');
    // content_text 200자 cap — OG description 표준 길이
    const preview = (post.content_text || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    return {
      title: `${baseTitle} — ${post.title || (post.category || '문서')}`,
      description: preview || settings?.seo_description || `${post.category || '문서'} - PlanQ 에서 공유한 문서입니다.`,
      image: settings?.og_image_url || `${process.env.APP_URL || 'https://planq.kr'}/og-default.png`,
      siteName: settings?.brand || 'PlanQ',
    };
  } catch { return null; }
}

async function resolveSignShare(token, settings) {
  try {
    const { SignatureRequest, Post, Document } = require('../models');
    const sr = await SignatureRequest.findOne({
      where: { share_token: token },
      attributes: ['entity_type', 'entity_id'],
    });
    if (!sr) return null;
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

// Express middleware — 봇 + 알려진 share path 면 dynamic OG HTML 반환.
// 일반 사용자 / 봇이지만 path 가 인식 안 되면 next() 로 통과 (SPA index.html 정적 응답으로 fallback).
async function ogMetaMiddleware(req, res, next) {
  if (!isShareBot(req)) return next();
  if (req.method !== 'GET') return next();
  const url = req.originalUrl || req.url;
  // path 추출 (query string 제외)
  const pathOnly = url.split('?')[0];
  const settings = await loadSettings();

  // 1) /public/posts/:token
  let m = pathOnly.match(/^\/public\/posts\/([A-Za-z0-9_-]+)$/);
  if (m) {
    const data = await resolvePostShare(m[1], settings);
    if (data) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(buildHtml({ url: `https://planq.kr${pathOnly}`, ...data }));
    }
  }
  // 2) /sign/:token
  m = pathOnly.match(/^\/sign\/([A-Za-z0-9_-]+)$/);
  if (m) {
    const data = await resolveSignShare(m[1], settings);
    if (data) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(buildHtml({ url: `https://planq.kr${pathOnly}`, ...data }));
    }
  }
  // 3) 그 외 = 기본 (랜딩) OG
  const base = settings || {};
  const data = {
    title: base.seo_title || `${base.brand || 'PlanQ'} — ${base.tagline || '일이 일이 되지 않게'}`,
    description: base.seo_description || base.tagline || '업무·프로젝트·사람·시간·고객·청구를 하나로 연결해 시간을 돈으로 바꾸는 수익성 엔진.',
    image: base.og_image_url || `${process.env.APP_URL || 'https://planq.kr'}/og-default.png`,
    siteName: base.brand || 'PlanQ',
  };
  res.set('Content-Type', 'text/html; charset=utf-8');
  return res.send(buildHtml({ url: `https://planq.kr${pathOnly}`, ...data }));
}

module.exports = { ogMetaMiddleware, invalidatePlatformCache, isShareBot, SHARE_BOT_UA };
