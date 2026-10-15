const express = require('express');
const router = express.Router();
const { Client, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
// 메뉴 권한(0-C C-8) — 멤버별 «고객» 메뉴 none/read/write 를 서버가 지킨다. sale.js 체인과 같은 자리(checkBusinessAccess 다음).
const { requireMenu } = require('../middleware/menu_permission');

// 응답·실시간 공용 조각 — 초대·등록 라우트(routes/client_invites.js)와 같이 쓴다(services/clientResponse 한 벌)
const { broadcastClient, stripClientSecrets, withRelation } = require('../services/clientResponse');

// List clients for a business
// 프로젝트 매칭은 ProjectClient.contact_user_id = Client.user_id 로 통일 (FK 기반).
// email/name 문자열 매칭 폐기 — 고객이 이름/이메일 변경 시 연결이 끊기거나 동명이인 혼선 제거.
// ★ 2026-09-13 — **초대 토큰은 응답에 실리지 않는다.**
//   `c.toJSON()` 을 그대로 내보내서 `invite_token` 이 목록·상세 양쪽에 실려 나갔다(실측).
//   이 토큰은 초대 링크의 자격증명이다 — `POST /api/auth/register` 가 이 값으로 "그 고객으로"
//   계정을 붙인다(routes/auth.js:242, routes/invites.js). 고객 목록 읽기 권한만 있으면
//   남의 고객 계정을 먼저 만들어 그 고객의 대화·자료로 들어갈 수 있었다.
//   화면은 이 필드를 **한 곳도 쓰지 않는다**(프론트 grep: 프로젝트 고객·가입 폼만 사용).
//   열거식이라 컬럼이 늘면 샌다 — 그래서 health-check 에 "응답에 토큰 없음" 검사를 같이 붙였다.
router.get('/:businessId', authenticateToken, checkBusinessAccess, requireMenu('clients', 'read'), async (req, res, next) => {
  try {
    const clients = await Client.findAll({
      where: { business_id: req.params.businessId },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone'] }],
      order: [['created_at', 'DESC']]
    });
    const { ProjectClient, Project } = require('../models');
    const userIds = clients.map((c) => c.user_id).filter(Boolean);
    const pcRows = userIds.length > 0 ? await ProjectClient.findAll({
      include: [{ model: Project, attributes: ['id', 'business_id', 'name', 'status'], where: { business_id: req.params.businessId } }],
      where: { contact_user_id: userIds },
    }) : [];
    const enriched = clients.map((c) => {
      const json = c.toJSON();
      const linked = c.user_id ? pcRows.filter((pc) => pc.contact_user_id === c.user_id) : [];
      json.project_count = linked.length;
      json.active_project_count = linked.filter((pc) => pc.Project?.status === 'active').length;
      return stripClientSecrets(withRelation(c, json));
    });
    successResponse(res, enriched);
  } catch (error) {
    next(error);
  }
});

// 고객 내보내기 영향도 조회 — 프로젝트 완료 시 "이 워크스페이스에서 아예 나감" 경고 여부
router.get('/:businessId/:clientId/removal-impact', authenticateToken, checkBusinessAccess, requireMenu('clients', 'read'), async (req, res, next) => {
  try {
    const { ProjectClient, Project } = require('../models');
    const client = await Client.findOne({
      where: { id: req.params.clientId, business_id: req.params.businessId },
    });
    if (!client) return errorResponse(res, 'Client not found', 404);
    // user_id 기반 매칭 (FK). user_id 없으면 연결 프로젝트 없음.
    const pcRows = client.user_id ? await ProjectClient.findAll({
      include: [{ model: Project, attributes: ['id', 'name', 'status'], where: { business_id: req.params.businessId } }],
      where: { contact_user_id: client.user_id },
    }) : [];
    const other = pcRows.map((pc) => ({ id: pc.Project?.id, name: pc.Project?.name, status: pc.Project?.status })).filter((p) => p.id);
    successResponse(res, {
      client_id: Number(req.params.clientId),
      other_projects: other,
      will_leave_workspace: other.length === 0,
    });
  } catch (error) { next(error); }
});

// 고객 통합 타임라인 (Customer 360, N+87 Phase A) — 채팅·메일·업무·청구 시간순 merge.
//   ★ 내부 전용: client 역할은 403 (자기 360 타임라인 노출 X — docs §8.5).
//   ?limit= ?before=<ISO> ?channels=chat,email,task,invoice
router.get('/:businessId/:clientId/timeline', authenticateToken, checkBusinessAccess, requireMenu('clients', 'read'), async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = Number(req.params.businessId);
    const clientId = Number(req.params.clientId);
    const client = await Client.findOne({ where: { id: clientId, business_id: businessId }, attributes: ['id'] });
    if (!client) return errorResponse(res, 'Client not found', 404);
    const { getClientTimeline } = require('../services/clientTimeline');
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
    const channels = req.query.channels ? String(req.query.channels).split(',').map((s) => s.trim()).filter(Boolean) : null;
    const out = await getClientTimeline(businessId, clientId, { userId: req.user.id, limit, before: req.query.before || null, channels });
    return successResponse(res, out);
  } catch (error) { next(error); }
});

