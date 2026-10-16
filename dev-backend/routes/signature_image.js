// 서명 이미지 — GET /api/signatures/:id/image?i=<칸 번호>
//   signatures.js god-file 분리(2026-10-16, signature_internal 선례). 꼬리 경로가 고유해 signatures 와 겹치지 않는다.
//   판정·응답은 옮기기 전과 한 글자도 같다(멤버 술어는 services/signatureCore 한 곳).
const express = require('express');
const router = express.Router();
const { SignatureRequest } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { errorResponse } = require('../middleware/errorHandler');
const { signedImagesOf } = require('../services/signatureItems');
const { canReadPostFn, postOfRequest, assertMember } = require('../services/signatureCore');

// GET /api/signatures/:id/image?i=<칸 번호> — 서명 이미지 (진행 표 썸네일·크게 보기·받은 서명)
//   ★ 2026-09-22 — 진행 표 응답은 이미지 본문 대신 '(present)' 를 싣고 «별도 GET» 으로 받는다고 적혀 있었는데
//     그 GET 이 **없었다.** 화면은 '(present)' 면 이미지를 숨겨서, 서명된 행이 늘 «—» 였다.
//   ★ 2026-10-16 — 서명 칸이 여럿(사인 + 회사 스탬프)이면 `?i=` 로 그 칸. 없으면 0(옛 요청 호환).
//     여태 첫 장만 줘서 «서명 2개 했는데 완료 뒤 1개만» 이었다. 장 수는 진행 표 응답의 signature_image_count.
//   권한은 형제 문(목록 GET)과 같다 — 같은 워크스페이스 멤버 + 문서 읽기.
//     그리고 **서명한 본인**(받은 서명 목록 — 고객은 멤버가 아니다). 자기 서명이라 넓히는 것이 아니다.
router.get('/signatures/:id/image', authenticateToken, async (req, res, next) => {
  try {
    const sr = await SignatureRequest.findByPk(req.params.id);
    const imgs = sr ? signedImagesOf(sr) : [];
    const i = req.query.i == null ? 0 : Number(req.query.i);
    if (!Number.isInteger(i) || i < 0 || i >= imgs.length) return errorResponse(res, 'not_found', 404);
    const mine = !!(req.user.email && sr.signer_email
      && String(sr.signer_email).toLowerCase() === String(req.user.email).toLowerCase());
    if (!mine) {
      if (!(await assertMember(req.user.id, sr.business_id, req.user.platform_role === 'platform_admin'))) {
        return errorResponse(res, 'forbidden', 403);
      }
      const imgPost = await postOfRequest(sr);
      if (!imgPost || !(await canReadPostFn()(req.user, imgPost))) return errorResponse(res, imgPost ? 'forbidden' : 'not_found', imgPost ? 403 : 404);
    }
    // 저장 쪽(signatureItems DATA_URL)이 jpg 도 받으므로 여기서도 — 안 그러면 data:image/jpg 스탬프가 422
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(imgs[i]));
    if (!m) return errorResponse(res, 'invalid_image', 422);
    const sub = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
    res.set('Content-Type', `image/${sub}`);
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(Buffer.from(m[2], 'base64'));
  } catch (err) { next(err); }
});

module.exports = router;
