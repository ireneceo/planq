// routes/client_invites.js — 고객 **초대·재발송·직접 관리 등록** (/api/clients 접두어, routes/clients.js 에서 분리 2026-10-15)
//   직접 관리 고객 설계: docs/CLIENT_MANAGED_DESIGN.md. 관계 축 판정은 services/clientAccess 한 곳.
//   ★ 이 파일의 경로는 모두 `/:businessId/<고유 꼬리>` 또는 `/:businessId/:id/<고유 꼬리>` 다 — clients.js 경로와 겹치지 않는다.
const express = require('express');
const router = express.Router();
const { Client, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const { perUserDaily } = require('../middleware/costGuard');
const { requireMenu } = require('../middleware/menu_permission');
const { broadcastClient, stripClientSecrets } = require('../services/clientResponse');

// 초대 메일 한 통 — 새 초대·승격 두 분기가 같이 쓴다(베끼면 한쪽만 고쳐진다).
//   sendEmail 은 던지지 않고 false 를 돌려준다 — 결과를 응답에 싣는다(0-F F-1).
async function sendClientInviteMail(req, { to, targetName, token }) {
  try {
    const { sendInviteEmail } = require('../services/emailService');
    const biz = await require('../models').Business.findByPk(req.params.businessId, { attributes: ['brand_name', 'name'] });
    const inviter = await User.findByPk(req.user.id, { attributes: ['name'] });
    const sent = await sendInviteEmail({
      to,
      workspaceName: biz?.brand_name || biz?.name || 'PlanQ',
      inviterName: inviter?.name || '',
      targetName,
      kind: 'workspace_client',
      token,
    });
    return sent === true;
  } catch (e) { console.warn('invite email send failed:', e.message); return false; }
}

router.post('/:businessId/invite', authenticateToken, checkBusinessAccess, requireMenu('clients', 'write'), ...perUserDaily('invite-email', { perMin: 20, perDay: 200, message: '초대 발송이 너무 잦습니다. 잠시 후 다시 시도하세요.' }), async (req, res, next) => {
  try {
    const { name, email, company_name, notes, kind, client_id } = req.body || {};
    if (!name?.trim() || !email?.trim()) return errorResponse(res, 'name and email are required', 400);
    const finalKind = ['customer', 'vendor', 'freelancer', 'other'].includes(kind) ? kind : 'customer';
    const { canInviteClient } = require('../services/clientAccess');
    const planEngine = require('../services/plan');
    const crypto = require('crypto');
    const businessId = req.params.businessId;

    // 승격 대상 — **행 id 가 정본**(드로어 «이 고객 초대»), 없으면 같은 주소의 문의/직접 관리 행(docs/CLIENT_MANAGED_DESIGN.md §3).
    //   새 행을 만들지 않고 같은 행을 invited 로 올린다 — 상담 기록·청구서·타임라인이 그 행에 붙어 있다.
    let target = null;
    if (client_id !== undefined && client_id !== null && client_id !== '') {
      target = await Client.findOne({ where: { id: Number(client_id) || 0, business_id: businessId } });
      if (!target) return errorResponse(res, 'Client not found', 404);
      if (!canInviteClient(target)) return errorResponse(res, 'not_invitable', 409);
    }

    const existingUser = await User.findOne({ where: { email: email.trim() } });
    // 동일 워크스페이스에 같은 이메일·user 이미 존재하는지 체크
    if (existingUser) {
      const dup = await Client.findOne({ where: { business_id: businessId, user_id: existingUser.id } });
      if (dup && (!target || dup.id !== target.id)) {
        if (dup.status === 'archived' && !target) {
          await dup.update({ status: 'invited', display_name: name.trim(), company_name: company_name?.trim() || dup.company_name, notes: notes?.trim() || dup.notes });
          return successResponse(res, stripClientSecrets(dup.toJSON()), 'Re-invited', 200);
        }
        return errorResponse(res, 'Client already exists', 409);
      }
    }
    const dupByEmail = await Client.findOne({ where: { business_id: businessId, invite_email: email.trim() } });
    if (!target && dupByEmail && canInviteClient(dupByEmail)) target = dupByEmail;
    // 주소가 이미 **다른** 고객의 받는 주소면 막는다 — 같은 사람이 두 행이 된다
    if (target && dupByEmail && dupByEmail.id !== target.id && dupByEmail.status !== 'archived') {
      return errorResponse(res, 'Client already exists', 409);
    }

    if (target) {
      // 문의 고객은 초대하는 순간 정식 고객 한도에 들어간다 — 그때만 센다. 직접 관리 고객은 이미 세고 있다(+0).
      if (target.status === 'prospect') {
        const planCan = await planEngine.can(businessId, 'add_client');
        if (!planCan.ok) return res.status(422).json(planEngine.buildQuotaError(planCan, businessId));
      }
      const before = { status: target.status, invite_email: target.invite_email };
      const token = crypto.randomBytes(24).toString('hex');
      await target.update({
        status: 'invited', invite_token: token, invited_by: req.user.id, invited_at: new Date(),
        invite_email: email.trim(),
        display_name: target.display_name || name.trim(),
        company_name: target.company_name || company_name?.trim() || null,
        user_id: target.user_id || existingUser?.id || null,
        assigned_member_id: target.assigned_member_id || req.user.id,
      });
      await createAuditLog({
        userId: req.user.id, businessId,
        action: 'client.invited', targetType: 'client', targetId: target.id,
        oldValue: before, newValue: { status: 'invited', invite_email: email.trim() },
      });
      const inviteEmailSent = await sendClientInviteMail(req, { to: email.trim(), targetName: target.display_name || name.trim(), token });
      await notifyClientInvitee(req, { email: email.trim(), entityId: target.id, token });
      // 문의 → 정식 고객으로 한도 계수가 바뀐다. 사용량 캐시(30초)를 비워야 플랜 화면이 바로 맞는다
      try { planEngine.invalidateBusinessCache(businessId); } catch { /* 캐시일 뿐이다 */ }
      broadcastClient(req, target, 'client:updated');
      return successResponse(res, { ...stripClientSecrets(target.toJSON()), invite_email_sent: inviteEmailSent },
        inviteEmailSent ? 'Client invited' : 'invite_email_failed', 200);
    }
    if (dupByEmail && dupByEmail.status !== 'archived') {
      return errorResponse(res, 'Client already exists', 409);
    }

    // 플랜 쿼터 — 고객 수 한도
    const planCan = await planEngine.can(businessId, 'add_client');
    if (!planCan.ok) {
      return res.status(422).json(planEngine.buildQuotaError(planCan, businessId));
    }
    const token = crypto.randomBytes(24).toString('hex');
    const created = await Client.create({
      business_id: businessId,
      user_id: existingUser?.id || null,
      display_name: name.trim(),
      company_name: company_name?.trim() || null,
      notes: notes?.trim() || null,
      kind: finalKind,
      status: 'invited',
      invited_by: req.user.id,
      invited_at: new Date(),
      invite_token: token,
      invite_email: email.trim(),
      // N+83 — 초대자를 기본 담당자로 자동 배정 (첫 응대 책임선 명확화). 이후 수동 변경 가능.
      assigned_member_id: req.user.id,
    });
    await createAuditLog({
      userId: req.user.id, businessId,
      action: 'client.invited', targetType: 'client', targetId: created.id,
      newValue: { email: email.trim(), name: name.trim(), company_name: company_name || null },
    });

    // 초대 이메일 발송 (실패해도 초대 레코드는 유지) — 실패를 **응답에 싣는다**(0-F F-1).
    const inviteEmailSent = await sendClientInviteMail(req, { to: email.trim(), targetName: name.trim(), token });
    if (existingUser) await notifyClientInvitee(req, { userId: existingUser.id, entityId: created.id, token });
    try { planEngine.invalidateBusinessCache(businessId); } catch { /* 캐시일 뿐이다 */ }

    broadcastClient(req, created, 'client:new');   // 신호만(0-C C-2) — 고객 목록을 연 다른 창이 따라온다
    successResponse(res, { ...stripClientSecrets(created.toJSON()), invite_email_sent: inviteEmailSent },
      inviteEmailSent ? 'Client invited' : 'invite_email_failed', 201);
  } catch (error) { next(error); }
});

// 직접 관리 고객 등록 — 계정·초대 없이 정보만 넣고 관리하는 **정식 고객**(docs/CLIENT_MANAGED_DESIGN.md).
//   청구서·프로젝트·증빙에 쓰려고 넣는 고객이다. 한도는 정식 고객(add_client). 메일은 보내지 않는다.
//   이메일·전화는 선택 — 이름 또는 회사 하나는 있어야 한다. 이미 같은 이메일·전화의 고객이 있으면 409(조용히 연결하지 않는다).
router.post('/:businessId/managed', authenticateToken, checkBusinessAccess, requireMenu('clients', 'write'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const { trimOrNull, normEmail, EMAIL_RE, findExistingByContact } = require('../services/saleCommon');
    const body = req.body || {};
    const seed = {
      display_name: trimOrNull(body.name, 100),
      company_name: trimOrNull(body.company_name, 200),
      email: normEmail(body.email),
      phone: trimOrNull(body.phone, 40),
      notes: trimOrNull(body.notes, 5000),
    };
    if (!seed.display_name && !seed.company_name) return errorResponse(res, 'name_required', 400);
    if (seed.email && !EMAIL_RE.test(seed.email)) return errorResponse(res, 'invalid_email', 400);
    const finalKind = ['customer', 'vendor', 'freelancer', 'other'].includes(body.kind) ? body.kind : 'customer';

    const existing = await findExistingByContact(businessId, { email: seed.email, phone: seed.phone });
    if (existing) return res.status(409).json({ success: false, message: 'client_exists', existing_client_id: existing.id });

    const planEngine = require('../services/plan');
    const planCan = await planEngine.can(businessId, 'add_client');
    if (!planCan.ok) return res.status(422).json(planEngine.buildQuotaError(planCan, businessId));

    const created = await Client.create({
      business_id: businessId,
      display_name: seed.display_name,
      company_name: seed.company_name,
      invite_email: seed.email,
      phone: seed.phone,
      notes: seed.notes,
      kind: finalKind,
      status: 'managed',
      assigned_member_id: req.user.id,
    });
    await createAuditLog({
      userId: req.user.id, businessId,
      action: 'client.created_managed', targetType: 'client', targetId: created.id,
      newValue: { name: seed.display_name, company_name: seed.company_name, email: seed.email },
    });
    planEngine.invalidateBusinessCache(businessId);
    broadcastClient(req, created, 'client:new');
    return successResponse(res, stripClientSecrets(created.toJSON()), 'Client created', 201);
  } catch (error) { next(error); }
});

