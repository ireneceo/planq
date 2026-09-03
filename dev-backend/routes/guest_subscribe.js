// routes/guest_subscribe.js — 게스트 답글 알림 신청 (#259 A안, 설계 §13)
//
// ★ **인증이 없는 표면이다.** guest.js 와 같은 규칙을 따른다 — 토큰 해석은
//   `guest_common.attachGuest` 하나, 못 찾겠으면 전부 404(403 은 "그 토큰은 있다" 를 흘린다).
//   파일을 나눈 것은 대화 라우트가 500줄을 넘었기 때문이고, **문은 여전히 하나**다.
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { guestLimiter, attachGuest, rootLink } = require('./guest_common');

// ══════════════════════════════════════════════════════════════════════════
// 답글 알림 — 게스트가 이름·이메일을 남긴다 (#259 A안). 설계 §13
//
// ★ 원문 personal 토큰은 **어떤 응답에도 실리지 않는다.** 브라우저는 이미 shared 링크를
//   갖고 있어 그것으로 계속 쓰면 되고, personal 토큰이 필요한 곳은 **메일 안의 링크뿐**이다.
//   응답에 실으면 링크가 하나 더 퍼질 자리를 만들 뿐이다.
// ★ 원문 personal 토큰은 **확인 직후 응답에 한 번** 나가고, 브라우저가 그것을 보관한다.
//   처음엔 쿠키에 브라우저 라벨(sid_hash)을 심으려 했는데, 그러면 "누가 이 브라우저인가" 를
//   서버가 **또 하나의 신원으로** 들고 있게 된다(지워야 할 개인정보가 하나 늘고, 라벨만으로
//   남의 등록을 지울 수 있는 문이 생긴다). 자기 것을 증명하는 수단은 **토큰 하나**로 족하다.
//   그래서 me·수신거부·삭제는 **personal 토큰으로만** 받는다.
// ══════════════════════════════════════════════════════════════════════════
/** 확인 코드 요청의 한도 — **한 축만 걸면 반드시 뚫리거나 정상 사용을 막는다.**
 *
 * ★ 처음엔 "링크당 3회/시간" 하나였다. 그러면 ①카톡방 다섯 명이 같은 저녁에 등록하면
 *   네 번째부터 막히고(설계 전제가 "한 링크를 여럿이" 다), ②동시에 링크를 여러 개 가진
 *   사람은 **임의의 주소로 PlanQ 브랜드 메일을 하루 72통씩** 때릴 수 있었다.
 *   막을 것은 "같은 사람이 같은 주소로 반복" 이고, 지켜야 할 것은 "여럿이 각자 한 번" 이다.
 */
const otpLimit = (name, { windowMs, max, key }) => rateLimit({
  windowMs, max, keyGenerator: key, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'too_many_requests' },
});
const bodyEmail = (req) => String(req.body?.email || '').trim().toLowerCase().slice(0, 200);

const otpRequestGuards = [
  attachGuest,   // ★ 먼저 토큰을 푼다 — 아래 한도들이 워크스페이스를 키로 쓴다
  // 이 링크로 들어온 사람이 **아무 주소나** 계속 두드리는 것
  otpLimit('gn-link', { windowMs: 60 * 60 * 1000, max: 20, key: (r) => `gn-l-${String(r.params.token).slice(0, 32)}` }),
  // 같은 주소로 반복 — 정상 사용은 한두 번이면 끝난다
  otpLimit('gn-pair', { windowMs: 60 * 60 * 1000, max: 3, key: (r) => `gn-p-${String(r.params.token).slice(0, 32)}-${bodyEmail(r)}` }),
  // 한 사람이 링크를 여러 개 들고 돌아가며 때리는 것
  otpLimit('gn-ip', { windowMs: 60 * 60 * 1000, max: 10, key: (r) => `gn-i-${ipKeyGenerator(r.ip)}` }),
  // 워크스페이스 전체 — 발신 평판은 워크스페이스 단위로 다친다
  otpLimit('gn-biz', { windowMs: 24 * 60 * 60 * 1000, max: 200, key: (r) => `gn-b-${r.guest?.link?.business_id || 0}` }),
  // ★ 플랫폼 전체에서 **같은 주소**로 가는 통수 — 링크를 바꿔 가며 한 사람을 괴롭히는 경로를 닫는다
  otpLimit('gn-mail', { windowMs: 24 * 60 * 60 * 1000, max: 5, key: (r) => `gn-m-${bodyEmail(r)}` }),
];

