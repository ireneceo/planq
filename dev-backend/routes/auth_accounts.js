// routes/auth_accounts.js — 한 기기에 로그인해 둔 여러 계정: 목록 · 전환 · 추가 의도.
//   설계 정본 docs/MULTI_ACCOUNT_DESIGN.md 7절 (Fable 설계 판정 반영). 쿠키 규칙은 services/deviceAccounts 한 곳.
//   마운트: server.js `/api/auth` (쿠키 path 가 /api/auth 라 이 경로들에만 계정 쿠키가 실려 온다).
const express = require('express');
const router = express.Router();
const { User, Business } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const deviceAccounts = require('../services/deviceAccounts');
const { generateAccessToken, setImageCookie, cookieSecure } = require('../services/authTokens');
const { unreadFor } = require('../services/accountUnread');
const { logAudit } = require('../services/auditService');

// GET /api/auth/device-accounts — 이 기기 계정 목록. **검증만**(회전·발급 없음) → 다중 탭 회전 경합 없음.
//   device_proof: 다른 경로(/api/push/subscribe)가 «이 기기 묶음» 을 알 수 있게 60초 서명 토큰.
// audit-exempt: 읽기 전용(쿠키 검증·목록) — 상태를 바꾸는 것은 미뤄 둔 «보통 로그인» 정리뿐이고 그건 로그인 감사로 남는다
router.get('/device-accounts', async (req, res, next) => {
  try {
    const bundle = await deviceAccounts.housekeep(req, res);
    const activeId = deviceAccounts.activeUid(req, bundle);
    const ids = Object.keys(bundle).map(Number);
    const checks = await Promise.all(ids.map((id) => deviceAccounts.inspectRaw(id, bundle[id])));
    const users = ids.length ? await User.findAll({
      where: { id: ids },
      limit: deviceAccounts.MAX_ACCOUNTS + 5,   // 이 기기 쿠키 수 이내(최대 5) — 목록 상한
      // wsscope-exempt: 계정 목록에 «그 계정이 마지막으로 쓴 워크스페이스 이름» 을 보여 주는 표시용(범위 판정 아님)
      attributes: ['id', 'name', 'email', 'avatar_url', 'status', 'is_ai', 'is_guest', 'active_business_id'],
    }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    // wsscope-exempt: 위와 같은 표시용 이름 조회
    const bizIds = [...new Set(users.map((u) => u.active_business_id).filter(Boolean))];
    const bizs = bizIds.length ? await Business.findAll({ where: { id: bizIds }, attributes: ['id', 'name', 'brand_name'], limit: 20 }) : [];
    const bizName = new Map(bizs.map((b) => [b.id, b.brand_name || b.name]));
    const accounts = [];
    for (let i = 0; i < ids.length; i++) {
      const u = byId.get(ids[i]);
      if (!u || u.is_ai || u.is_guest) continue;
      const valid = checks[i].valid && u.status === 'active';
      accounts.push({
        user_id: u.id,
        name: u.name,
        email: u.email,
        avatar_url: u.avatar_url || null,
        // wsscope-exempt: 표시용
        workspace_name: bizName.get(u.active_business_id) || null,
        valid,
        active: u.id === activeId,
        unread_total: valid && u.id !== activeId ? await unreadFor(u.id) : 0,
      });
    }
    accounts.sort((a, b) => (b.active - a.active) || (a.user_id - b.user_id));
    const validIds = accounts.filter((a) => a.valid).map((a) => a.user_id);
    return successResponse(res, {
      active_user_id: activeId,
      accounts,
      max: deviceAccounts.MAX_ACCOUNTS,
      device_proof: deviceAccounts.issueProof(validIds),
    });
  } catch (e) { next(e); }
});

// POST /api/auth/switch { user_id } — 이 기기의 지금 계정을 바꾸는 **유일한 문**(로그인 제외).
//   그 계정 쿠키가 이 기기에 있고 살아 있어야 한다. 회전은 하지 않는다 — 창이 다시 부팅하며 /refresh 로 회전한다.
router.post('/switch', async (req, res, next) => {
  try {
    const target = Number(req.body?.user_id || 0);
    if (!target) return errorResponse(res, 'user_id required', 400);
    const bundle = await deviceAccounts.housekeep(req, res);
    const raw = bundle[target];
    if (!raw) return errorResponse(res, 'Account not on this device', 404, 'not_on_device');
    const chk = await deviceAccounts.inspectRaw(target, raw);
    const user = chk.valid ? await User.findByPk(target) : null;
    if (!user || user.status !== 'active' || user.is_ai || user.is_guest) {
      return errorResponse(res, 'Sign in again', 401, 'relogin_required');
    }
    const fromId = deviceAccounts.activeUid(req, bundle);
    const maxAge = chk.row && chk.row.expires_at ? Math.max(0, new Date(chk.row.expires_at).getTime() - Date.now()) : undefined;
    deviceAccounts.setLast(res, target, maxAge);
    // 옛 refresh_token 도 지금 계정 것으로(롤백 대비 이중 쓰기 — 7절 4)
    const o = { httpOnly: true, secure: cookieSecure(res), sameSite: 'lax', path: deviceAccounts.COOKIE_PATH };
    res.cookie(deviceAccounts.LEGACY, raw, o);
    setImageCookie(res, user);   // 이미지 신원은 지금 계정으로만(7절 3)
    logAudit(req, {
      action: 'auth.account_switch', targetType: 'User', targetId: target, userId: target, businessId: null,
      oldValue: { user_id: fromId || null }, newValue: { user_id: target },
    });
    return successResponse(res, { user_id: target, token: generateAccessToken(user) });
  } catch (e) { next(e); }
});

// POST /api/auth/accounts/add-intent — «계정 추가» 를 누른 **로그인된 사람**만(유효 접속 토큰).
//   10분짜리 서명 쿠키 rt_add 를 남긴다 → 이어지는 로그인(비밀번호·가입·구글·애플)이 기존 계정을 지우지 않는다.
router.post('/accounts/add-intent', authenticateToken, async (req, res, next) => {
  try {
    const bundle = await deviceAccounts.housekeep(req, res);
    if (!bundle[req.user.id]) return errorResponse(res, 'Current account not on this device', 409, 'not_on_device');
    const valid = await deviceAccounts.validUids(req, bundle);
    if (valid.length >= deviceAccounts.MAX_ACCOUNTS) {
      return errorResponse(res, 'Too many accounts on this device', 409, 'account_limit');
    }
    deviceAccounts.setAddIntent(res, req.user.id);
    logAudit(req, {
      action: 'auth.account_add_intent', targetType: 'User', targetId: req.user.id, userId: req.user.id, businessId: null,
      newValue: { accounts: valid.length },
    });
    return successResponse(res, { ok: true, accounts: valid.length, max: deviceAccounts.MAX_ACCOUNTS });
  } catch (e) { next(e); }
});

module.exports = router;
