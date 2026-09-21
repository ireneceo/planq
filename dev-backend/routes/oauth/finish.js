// routes/oauth/finish.js — 외부 로그인(구글·애플) 콜백의 **공통 끝부분**.
//
// ★ 2026-09-21 Sign in with Apple 추가 때 구글 콜백에서 뽑아냈다. 공급자마다 이 3분기를
//   베끼면 한쪽만 고쳐진다 — 시스템 계정 제외(#259)·네이티브 연결확인 분기(2026-09-04)·
//   실패 착지(2026-09-10) 모두 **구글 한 곳을 고친 뒤 다시 발견된** 수리들이다.
//
// 공급자별로 다른 것은 **둘뿐**이다: ①프로필을 얻는 법 ②"네이티브 흐름인가" 를 아는 법.
//   구글은 GET 콜백이라 쿠키(oauth_native)로 알고, 애플은 appleid.apple.com 에서 오는
//   **교차 사이트 POST**(form_post)라 SameSite=Lax 쿠키가 실려 오지 않는다 → state 에 실어 온다.
//   그래서 native 는 호출부가 **명시적으로** 넘긴다(쿠키를 여기서 다시 읽지 않는다).
const { Op } = require('sequelize');
const { User, OauthConnection } = require('../../models');
// ★ sequelize 는 models 에서 오지 않는다(models/index.js 가 내보내지 않는다) — 옛 구글 콜백이
//   `require('../../models').sequelize` 로 받아 **undefined.transaction()** 이 되어 구글 신규 가입이
//   운영에서 한 번도 성공하지 못했다(2026-08-27 로그 4건 · 운영 OAuth 전용 가입자 0명). 2026-09-21 발견.
const { sequelize } = require('../../config/database');
const { sendNativeReturn } = require('../../utils/nativeReturn');
const { logOauthFailure } = require('../../utils/oauthLog');
const oauthPairing = require('../../services/oauthPairing');
const {
  stashConfirm, issueNativeOAuthCode, setupNewWorkspace, buildRedirectTarget, issueSessionCookie,
} = require('./core');

const PROVIDER_LABEL = { google: 'Google', apple: 'Apple' };

/**
 * 로그인 실패 착지 — **네이티브 흐름이면 복귀 페이지**, 웹이면 /login?oauth_error=.
 *   여태 네이티브 실패도 웹 로그인 화면으로 302 해서 사용자가 팝오버 안에 갇혔다(2026-09-10).
 */
function failLogin(req, res, reason, { native, provider = 'google' } = {}) {
  const code = String(reason || 'oauth_failed').slice(0, 64);
  if (!native) {
    // 공급자를 붙여 로그인 화면이 «Apple 로그인이…» 로 말하게 한다(구글은 종전 주소 그대로).
    const target = buildRedirectTarget({ ok: false, error: code });
    return res.redirect(303, provider === 'google' ? target : `${target}&oauth_provider=${encodeURIComponent(provider)}`);
  }
  res.clearCookie('oauth_native', { path: '/api/auth' });
  const label = PROVIDER_LABEL[provider] || provider;
  const MSG = {
    access_denied: `${label} 로그인이 취소됐습니다.`,
    user_cancelled_authorize: `${label} 로그인이 취소됐습니다.`,
    invalid_state: '로그인 시간이 초과됐습니다. 앱에서 다시 시도해 주세요.',
    email_not_verified: `이메일이 확인되지 않은 ${label} 계정입니다.`,
    email_missing: `${label} 계정의 이메일을 받지 못했습니다. 앱에서 다시 시도해 주세요.`,
    account_suspended: '사용할 수 없는 계정입니다. 관리자에게 문의해 주세요.',
  };
  return sendNativeReturn(res, { error: code }, {
    title: '로그인을 마치지 못했습니다',
    message: MSG[code] || `${label} 로그인을 마치지 못했습니다. 앱에서 다시 시도해 주세요.`,
    userAgent: req.get('user-agent'),
  });
}

/**
 * 프로필을 받은 뒤의 3분기 — ①연결된 subject 면 로그인 ②같은 이메일의 기존 계정이면 연결 확인
 * ③둘 다 없으면 신규 가입(사용자 + 워크스페이스 + Cue + OauthConnection).
 *
 * @param {object} p
 * @param {'google'|'apple'} p.provider
 * @param {{subject:string,email:string|null,name?:string|null,picture?:string|null,locale?:string|null}} p.profile
 *   email 은 **공급자가 확인한** 주소여야 한다(호출부가 email_verified 를 먼저 거른다).
 * @param {boolean} p.native   네이티브 앱에서 시작한 흐름인가
 * @param {string|null} p.pairId 앱 페어링 흐름 식별자(비밀 아님)
 * @param {string} p.logTag
 */
