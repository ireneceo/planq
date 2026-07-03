const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { User } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { sendVerificationCodeEmail } = require('../services/emailService');
const { perUserDaily } = require('../middleware/costGuard');

// 응답에서 절대 노출 금지인 민감 필드
// password_hash · refresh_token · reset_token · reset_token_expires · email_change_otp_hash
const USER_SENSITIVE_FIELDS = [
  'password_hash', 'refresh_token', 'reset_token', 'reset_token_expires',
  'email_change_otp_hash',
];

const USERNAME_RE = /^[a-z0-9_-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MIN = 10;
const OTP_LOCK_MIN = 60;
const OTP_MAX_ATTEMPTS = 5;
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'api',
  'planq', 'cue', 'null', 'undefined', 'me', 'profile', 'settings',
]);

function sha256(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }
function genOtp() { return String(Math.floor(100000 + Math.random() * 900000)); }

// List users (platform admin)
router.get('/', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: USER_SENSITIVE_FIELDS },
      order: [['created_at', 'DESC']]
    });
    successResponse(res, users);
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/users/username-available?value=xxx
// 가용성 체크 — 본인 username 이거나 미사용이면 available=true
// (반드시 /:id 라우트보다 위에 둘 것 — 'username-available' 이 :id 에 매칭되지 않게)
// ============================================
router.get('/username-available', authenticateToken, async (req, res, next) => {
  try {
    const raw = String(req.query.value || '').toLowerCase().trim();
    if (!raw) return successResponse(res, { available: false, reason: 'empty' });
    if (!USERNAME_RE.test(raw)) return successResponse(res, { available: false, reason: 'invalid_format' });
    if (RESERVED_USERNAMES.has(raw)) return successResponse(res, { available: false, reason: 'reserved' });
    const me = await User.findByPk(req.user.id, { attributes: ['username'] });
    if (me?.username === raw) return successResponse(res, { available: true, reason: 'self' });
    const exists = await User.findOne({ where: { username: raw }, attributes: ['id'] });
    if (exists) return successResponse(res, { available: false, reason: 'taken' });
    return successResponse(res, { available: true });
  } catch (err) { next(err); }
});

// Get user by ID — 본인 또는 platform_admin 만. IDOR 차단.
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (Number.isNaN(targetId)) return errorResponse(res, 'invalid_id', 400);
    const isSelf = targetId === req.user.id;
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    if (!isSelf && !isPlatformAdmin) return errorResponse(res, 'forbidden', 403);
    const user = await User.findByPk(targetId, {
      attributes: { exclude: USER_SENSITIVE_FIELDS }
    });
    if (!user) return errorResponse(res, 'User not found', 404);
    successResponse(res, user);
  } catch (error) {
    next(error);
  }
});

