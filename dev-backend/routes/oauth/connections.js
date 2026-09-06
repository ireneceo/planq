// routes/oauth/connections.js — 계정 연결 확인 흐름 + Settings 연결 관리 API.
const { User, OauthConnection } = require('../../models');
const googleOauthLogin = require('../../services/google_oauth_login');
const { authenticateToken } = require('../../middleware/auth');
// CLAUDE.md — 모든 GET list 는 parsePagination + paginatedResponse (unbounded 응답 차단).
//   `data` 는 여전히 배열이라 기존 화면(ProfileIntegrationsPage 가 r2.data 를 그대로 쓴다)은 무변경.
const { parsePagination, paginatedResponse } = require('../../middleware/errorHandler');
const { confirmStash, issueSessionCookie } = require('./core');

module.exports = function registerConnectionRoutes(router) {
// ─── N+70 Task 62 — Connect Confirm 흐름 + Settings API ─────────
// 사용자가 옛 계정에 Google OAuth 를 attach 하는 흐름.
// 1. callback 분기 2 에서 redirect 시 token 발급
// 2. frontend /oauth/connect-confirm page 가 token 으로 정보 fetch
// 3. 사용자가 "예 연결" 클릭 → POST /api/auth/google/connect-confirm

// GET /api/auth/google/connect-confirm/info?token=...
router.get('/google/connect-confirm/info', (req, res) => {
  const token = String(req.query.token || '');
  const stash = confirmStash.get(token);
  if (!stash || stash.exp < Date.now()) {
    return res.status(400).json({ success: false, message: 'invalid_or_expired_token' });
  }
  // user lookup
  User.findByPk(stash.user_id, { attributes: ['id', 'email', 'name', 'avatar_url'] }).then(u => {
    if (!u) return res.status(404).json({ success: false, message: 'user_not_found' });
    res.json({
      success: true,
      data: {
        existing_user: { id: u.id, email: u.email, name: u.name, avatar_url: u.avatar_url },
        google: {
          email: stash.email,
          display_name: stash.display_name,
          picture: stash.picture,
        },
      },
    });
  }).catch(e => res.status(500).json({ success: false, message: e.message }));
});

// POST /api/auth/google/connect-confirm  body: { token, action: 'connect' | 'cancel' }
router.post('/google/connect-confirm', async (req, res) => {
  try {
    const { token, action } = req.body || {};
    const stash = confirmStash.get(String(token));
    if (!stash || stash.exp < Date.now()) {
      return res.status(400).json({ success: false, message: 'invalid_or_expired_token' });
    }
    confirmStash.delete(token);
    if (action !== 'connect') {
      return res.json({ success: true, data: { action: 'cancelled' } });
    }
    const user = await User.findByPk(stash.user_id);
    if (!user || user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'user_inactive' });
    }
    // OauthConnection 생성 (이미 다른 sub 가 user_id+google 에 있으면 교체)
    const existing = await OauthConnection.findOne({ where: { user_id: user.id, provider: 'google' } });
    if (existing) {
      await existing.update({
        subject: stash.subject,
        email: stash.email,
        display_name: stash.display_name,
        picture: stash.picture,
        last_used_at: new Date(),
      });
    } else {
      await OauthConnection.create({
        user_id: user.id,
        provider: 'google',
        subject: stash.subject,
        email: stash.email,
        display_name: stash.display_name,
        picture: stash.picture,
        connected_at: new Date(),
        last_used_at: new Date(),
      });
    }
    // 즉시 로그인 (refresh_token cookie set)
    await issueSessionCookie(req, res, user);
    res.json({ success: true, data: { action: 'connected', user_id: user.id, next: '/inbox' } });
  } catch (e) {
    console.error('[connect-confirm POST]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Settings 메뉴 API — 내 연결 list / 추가 / 해제 ─────────

// GET /api/auth/oauth-connections — 본인 연결 list
router.get('/oauth-connections', authenticateToken, async (req, res) => {
  try {
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await OauthConnection.findAndCountAll({
      where: { user_id: req.user.id },
      attributes: ['id', 'provider', 'email', 'display_name', 'picture', 'connected_at', 'last_used_at'],
      order: [['connected_at', 'DESC']],
      limit, offset,
    });
    return paginatedResponse(res, rows, count, { limit, page, offset });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/auth/oauth-connections/google/initiate — 로그인된 사용자가 Settings 에서 Google 연결 시작
router.post('/oauth-connections/google/initiate', authenticateToken, (req, res) => {
  // state 에 user_id 추가 — callback 에서 분기 2 거치지 않고 직접 연결
  // 단순화 — 기존 initiate 그대로 사용. callback 시 email 매칭으로 attach.
  // 향후: state encode user_id 로 명시 attach
  const { url } = googleOauthLogin.buildAuthUrl();
  res.json({ success: true, data: { auth_url: url } });
});

// DELETE /api/auth/oauth-connections/:id — 본인 연결 해제
router.delete('/oauth-connections/:id', authenticateToken, async (req, res) => {
  try {
    const conn = await OauthConnection.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!conn) return res.status(404).json({ success: false, message: 'not_found' });
    // 비밀번호 없는 OAuth-only 사용자는 마지막 연결 해제 차단 (lockout 방지)
    const user = await User.findByPk(req.user.id);
    const isOauthOnly = user.password_hash && user.password_hash.startsWith('$2a$12$oauth_no_password_set');
    const remainingCount = await OauthConnection.count({ where: { user_id: req.user.id } });
    if (isOauthOnly && remainingCount <= 1) {
      return res.status(400).json({ success: false, message: 'cannot_remove_last_oauth_method_set_password_first' });
    }
    await conn.destroy();
    res.json({ success: true, data: { disconnected: true } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
};
