// routes/email_oauth_gmail.js — Gmail OAuth 연결 (앱 비밀번호 대체).
//
// email_accounts.js 에서 절출했다. 500줄 라우트 한도(가드)를 넘겨서이기도 하지만, 절단면이
// 원래 분명하다 — 계정 CRUD 와 OAuth 동의/콜백은 다른 축이다.
//
// ★ 현재 이 경로의 **동의 요청은 막혀 있다** (2026-08-19, Irene 결정).
//   Google OAuth 검증을 캘린더만으로 제출하기로 하면서 Cloud Console 에서
//   `https://mail.google.com/`(RESTRICTED)을 뺀다. Console 에 없는 scope 로 동의 화면을 띄우면
//   사용자는 "액세스 차단됨: 승인되지 않은 요청" 만 보게 된다.
//   판정은 services/googleScopes.isConsentDisabled 단일 원천. 콜백은 그대로 둔다 —
//   진행 중이던 흐름이 중간에 끊기지 않게. 기존 연결의 토큰 갱신·수신은 이 파일을 지나지 않는다.
//   Console 에 다시 등록하면 googleScopes 의 집합에서 'gmail' 만 빼면 된다.
const express = require('express');
const router = express.Router();
const { EmailAccount } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { encrypt } = require('../services/encryption');

function isAdmin(req) {
  return req.businessRole === 'owner'
    || req.businessRole === 'admin'
    || req.user?.platform_role === 'platform_admin';
}

