// routes/email_accounts.js — EmailAccount CRUD (Q Mail M1)
// admin only (workspace owner/admin) — requireMenu('qmail', 'admin') 정합.
// 비밀번호는 services/encryption.js (AES-256-GCM).
// POST/PUT 시 IMAP 실연결 검증 강제 — 잘못된 자격이 조용히 등록되어 5분마다 실패하는 사고 차단.
const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { EmailAccount, Business, EmailAccountAlias } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { encrypt, decrypt } = require('../services/encryption');
const { createAuditLog } = require('../middleware/audit');
const { accountHealth, oauthToPasswordPatch } = require('../services/emailAccountHealth');

// admin 권한 검사 — owner 또는 admin 또는 platform_admin
function isAdmin(req) {
  return req.businessRole === 'owner'
    || req.businessRole === 'admin'
    || req.user?.platform_role === 'platform_admin';
}

// 이 사용자가 볼 수 있는 계정 where 조건:
//   회사 공용 계정 (owner_user_id NULL, 모든 멤버) + 본인 개인 계정 (owner_user_id = 나).
//   다른 사람의 개인 메일은 절대 노출 X (admin 도 차단 — email_threads.accessibleAccountIds 와 정합).
function accessibleWhere(req) {
  const { Op } = require('sequelize');
  return { [Op.or]: [{ owner_user_id: null }, { owner_user_id: req.user.id }] };
}

// 이 계정을 관리(편집/삭제/동기화)할 수 있는가:
//   회사 공용(owner null) → admin 만. 본인 개인(owner=나) → 본인. 그 외 → false.
function canManageAccount(req, acc) {
  if (acc.owner_user_id == null) return isAdmin(req);
  return acc.owner_user_id === req.user.id;
}

// 관리자 교정(remediation) — 남의 개인 계정으로 "잘못 등록된" 워크스페이스 자산을 바로잡는 경로.
//   실사례: 회사 대표 메일(help@)이 한 멤버의 개인 메일로 등록돼 회사 메일이 그 사람에게만 보였다.
//   프론트엔 admin 전용 "개인 ↔ 회사 공용 전환" 버튼이 있었지만, accessibleWhere 가 남의 개인 계정을
//   조회 단계에서 걸러 404 → 그 기능은 한 번도 동작한 적이 없다 (죽은 기능).
//   열어주는 범위는 최소 — 공용 전환(scope='team') 과 비활성화(is_active=false) 뿐:
//     · 자격증명(비밀번호·호스트·사용자명) 편집 불가 — 관리자가 남의 사서함을 가로챌 수 없다
//     · 남의 개인 계정을 자기 개인(scope='personal')으로 가져오는 것도 불가
//     · GET 목록은 그대로 — 누가 어떤 개인 메일을 연결했는지 노출하지 않는다
const ADMIN_REMEDIATION_FIELDS = ['scope', 'is_active'];

function isAdminRemediation(req, acc) {
  if (!acc || acc.owner_user_id == null) return false;   // 공용 계정은 기존 경로
  if (acc.owner_user_id === req.user.id) return false;   // 본인 것은 기존 경로
  if (!isAdmin(req)) return false;
  const keys = Object.keys(req.body || {});
  if (keys.length === 0) return false;
  if (!keys.every((k) => ADMIN_REMEDIATION_FIELDS.includes(k))) return false;
  if (req.body.scope !== undefined && req.body.scope !== 'team') return false;
  if (req.body.is_active !== undefined && req.body.is_active !== false) return false;
  return true;
}

// PUT/DELETE 공통 조회 — 기본은 본인 것 + 공용. 관리자 교정 요청이면 워크스페이스 전체에서 찾는다.
async function findAccountForMutation(req, { allowRemediation = true } = {}) {
  const base = { id: req.params.id, business_id: req.params.businessId };
  const own = await EmailAccount.findOne({ where: { ...base, ...accessibleWhere(req) } });
  if (own) return { acc: own, remediation: false };
  if (!allowRemediation) return { acc: null, remediation: false };
  const any = await EmailAccount.findOne({ where: base });
  if (!any || !isAdminRemediation(req, any)) return { acc: null, remediation: false };
  return { acc: any, remediation: true };
}