// Update user
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id) && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'Insufficient permissions', 403);
    }

    const user = await User.findByPk(req.params.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    const {
      name, name_localized, username, phone, avatar_url, language,
      bio, expertise, organization, job_title,
      language_levels, expertise_level,
      answer_style_default, answer_length_default,
      timezone, reference_timezones,
    } = req.body;
    const updates = {};

    // 이름 변경 — 즉시 적용 (verification 불필요)
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return errorResponse(res, 'name_required', 400);
      if (name.length > 100) return errorResponse(res, 'name_too_long', 400);
      updates.name = name.trim();
    }

    // 다국어 이름 — 사이클 F. 객체 형태 { ko, en, ja, zh, es }, 각 값은 string 또는 null.
    if (name_localized !== undefined) {
      if (name_localized !== null && (typeof name_localized !== 'object' || Array.isArray(name_localized))) {
        return errorResponse(res, 'invalid_name_localized', 400);
      }
      if (name_localized) {
        const allowed = ['ko', 'en', 'ja', 'zh', 'es'];
        const cleaned = {};
        for (const [k, v] of Object.entries(name_localized)) {
          if (!allowed.includes(k)) continue;
          if (v == null || v === '') continue;
          if (typeof v !== 'string' || v.length > 100) {
            return errorResponse(res, `name_localized_${k}_invalid`, 400);
          }
          cleaned[k] = v.trim();
        }
        updates.name_localized = Object.keys(cleaned).length ? cleaned : null;
      } else {
        updates.name_localized = null;
      }
    }

    // username 은 안전핀 — 한 번 정해지면 변경 불가 (회원가입 시 또는 마이그레이션 시 정해짐)
    // 기존 사용자가 username 이 비어있는 경우에만 1회 설정 허용.
    if (username !== undefined) {
      if (user.username) {
        // 이미 설정됨 → 변경 차단. 무시 (요청 본문에 포함되어도 silently ignore).
      } else {
        if (username === null || username === '') {
          return errorResponse(res, 'username_required', 400);
        }
        const u = String(username).toLowerCase().trim();
        if (!USERNAME_RE.test(u)) return errorResponse(res, 'invalid_username_format', 400);
        if (RESERVED_USERNAMES.has(u)) return errorResponse(res, 'username_reserved', 409);
        const existing = await User.findOne({ where: { username: u } });
        if (existing && existing.id !== user.id) return errorResponse(res, 'username_taken', 409);
        updates.username = u;
      }
    }

    if (phone !== undefined) updates.phone = phone;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    // 타임존 (IANA id — 자유형식 문자열로 저장, 포맷 검증만)
    if (timezone !== undefined) {
      if (timezone !== null && (typeof timezone !== 'string' || !/^[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+){0,2}$/.test(timezone))) {
        return errorResponse(res, 'Invalid timezone', 400);
      }
      updates.timezone = timezone || null;
    }
    if (reference_timezones !== undefined) {
      if (reference_timezones !== null && !Array.isArray(reference_timezones)) {
        return errorResponse(res, 'Invalid reference_timezones', 400);
      }
      const cleaned = (reference_timezones || [])
        .filter((t) => typeof t === 'string' && /^[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+){0,2}$/.test(t))
        .slice(0, 20);
      updates.reference_timezones = cleaned.length ? cleaned : null;
    }
    if (language !== undefined) {
      if (typeof language !== 'string' || !/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) {
        return errorResponse(res, 'Invalid language code', 400);
      }
      updates.language = language;
    }
    // Q Note 답변 생성용 프로필 필드 (모두 선택)
    if (bio !== undefined) {
      if (bio !== null && typeof bio !== 'string') return errorResponse(res, 'Invalid bio', 400);
      if (bio && bio.length > 2000) return errorResponse(res, 'bio too long (max 2000)', 400);
      updates.bio = bio || null;
    }
    if (expertise !== undefined) {
      if (expertise !== null && typeof expertise !== 'string') return errorResponse(res, 'Invalid expertise', 400);
      if (expertise && expertise.length > 500) return errorResponse(res, 'expertise too long (max 500)', 400);
      updates.expertise = expertise || null;
    }
    if (organization !== undefined) {
      if (organization !== null && typeof organization !== 'string') return errorResponse(res, 'Invalid organization', 400);
      if (organization && organization.length > 200) return errorResponse(res, 'organization too long (max 200)', 400);
      updates.organization = organization || null;
    }
    if (job_title !== undefined) {
      if (job_title !== null && typeof job_title !== 'string') return errorResponse(res, 'Invalid job_title', 400);
      if (job_title && job_title.length > 100) return errorResponse(res, 'job_title too long (max 100)', 400);
      updates.job_title = job_title || null;
    }
    // 언어 레벨: { ko: { reading, speaking, listening, writing }, en: ... }
    if (language_levels !== undefined) {
      if (language_levels !== null && (typeof language_levels !== 'object' || Array.isArray(language_levels))) {
        return errorResponse(res, 'Invalid language_levels', 400);
      }
      const SKILLS = ['reading', 'speaking', 'listening', 'writing'];
      const cleaned = {};
      if (language_levels) {
        for (const [lang, block] of Object.entries(language_levels)) {
          if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) continue;
          if (!block || typeof block !== 'object') continue;
          const out = {};
          for (const s of SKILLS) {
            const v = block[s];
            if (v == null) continue;
            const n = parseInt(v, 10);
            if (Number.isInteger(n) && n >= 1 && n <= 6) out[s] = n;
          }
          if (Object.keys(out).length) cleaned[lang] = out;
        }
      }
      updates.language_levels = Object.keys(cleaned).length ? cleaned : null;
    }
    if (expertise_level !== undefined) {
      if (expertise_level !== null && !['layman', 'practitioner', 'expert'].includes(expertise_level)) {
        return errorResponse(res, 'Invalid expertise_level', 400);
      }
      updates.expertise_level = expertise_level || null;
    }
    if (answer_style_default !== undefined) {
      if (answer_style_default !== null && typeof answer_style_default !== 'string') {
        return errorResponse(res, 'Invalid answer_style_default', 400);
      }
      if (answer_style_default && answer_style_default.length > 2000) {
        return errorResponse(res, 'answer_style_default too long (max 2000)', 400);
      }
      updates.answer_style_default = answer_style_default || null;
    }
    if (answer_length_default !== undefined) {
      if (answer_length_default !== null && !['short', 'medium', 'long'].includes(answer_length_default)) {
        return errorResponse(res, 'Invalid answer_length_default', 400);
      }
      updates.answer_length_default = answer_length_default || null;
    }

    // 약관 재동의 — TermsReacceptModal 에서 호출
    const { terms_accepted_at, terms_version, privacy_accepted_at, privacy_version } = req.body;
    if (terms_accepted_at !== undefined && terms_version !== undefined) {
      updates.terms_accepted_at = new Date(terms_accepted_at);
      updates.terms_version = terms_version;
    }
    if (privacy_accepted_at !== undefined && privacy_version !== undefined) {
      updates.privacy_accepted_at = new Date(privacy_accepted_at);
      updates.privacy_version = privacy_version;
    }

    await user.update(updates);

    const updated = await User.findByPk(req.params.id, {
      attributes: { exclude: USER_SENSITIVE_FIELDS }
    });
    successResponse(res, updated);
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/users/:id/email-change-request
// 새 이메일 받음 → 6자리 OTP 생성·해시 저장 → 새 이메일에 발송
// body: { new_email }
// ============================================
router.post('/:id/email-change-request', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return errorResponse(res, 'only_self', 403);
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'user_not_found', 404);

    if (user.email_change_locked_until && user.email_change_locked_until > new Date()) {
      return errorResponse(res, 'locked', 423);
    }

    const newEmail = String(req.body?.new_email || '').toLowerCase().trim();
    if (!EMAIL_RE.test(newEmail)) return errorResponse(res, 'invalid_email_format', 400);
    if (newEmail === user.email) return errorResponse(res, 'same_as_current', 400);
    if (/^cue\+\d+@system\.planq\.kr$/.test(newEmail)) return errorResponse(res, 'reserved_email', 400);

    const dup = await User.findOne({ where: { email: newEmail } });
    if (dup) return errorResponse(res, 'email_already_used', 409);

    const code = genOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000);
    await user.update({
      pending_email: newEmail,
      email_change_otp_hash: sha256(code),
      email_change_otp_expires_at: expiresAt,
      email_change_otp_attempts: 0,
    });

    const sent = await sendVerificationCodeEmail({
      to: newEmail,
      code,
      ttlMinutes: OTP_TTL_MIN,
      userName: user.name || '',
    }).catch(() => false);

    if (!process.env.SMTP_HOST) {
      console.log(`[DEV-EMAIL-CHANGE] user_id=${user.id} new=${newEmail} code=${code}`);
    }

    return successResponse(res, {
      sent: !!sent,
      pending_email: newEmail,
      expires_at: expiresAt,
      ttl_minutes: OTP_TTL_MIN,
    });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/users/:id/email-change-verify