// cross-channel 요약 (우측 패널 "이 고객" — 채널별 카운트 + 최근 1건). 내부 전용.
router.get('/:businessId/:clientId/channel-summary', authenticateToken, checkBusinessAccess, requireMenu('clients', 'read'), async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = Number(req.params.businessId);
    const clientId = Number(req.params.clientId);
    const client = await Client.findOne({ where: { id: clientId, business_id: businessId }, attributes: ['id'] });
    if (!client) return errorResponse(res, 'Client not found', 404);
    const { getClientChannelSummary } = require('../services/clientTimeline');
    const out = await getClientChannelSummary(businessId, clientId, { userId: req.user.id });
    return successResponse(res, out);
  } catch (error) { next(error); }
});

// Create client (invite)
router.post('/:businessId', authenticateToken, checkBusinessAccess, requireMenu('clients', 'write'), async (req, res, next) => {
  try {
    const { user_id, display_name, company_name, notes, kind } = req.body;
    if (!user_id) return errorResponse(res, 'User ID required', 400);
    const finalKind = ['customer', 'vendor', 'freelancer', 'other'].includes(kind) ? kind : 'customer';

    const existing = await Client.findOne({
      where: { business_id: req.params.businessId, user_id }
    });
    if (existing) return errorResponse(res, 'Client already exists', 409);

    // 플랜 쿼터 — 고객 수 한도
    const planEngine = require('../services/plan');
    const planCan = await planEngine.can(req.params.businessId, 'add_client');
    if (!planCan.ok) {
      return res.status(422).json(planEngine.buildQuotaError(planCan, req.params.businessId));
    }

    const client = await Client.create({
      business_id: req.params.businessId,
      user_id,
      display_name,
      company_name,
      notes,
      kind: finalKind,
      invited_by: req.user.id,
      invited_at: new Date()
    });
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'client.invited', targetType: 'client', targetId: client.id,
      newValue: { user_id, display_name, company_name },
    });
    broadcastClient(req, client, 'client:new');
    successResponse(res, stripClientSecrets(client.toJSON()), 'Client invited', 201);
  } catch (error) {
    next(error);
  }
});

// Get single client — 드로어용. 연결 프로젝트 + 대화 + 기본 정보.
router.get('/:businessId/:id', authenticateToken, checkBusinessAccess, requireMenu('clients', 'read'), async (req, res, next) => {
  try {
    const { Op } = require('sequelize');
    const { ProjectClient, Project, Conversation, ConversationParticipant } = require('../models');
    const client = await Client.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone', 'avatar_url'] }],
    });
    if (!client) return errorResponse(res, 'Client not found', 404);

    // 연결 프로젝트 — ProjectClient.contact_user_id = Client.user_id (FK 매칭).
    // email/name 문자열 매칭 폐기 — 이름/이메일 변경 시 연결 끊김 + 동명이인 혼선 제거.
    const pcRows = client.user_id ? await ProjectClient.findAll({
      include: [{ model: Project, attributes: ['id', 'name', 'status', 'color', 'project_type', 'start_date', 'end_date'], where: { business_id: req.params.businessId } }],
      where: { contact_user_id: client.user_id },
    }) : [];
    // 중복 프로젝트 id 제거
    const seenProjects = new Set();
    const projects = [];
    for (const pc of pcRows) {
      const p = pc.Project;
      if (!p || seenProjects.has(p.id)) continue;
      seenProjects.add(p.id);
      projects.push({
        id: p.id, name: p.name, status: p.status, color: p.color,
        project_type: p.project_type, start_date: p.start_date, end_date: p.end_date,
        project_client_id: pc.id,
      });
    }

    // 연결 대화 — ConversationParticipant 로 user_id 일치 + 같은 workspace
    const convs = client.user_id
      ? await Conversation.findAll({
          where: { business_id: req.params.businessId },
          include: [{ model: ConversationParticipant, as: 'participants', where: { user_id: client.user_id }, required: true }],
          order: [['last_message_at', 'DESC']],
        })
      : [];
    const conversations = convs.map((c) => ({
      id: c.id, title: c.title, channel_type: c.channel_type, status: c.status,
      project_id: c.project_id, last_message_at: c.last_message_at,
    }));

    const out = stripClientSecrets(withRelation(client, client.toJSON()));
    out.linked_projects = projects;
    out.linked_conversations = conversations;
    successResponse(res, out);
  } catch (error) { next(error); }
});