/** 화면에 되비추는 주소는 가린다 — 어깨너머로 보는 사람에게 주소를 알려줄 이유가 없다. */
function maskEmail(v) {
  const s2 = String(v || '');
  const at = s2.indexOf('@');
  if (at < 1) return null;
  const head = s2.slice(0, at);
  const shown = head.length <= 2 ? head.slice(0, 1) : head.slice(0, 2);
  return `${shown}${'*'.repeat(Math.max(1, head.length - shown.length))}${s2.slice(at)}`;
}


// ── POST /:token/notify/request — 이름·이메일 남기고 확인 코드 받기 ─────────
router.post('/:token/notify/request', ...otpRequestGuards, async (req, res, next) => {
  try {
    const { GuestLink, PlatformSetting } = require('../models');
    const {
      normalizeEmail, generateOtpCode, hashToken, ensurePersonalLink,
      OTP_TTL_MS, OTP_LOCK_MS,
    } = require('../services/guest_link');

    // ★ 개인 링크로는 신청할 수 없다. 확인한 사람마다 링크가 하나씩 늘고, 링크마다
    //   한도 버킷이 새로 생긴다 — 한도가 기하급수로 무력해진다. 신청은 **부모로만** 한다.
    if (req.guest.link.kind === 'personal') return errorResponse(res, 'not_found', 404);

    const email = normalizeEmail(req.body?.email);
    const name = String(req.body?.name || '').trim().slice(0, 30);
    // ★ 동의는 **명시**여야 한다. 회원가입이 명시 체크를 받으므로 게스트만 예외를 두지 않는다.
    if (req.body?.consent !== true) return errorResponse(res, 'consent_required', 400);
    if (!name) return errorResponse(res, 'name_required', 400);
    if (!email) return errorResponse(res, 'invalid_email', 400);

    const parent = rootLink(req.guest);
    const r = await ensurePersonalLink({
      parentLink: parent, email, name,
      locale: String(req.body?.locale || '').slice(0, 5) || null,
    });
    // 회수된 자식은 되살리지 않는다. 다만 **그 사실을 알려주지 않는다** —
    //   회수 여부는 이 주소가 여기 등록돼 있었다는 정보다(열거 수단).
    if (!r || r.revoked) return successResponse(res, { sent: true }, 'sent');
    const link = r.link;

    // 잠금 중이면 코드를 새로 만들지 않는다. 응답은 같다.
    if (link.otp_locked_until && new Date(link.otp_locked_until).getTime() > Date.now()) {
      return successResponse(res, { sent: true }, 'sent');
    }

    const code = generateOtpCode();
    const privacy = await PlatformSetting.findOne({ attributes: ['privacy_version'] }).catch(() => null);
    // ★ **확인이 끝난 등록의 이름은 남이 못 바꾼다.** 링크와 주소만 알면 신청을 한 번 더
    //   보내는 것으로 `contact_name` 을 갈아치울 수 있었다(Fable 실측: Fable A → IMPOSTOR,
    //   확인 상태는 그대로). 멤버 화면에는 그 이름이 "확인된 사람" 으로 뜬다 —
    //   #259 에서 이미 난 "제3자가 고객 본인처럼 보인다" 와 같은 모양이다.
    const nameToKeep = link.email_verified_at ? link.contact_name : (name || link.contact_name);
    await link.update({
      contact_name: nameToKeep,
      otp_hash: hashToken(code),
      otp_sent_at: new Date(),
      otp_expires_at: new Date(Date.now() + OTP_TTL_MS),
      otp_attempts: 0,
      otp_locked_until: null,
      // 동의는 **신청 시점**에 받는다. 확인은 주소 소유 증명이지 동의가 아니다.
      consent_at: link.consent_at || new Date(),
      consent_privacy_version: link.consent_privacy_version || (privacy?.privacy_version || null),
    });
    void OTP_LOCK_MS;

    try {
      const { sendGuestVerifyCodeEmail } = require('../services/emailService');
      await sendGuestVerifyCodeEmail({
        to: email, code, ttlMinutes: Math.round(OTP_TTL_MS / 60000),
        businessId: parent.business_id,
        locale: link.locale || String(req.body?.locale || '').slice(0, 5) || 'ko',
      });
    } catch (e) {
      // 발송 실패도 응답은 같다 — 실패/성공이 갈리면 그 자체가 주소 존재 신호가 된다.
      console.error('[guest] notify OTP 발송 실패:', e.message);
    }
    return successResponse(res, { sent: true }, 'sent');
  } catch (err) { next(err); }
});