// body: { code }
// → 검증 성공 시 email = pending_email 로 교체
// ============================================
router.post('/:id/email-change-verify', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return errorResponse(res, 'only_self', 403);
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'user_not_found', 404);

    if (user.email_change_locked_until && user.email_change_locked_until > new Date()) {
      return errorResponse(res, 'locked', 423);
    }
    if (!user.pending_email || !user.email_change_otp_hash || !user.email_change_otp_expires_at) {
      return errorResponse(res, 'no_pending_request', 400);
    }
    if (user.email_change_otp_expires_at < new Date()) {
      await user.update({
        pending_email: null, email_change_otp_hash: null,
        email_change_otp_expires_at: null, email_change_otp_attempts: 0,
      });
      return errorResponse(res, 'otp_expired', 410);
    }

    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) return errorResponse(res, 'invalid_code_format', 400);

    if (sha256(code) !== user.email_change_otp_hash) {
      const attempts = user.email_change_otp_attempts + 1;
      const update = { email_change_otp_attempts: attempts };
      if (attempts >= OTP_MAX_ATTEMPTS) {
        update.email_change_locked_until = new Date(Date.now() + OTP_LOCK_MIN * 60_000);
        update.pending_email = null;
        update.email_change_otp_hash = null;
        update.email_change_otp_expires_at = null;
        update.email_change_otp_attempts = 0;
      }
      await user.update(update);
      return errorResponse(res,
        attempts >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid_code',
        attempts >= OTP_MAX_ATTEMPTS ? 423 : 400
      );
    }

    // 마지막 충돌 검증 (race)
    const dup = await User.findOne({ where: { email: user.pending_email } });
    if (dup && dup.id !== user.id) {
      await user.update({
        pending_email: null, email_change_otp_hash: null,
        email_change_otp_expires_at: null, email_change_otp_attempts: 0,
      });
      return errorResponse(res, 'email_already_used', 409);
    }

    const newEmail = user.pending_email;
    await user.update({
      email: newEmail,
      email_verified_at: new Date(),
      pending_email: null,
      email_change_otp_hash: null,
      email_change_otp_expires_at: null,
      email_change_otp_attempts: 0,
    });

    return successResponse(res, { email: newEmail, changed: true });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/users/:id/email-verify-request