async function finishOauthLogin(req, res, { provider, profile, native, pairId, logTag }) {
  const logCtx = { ua: String(req.get('user-agent') || '').slice(0, 120), native: native || undefined };
  const fail = (reason) => {
    logOauthFailure(logTag, reason, logCtx);
    return failLogin(req, res, reason, { native, provider });
  };

  let user = null;
  let isNewUser = false;

  // [분기 1] oauth_connections subject 매칭 → 그 사용자 즉시 로그인
  const existingConn = await OauthConnection.findOne({
    where: { provider, subject: profile.subject },
    include: [{ model: User, attributes: ['id', 'email', 'status'] }],
  });
  if (existingConn && existingConn.User) {
    user = await User.findByPk(existingConn.User.id);
    await existingConn.update({ last_used_at: new Date() });
  } else {
    // 연결이 없는데 이메일도 없으면 어디에도 붙일 수 없다(애플은 첫 동의 뒤로 이메일을 안 줄 수 있다).
    if (!profile.email) return fail('email_missing');
    // [분기 2] email 매칭 (primary or verified secondary) — 연결 확인 페이지로
    const prospectUser = await User.findOne({
      where: {
        // #259 — 시스템 계정(Cue·게스트 그림자)에는 절대 붙이지 않는다.
        is_ai: false,
        is_guest: false,
        [Op.or]: [
          { email: profile.email },
          { secondary_email: profile.email, secondary_email_verified_at: { [Op.ne]: null } },
        ],
      },
    });
    if (prospectUser) {
      // confirm token 5분 — ephemeral_tokens(kind=oauth_confirm). 재시작에도 남는다.
      const confirmToken = await stashConfirm({
        user_id: prospectUser.id,
        provider,
        subject: profile.subject,
        email: profile.email,
        display_name: profile.name || null,
        picture: profile.picture || null,
      });
      // ★ 네이티브는 앱으로 먼저 돌아간 뒤 **앱 WebView 안에서** 확인 화면을 연다 —
      //   시스템 브라우저 안에서 확인하면 세션 쿠키가 그 브라우저에 심겨 앱은 못 받는다(2026-09-04).
      if (native) {
        res.clearCookie('oauth_native', { path: '/api/auth' });
        return sendNativeReturn(res, { confirm: confirmToken }, {
          title: '계정 연결 확인이 필요합니다',
          altUrl: `/oauth/connect-confirm?token=${encodeURIComponent(confirmToken)}`,
          altLabel: '연결 확인하기',
          userAgent: req.get('user-agent'),
        });
      }
      return res.redirect(303, `/oauth/connect-confirm?token=${confirmToken}&email=${encodeURIComponent(profile.email)}&existing_email=${encodeURIComponent(prospectUser.email)}&name=${encodeURIComponent(profile.name || '')}`);
    }
    // [분기 3] 신규 가입
  }

  if (!user) {
    const browserLang = String(req.headers['accept-language'] || '').toLowerCase();
    const wantsKo = browserLang.startsWith('ko') || (profile.locale && profile.locale.startsWith('ko'));
    const t = await sequelize.transaction();
    try {
      user = await User.create({
        email: profile.email,
        password_hash: '$2a$12$oauth_no_password_set',
        name: profile.name || profile.email.split('@')[0],
        avatar_url: profile.picture || null,
        language: wantsKo ? 'ko' : 'en',
        email_verified_at: new Date(),
        platform_role: 'user',
        status: 'active',
        terms_accepted_at: new Date(),
        terms_version: '1.0',
        privacy_accepted_at: new Date(),
        privacy_version: '1.0',
      }, { transaction: t });
      await setupNewWorkspace(user, wantsKo, t);
      await OauthConnection.create({
        user_id: user.id,
        provider,
        subject: profile.subject,
        email: profile.email,
        display_name: profile.name || null,
        picture: profile.picture || null,
        connected_at: new Date(),
        last_used_at: new Date(),
      }, { transaction: t });
      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
    isNewUser = true;
  } else {
    const patch = { last_login_at: new Date() };
    if (!user.avatar_url && profile.picture) patch.avatar_url = profile.picture;
    if (!user.email_verified_at) patch.email_verified_at = new Date();
    await user.update(patch);
  }

  if (user.status !== 'active') return fail('account_suspended');

  // 네이티브 앱: 시스템 브라우저에 쿠키를 심지 말고, 일회용 code 를 딥링크로 앱에 전달 (H-2).
  if (native) {
    res.clearCookie('oauth_native', { path: '/api/auth' });
    const code = issueNativeOAuthCode(user);
    logOauthFailure(logTag, 'native_return(정상)', { ...logCtx, note: '네이티브 복귀 페이지를 냄' });
    const origin = `${req.protocol}://${req.get('host')}`;
    // ★ 앱에 입력할 6자리 — **이 브라우저 화면에서만** 생겨난다(공격자가 가져갈 수 없다).
    const pairCode = await oauthPairing.attach(pairId, user.id);
    return sendNativeReturn(res, { code, new: isNewUser ? '1' : '0' }, {
      title: '로그인이 끝났습니다',
      // web-return 은 공급자와 무관하다(일회용 code 만 본다) — 구글 경로를 그대로 쓴다.
      webUrl: `${origin}/api/auth/google/web-return?code=${encodeURIComponent(code)}`,
      userAgent: req.get('user-agent'),
      pairCode,
    });
  }

  await issueSessionCookie(req, res, user);
  // 303 — 애플 콜백은 POST 라 302 면 일부 브라우저가 POST 를 다시 보낸다. GET 콜백에도 무해하다.
  return res.redirect(303, buildRedirectTarget({ ok: true, isNewUser }));
}

module.exports = { finishOauthLogin, failLogin, PROVIDER_LABEL };