// ── POST /:token/notify/verify — 코드 확인 ────────────────────────────────
router.post('/:token/notify/verify',
  attachGuest,
  // ★ 링크 단위로 걸면 안 된다 — 링크를 아는 아무나 오답 10번으로 **카톡방 전원의 확인을
  //   1시간 막는다**(Fable 실측: 내 잠금 테스트가 이것 때문에 OTP 5회 잠금에 닿지도 못했다).
  //   틀린 코드를 막는 일은 OTP 5회 잠금이 하고, 여기서는 주소별로만 상한을 둔다.
  otpLimit('gn-vpair', {
    windowMs: 60 * 60 * 1000, max: 20,
    key: (r) => `gn-v-${String(r.params.token).slice(0, 32)}-${bodyEmail(r)}`,
  }),
  otpLimit('gn-vip', { windowMs: 60 * 60 * 1000, max: 60, key: (r) => `gn-vi-${ipKeyGenerator(r.ip)}` }),
  async (req, res, next) => {
  try {
    const { GuestLink } = require('../models');
    const {
      normalizeEmail, hashToken, mintPersonalToken, promotePersonalIdentity,
      OTP_MAX_ATTEMPTS, OTP_LOCK_MS,
    } = require('../services/guest_link');
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    if (!email || !/^\d{4,8}$/.test(code)) return errorResponse(res, 'invalid_code', 400);

    const parent = rootLink(req.guest);
    const link = await GuestLink.findOne({
      where: { parent_link_id: parent.id, contact_email: email, kind: 'personal' },
    });
    // 없는 주소도 **같은 응답**이다 — 다르면 그것이 곧 열거 수단이다.
    if (!link || link.revoked_at) return errorResponse(res, 'invalid_code', 400);
    if (link.otp_locked_until && new Date(link.otp_locked_until).getTime() > Date.now()) {
      return errorResponse(res, 'locked', 429);
    }
    if (!link.otp_hash || !link.otp_expires_at || new Date(link.otp_expires_at).getTime() < Date.now()) {
      return errorResponse(res, 'invalid_code', 400);
    }

    const crypto = require('crypto');
    const given = Buffer.from(hashToken(code), 'hex');
    const kept = Buffer.from(link.otp_hash, 'hex');
    const ok = given.length === kept.length && crypto.timingSafeEqual(given, kept);
    if (!ok) {
      const attempts = (link.otp_attempts || 0) + 1;
      const locked = attempts >= OTP_MAX_ATTEMPTS;
      await link.update({
        otp_attempts: attempts,
        otp_locked_until: locked ? new Date(Date.now() + OTP_LOCK_MS) : null,
      });
      if (locked) return errorResponse(res, 'locked', 429);
      return errorResponse(res, 'invalid_code', 400);
    }

    // ★ 첫 확인일 때만 토큰을 만든다. 이미 확인된 링크를 회전시키면 지난 알림 메일의
    //   링크가 전부 죽는다 — 사용자에게는 "링크가 만료됐다" 로 보인다.
    const first = !link.email_verified_at;
    // 신원은 여기서 갈린다 — 확인 전에는 부모의 익명 신원을 쓰고 있었다(열거 타이밍·쓰레기 행 방지).
    if (first) await promotePersonalIdentity(link);
    const minted = first ? await mintPersonalToken(link) : null;
    await link.update({
      email_verified_at: link.email_verified_at || new Date(),
      // 쓴 코드는 즉시 버린다 — 남겨 두면 재사용 창이 생긴다.
      otp_hash: null, otp_expires_at: null, otp_attempts: 0, otp_locked_until: null,
      unsubscribed_at: null,   // 다시 신청했으면 다시 받겠다는 뜻이다
    });
    // ★ 원문 토큰은 **여기 한 번**만 나간다. 우리는 해시만 갖고 있어 되살릴 수 없으므로,
    //   확인 직후 못 받아 가면 그 브라우저는 자기 등록을 다시는 못 만진다(메일 링크로는 가능).
    //   신규 생성 때만 값이 있고 재확인이면 null 이다 — 프론트는 옛 값을 지우지 않는다.
    try { require('../services/guest_notify').invalidateGuestCache(link.conversation_id); } catch { /* 캐시일 뿐이다 */ }
    return successResponse(res, {
      verified: true,
      email: maskEmail(link.contact_email),
      name: link.contact_name || null,
      personal_token: minted,
    }, 'verified');
  } catch (err) { next(err); }
});

