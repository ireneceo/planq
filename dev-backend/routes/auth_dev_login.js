// ============================================
// POST /api/auth/dev-login { code }  — 개발서버 전용 «시험 계정으로 열기» (2026-10-12)
//
// 상황판 «확인할 곳» 줄 끝 `[as=<역할키> ws=<번호>]` → 상황판이 90초·1회용 서명 코드를 만들어
// https://dev.planq.kr/dev-login#code=… 로 보낸다. 이 라우트는 그 코드를 검증하고
// **보통 /login 과 같은 세션**(issueLoginSession)을 준다 — 대리 로그인 토큰이 아니다
// (impersonator 토큰은 워크스페이스 전환이 막혀 범위를 맞출 수 없다).
// 계약 정본: ~/dev-server/kit/DEV-LOGIN.md · 검증기 services/devLogin/verify.js(키트 사본 그대로).
//
// ★ 이 파일은 server.js 가 devLoginEnabled() 일 때만 마운트한다(NODE_ENV==='development' ∧ 비밀 32자 이상).
//   운영에는 라우트가 없다(404). 운영 .env 에 DEV_LOGIN_SECRET 이 있으면 배포 가드가 막는다.
// ============================================
const express = require('express');
const { User, Business, BusinessMember, Client } = require('../models');
const { successResponse } = require('../middleware/errorHandler');
const { verifyDevLoginCode } = require('../services/devLogin/verify');
const { helpers } = require('./auth');

const router = express.Router();

// 역할키 → 시험 계정. 코드에 이메일을 싣지 않는다(코드는 역할키만 말한다).
//   표는 CLAUDE.md «시험 역할» 과 같다 — 바꾸면 둘을 같이 고친다.
const ROLE_ACCOUNTS = {
  owner: 'owner@test.planq.kr',
  member: 'member1@test.planq.kr',
  member2: 'member2@test.planq.kr',
  client: 'client@test.planq.kr',
  admin: 'admin@test.planq.kr',
};
const TEST_DOMAIN = '@test.planq.kr';

// 시험 계정이 들어가도 되는 워크스페이스 — scripts/create-test-accounts.js 가 만드는 두 곳(slug).
//   ★ dev 에서 member1·member2 는 «워프로랩»(ws 3)에도 멤버라, 멤버십만 보면 시험 계정이 그 화면을 연다.
//   범위는 «멤버십 ∧ 시험 워크스페이스» 둘 다 본다.
const TEST_WORKSPACE_SLUGS = ['planq-test', 'brand-partners-test'];
const DEFAULT_WS_SLUG = 'planq-test';   // 범위를 안 준 워크스페이스 역할은 여기로(옛 active 가 ws 3 인 계정이 있다)

const fail = (res, status, error) => res.status(status).json({ success: false, error, message: error });

async function canUse(userId, businessId) {
  const m = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId, removed_at: null } });
  if (m) return true;
  const c = await Client.findOne({ where: { user_id: userId, business_id: businessId, status: 'active' } });
  return !!c;
}

// audit-exempt: 로그인 자체가 authAudit.signInOk(method 'dev_login') 로 남는다
router.post('/dev-login', async (req, res, next) => {
  try {
    const v = verifyDevLoginCode(req.body && req.body.code);
    if (!v.ok) return fail(res, v.status, v.error);

    const email = Object.prototype.hasOwnProperty.call(ROLE_ACCOUNTS, v.as) ? ROLE_ACCOUNTS[v.as] : null;
    if (!email) return fail(res, 400, 'unknown_role');

    // 둘째 문 — 맵에 있어도 시험 도메인·활성·사람 계정이어야 한다.
    const user = await User.findOne({ where: { email } });
    if (!user || !String(user.email).toLowerCase().endsWith(TEST_DOMAIN) || user.is_ai || user.is_guest || user.status !== 'active') {
      return fail(res, 403, 'not_test_account');
    }

    // 범위 — 이름은 ws 하나. 모르는 범위 이름은 거절(조용히 무시하면 엉뚱한 화면을 «확인» 한다).
    const scope = v.scope || {};
    const keys = Object.keys(scope);
    if (keys.some((k) => k !== 'ws')) return fail(res, 403, 'scope_not_allowed');
    const testBiz = await Business.findAll({ where: { slug: TEST_WORKSPACE_SLUGS, deleted_at: null }, attributes: ['id', 'slug'] });
    let targetId = null;
    if (scope.ws != null) {
      targetId = Number(scope.ws);
      if (!Number.isInteger(targetId) || targetId <= 0) return fail(res, 403, 'scope_not_allowed');
      if (!testBiz.some((b) => b.id === targetId)) return fail(res, 403, 'scope_not_allowed');
      if (!(await canUse(user.id, targetId))) return fail(res, 403, 'scope_not_allowed');
    } else if (user.platform_role !== 'platform_admin') {
      const def = testBiz.find((b) => b.slug === DEFAULT_WS_SLUG);
      if (def && (await canUse(user.id, def.id))) targetId = def.id;
    }
    // 앱의 전환과 같은 정본 — users.active_business_id (routes/auth.js switch-workspace 와 같은 칸)
    //   읽지 않고 쓴다(멱등) — 정본은 범위를 «정하는» 곳에서만 쓴다(guard wsscope).
    if (targetId) {
      await User.update({ active_business_id: targetId }, { where: { id: user.id } });
      await user.reload();
      try {
        const io = req.app.get('io');
        if (io) io.to(`user:${user.id}`).emit('workspace:switched', { user_id: user.id, business_id: targetId });
      } catch (_) { /* best-effort */ }
    }

    const { accessToken, userData } = await helpers.issueLoginSession(req, res, user, { method: 'dev_login' });
    console.log('[dev-login] as=%s user=%d ws=%s next=%s', v.as, user.id, targetId || '-', v.next);
    successResponse(res, {
      token: accessToken,
      user: userData,
      dev_login: { as: v.as, scope: v.scope, next: v.next },
    }, 'Login successful');
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.ROLE_ACCOUNTS = ROLE_ACCOUNTS;