// Update client — display_name / company_name / notes 변경 + AuditLog
router.put('/:businessId/:id', authenticateToken, checkBusinessAccess, requireMenu('clients', 'write'), async (req, res, next) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!client) return errorResponse(res, 'Client not found', 404);

    // ★ status 입력은 받지 않는다(2026-10-15 직접 관리 고객) — 여기서 아무 행이나 'active' 로 만들 수 있었다.
    //   active = «계정이 연결된 고객» 이다. 상태는 초대·수락·보관·등록 문만 바꾼다(services/clientAccess).
    const { display_name, company_name, notes, kind } = req.body;
    const patch = {};
    const before = {};
    if (display_name !== undefined && display_name !== client.display_name) { patch.display_name = display_name; before.display_name = client.display_name; }
    if (company_name !== undefined && company_name !== client.company_name) { patch.company_name = company_name; before.company_name = client.company_name; }
    if (notes !== undefined && notes !== client.notes) { patch.notes = notes; before.notes = client.notes; }
    if (kind !== undefined && ['customer', 'vendor', 'freelancer', 'other'].includes(kind) && kind !== client.kind) { patch.kind = kind; before.kind = client.kind; }
    // 계정 없는 고객의 받는 주소·전화 — 초대 토큰이 나가기 전까지만(emailEditable 한 술어 · Q sale 프로필과 같다)
    if (req.body.invite_email !== undefined) {
      const { emailEditable } = require('../services/clientAccess');
      if (!emailEditable(client)) return errorResponse(res, 'email_locked_after_invite', 400);
      const { normEmail, EMAIL_RE } = require('../services/saleCommon');
      const e = normEmail(req.body.invite_email);
      if (e && !EMAIL_RE.test(e)) return errorResponse(res, 'invalid_email', 400);
      if (e !== client.invite_email) { patch.invite_email = e; before.invite_email = client.invite_email; }
    }
    if (req.body.phone !== undefined) {
      const { trimOrNull } = require('../services/saleCommon');
      const ph = trimOrNull(req.body.phone, 40);
      if (ph !== client.phone) { patch.phone = ph; before.phone = client.phone; }
    }

    // 사업자·증빙 정보 (세금계산서/현금영수증 prefill 원천) — 빈 문자열은 null 로 저장
    const BIZ_STR_FIELDS = [
      'biz_name', 'biz_tax_id', 'biz_ceo', 'biz_address', 'biz_type', 'biz_item',
      'tax_invoice_email', 'billing_contact_name', 'billing_contact_email', 'billing_contact_phone',
    ];
    for (const f of BIZ_STR_FIELDS) {
      if (req.body[f] !== undefined) {
        const nv = (req.body[f] === '' || req.body[f] === null) ? null : String(req.body[f]).trim();
        if (nv !== client[f]) { patch[f] = nv; before[f] = client[f]; }
      }
    }
    if (req.body.is_business !== undefined) {
      const nv = !!req.body.is_business;
      if (nv !== client.is_business) { patch.is_business = nv; before.is_business = client.is_business; }
    }

    if (Object.keys(patch).length === 0) { broadcastClient(req, client, 'client:updated'); return successResponse(res, stripClientSecrets(client.toJSON())); }
    await client.update(patch);
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'client.updated', targetType: 'client', targetId: client.id,
      oldValue: before, newValue: patch,
    });
    successResponse(res, stripClientSecrets(client.toJSON()));
  } catch (error) { next(error); }
});

// History — AuditLog 조회 (target=client / 관련 프로젝트 이벤트 포함)
router.get('/:businessId/:id/history', authenticateToken, checkBusinessAccess, requireMenu('clients', 'read'), async (req, res, next) => {
  try {
    const { Op } = require('sequelize');
    const AuditLog = require('../models/AuditLog');
    const client = await Client.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!client) return errorResponse(res, 'Client not found', 404);
    const rows = await AuditLog.findAll({
      where: {
        business_id: req.params.businessId,
        [Op.or]: [
          { target_type: 'client', target_id: client.id },
          { target_type: 'project_client', new_value: { client_id: client.id } },
          { target_type: 'project_client', old_value: { client_id: client.id } },
        ],
      },
      include: [{ model: User, attributes: ['id', 'name', 'avatar_url'] }],
      order: [['created_at', 'DESC']],
      limit: 100,
    });
    successResponse(res, rows);
  } catch (error) { next(error); }
});