// ── GET /:token/notify/me — 이 링크의 등록 상태 ────────────────────────────
//   ★ **personal 토큰으로만** 답한다. shared 토큰으로 물으면 그 링크로 들어온 아무나
//     남의 등록 여부·주소를 물을 수 있다 — 그것 자체가 열거 수단이다.
router.get('/:token/notify/me',
  guestLimiter('guest-notify-me', { windowMs: 60 * 1000, max: 60 }), attachGuest, async (req, res, next) => {
  try {
    const link = req.guest.link;
    if (link.kind !== 'personal') return successResponse(res, { registered: false });
    return successResponse(res, {
      registered: true,
      verified: !!link.email_verified_at,
      unsubscribed: !!link.unsubscribed_at,
      email: maskEmail(link.contact_email),
      name: link.contact_name || null,
    });
  } catch (err) { next(err); }
});

/** 이 요청이 그 개인 링크의 주인임을 증명한다 — **토큰 자체뿐**이다. */
function ownPersonalLink(req) {
  return req.guest.link.kind === 'personal' ? req.guest.link : null;
}

// ── POST /:token/notify/unsubscribe — 알림만 끈다 (링크 회수가 아니다) ──────
router.post('/:token/notify/unsubscribe',
  guestLimiter('guest-notify-unsub', { windowMs: 60 * 60 * 1000, max: 10 }), attachGuest, async (req, res, next) => {
  try {
    const link = ownPersonalLink(req);
    if (!link) return errorResponse(res, 'not_found', 404);
    const on = req.body?.on === true;   // on=true 면 다시 받겠다는 뜻
    await link.update({ unsubscribed_at: on ? null : new Date() });
    try { require('../services/guest_notify').invalidateGuestCache(link.conversation_id); } catch { /* 캐시일 뿐이다 */ }
    return successResponse(res, { unsubscribed: !on });
  } catch (err) { next(err); }
});

// ── DELETE /:token/notify — 남긴 이름·이메일을 지운다 ──────────────────────
//   ★ 개인정보처리방침에 "본인이 화면에서 즉시 삭제 요청 가능" 이라고 썼다.
//     써 놓고 없으면 그것은 거짓말이다.
//   ★ 과거 메시지의 표시명(meta.guest.name 박제)은 **건드리지 않는다** — 그것은 대화 기록이고,
//     지우면 남이 쓴 것처럼 보이게 만든다. 지우는 것은 연락처다.
router.delete('/:token/notify',
  guestLimiter('guest-notify-del', { windowMs: 60 * 60 * 1000, max: 10 }), attachGuest, async (req, res, next) => {
  try {
    const link = ownPersonalLink(req);
    if (!link) return errorResponse(res, 'not_found', 404);
    // ★ 지우는 목록을 여기 또 적지 않는다 — 보관기간 cron 과 갈라지는 순간 한쪽이 덜 지운다.
    //   같은 함수를 부른다. 발송 기록의 수신 주소까지 **그 자리에서** 가린다.
    const purged = await require('../services/guestContactCleanup').purgeContactNow(link);
    void purged;
    try { require('../services/guest_notify').invalidateGuestCache(link.conversation_id); } catch { /* 캐시일 뿐이다 */ }
    return successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});
module.exports = router;