// IMAP 자격 검증·비밀번호 정규화 — services/email_credentials.js (라우트 슬림화)
const { normalizeImapPassword, verifyImapCredentials } = require('../services/email_credentials');

// 응답 시 비밀번호 hash 제외 (frontend 노출 X)
function serializeAccount(acc) {
  const j = acc.toJSON ? acc.toJSON() : acc;
  return {
    id: j.id,
    business_id: j.business_id,
    email: j.email,
    display_name: j.display_name,
    signature_html: j.signature_html || null,
    signature_enabled: j.signature_enabled !== false,
    imap_host: j.imap_host,
    imap_port: j.imap_port,
    imap_username: j.imap_username,
    imap_tls: j.imap_tls,
    imap_folder: j.imap_folder,
    imap_last_uid: j.imap_last_uid,
    smtp_host: j.smtp_host,
    smtp_port: j.smtp_port,
    smtp_username: j.smtp_username,
    smtp_tls: j.smtp_tls,
    is_active: j.is_active,
    is_default: j.is_default,
    notify_scope: j.notify_scope || 'recommended',   // #207 알림 범위
    owner_user_id: j.owner_user_id ?? null,
    is_personal: j.owner_user_id != null,
    scope: j.owner_user_id != null ? 'personal' : 'team',
    last_sync_at: j.last_sync_at,
    last_sync_error: j.last_sync_error,
    fail_count: j.fail_count,
    auth_type: j.auth_type,
    ...accountHealth(j),   // 재인증 필요 판정 = 서버 단일 원천 (services/emailAccountHealth.js)
    // 비밀번호는 응답 X — 보유 여부만 boolean
    has_imap_password: !!j.imap_password_encrypted,
    has_smtp_password: !!j.smtp_password_encrypted,
    created_at: j.created_at,
    updated_at: j.updated_at,
  };
}

// GET — 계정 목록 (회사 공용 + 본인 개인. 멤버도 접근 가능 — 개인 메일 관리 위해)
router.get('/:businessId/email-accounts', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const rows = await EmailAccount.findAll({
      where: { business_id: req.params.businessId, ...accessibleWhere(req) },
      order: [['owner_user_id', 'ASC'], ['is_default', 'DESC'], ['created_at', 'ASC']],
    });
    successResponse(res, rows.map(serializeAccount));
  } catch (err) { next(err); }
});