// Invite (이메일 기반) — User 없어도 Client(invited) 생성 + 초대 토큰 발급 + 이메일 발송
// accept 시 User 생성·연결
// 초대·재발송·직접 관리 등록은 routes/client_invites.js (같은 /api/clients 접두어, server.js 에서 이 파일 앞에 마운트)

// Archive / activate toggle — POST body { status: 'active' | 'archived' }. 미지정 시 토글.
// 권한: owner/platform_admin 만 (고객 상태 변경은 조직 관리 영역 · PERMISSION_MATRIX.md §5.5)
router.post('/:businessId/:id/archive', authenticateToken, checkBusinessAccess, requireMenu('clients', 'write'), async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const client = await Client.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!client) return errorResponse(res, 'Client not found', 404);
    const want = req.body?.status || (client.status === 'archived' ? 'active' : 'archived');
    if (!['active', 'archived'].includes(want)) return errorResponse(res, 'invalid status', 400);
    // 문의 고객을 보관하면 한도 계수(≠prospect)에 들어가 조용히 정식 고객이 된다 — 종결은 Q sale «무산» 단계로
    if (client.status === 'prospect') return errorResponse(res, 'prospect_use_stage', 409);
    // 되살릴 상태는 «active» 고정이 아니라 증거로 파생한다 — 계정 없는 고객이 «활성(가입)» 으로 둔갑하던 것
    const { reactivatedStatusOf } = require('../services/clientAccess');
    const target = want === 'archived' ? 'archived' : reactivatedStatusOf(client);
    if (target === client.status) return successResponse(res, stripClientSecrets(client.toJSON()));
    const before = { status: client.status };
    await client.update({ status: target });
    if (target === 'archived') await require('../services/inviteNotify').dismissInviteNotice('client', client.id);
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: target === 'archived' ? 'client.archived' : 'client.activated',
      targetType: 'client', targetId: client.id,
      oldValue: before, newValue: { status: target },
    });
    broadcastClient(req, client, 'client:updated');
    successResponse(res, stripClientSecrets(client.toJSON()), target === 'archived' ? 'Client archived' : 'Client activated');
  } catch (error) { next(error); }
});

// Hard delete — 워크스페이스에서 고객 완전 삭제. 연결된 ProjectClient 도 같이 정리.
// User 계정 자체는 유지 (다른 워크스페이스/플랫폼 계정일 수 있음).
// 권한: owner/platform_admin 만 (PERMISSION_MATRIX.md §5.5 — 고객 삭제는 조직 인사 영역)
router.delete('/:businessId/:id', authenticateToken, checkBusinessAccess, requireMenu('clients', 'write'), async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const { ProjectClient, Project, User } = require('../models');
    const client = await Client.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      include: [{ model: User, as: 'user', attributes: ['id', 'email', 'name'] }],
    });
    if (!client) return errorResponse(res, 'Client not found', 404);

    // 같은 워크스페이스 프로젝트의 ProjectClient 중 동일 이메일/이름 전부 제거
    const email = client.user?.email || null;
    const name = client.display_name || client.user?.name || null;
    const pcWhere = {
      [require('sequelize').Op.or]: [
        ...(email ? [{ contact_email: email }] : []),
        ...(name ? [{ contact_name: name }] : []),
      ],
    };
    const pcRows = await ProjectClient.findAll({
      include: [{ model: Project, attributes: ['id', 'business_id'], where: { business_id: req.params.businessId } }],
      where: pcWhere,
    });
    const removedProjectLinks = pcRows.length;
    { const dn = require('../services/inviteNotify').dismissInviteNotice; await dn('client', client.id); await dn('project_client', pcRows.map((pc) => pc.id)); }
    for (const pc of pcRows) await pc.destroy();

    await client.destroy();
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'client.deleted', targetType: 'client', targetId: Number(req.params.id),
      oldValue: { display_name: client.display_name, email, removed_project_links: removedProjectLinks }, newValue: null,
    });
    successResponse(res, { id: Number(req.params.id), removed_project_links: removedProjectLinks });
  } catch (error) { next(error); }
});

module.exports = router;