// 문의 고객 → 직접 관리 고객(계정 없이 정식 고객으로) — 사람이 누르는 문. 영업 단계(sales_stage)는 건드리지 않는다.
//   정식 고객 한도에 들어가므로 add_client 를 본다.
router.post('/:businessId/:id/register-managed', authenticateToken, checkBusinessAccess, requireMenu('clients', 'write'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const client = await Client.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!client) return errorResponse(res, 'Client not found', 404);
    if (client.status !== 'prospect' || client.user_id) return errorResponse(res, 'not_prospect', 409);
    const planEngine = require('../services/plan');
    const planCan = await planEngine.can(businessId, 'add_client');
    if (!planCan.ok) return res.status(422).json(planEngine.buildQuotaError(planCan, businessId));
    await client.update({ status: 'managed' });
    await createAuditLog({
      userId: req.user.id, businessId,
      action: 'client.registered_managed', targetType: 'client', targetId: client.id,
      oldValue: { status: 'prospect' }, newValue: { status: 'managed' },
    });
    planEngine.invalidateBusinessCache(businessId);
    broadcastClient(req, client, 'client:updated');
    return successResponse(res, stripClientSecrets(client.toJSON()));
  } catch (error) { next(error); }
});

// 이미 PlanQ 계정인 고객에게 앱 안에서도 초대를 알린다 — services/inviteNotify 한 벌(초대·승격·재발송이 같이 쓴다)
const notifyClientInvitee = (req, a) => require('../services/inviteNotify').notifyExistingInvitee({ kind: 'workspace_client',
  businessId: Number(req.params.businessId), entityType: 'client', actorUserId: req.user.id, io: req.app.get('io'), ...a });
