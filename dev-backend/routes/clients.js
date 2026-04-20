const express = require('express');
const router = express.Router();
const { Client, User, Business } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');

// List clients for a business
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const clients = await Client.findAll({
      where: { business_id: req.params.businessId },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone'] }],
      order: [['created_at', 'DESC']]
    });
    // 응답에 연결된 프로젝트 수 부여 — 클라이언트 페이지 표시용
    const { ProjectClient, Project } = require('../models');
    const emails = clients.map((c) => c.user?.email).filter(Boolean);
    const names = clients.map((c) => c.display_name || c.user?.name).filter(Boolean);
    // ProjectClient 는 email / contact_name 으로 저장됨 (user_id 무관). 같은 워크스페이스 프로젝트에 들어있는 것 집계.
    const pcRows = await ProjectClient.findAll({
      include: [{ model: Project, attributes: ['id', 'business_id', 'name', 'status'], where: { business_id: req.params.businessId } }],
      where: {
        [require('sequelize').Op.or]: [
          ...(emails.length ? [{ contact_email: emails }] : []),
          ...(names.length ? [{ contact_name: names }] : []),
        ],
      },
    });
    const enriched = clients.map((c) => {
      const json = c.toJSON();
      const email = c.user?.email || null;
      const name = c.display_name || c.user?.name || null;
      const linked = pcRows.filter((pc) => (email && pc.contact_email === email) || (name && pc.contact_name === name));
      json.project_count = linked.length;
      json.active_project_count = linked.filter((pc) => pc.Project?.status === 'active').length;
      return json;
    });
    successResponse(res, enriched);
  } catch (error) {
    next(error);
  }
});

// 고객 내보내기 영향도 조회 — 프로젝트 완료 시 "이 워크스페이스에서 아예 나감" 경고 여부
router.get('/:businessId/:clientId/removal-impact', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { ProjectClient, Project } = require('../models');
    const client = await Client.findOne({
      where: { id: req.params.clientId, business_id: req.params.businessId },
      include: [{ model: User, as: 'user', attributes: ['email', 'name'] }],
    });
    if (!client) return errorResponse(res, 'Client not found', 404);
    const email = client.user?.email;
    const name = client.display_name || client.user?.name;
    const pcRows = await ProjectClient.findAll({
      include: [{ model: Project, attributes: ['id', 'name', 'status'], where: { business_id: req.params.businessId } }],
      where: {
        [require('sequelize').Op.or]: [
          ...(email ? [{ contact_email: email }] : []),
          ...(name ? [{ contact_name: name }] : []),
        ],
      },
    });
    const other = pcRows.map((pc) => ({ id: pc.Project?.id, name: pc.Project?.name, status: pc.Project?.status })).filter((p) => p.id);
    successResponse(res, {
      client_id: Number(req.params.clientId),
      other_projects: other,
      will_leave_workspace: other.length === 0,
    });
  } catch (error) { next(error); }
});

// Create client (invite)
router.post('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { user_id, display_name, company_name, notes } = req.body;
    if (!user_id) return errorResponse(res, 'User ID required', 400);

    const existing = await Client.findOne({
      where: { business_id: req.params.businessId, user_id }
    });
    if (existing) return errorResponse(res, 'Client already exists', 409);

    const client = await Client.create({
      business_id: req.params.businessId,
      user_id,
      display_name,
      company_name,
      notes,
      invited_by: req.user.id,
      invited_at: new Date()
    });
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'client.invited', targetType: 'client', targetId: client.id,
      newValue: { user_id, display_name, company_name },
    });
    successResponse(res, client, 'Client invited', 201);
  } catch (error) {
    next(error);
  }
});

// Get single client — 드로어용. 연결 프로젝트 + 대화 + 기본 정보.
router.get('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { Op } = require('sequelize');
    const { ProjectClient, Project, Conversation, ConversationParticipant } = require('../models');
    const client = await Client.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone', 'avatar_url'] }],
    });
    if (!client) return errorResponse(res, 'Client not found', 404);

    const email = client.user?.email || null;
    const name = client.display_name || client.user?.name || null;

    // 연결 프로젝트 — ProjectClient contact_user_id 또는 email/name 매칭
    const pcRows = await ProjectClient.findAll({
      include: [{ model: Project, attributes: ['id', 'name', 'status', 'color', 'project_type', 'start_date', 'end_date'], where: { business_id: req.params.businessId } }],
      where: {
        [Op.or]: [
          ...(client.user_id ? [{ contact_user_id: client.user_id }] : []),
          ...(email ? [{ contact_email: email }] : []),
          ...(name ? [{ contact_name: name }] : []),
        ],
      },
    });
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

    const out = client.toJSON();
    out.linked_projects = projects;
    out.linked_conversations = conversations;
    successResponse(res, out);
  } catch (error) { next(error); }
});

