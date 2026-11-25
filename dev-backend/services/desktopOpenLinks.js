// services/desktopOpenLinks.js — «PlanQ 링크를 데스크탑 앱에서 열기» 서버 몫 (2026-11-25, Fable 설계 판정 4).
//   브라우저 웹이 «앱에서 열기» 띠를 보여도 되는가 = 이 사람에게 **링크를 받을 수 있는 껍데기**의 데스크탑 세션이 살아 있는가.
//   표시는 토큰 행(refresh_tokens.open_links) — 사용자 단위로 두면 옛 1.1.0 껍데기(planq://open 을 버림)와 섞인다.
//   표시하는 쪽은 껍데기 안 웹뿐(preload capabilities.openLinks) · 자기 쿠키의 desktop 행에만.
const { Op } = require('sequelize');
const { RefreshToken } = require('../models');
const deviceAccounts = require('./deviceAccounts');

/** /me 에 싣는 불리언 — desktop · 미회수 · 미만료 · 표시 있음 */
async function hasOpenLinksDesktop(userId) {
  if (!userId) return false;
  const row = await RefreshToken.findOne({
    where: { user_id: userId, client_kind: 'desktop', open_links: true, revoked_at: null, expires_at: { [Op.gt]: new Date() } },
    attributes: ['id'],
  });
  return !!row;
}

/** 이 요청의 쿠키(지금 계정 몫)가 desktop 세션이면 그 행에 표시. 다른 종류면 아무것도 안 한다. */
async function markFromRequest(req) {
  const uid = Number(req.user && req.user.id);
  if (!uid) return { marked: false, reason: 'no_user' };
  const raw = deviceAccounts.readBundle(req)[uid];
  if (!raw) return { marked: false, reason: 'no_cookie' };
  const r = await deviceAccounts.inspectRaw(uid, raw);
  if (!r.valid || !r.row) return { marked: false, reason: r.reason || 'invalid' };
  if (r.row.client_kind !== 'desktop') return { marked: false, reason: 'not_desktop' };
  // 회전 직후(옛 쿠키가 아직 유예 안) — 옛 행에 찍으면 후속이 못 물려받는다. 웹(DesktopBridge)이 20초 뒤 한 번 더 부른다.
  if (r.row.revoked_at) return { marked: false, reason: 'rotated' };
  if (!r.row.open_links) await r.row.update({ open_links: true });
  return { marked: true };
}

module.exports = { hasOpenLinksDesktop, markFromRequest };