// 초대 재발송 — 아직 수락 안 한 (invited) 고객에게 초대 메일 다시 보내기.
//   토큰은 유지하되 invited_at 갱신(만료 30일 연장). 이미 가입(active)한 고객은 불가.
router.post('/:businessId/:id/resend-invite', authenticateToken, checkBusinessAccess, requireMenu('clients', 'write'), async (req, res, next) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!client) return errorResponse(res, 'Client not found', 404);
    if (client.status === 'active' || client.accepted_at) return errorResponse(res, 'already_accepted', 400);
    // 재발송은 **이미 초대한** 고객만 — 문의·직접 관리 고객을 여기로 보내면 한도 검사 없이 invited 가 됐다(승격 우회).
    //   처음 초대는 POST /invite { client_id } 한 문이다.
    if (client.status !== 'invited') return errorResponse(res, 'not_invited', 400);
    if (!client.invite_email) return errorResponse(res, 'no_invite_email', 400);

    const crypto = require('crypto');
    // 토큰 없으면 신규 발급, 있으면 유지. invited_at 갱신으로 만료 연장. reinvite_count +1 (운영 #52 재발송 이력).
    const token = client.invite_token || crypto.randomBytes(24).toString('hex');
    await client.update({ invite_token: token, invited_at: new Date(), status: 'invited', reinvite_count: (client.reinvite_count || 0) + 1 });

    try {
      const { sendInviteEmail } = require('../services/emailService');
      const biz = await require('../models').Business.findByPk(req.params.businessId, { attributes: ['brand_name', 'name'] });
      const inviter = await User.findByPk(req.user.id, { attributes: ['name'] });
      await sendInviteEmail({
        to: client.invite_email,
        workspaceName: biz?.brand_name || biz?.name || 'PlanQ',
        inviterName: inviter?.name || '',
        targetName: client.display_name || '',
        kind: 'workspace_client',
        token,
      });
    } catch (e) { console.warn('resend invite email failed:', e.message); }
    await notifyClientInvitee(req, { email: client.invite_email, entityId: client.id, token });   // 안 읽은 알림이 있으면 helper 가 거른다

    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'client.reinvited', targetType: 'client', targetId: client.id,
      newValue: { email: client.invite_email },
    });
    return successResponse(res, { id: client.id, status: 'invited' }, 'Invite resent');
  } catch (error) { next(error); }
});

module.exports = router;
