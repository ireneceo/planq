// 랜딩 방문 집계 — 쿠키 없음 · 숫자만 (2026-09-21).
//   Irene: "방문자가 왜 이렇게 적어" → 잴 도구부터 없었다. GA4 는 운영 CSP(외부 스크립트 차단)를 풀어야 해
//   root 가 필요하고 쿠키 동의도 따라온다 → 우리 서버에 숫자만 남긴다.
//
//   POST /api/landing-visits          (공개) — 랜딩 화면이 페이지를 열 때 한 번 보낸다(sendBeacon)
//   GET  /api/landing-visits/admin    (플랫폼 관리자) — 최근 N일 요약
//
// ★ 공개 라우트라 받는 것을 좁힌다: ①랜딩 주소만(seo-pages.json 목록 + 인사이트·위키 글 모양) ②봇 제외
//   ③IP 당 분당 60회 ④IP·브라우저는 저장하지 않는다 — 순방문자는 하루마다 바뀌는 비밀로 만든 해시만.
//   워크스페이스(그룹웨어) 화면은 대상이 아니다.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const router = express.Router();
const { sequelize } = require('../config/database');
const { LandingVisit, LandingVisitor } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const { frontendDir } = require('../services/seoArtifacts');

const BOT_RE = /bot|crawl|spider|slurp|yeti|daum(oa)?|bingpreview|facebookexternalhit|embedly|headless|lighthouse|pagespeed|curl|wget|python|axios|node-fetch|go-http|java\//i;
const MOBILE_RE = /mobi|android|iphone|ipad|ipod/i;
const ARTICLE_RE = /^\/(insights\/[a-z0-9][a-z0-9-]{0,120}|wiki\/a\/[a-z0-9][a-z0-9-]{0,120})\/$/;

