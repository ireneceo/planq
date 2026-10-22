// 인사이트 글별 링크 미리보기 이미지 — 무인증 공개 문 (2026-10-22 SNS 발송 단계 1 · Fable 설계 지적 1).
//   GET /api/insights/:slug/og.jpg — 이 꼬리 하나만 둔다(같은 접두어의 routes/insights.js 는 로그인 Cue 카드라 이 파일을 앞에 마운트).
//   판정: ogSources.publishedInsightWhere(slug) ∧ og_image_path 있음 ∧ 파일이 social/ 아래 실제로 있음 — 아니면 404
//         (미발행·비공개 글인지 «없는» 글인지 흘리지 않는다). uploads 디렉토리는 통째로 열지 않는다 — 이 파일 한 장만 보낸다.
//   이미지는 이미 공개된 글의 제목·요약을 그린 것이라 비밀이 아니다 → 하루 공개 캐시(다시 만들면 주소의 ?v= 가 바뀐다).
const express = require('express');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { publishedInsightWhere } = require('../services/ogSources');
const { resolveSocialFile } = require('../services/social/cardRender');

const router = express.Router();

// 크롤러가 한꺼번에 와도 넉넉히, 한 IP 가 긁어 가는 것만 막는다
const limiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

router.get('/:slug/og.jpg', limiter, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '');
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(slug)) return res.status(404).end();
    const HelpArticle = require('../models/HelpArticle');
    const a = await HelpArticle.findOne({ where: publishedInsightWhere(slug), attributes: ['id', 'og_image_path'] });
    const abs = a && resolveSocialFile(a.og_image_path);
    if (!abs || !fs.existsSync(abs)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('image/jpeg');
    return res.sendFile(abs);
  } catch (e) { next(e); }
});

module.exports = router;