// Update client — display_name / company_name / notes 변경 + AuditLog
router.put('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!client) return errorResponse(res, 'Client not found', 404);

    const { display_name, company_name, notes, status } = req.body;
    const patch = {};
    const before = {};
    if (display_name !== undefined && display_name !== client.display_name) { patch.display_name = display_name; before.display_name = client.display_name; }
    if (company_name !== undefined && company_name !== client.company_name) { patch.company_name = company_name; before.company_name = client.company_name; }
    if (notes !== undefined && notes !== client.notes) { patch.notes = notes; before.notes = client.notes; }
    if (status !== undefined && ['invited','active','archived'].includes(status) && status !== client.status) {
      patch.status = status; before.status = client.status;
    }

    if (Object.keys(patch).length === 0) return successResponse(res, client);
    await client.update(patch);
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'client.updated', targetType: 'client', targetId: client.id,
      oldValue: before, newValue: patch,
    });
    successResponse(res, client);
  } catch (error) { next(error); }
});

// History — AuditLog 조회 (target=client / 관련 프로젝트 이벤트 포함)
router.get('/:businessId/:id/history', authenticateToken, checkBusinessAccess, async (req, res, next) => {
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

// Invite (이메일 기반 신규) — User 없으면 생성 + Client(invited) 생성
router.post('/:businessId/invite', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { name, email, company_name, notes } = req.body || {};
    if (!name?.trim() || !email?.trim()) return errorResponse(res, 'name and email are required', 400);
    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');
    let u = await User.findOne({ where: { email: email.trim() } });
    if (!u) {
      const randomPw = crypto.randomBytes(12).toString('hex');
      u = await User.create({
        email: email.trim(), name: name.trim(),
        password_hash: await bcrypt.hash(randomPw, 12),
        platform_role: 'user', status: 'active',
      });
    }
    const existing = await Client.findOne({ where: { business_id: req.params.businessId, user_id: u.id } });
    if (existing) {
      if (existing.status === 'archived') {
        await existing.update({ status: 'invited', display_name: name.trim(), company_name: company_name?.trim() || existing.company_name, notes: notes?.trim() || existing.notes });
        await createAuditLog({ userId: req.user.id, businessId: req.params.businessId, action: 'client.activated', targetType: 'client', targetId: existing.id });
        return successResponse(res, existing, 'Re-invited', 200);
      }
      return errorResponse(res, 'Client already exists', 409);
    }
    const created = await Client.create({
      business_id: req.params.businessId, user_id: u.id,
      display_name: name.trim(), company_name: company_name?.trim() || null, notes: notes?.trim() || null,
      status: 'invited', invited_by: req.user.id, invited_at: new Date(),
    });
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'client.invited', targetType: 'client', targetId: created.id,
      newValue: { email: u.email, name: name.trim(), company_name: company_name || null },
    });
    successResponse(res, created, 'Client invited', 201);
  } catch (error) { next(error); }
});

// Archive / activate toggle — POST body { status: 'active' | 'archived' }. 미지정 시 토글.
router.post('/:businessId/:id/archive', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const client = await Client.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!client) return errorResponse(res, 'Client not found', 404);
    const target = req.body?.status || (client.status === 'archived' ? 'active' : 'archived');
    if (!['active', 'archived'].includes(target)) return errorResponse(res, 'invalid status', 400);
    const before = { status: client.status };
    await client.update({ status: target });
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: target === 'archived' ? 'client.archived' : 'client.activated',
      targetType: 'client', targetId: client.id,
      oldValue: before, newValue: { status: target },
    });
    successResponse(res, client, target === 'archived' ? 'Client archived' : 'Client activated');
  } catch (error) { next(error); }
});

// Hard delete — 워크스페이스에서 고객 완전 삭제. 연결된 ProjectClient 도 같이 정리.
// User 계정 자체는 유지 (다른 워크스페이스/플랫폼 계정일 수 있음).
router.delete('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
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