// 랜딩 주소 목록 — 빌드에 실린 seo-pages.json(정본). 10분 캐시.
let pagesCache = { at: 0, set: new Set() };
function landingPaths() {
  if (Date.now() - pagesCache.at < 10 * 60 * 1000 && pagesCache.set.size) return pagesCache.set;
  const set = new Set();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(frontendDir(), 'seo-pages.json'), 'utf8'));
    for (const p of cfg.pages || []) set.add(normPath(p.path));
  } catch { set.add('/'); }
  pagesCache = { at: Date.now(), set };
  return set;
}
/** /features → /features/ (대표 주소 모양). 홈은 '/'. 쿼리·해시는 버린다. */
function normPath(p) {
  let s = String(p || '').split(/[?#]/)[0].trim();
  if (!s.startsWith('/')) return null;
  if (s.length > 200) return null;
  if (s !== '/' && !s.endsWith('/') && !/\.[a-z0-9]+$/i.test(s)) s += '/';
  return s.toLowerCase();
}
function allowedPath(p) {
  const n = normPath(p);
  if (!n) return null;
  const pages = landingPaths();
  if (pages.has(n) || pages.has(n.replace(/\/$/, ''))) return n;
  if (ARTICLE_RE.test(n)) return n;
  return null;
}
function sourceOf(ref) {
  const r = String(ref || '').trim();
  if (!r) return 'direct';
  if (r === 'internal') return 'internal';
  let host = '';
  try { host = new URL(r).hostname.toLowerCase().replace(/^www\./, ''); } catch { return 'other'; }
  if (!host) return 'direct';
  if (host === 'planq.kr' || host.endsWith('.planq.kr')) return 'internal';
  if (host.includes('naver')) return 'naver';
  if (host.includes('google')) return 'google';
  if (host.includes('daum') || host.includes('kakao')) return 'daum/kakao';
  if (host.includes('bing')) return 'bing';
  return host.slice(0, 80);
}
const kstDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

const visitLimiter = perUserLimiter('landing-visit', { windowMs: 60 * 1000, max: 60 });

router.post('/', visitLimiter, async (req, res) => {
  // 어떤 경우에도 204 — 공개 표면이라 무엇이 걸렸는지 알려 주지 않는다(재시도 유도 방지)
  try {
    const ua = String(req.get('user-agent') || '');
    if (!ua || BOT_RE.test(ua)) return res.status(204).end();
    const b = req.body || {};
    const p = allowedPath(b.p);
    if (!p) return res.status(204).end();
    const date = kstDate();
    const source = sourceOf(b.r);
    const device = MOBILE_RE.test(ua) ? 'mobile' : 'desktop';
    await sequelize.query(
      `INSERT INTO landing_visits (visit_date, path, source, device, views, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE views = views + 1, updated_at = NOW()`,
      { replacements: [date, p, source, device] },
    );
    // 순방문자 — IP·브라우저는 해시에만 쓰고 버린다. 비밀은 저장하지 않으므로 날이 바뀌면 이어지지 않는다.
    const secret = process.env.JWT_SECRET || 'planq';
    const hash = crypto.createHash('sha256').update(`${secret}:${date}:${req.ip}:${ua}`).digest('hex').slice(0, 32);
    await sequelize.query(
      'INSERT IGNORE INTO landing_visitors (visit_date, visitor_hash, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
      { replacements: [date, hash] },
    );
  } catch (e) { console.warn('[landing-visit]', e.message); }
  return res.status(204).end();
});

// 플랫폼 관리자 — 최근 N일(7~180) 요약
router.get('/admin', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const days = Math.min(180, Math.max(7, Number(req.query.days) || 30));
    const since = kstDate(new Date(Date.now() - (days - 1) * 86400000));
    const [daily] = await sequelize.query(
      // 날짜는 **글자로** 만든다 — DATE 를 JS Date 로 받으면 서버 시간대에 따라 하루 밀린다(memory feedback_dateonly_string_slice_corrupts)
      `SELECT DATE_FORMAT(d.visit_date, '%Y-%m-%d') AS date, d.views, COALESCE(v.visitors, 0) AS visitors
         FROM (SELECT visit_date, SUM(views) views FROM landing_visits WHERE visit_date >= ? AND source <> 'internal' GROUP BY visit_date) d
         LEFT JOIN (SELECT visit_date, COUNT(*) visitors FROM landing_visitors WHERE visit_date >= ? GROUP BY visit_date) v
           ON v.visit_date = d.visit_date
        ORDER BY d.visit_date`,
      { replacements: [since, since] },
    );
    const sum = (col, extra = '') => sequelize.query(
      `SELECT ${col} k, SUM(views) n FROM landing_visits WHERE visit_date >= ? ${extra} GROUP BY ${col} ORDER BY n DESC LIMIT 20`,
      { replacements: [since] },
    ).then(([r]) => r.map((x) => ({ key: x.k, views: Number(x.n) })));
    const [pages, sources, devices] = await Promise.all([
      sum('path'), sum('source', "AND source <> 'internal'"), sum('device'),
    ]);
    const [[vt]] = await sequelize.query('SELECT COUNT(*) n FROM landing_visitors WHERE visit_date >= ?', { replacements: [since] });
    const totalViews = daily.reduce((a, r) => a + Number(r.views), 0);
    // 들어온 경로 합계에서 사이트 안 이동(internal)은 빼고 «들어온 방문» 만 센다 — 페이지별은 전부 센다
    return successResponse(res, {
      days, since,
      totals: { entries: totalViews, visitor_days: Number(vt.n) },
      daily: daily.map((r) => ({ date: r.date, views: Number(r.views), visitors: Number(r.visitors) })),
      pages, sources, devices,
    });
  } catch (err) { next(err); }
});

/** 보관 기간 — 400일 지난 집계를 지운다(서버 매일 0시). */
async function pruneLandingVisits() {
  const cut = kstDate(new Date(Date.now() - 400 * 86400000));
  const a = await LandingVisit.destroy({ where: { visit_date: { [Op.lt]: cut } } });
  const b = await LandingVisitor.destroy({ where: { visit_date: { [Op.lt]: cut } } });
  return { visits: a, visitors: b };
}

module.exports = router;
module.exports.pruneLandingVisits = pruneLandingVisits;
module.exports._test = { normPath, allowedPath, sourceOf, BOT_RE };