// 현재 primary 이메일이 미인증 상태일 때 — 그 이메일로 OTP 발송 (변경 없음, 인증만)
// email_change_otp_* 필드 재활용. pending_email 은 user.email 로 둠.
// ============================================
router.post('/:id/email-verify-request', authenticateToken, ...perUserDaily('otp-email', { perMin: 3, perDay: 20, message: '인증 메일 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' }), async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return errorResponse(res, 'only_self', 403);
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'user_not_found', 404);
    if (user.email_verified_at) return errorResponse(res, 'already_verified', 400);
    if (user.email_change_locked_until && user.email_change_locked_until > new Date()) {
      return errorResponse(res, 'locked', 423);
    }

    const code = genOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000);
    await user.update({
      pending_email: user.email,                // 자기 자신 — verify-confirm 에서 동일 이메일 검증
      email_change_otp_hash: sha256(code),
      email_change_otp_expires_at: expiresAt,
      email_change_otp_attempts: 0,
    });

    const sent = await sendVerificationCodeEmail({
      to: user.email,
      code,
      ttlMinutes: OTP_TTL_MIN,
      userName: user.name || '',
    }).catch(() => false);

    if (!process.env.SMTP_HOST) {
      console.log(`[DEV-EMAIL-VERIFY] user_id=${user.id} email=${user.email} code=${code}`);
    }

    return successResponse(res, {
      sent: !!sent,
      email: user.email,
      expires_at: expiresAt,
      ttl_minutes: OTP_TTL_MIN,
    });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/users/:id/email-verify-confirm