// ─── Gmail OAuth (N+70 Task C) — 앱 비밀번호 대체 ───────────────────
// GET /api/businesses/:businessId/email-accounts/oauth/gmail/initiate?return_to=...
//   → Google OAuth URL 302 redirect (scope: https://mail.google.com/ + email + profile)
router.get('/:businessId/email-accounts/oauth/gmail/initiate', authenticateToken, checkBusinessAccess, async (req, res) => {
  try {
    // scope: 'personal'(개인, 본인만) | 'team'(회사 공용). team 은 admin 만.
    const scope = req.query.scope === 'personal' ? 'personal' : 'team';
    if (scope === 'team' && !isAdmin(req)) return res.status(403).send('admin only');
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).send('GOOGLE_CLIENT_ID 미설정');
    // Console 에 mail.google.com 이 없는 동안은 동의 화면을 띄우지 않는다 (services/googleScopes 단일 원천).
    //   기존 연결의 토큰 갱신·수신은 이 라우트를 지나지 않으므로 영향 없다.
    if (require('../services/googleScopes').isConsentDisabled('gmail')) {
      return res.status(400).json({ success: false, message: 'oauth_disabled_for_provider' });
    }
    const gmailOauth = require('../services/gmail_oauth');
    const url = gmailOauth.buildAuthUrl({
      businessId: Number(req.params.businessId),
      userId: req.user.id,
      returnUrl: req.query.return_to || '/business/settings/mail-accounts',
      scope,
    });
    // #82/#72 — auth_url 을 JSON 으로 반환. 프론트가 apiFetch(Bearer) 로 받아 window.location 이동.
    // (옛 방식: window.location.href 로 이 라우트 직접 진입 → 브라우저 네비게이션이 Bearer 미전달 →
    //  authenticateToken 401 "Access token required". connectPersonal 동일 패턴으로 통일.)
    return res.json({ success: true, data: { auth_url: url } });
  } catch (e) {
    console.error('[gmail-oauth/initiate]', e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

// GET /api/businesses/email-accounts/oauth/gmail/callback?code=&state=
//   → Google 이 redirect — code 교환 + EmailAccount 생성/갱신 + frontend redirect
//   (note: 이 callback 은 business path 외부 — Google 가 등록한 redirect URI 그대로 사용)
router.get('/email-accounts/oauth/gmail/callback', async (req, res) => {
  // CSP 정합 — inline script X. 성공 시 302 redirect, 실패 시 settings 페이지에 ?error= 쿼리.
  // open redirect 방어 — returnUrl 은 상대경로(/ 시작, // 아님)만 허용. 그 외 기본으로 강제.
  const safeReturn = (returnUrl) => {
    const u = String(returnUrl || '');
    return (u.startsWith('/') && !u.startsWith('//')) ? u : '/business/settings/mail-accounts';
  };
  // 기존 쿼리(?scope=personal 등) 보존해 append — 개인 뷰 복귀 (F-3). hash 만 제거.
  const appendQuery = (returnUrl, key, val) => {
    const base = safeReturn(returnUrl).replace(/#.*$/, '');
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}${key}=${encodeURIComponent(val)}`;
  };
  const buildSuccessRedirect = (returnUrl, email) => appendQuery(returnUrl, 'gmail_connected', email);
  const buildErrorRedirect = (returnUrl, error) => appendQuery(returnUrl, 'gmail_error', error);

  let returnUrl = null;   // catch 에서도 개인 뷰 복귀하도록 바깥 스코프.
  try {
    const { code, state, error: oauthError } = req.query;
    const gmailOauth = require('../services/gmail_oauth');
    const parsed = state ? gmailOauth.decodeState(String(state)) : null;
    if (parsed) returnUrl = parsed.returnUrl;
    if (oauthError) return res.redirect(302, buildErrorRedirect(returnUrl, oauthError));
    if (!code || !state) return res.redirect(302, buildErrorRedirect(returnUrl, 'invalid_request'));
    if (!parsed) return res.redirect(302, buildErrorRedirect(null, 'invalid_state'));

    const tokens = await gmailOauth.exchangeCodeForTokens(String(code));
    const { encrypt } = require('../services/encryption');

    // scope: 'personal' → 본인 소유 / 'team' → 회사 공용 (owner null)
    const ownerUserId = parsed.scope === 'personal' ? parsed.userId : null;
    // 같은 email 이미 등록돼 있으면 갱신 (OAuth 토큰 교체)
    let acc = await EmailAccount.findOne({
      where: { business_id: parsed.businessId, email: tokens.email },
    });
    const teamCount = await EmailAccount.count({ where: { business_id: parsed.businessId, owner_user_id: null } });
    const isFirstTeam = parsed.scope !== 'personal' && teamCount === 0;

    // 발신 이름(display_name) — 이 값이 그대로 고객 메일함에 뜬다 (emailSend.js: `"이름" <주소>`).
    //   여태 구글 프로필 이름을 그대로 박아, 회사 대표 메일로 답장해도 개인 구글 계정명이 찍혔다
    //   (실사례: 회사 메일이 "IRENE WP" 로 발신 — 브랜드가 아니라 구글이 정한 이름).
    //   회사 공용 = 워크스페이스 브랜드 / 개인 = 그 사람의 워크스페이스 표시명. 둘 다 나중에 수정 가능.
    let defaultFromName = tokens.name || null;
    try {
      if (ownerUserId === null) {
        const { Business } = require('../models');
        const biz = await Business.findByPk(parsed.businessId, {
          attributes: ['mail_from_name', 'brand_name', 'name'],
        });
        defaultFromName = biz?.mail_from_name || biz?.brand_name || biz?.name || defaultFromName;
      } else {
        const { getMemberNameMap } = require('../services/displayName');
        const nameMap = await getMemberNameMap(parsed.businessId, [ownerUserId]);
        const dn = nameMap.get(ownerUserId);
        defaultFromName = dn?.name || dn?.name_localized || defaultFromName;
      }
    } catch (e) { console.warn('[gmail oauth] default from name', e.message); }
    // 재연결(토큰 갱신)이면 사용자가 정해둔 이름을 덮어쓰지 않는다
    const finalFromName = acc?.display_name || defaultFromName;

    const payload = {
      business_id: parsed.businessId,
      owner_user_id: ownerUserId,
      email: tokens.email,
      display_name: finalFromName,
      auth_type: 'google_oauth',
      oauth_access_token_encrypted: encrypt(tokens.access_token),
      oauth_refresh_token_encrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : (acc?.oauth_refresh_token_encrypted || null),
      oauth_expires_at: tokens.expires_at,
      oauth_scope: tokens.scope,
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      imap_username: tokens.email,
      imap_password_encrypted: null,    // OAuth 시 password 없음
      imap_tls: true,
      imap_folder: 'INBOX',
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_username: tokens.email,
      smtp_password_encrypted: null,
      smtp_tls: true,
      is_active: true,
    };
    if (acc) {
      // 재연결 — 소유(공용/개인)는 기존 값 보존 (token/연결정보만 갱신)
      delete payload.owner_user_id;
      await acc.update(payload);
    } else {
      payload.is_default = isFirstTeam;
      acc = await EmailAccount.create(payload);
    }
    require('../services/emailImapCron').startIdleForAccount(acc).catch((e) => console.error('[idle-start-oauth]', e.message)); // OAuth 연결/재연결 → 즉시 IMAP IDLE 재시작
    return res.redirect(302, buildSuccessRedirect(parsed.returnUrl, tokens.email));
  } catch (e) {
    console.error('[gmail-oauth/callback]', e);
    return res.redirect(302, buildErrorRedirect(returnUrl, e.message));
  }
});

module.exports = router;