// POST — 신규 등록 (자동 IMAP test)
router.post('/:businessId/email-accounts', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const b = req.body || {};
    // scope: 'personal'(개인, 본인만) | 'team'(회사 공용, 모든 멤버). team 은 admin 만.
    const scope = b.scope === 'personal' ? 'personal' : 'team';
    if (scope === 'team' && !isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const ownerUserId = scope === 'personal' ? req.user.id : null;
    // 필수 검증
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return errorResponse(res, 'invalid_email', 400);
    if (!b.imap_host || !b.imap_username || !b.imap_password) {
      return errorResponse(res, 'imap_required', 400);
    }
    // 앱비밀번호 공백 정규화 — 검증과 저장이 같은 값을 쓰도록 여기서 한 번만 처리
    const imapPassword = normalizeImapPassword(b.imap_host, b.imap_password);
    const smtpPassword = b.smtp_password
      ? normalizeImapPassword(b.smtp_host || b.imap_host, b.smtp_password)
      : null;
    // 중복 (워크스페이스 내 같은 email 1개만)
    const dup = await EmailAccount.findOne({ where: { business_id: businessId, email } });
    if (dup) return errorResponse(res, 'duplicate_email', 409);
    // 저장 전 실연결 검증 — 실패 시 등록 자체를 거부 + 원인별 안내 코드
    const verify = await verifyImapCredentials({
      host: b.imap_host, port: Number(b.imap_port) || 993, tls: b.imap_tls !== false,
      username: b.imap_username, password: imapPassword, folder: b.imap_folder || 'INBOX',
    });
    if (!verify.ok) return res.status(400).json({ success: false, message: verify.code, detail: verify.detail });
    // 첫 공용 계정이면 is_default 자동 (개인 계정은 공용 default 후보 아님)
    const teamCount = await EmailAccount.count({ where: { business_id: businessId, owner_user_id: null } });
    const acc = await EmailAccount.create({
      business_id: businessId,
      owner_user_id: ownerUserId,
      email,
      display_name: b.display_name || null,
      imap_host: b.imap_host,
      imap_port: Number(b.imap_port) || 993,
      imap_username: b.imap_username,
      imap_password_encrypted: encrypt(imapPassword),
      imap_tls: b.imap_tls !== false,
      imap_folder: b.imap_folder || 'INBOX',
      smtp_host: b.smtp_host || null,
      smtp_port: Number(b.smtp_port) || (b.smtp_host ? 587 : null),
      smtp_username: b.smtp_username || null,
      smtp_password_encrypted: smtpPassword ? encrypt(smtpPassword) : null,
      smtp_tls: b.smtp_tls !== false,
      is_active: true,
      is_default: scope === 'team' && teamCount === 0,
    });
    await createAuditLog({
      userId: req.user.id, businessId,
      action: 'email_account.create',
      targetType: 'EmailAccount', targetId: acc.id,
      newValue: { email, imap_host: acc.imap_host, imap_port: acc.imap_port },
    });
    require('../services/emailImapCron').startIdleForAccount(acc).catch((e) => console.error('[idle-start]', e.message)); // 신규 계정 즉시 IMAP IDLE(실시간)
    successResponse(res, serializeAccount(acc), 'EmailAccount created', 201);
  } catch (err) { next(err); }
});