// body: { code }
// → 검증 성공 시 email_verified_at = now. email 변경 없음.
// ============================================
router.post('/:id/email-verify-confirm', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return errorResponse(res, 'only_self', 403);
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'user_not_found', 404);

    if (user.email_change_locked_until && user.email_change_locked_until > new Date()) {
      return errorResponse(res, 'locked', 423);
    }
    if (!user.email_change_otp_hash || !user.email_change_otp_expires_at) {
      return errorResponse(res, 'no_pending_request', 400);
    }
    if (user.email_change_otp_expires_at < new Date()) {
      await user.update({
        pending_email: null, email_change_otp_hash: null,
        email_change_otp_expires_at: null, email_change_otp_attempts: 0,
      });
      return errorResponse(res, 'otp_expired', 410);
    }

    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) return errorResponse(res, 'invalid_code_format', 400);

    if (sha256(code) !== user.email_change_otp_hash) {
      const attempts = user.email_change_otp_attempts + 1;
      const update = { email_change_otp_attempts: attempts };
      if (attempts >= OTP_MAX_ATTEMPTS) {
        update.email_change_locked_until = new Date(Date.now() + OTP_LOCK_MIN * 60_000);
        update.pending_email = null;
        update.email_change_otp_hash = null;
        update.email_change_otp_expires_at = null;
        update.email_change_otp_attempts = 0;
      }
      await user.update(update);
      return errorResponse(res,
        attempts >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid_code',
        attempts >= OTP_MAX_ATTEMPTS ? 423 : 400
      );
    }

    await user.update({
      email_verified_at: new Date(),
      pending_email: null,
      email_change_otp_hash: null,
      email_change_otp_expires_at: null,
      email_change_otp_attempts: 0,
    });
    return successResponse(res, { email: user.email, verified: true });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/users/:id/secondary-email-verify-request
// 현재 secondary 이메일이 미인증 상태일 때 — 그 이메일로 OTP 발송
// ============================================
router.post('/:id/secondary-email-verify-request', authenticateToken, ...perUserDaily('otp-email', { perMin: 3, perDay: 20, message: '인증 메일 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' }), async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return errorResponse(res, 'only_self', 403);
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'user_not_found', 404);
    if (!user.secondary_email) return errorResponse(res, 'no_secondary_email', 400);
    if (user.secondary_email_verified_at) return errorResponse(res, 'already_verified', 400);
    if (user.secondary_email_locked_until && user.secondary_email_locked_until > new Date()) {
      return errorResponse(res, 'locked', 423);
    }

    const code = genOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000);
    await user.update({
      pending_secondary_email: user.secondary_email,
      secondary_email_otp_hash: sha256(code),
      secondary_email_otp_expires_at: expiresAt,
      secondary_email_otp_attempts: 0,
    });

    const sent = await sendVerificationCodeEmail({
      to: user.secondary_email,
      code,
      ttlMinutes: OTP_TTL_MIN,
      userName: user.name || '',
    }).catch(() => false);

    if (!process.env.SMTP_HOST) {
      console.log(`[DEV-SEC-VERIFY] user_id=${user.id} email=${user.secondary_email} code=${code}`);
    }

    return successResponse(res, {
      sent: !!sent,
      email: user.secondary_email,
      expires_at: expiresAt,
      ttl_minutes: OTP_TTL_MIN,
    });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/users/:id/secondary-email-verify-confirm
