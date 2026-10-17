// routes/name_cards_public.js — 내 명함 **무인증** 표면 `/api/name-cards/public/:token`. 설계 docs/BUSINESS_CARD_DESIGN.md
//
// ★ 할 수 있는 것은 셋 — 명함 읽기 · 사진 · 연락처 파일(.vcf). 쓰는 경로는 없다(보관은 인증 라우트 POST /api/name-cards/saved).
// ★ 열림 판정은 services/nameCard.resolvePublicCard 한 함수 — 없음·꺼짐·이름 없음·계정 비활성·미인증이 **같은 404**.
// ★ 응답은 cardPublicView 화이트리스트 — id·user_id·명함 이름(label)·토큰을 싣지 않는다.
// ★ 개인 연락처·얼굴이라 색인 차단(X-Robots-Tag) — 페이지 HTML 의 noindex 는 nginx `location ^~ /c/` 가 붙인다.
// ★ 인쇄된 QR 은 영구다 — shareTokenCleanup(30일 비사용 토큰 정리)에 넣지 않는다.
// 레이트리밋: 한 번 열면 JSON·사진·vcf 세 요청이다. 행사장 NAT(한 IP 에 수십 명)를 생각해 IP 한도는 JSON 에만 느슨하게(Fable 비차단).
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { guestLimiter } = require('./guest_common');
const nc = require('../services/nameCard');

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

const ipLimiter = (name, windowMs, max) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (r) => `${name}-${ipKeyGenerator(r.ip)}`,
  message: { success: false, message: 'too_many_requests' },
});

function noIndex(res) { res.set('X-Robots-Tag', 'noindex, nofollow'); }

router.get('/:token',
  guestLimiter('card-get', { windowMs: 60 * 1000, max: 120 }),
  ipLimiter('card-get-ip', 60 * 1000, 240),
  async (req, res, next) => {
    try {
      noIndex(res);
      res.set('Cache-Control', 'no-store');
      const card = await nc.resolvePublicCard(req.params.token);
      if (!card) return errorResponse(res, 'not_found', 404);
      return successResponse(res, nc.cardPublicView(card));
    } catch (e) { return next(e); }
  });

router.get('/:token/photo',
  guestLimiter('card-photo', { windowMs: 60 * 1000, max: 600 }),
  async (req, res, next) => {
    try {
      noIndex(res);
      const card = await nc.resolvePublicCard(req.params.token);
      const buf = card && card.has_photo ? nc.readIfExists(nc.cardPhotoPath(card.id)) : null;
      if (!buf) return errorResponse(res, 'not_found', 404);
      // 짧은 캐시만 — 주인이 사진을 지우거나 링크를 끄면 곧 사라져야 한다(주소에 ?v= 가 붙어 바꾼 사진은 바로 보인다)
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
      return res.send(buf);
    } catch (e) { return next(e); }
  });

router.get('/:token/vcf',
  guestLimiter('card-vcf', { windowMs: 60 * 1000, max: 60 }),
  ipLimiter('card-vcf-ip', 60 * 1000, 120),
  async (req, res, next) => {
    try {
      noIndex(res);
      const card = await nc.resolvePublicCard(req.params.token);
      if (!card) return errorResponse(res, 'not_found', 404);
      const view = nc.cardPublicView(card);
      const photo = card.has_photo ? nc.readIfExists(nc.cardPhotoPath(card.id)) : null;
      res.set({ 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': nc.vcardFilename(view), 'Cache-Control': 'no-store' });
      return res.send(nc.toVcard(view, { photo, url: `${APP_URL}/c/${card.public_token}` }));
    } catch (e) { return next(e); }
  });

module.exports = router;