// PUT — 수정 (비밀번호 변경 가능)
router.put('/:businessId/email-accounts/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { acc, remediation } = await findAccountForMutation(req);
    if (!acc) return errorResponse(res, 'not_found', 404);
    if (!remediation && !canManageAccount(req, acc)) return errorResponse(res, 'forbidden', 403);
    const b = req.body || {};
    const patch = {};
    // #109 — 개인 ↔ 회사공용(scope) 전환. 옛 버그: PUT 에 scope 변경이 없어 "회사공용에 실수로 추가했는데 개인으로 못 바꿈".
    //   회사공용→개인: 본인 소유로 이전(팀 계정 관리 권한은 canManageAccount 가 이미 admin 으로 게이트).
    //   개인→회사공용: 공용화라 admin 만.
    if (b.scope !== undefined) {
      if (b.scope === 'personal') {
        patch.owner_user_id = req.user.id;
      } else {
        if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
        patch.owner_user_id = null;
      }
    }
    if (b.display_name !== undefined) patch.display_name = b.display_name || null;
    // 서명 — 계정마다 등록한다. HTML 저장(발송 시 emailSend.appendSignature 가 붙인다).
    if (b.signature_html !== undefined) patch.signature_html = b.signature_html ? String(b.signature_html).slice(0, 20000) : null;
    if (b.signature_enabled !== undefined) patch.signature_enabled = !!b.signature_enabled;
    if (b.imap_host !== undefined) patch.imap_host = b.imap_host;
    if (b.imap_port !== undefined) patch.imap_port = Number(b.imap_port) || 993;
    if (b.imap_username !== undefined) patch.imap_username = b.imap_username;
    if (b.imap_password !== undefined && b.imap_password) {
      patch.imap_password_encrypted = encrypt(normalizeImapPassword(b.imap_host || acc.imap_host, b.imap_password));
    }
    if (b.imap_tls !== undefined) patch.imap_tls = !!b.imap_tls;
    if (b.imap_folder !== undefined) patch.imap_folder = b.imap_folder || 'INBOX';
    if (b.smtp_host !== undefined) patch.smtp_host = b.smtp_host || null;
    if (b.smtp_port !== undefined) patch.smtp_port = Number(b.smtp_port) || null;
    if (b.smtp_username !== undefined) patch.smtp_username = b.smtp_username || null;
    if (b.smtp_password !== undefined && b.smtp_password) {
      patch.smtp_password_encrypted = encrypt(normalizeImapPassword(b.smtp_host || acc.smtp_host || b.imap_host || acc.imap_host, b.smtp_password));
    }
    if (b.smtp_tls !== undefined) patch.smtp_tls = !!b.smtp_tls;
    if (b.is_active !== undefined) patch.is_active = !!b.is_active;
    // #207 — 알림 범위 (전체 / 확인권장+답변필요 / 답변필요만). 계정 속성이라 여기서 저장한다.
    if (b.notify_scope !== undefined) {
      const allowed = ['all', 'recommended', 'reply_only'];
      if (!allowed.includes(String(b.notify_scope))) return errorResponse(res, 'invalid_notify_scope', 400);
      patch.notify_scope = String(b.notify_scope);
    }
    // IMAP 자격이 바뀌면 저장 전 실연결 검증 (비밀번호 재입력으로 계정 살리는 경로 포함)
    const imapTouched = ['imap_host', 'imap_port', 'imap_username', 'imap_password'].some((k) => b[k] !== undefined && b[k]);
    if (imapTouched) {
      const password = (b.imap_password && normalizeImapPassword(b.imap_host || acc.imap_host, b.imap_password)) || decrypt(acc.imap_password_encrypted);
      const verify = await verifyImapCredentials({
        host: b.imap_host !== undefined ? b.imap_host : acc.imap_host,
        port: Number(b.imap_port !== undefined ? b.imap_port : acc.imap_port) || 993,
        tls: b.imap_tls !== undefined ? !!b.imap_tls : acc.imap_tls,
        username: b.imap_username !== undefined ? b.imap_username : acc.imap_username,
        password,
        folder: b.imap_folder !== undefined ? (b.imap_folder || 'INBOX') : acc.imap_folder,
      });
      if (!verify.ok) return res.status(400).json({ success: false, message: verify.code, detail: verify.detail });
      // 검증 통과 → 실패 이력 리셋
      patch.last_sync_error = null;
      patch.fail_count = 0;

      Object.assign(patch, oauthToPasswordPatch(acc, b, patch));  // OAuth → 앱 비밀번호 전환 (검증 통과 후에만)
    }
    const prevOwner = acc.owner_user_id;
    await acc.update(patch);
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      // 관리자가 남의 개인 계정을 교정한 경우는 별도 action — 감사에서 구분되어야 한다
      action: remediation ? 'email_account.admin_remediate' : 'email_account.update',
      targetType: 'EmailAccount', targetId: acc.id,
      oldValue: remediation ? { owner_user_id: prevOwner } : undefined,
      newValue: { fields: Object.keys(patch), ...(remediation ? { owner_user_id: acc.owner_user_id } : {}) },
    });
    successResponse(res, serializeAccount(acc));
  } catch (err) { next(err); }
});

// DELETE — soft (is_active=false, data 보존)
router.delete('/:businessId/email-accounts/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    // 관리자 교정 — DELETE 는 body 가 없으므로 비활성화 의사로 간주 (교정 허용 필드와 동일)
    if (!req.body || Object.keys(req.body).length === 0) req.body = { is_active: false };
    const { acc, remediation } = await findAccountForMutation(req);
    if (!acc) return errorResponse(res, 'not_found', 404);
    if (!remediation && !canManageAccount(req, acc)) return errorResponse(res, 'forbidden', 403);
    await acc.update({ is_active: false });
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: remediation ? 'email_account.admin_deactivate' : 'email_account.deactivate',
      targetType: 'EmailAccount', targetId: acc.id,
    });
    successResponse(res, null, 'deactivated');
  } catch (err) { next(err); }
});