// ============================================
router.post('/:id/secondary-email-verify-confirm', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return errorResponse(res, 'only_self', 403);
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'user_not_found', 404);

    if (user.secondary_email_locked_until && user.secondary_email_locked_until > new Date()) {
      return errorResponse(res, 'locked', 423);
    }
    if (!user.secondary_email_otp_hash || !user.secondary_email_otp_expires_at) {
      return errorResponse(res, 'no_pending_request', 400);
    }
    if (user.secondary_email_otp_expires_at < new Date()) {
      await user.update({
        pending_secondary_email: null, secondary_email_otp_hash: null,
        secondary_email_otp_expires_at: null, secondary_email_otp_attempts: 0,
      });
      return errorResponse(res, 'otp_expired', 410);
    }

    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) return errorResponse(res, 'invalid_code_format', 400);

    if (sha256(code) !== user.secondary_email_otp_hash) {
      const attempts = user.secondary_email_otp_attempts + 1;
      const update = { secondary_email_otp_attempts: attempts };
      if (attempts >= OTP_MAX_ATTEMPTS) {
        update.secondary_email_locked_until = new Date(Date.now() + OTP_LOCK_MIN * 60_000);
        update.pending_secondary_email = null;
        update.secondary_email_otp_hash = null;
        update.secondary_email_otp_expires_at = null;
        update.secondary_email_otp_attempts = 0;
      }
      await user.update(update);
      return errorResponse(res,
        attempts >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid_code',
        attempts >= OTP_MAX_ATTEMPTS ? 423 : 400
      );
    }

    await user.update({
      secondary_email_verified_at: new Date(),
      pending_secondary_email: null,
      secondary_email_otp_hash: null,
      secondary_email_otp_expires_at: null,
      secondary_email_otp_attempts: 0,
    });
    return successResponse(res, { email: user.secondary_email, verified: true });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/users/:id/secondary-email-change-request
// 보조 이메일 추가/변경. 새 이메일에 6자리 OTP 발송. verify 시 secondary_email 로 교체.
// body: { new_email }
// ============================================
router.post('/:id/secondary-email-change-request', authenticateToken, ...perUserDaily('otp-email', { perMin: 3, perDay: 20, message: '인증 메일 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' }), async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return errorResponse(res, 'only_self', 403);
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'user_not_found', 404);

    if (user.secondary_email_locked_until && user.secondary_email_locked_until > new Date()) {
      return errorResponse(res, 'locked', 423);
    }

    const newEmail = String(req.body?.new_email || '').toLowerCase().trim();
    if (!EMAIL_RE.test(newEmail)) return errorResponse(res, 'invalid_email_format', 400);
    if (newEmail === user.email) return errorResponse(res, 'same_as_primary', 400);
    if (newEmail === user.secondary_email) return errorResponse(res, 'same_as_current', 400);
    if (/^cue\+\d+@system\.planq\.kr$/.test(newEmail)) return errorResponse(res, 'reserved_email', 400);

    // primary email 로 다른 사용자에게 잡혀있으면 충돌
    const dupPrimary = await User.findOne({ where: { email: newEmail } });
    if (dupPrimary && dupPrimary.id !== user.id) return errorResponse(res, 'email_already_used', 409);

    const code = genOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60_000);
    await user.update({
      pending_secondary_email: newEmail,
      secondary_email_otp_hash: sha256(code),
      secondary_email_otp_expires_at: expiresAt,
      secondary_email_otp_attempts: 0,
    });

    const sent = await sendVerificationCodeEmail({
      to: newEmail,
      code,
      ttlMinutes: OTP_TTL_MIN,
      userName: user.name || '',
    }).catch(() => false);

    if (!process.env.SMTP_HOST) {
      console.log(`[DEV-SECONDARY-EMAIL] user_id=${user.id} new=${newEmail} code=${code}`);
    }

    return successResponse(res, {
      sent: !!sent,
      pending_email: newEmail,
      expires_at: expiresAt,
      ttl_minutes: OTP_TTL_MIN,
    });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/users/:id/secondary-email-change-verify
