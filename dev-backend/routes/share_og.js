// 공유 링크 미리보기 이미지 — 무인증 공개 문 (2026-10-30 · Irene «썸네일도 해당 이미지가 잡혀서 나오거나 없으면 메인 썸네일»).
//   GET /api/share-og/files/:token/og.jpg — 공유한 파일이 이미지일 때 그 이미지를 1200폭 JPEG 로 줄여 준다.
//   판정은 ogSources.fileShareOgEligible 한 곳(봇 응답 middleware/ogMeta 가 주소를 낼 때와 같은 함수) — 아니면 404
//   (비밀번호·만료·회수·등급 때문인지 «없는» 것인지 흘리지 않는다). 내용은 링크를 받은 사람이 이미 받을 수 있는 것과 같다.
//   크롤러 캐시는 짧게(10분) — 공유를 거두면 우리 쪽에서는 바로 닫힌다(남의 캐시는 못 지운다).
const express = require('express');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { fileShareOgEligible } = require('../services/ogSources');

const router = express.Router();

// 크롤러가 한꺼번에 와도 넉넉히, 한 IP 가 긁어 가는 것만 막는다 (insight_og 와 같은 값)
const limiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

router.get('/files/:token/og.jpg', limiter, async (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return res.status(404).end();
    const { File } = require('../models');
    const f = await File.findOne({
      where: { share_token: token, deleted_at: null },
      attributes: ['id', 'business_id', 'file_name', 'mime_type', 'file_path', 'storage_provider', 'external_id',
        'share_token', 'share_expires_at', 'share_password_hash', 'security_level', 'deleted_at'],
    });
    if (!fileShareOgEligible(f)) return res.status(404).end();
    const resize = require('../services/imageResize');
    const out = await resize.ogJpegPath(async () => {
      const body = await require('../services/attachmentStorage').readAttachmentBody(f);
      if (!body.ok || body.redirect) return null;
      if (body.abs) return body.abs;
      if (!body.stream) return null;
      const chunks = []; let n = 0;
      for await (const c of body.stream) {
        n += c.length;
        if (n > resize.MAX_STREAM_BYTES) { body.stream.destroy(); return null; }
        chunks.push(c);
      }
      return Buffer.concat(chunks);
    }, `file:${f.id}`);
    if (!out || !fs.existsSync(out)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=600');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.type('image/jpeg');
    return res.sendFile(out);
  } catch (e) { next(e); }
});

module.exports = router;