// POST /test — IMAP 연결 테스트
router.post('/:businessId/email-accounts/:id/test', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, ...accessibleWhere(req) },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    if (!canManageAccount(req, acc)) return errorResponse(res, 'forbidden', 403);
    const password = decrypt(acc.imap_password_encrypted);
    if (!password) return errorResponse(res, 'password_decrypt_failed', 500);
    // imap-simple 으로 1회 connect → disconnect (10초 timeout)
    let connOk = false;
    let errMsg = null;
    try {
      const imaps = require('imap-simple');
      const conn = await imaps.connect({
        imap: {
          user: acc.imap_username,
          password,
          host: acc.imap_host,
          port: acc.imap_port,
          tls: acc.imap_tls,
          authTimeout: 10000,
          tlsOptions: { rejectUnauthorized: false },
        },
      });
      await conn.openBox(acc.imap_folder);
      await conn.end();
      connOk = true;
    } catch (e) {
      errMsg = e.message;
    }
    successResponse(res, { ok: connOk, error: errMsg });
  } catch (err) { next(err); }
});

// POST /set-default — 기본 계정 설정
router.post('/:businessId/email-accounts/:id/set-default', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: businessId },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    // 기본 계정은 워크스페이스 공용 발송 기본값 → 회사 공용 계정만 가능 (개인 계정 제외)
    if (acc.owner_user_id != null) return errorResponse(res, 'personal_cannot_be_default', 400);
    // 공용 계정 default 해제 → 이 계정만 true
    await EmailAccount.update({ is_default: false }, { where: { business_id: businessId, owner_user_id: null } });
    await acc.update({ is_default: true });
    successResponse(res, serializeAccount(acc));
  } catch (err) { next(err); }
});

// POST /sync-now — 즉시 IMAP fetch 트리거 (cron 대기 없이)
router.post('/:businessId/email-accounts/:id/sync-now', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, ...accessibleWhere(req) },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    if (!canManageAccount(req, acc)) return errorResponse(res, 'forbidden', 403);
    // 백그라운드 fire-and-forget
    const emailImapCron = require('../services/emailImapCron');
    emailImapCron.syncOne(acc).catch(e => console.error('[sync-now]', e.message));
    successResponse(res, { triggered: true, account_id: acc.id });
  } catch (err) { next(err); }
});

// POST /backfill — 최근 N일 과거 메일 가져오기 (기본 30일)
//   계정을 연결하면 그 뒤로 오는 메일만 담기던 옛 동작 때문에, 방금 연결한 사용자는 빈 화면을 봤다.
//   신규 연결은 이제 자동 백필되지만, 이미 연결된 계정은 이 버튼으로 과거분을 채운다.
//   과거 메일은 읽기만 — "답변 필요" 로 올리지 않는다 (이미 다른 데서 처리했을 가능성).
router.post('/:businessId/email-accounts/:id/backfill', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const acc = await EmailAccount.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, ...accessibleWhere(req) },
    });
    if (!acc) return errorResponse(res, 'not_found', 404);
    if (!canManageAccount(req, acc)) return errorResponse(res, 'forbidden', 403);

    const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 90);
    const emailImapCron = require('../services/emailImapCron');
    // 백그라운드 — 수백 통이면 시간이 걸린다. 완료는 socket(mail:updated)으로 화면에 반영.
    emailImapCron.syncOne(acc, { backfill: true, days })
      .then((n) => console.log(`[backfill] account #${acc.id} — ${n} 건 가져옴`))
      .catch((e) => console.error('[backfill]', e.message));
    successResponse(res, { triggered: true, account_id: acc.id, days }, `최근 ${days}일 메일을 가져오는 중입니다`);
  } catch (err) { next(err); }
});

// Gmail OAuth 동의/콜백은 별도 라우터로 절출 (routes/email_oauth_gmail.js).
//   같은 마운트 경로(/api/businesses)를 공유하므로 여기서 이어 붙인다 — server.js 변경 불필요.
router.use(require('./email_oauth_gmail'));

module.exports = router;