// body: { code }
// → 검증 성공 시 secondary_email = pending_secondary_email 로 교체 + verified_at 마킹
// ============================================
router.post('/:id/secondary-email-change-verify', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return errorResponse(res, 'only_self', 403);
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'user_not_found', 404);

    if (user.secondary_email_locked_until && user.secondary_email_locked_until > new Date()) {
      return errorResponse(res, 'locked', 423);
    }
    if (!user.pending_secondary_email || !user.secondary_email_otp_hash || !user.secondary_email_otp_expires_at) {
      return errorResponse(res, 'no_pending_request', 400);
    }
    if (user.secondary_email_otp_expires_at < new Date()) {
      await user.update({
        pending_secondary_email: null, secondary_email_otp_hash: null,
        secondary_email_otp_expires_at: null, secondary_email_otp_attempts: 0,
      });
      return errorResponse(res, 'otp_expired', 410);
    }

    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) return errorResponse(res, 'invalid_code_format', 400);

    if (sha256(code) !== user.secondary_email_otp_hash) {
      const attempts = user.secondary_email_otp_attempts + 1;
      const update = { secondary_email_otp_attempts: attempts };
      if (attempts >= OTP_MAX_ATTEMPTS) {
        update.secondary_email_locked_until = new Date(Date.now() + OTP_LOCK_MIN * 60_000);
        update.pending_secondary_email = null;
        update.secondary_email_otp_hash = null;
        update.secondary_email_otp_expires_at = null;
        update.secondary_email_otp_attempts = 0;
      }
      await user.update(update);
      return errorResponse(res,
        attempts >= OTP_MAX_ATTEMPTS ? 'locked' : 'invalid_code',
        attempts >= OTP_MAX_ATTEMPTS ? 423 : 400
      );
    }

    const newEmail = user.pending_secondary_email;
    const prevSecondary = user.secondary_email;
    await user.update({
      secondary_email: newEmail,
      secondary_email_verified_at: new Date(),
      pending_secondary_email: null,
      secondary_email_otp_hash: null,
      secondary_email_otp_expires_at: null,
      secondary_email_otp_attempts: 0,
    });
    // 사이클 N+51 — audit. 보조 이메일 변경 = 계정 복구 채널 변경 (보안 critical)
    require('../services/auditService').logAudit(req, {
      action: 'user.secondary_email_change',
      targetType: 'user',
      targetId: user.id,
      userId: user.id,
      oldValue: { secondary_email: prevSecondary },
      newValue: { secondary_email: newEmail, verified_at: user.secondary_email_verified_at },
    });

    return successResponse(res, { secondary_email: newEmail, changed: true });
  } catch (err) { next(err); }
});

// ============================================
// DELETE /api/users/:id/secondary-email — 보조 이메일 제거
// ============================================
router.delete('/:id/secondary-email', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.id !== parseInt(req.params.id, 10)) {
      return errorResponse(res, 'only_self', 403);
    }
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'user_not_found', 404);
    const prevSecondary = user.secondary_email;
    await user.update({
      secondary_email: null,
      secondary_email_verified_at: null,
      pending_secondary_email: null,
      secondary_email_otp_hash: null,
      secondary_email_otp_expires_at: null,
      secondary_email_otp_attempts: 0,
    });
    // 사이클 N+51 — audit. 보조 이메일 제거 (보안 critical)
    require('../services/auditService').logAudit(req, {
      action: 'user.secondary_email_remove',
      targetType: 'user',
      targetId: user.id,
      userId: user.id,
      oldValue: { secondary_email: prevSecondary },
    });
    return successResponse(res, { removed: true });
  } catch (err) { next(err); }
});

// Suspend/Activate user (platform admin)
router.patch('/:id/status', authenticateToken, requireRole('platform_admin'), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return errorResponse(res, 'User not found', 404);

    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return errorResponse(res, 'Invalid status', 400);
    }

    const prevStatus = user.status;
    await user.update({ status });
    // 사이클 N+51 — audit. platform admin 의 계정 상태 변경 (suspend/activate)
    require('../services/auditService').logAudit(req, {
      action: 'user.status_change',
      targetType: 'user',
      targetId: user.id,
      userId: req.user.id,
      oldValue: { status: prevStatus },
      newValue: { status, target_user_email: user.email },
    });
    successResponse(res, { id: user.id, status });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
