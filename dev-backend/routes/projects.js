const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');
const router = express.Router();
const { sequelize } = require('../config/database');
const {
  Project, ProjectMember, ProjectClient,
  ProjectNote, ProjectIssue, TaskCandidate,
  Conversation, Message, Task,
  BusinessMember, User, Business,
} = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');

// ============================================
// 공통 미들웨어: 워크스페이스 접근 확인 (BusinessMember 기준)
// ============================================
async function requireBusinessMember(userId, businessId) {
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  return bm; // null / BusinessMember
}

async function loadProjectOrForbidden(projectId, userId) {
  const project = await Project.findByPk(projectId);
  if (!project) return { error: { code: 404, message: 'project_not_found' } };
  // 워크스페이스 멤버 여부 (owner/member)
  const bm = await requireBusinessMember(userId, project.business_id);
  if (bm) return { project, role: bm.role };
  // 또는 프로젝트 참여 고객
  const pc = await ProjectClient.findOne({
    where: { project_id: project.id, contact_user_id: userId },
  });
  if (pc) return { project, role: 'client' };
  return { error: { code: 403, message: 'not_project_member' } };
}

// ============================================
// POST /api/projects — 신규 프로젝트 생성
// 바디: { business_id, name, description?, client_company?, start_date?, end_date?, members: [{user_id, role, is_default}], clients: [{name, email}] }
// ============================================
router.post('/', authenticateToken, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      business_id,
      name,
      description,
      client_company,
      start_date,
      end_date,
      members = [],
      clients = [],
    } = req.body || {};

    if (!business_id || !name?.trim()) {
      await t.rollback();
      return errorResponse(res, 'business_id and name are required', 400);
    }

    // 권한: 본인이 해당 워크스페이스 owner 또는 member 여야 함
    const bm = await requireBusinessMember(req.user.id, business_id);
    if (!bm || bm.role === 'ai') {
      await t.rollback();
      return errorResponse(res, 'You do not belong to this workspace', 403);
    }

    const defaultAssignee = members.find((m) => m.is_default)?.user_id || req.user.id;

    // 1) Project 생성
    const project = await Project.create({
      business_id,
      name: name.trim(),
      description: description?.trim() || null,
      client_company: client_company?.trim() || null,
      start_date: start_date || null,
      end_date: end_date || null,
      default_assignee_user_id: defaultAssignee,
      owner_user_id: req.user.id,
    }, { transaction: t });

    // 2) 생성자 자동으로 project_members 에 추가 (이미 members 에 있으면 skip)
    const memberUserIds = new Set(members.map((m) => m.user_id));
    if (!memberUserIds.has(req.user.id)) {
      members.push({ user_id: req.user.id, role: '기타', is_default: false });
    }

    // 3) project_members — members 의 각 user_id 가 business_members 에 속해야 함 (검증)
    const validUserIds = new Set(
      (await BusinessMember.findAll({
        where: { business_id, user_id: members.map((m) => m.user_id) },
      })).map((x) => x.user_id)
    );

    const pmRows = [];
    for (const m of members) {
      if (!validUserIds.has(m.user_id)) continue;
      pmRows.push({
        project_id: project.id,
        user_id: m.user_id,
        role: m.role?.trim() || '기타',
        role_order: 0,
      });
    }
    await ProjectMember.bulkCreate(pmRows, { transaction: t });

    // 4) project_clients — 초대 링크 토큰 생성
    const pcRows = [];
    for (const c of clients) {
      if (!c.name?.trim()) continue;
      const token = crypto.randomBytes(24).toString('hex');
      pcRows.push({
        project_id: project.id,
        contact_name: c.name.trim(),
        contact_email: c.email?.trim() || null,
        invite_token: token,
        invited_by: req.user.id,
      });
    }
    await ProjectClient.bulkCreate(pcRows, { transaction: t });

    await t.commit();

    // 재조회 (연관 포함)
    const detail = await loadProjectDetail(project.id);
    return successResponse(res, detail);
  } catch (err) {
    await t.rollback();
    next(err);
  }
});

// ============================================
// GET /api/projects?business_id=X&status=active — 목록
// ============================================
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    const bm = await requireBusinessMember(req.user.id, businessId);
    if (!bm) {
      // 고객이면 본인 참여 프로젝트만
      const clientRows = await ProjectClient.findAll({
        where: { contact_user_id: req.user.id },
        include: [{ model: Project, where: { business_id: businessId } }],
      });
      const list = await Promise.all(
        clientRows.map((cr) => loadProjectDetail(cr.project_id))
      );
      return successResponse(res, list.filter(Boolean));
    }

    const where = { business_id: businessId };
    if (req.query.status) where.status = req.query.status;

    const projects = await Project.findAll({
      where,
      order: [['created_at', 'DESC']],
    });
    const details = await Promise.all(projects.map((p) => loadProjectDetail(p.id)));
    return successResponse(res, details.filter(Boolean));
  } catch (err) { next(err); }
});

// ============================================
// GET /api/projects/:id — 상세
// ============================================
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const detail = await loadProjectDetail(project.id);
    return successResponse(res, { ...detail, my_role_in_project: role });
  } catch (err) { next(err); }
});

// ============================================
// PUT /api/projects/:id — 수정
// ============================================
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);

    const { name, description, client_company, start_date, end_date, status, default_assignee_user_id } = req.body || {};
    const patch = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (description !== undefined) patch.description = description?.trim() || null;
    if (client_company !== undefined) patch.client_company = client_company?.trim() || null;
    if (start_date !== undefined) patch.start_date = start_date || null;
    if (end_date !== undefined) patch.end_date = end_date || null;
    if (status !== undefined && ['active', 'paused', 'closed'].includes(status)) patch.status = status;
    if (default_assignee_user_id !== undefined) patch.default_assignee_user_id = default_assignee_user_id || null;

    await project.update(patch);
    const detail = await loadProjectDetail(project.id);
    return successResponse(res, detail);
  } catch (err) { next(err); }
});

// ============================================
// DELETE /api/projects/:id — closed 로 전환 (물리 삭제 금지)
// ============================================
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    await project.update({ status: 'closed' });
    return successResponse(res, { id: project.id, status: 'closed' });
  } catch (err) { next(err); }
});

// ============================================
// PUT /api/projects/:id/members — 멤버 일괄 저장
// 바디: { members: [{ user_id, role }] }
// ============================================
router.put('/:id/members', authenticateToken, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) { await t.rollback(); return errorResponse(res, error.message, error.code); }
    if (role === 'client') { await t.rollback(); return errorResponse(res, 'forbidden', 403); }

    const { members = [] } = req.body || {};

    const validUserIds = new Set(
      (await BusinessMember.findAll({
        where: { business_id: project.business_id, user_id: members.map((m) => m.user_id) },
      })).map((x) => x.user_id)
    );

    await ProjectMember.destroy({ where: { project_id: project.id }, transaction: t });
    const rows = [];
    for (const m of members) {
      if (!validUserIds.has(m.user_id)) continue;
      rows.push({ project_id: project.id, user_id: m.user_id, role: m.role || '기타', role_order: 0 });
    }
    await ProjectMember.bulkCreate(rows, { transaction: t });
    await t.commit();

    const detail = await loadProjectDetail(project.id);
    return successResponse(res, detail);
  } catch (err) { await t.rollback(); next(err); }
});

// ============================================
// GET /api/projects/:id/conversations — 프로젝트의 채널 목록
// 고객은 customer 채널만, 멤버는 전체
// ============================================
router.get('/:id/conversations', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const where = { project_id: project.id };
    if (role === 'client') where.channel_type = 'customer';
    const convs = await Conversation.findAll({
      where,
      order: [['channel_type', 'DESC'], ['id', 'ASC']], // customer 먼저
    });
    return successResponse(res, convs.map((c) => c.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// PATCH /api/projects/conversations/:id — 채널 설정 변경
// 바디: { display_name?, auto_extract_enabled? }
// ============================================
router.patch('/conversations/:id', authenticateToken, async (req, res, next) => {
  try {
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    if (!conv.project_id) return errorResponse(res, 'not_a_project_channel', 400);
    const { role, error } = await loadProjectOrForbidden(conv.project_id, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);

    const { display_name, auto_extract_enabled } = req.body || {};
    const patch = {};
    if (typeof display_name === 'string' && display_name.trim()) {
      patch.display_name = display_name.trim();
    }
    if (typeof auto_extract_enabled === 'boolean') {
      patch.auto_extract_enabled = auto_extract_enabled;
    }
    if (Object.keys(patch).length === 0) {
      return errorResponse(res, 'no_valid_fields', 400);
    }
    await conv.update(patch);
    return successResponse(res, conv.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// POST /api/projects/conversations/:id/messages — 메시지 전송
// 바디: { content, reply_to_message_id?, kind? }
// ============================================
router.post('/conversations/:id/messages', authenticateToken, async (req, res, next) => {
  try {
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    if (conv.project_id) {
      const { role, error } = await loadProjectOrForbidden(conv.project_id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client' && conv.channel_type !== 'customer') {
        return errorResponse(res, 'forbidden_channel', 403);
      }
    }
    const { content, reply_to_message_id, kind } = req.body || {};
    if (!content || !String(content).trim()) {
      return errorResponse(res, 'content is required', 400);
    }

    const msg = await Message.create({
      conversation_id: conv.id,
      sender_id: req.user.id,
      content: String(content).trim(),
      kind: kind || 'text',
      is_ai: false,
      is_internal: false,
      reply_to_message_id: reply_to_message_id || null,
    });
    // last_message_at 업데이트
    await conv.update({ last_message_at: new Date() });

    // 응답에 sender 포함
    const full = await Message.findByPk(msg.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email'] }],
    });

    // Socket.IO broadcast (있으면)
    const io = req.app.get('io');
    if (io) {
      io.to(`conversation:${conv.id}`).emit('message:new', full.toJSON());
    }

    return successResponse(res, full.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// GET /api/projects/conversations/:id/messages — 대화방 메시지 목록 (시간순)
// (projects 라우터 네임스페이스 아래에 중첩)
// ============================================
router.get('/conversations/:id/messages', authenticateToken, async (req, res, next) => {
  try {
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    if (conv.project_id) {
      const { error, role } = await loadProjectOrForbidden(conv.project_id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client' && conv.channel_type !== 'customer') {
        return errorResponse(res, 'forbidden_channel', 403);
      }
    }
    const msgs = await Message.findAll({
      where: { conversation_id: conv.id, is_deleted: false },
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email'] }],
      order: [['created_at', 'ASC']],
      limit: 200,
    });
    return successResponse(res, msgs.map((m) => m.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// GET /api/projects/:id/tasks — 프로젝트 업무
// ============================================
router.get('/:id/tasks', authenticateToken, async (req, res, next) => {
  try {
    const { project, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const tasks = await Task.findAll({
      where: { project_id: project.id },
      order: [['created_at', 'DESC']],
    });
    return successResponse(res, tasks.map((t) => t.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// GET /api/projects/:id/notes — 프로젝트 메모
// 권한 필터: 고객은 자기 personal 만, 멤버는 internal + 본인 personal
// ============================================
router.get('/:id/notes', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const { Op } = require('sequelize');
    let where = { project_id: project.id };
    if (role === 'client') {
      where = {
        project_id: project.id,
        visibility: 'personal',
        author_user_id: req.user.id,
      };
    } else {
      where = {
        project_id: project.id,
        [Op.or]: [
          { visibility: 'internal' },
          { visibility: 'personal', author_user_id: req.user.id },
        ],
      };
    }
    const notes = await ProjectNote.findAll({
      where,
      include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
    });
    return successResponse(res, notes.map((n) => n.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// GET /api/projects/:id/issues — 주요 이슈
// ============================================
router.get('/:id/issues', authenticateToken, async (req, res, next) => {
  try {
    const { project, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const issues = await ProjectIssue.findAll({
      where: { project_id: project.id },
      include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
    });
    return successResponse(res, issues.map((i) => i.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// GET /api/projects/:id/task-candidates — 업무 후보
// ============================================
router.get('/:id/task-candidates', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const status = req.query.status || 'pending';
    const where = { project_id: project.id };
    if (status !== 'all') where.status = status;
    const cands = await TaskCandidate.findAll({
      where,
      include: [{ model: User, as: 'guessedAssignee', attributes: ['id', 'name'] }],
      order: [['extracted_at', 'DESC']],
    });
    return successResponse(res, cands.map((c) => c.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// GET /api/projects/workspace/:businessId/all-tasks — 워크스페이스 전체 업무
// 쿼리: status, assignee_id, project_id, mine=1
// 권한: 멤버면 참여 프로젝트, 고객이면 자기 참여 채널의 프로젝트 업무 (읽기만)
// ============================================
router.get('/workspace/:businessId/all-tasks', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const bm = await requireBusinessMember(req.user.id, businessId);

    // 접근 가능한 프로젝트 id 수집
    let projectIds;
    if (bm && bm.role !== 'ai') {
      // 워크스페이스 멤버 — 해당 워크스페이스 전체 프로젝트 열람 가능
      const projs = await Project.findAll({ where: { business_id: businessId }, attributes: ['id'] });
      projectIds = projs.map((p) => p.id);
    } else {
      // 고객 — 자기가 project_clients 에 등록된 프로젝트만
      const pcs = await ProjectClient.findAll({
        where: { contact_user_id: req.user.id },
        include: [{ model: Project, where: { business_id: businessId }, attributes: ['id'] }],
      });
      projectIds = pcs.map((pc) => pc.project_id).filter(Boolean);
    }

    if (projectIds.length === 0) return successResponse(res, []);

    const where = { project_id: projectIds };
    if (req.query.status) where.status = req.query.status;
    if (req.query.project_id) where.project_id = Number(req.query.project_id);
    if (req.query.mine === '1') where.assigned_to = req.user.id;
    else if (req.query.assignee_id) where.assigned_to = Number(req.query.assignee_id);

    const tasks = await Task.findAll({
      where,
      include: [
        { model: Project, attributes: ['id', 'name', 'client_company', 'status'] },
        { model: User, as: 'assignee', attributes: ['id', 'name'], required: false },
      ],
      order: [['createdAt', 'DESC']],
    });
    return successResponse(res, tasks.map((t) => t.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// POST /api/projects/:id/issues — 이슈 추가 (멤버만)
// ============================================
router.post('/:id/issues', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const { body } = req.body || {};
    if (!body || !String(body).trim()) return errorResponse(res, 'body is required', 400);
    const issue = await ProjectIssue.create({
      project_id: project.id,
      body: String(body).trim(),
      author_user_id: req.user.id,
    });
    const full = await ProjectIssue.findByPk(issue.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
    });
    return successResponse(res, full.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// PUT /api/projects/issues/:id — 이슈 수정
// ============================================
router.put('/issues/:id', authenticateToken, async (req, res, next) => {
  try {
    const issue = await ProjectIssue.findByPk(req.params.id);
    if (!issue) return errorResponse(res, 'issue_not_found', 404);
    const { role, error } = await loadProjectOrForbidden(issue.project_id, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const { body } = req.body || {};
    if (!body || !String(body).trim()) return errorResponse(res, 'body is required', 400);
    await issue.update({ body: String(body).trim() });
    return successResponse(res, issue.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// DELETE /api/projects/issues/:id — 이슈 삭제
// ============================================
router.delete('/issues/:id', authenticateToken, async (req, res, next) => {
  try {
    const issue = await ProjectIssue.findByPk(req.params.id);
    if (!issue) return errorResponse(res, 'issue_not_found', 404);
    const { role, error } = await loadProjectOrForbidden(issue.project_id, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    await issue.destroy();
    return successResponse(res, { id: Number(req.params.id), deleted: true });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/projects/:id/notes — 메모 작성 (personal/internal)
// ============================================
router.post('/:id/notes', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const { body, visibility } = req.body || {};
    if (!body || !String(body).trim()) return errorResponse(res, 'body is required', 400);
    // 고객은 personal 만 작성 가능
    let vis = visibility === 'internal' ? 'internal' : 'personal';
    if (role === 'client') vis = 'personal';
    const note = await ProjectNote.create({
      project_id: project.id,
      author_user_id: req.user.id,
      visibility: vis,
      body: String(body).trim(),
    });
    const full = await ProjectNote.findByPk(note.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
    });
    return successResponse(res, full.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// DELETE /api/projects/notes/:id — 메모 삭제 (본인만)
// ============================================
router.delete('/notes/:id', authenticateToken, async (req, res, next) => {
  try {
    const note = await ProjectNote.findByPk(req.params.id);
    if (!note) return errorResponse(res, 'note_not_found', 404);
    if (note.author_user_id !== req.user.id) return errorResponse(res, 'forbidden', 403);
    await note.destroy();
    return successResponse(res, { id: Number(req.params.id), deleted: true });
  } catch (err) { next(err); }
});

// ============================================
// PATCH /api/projects/tasks/:id — 업무 상태 전환
// ============================================
router.patch('/tasks/:id', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return errorResponse(res, 'task_not_found', 404);
    if (!task.project_id) return errorResponse(res, 'not_a_project_task', 400);
    const { role, error } = await loadProjectOrForbidden(task.project_id, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const { status } = req.body || {};
    const allowed = ['task_requested', 'task_re_requested', 'waiting', 'not_started', 'in_progress', 'review_requested', 're_review_requested', 'customer_confirm', 'completed', 'canceled'];
    if (!status || !allowed.includes(status)) return errorResponse(res, 'invalid status', 400);
    await task.update({ status });
    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// Helper: 프로젝트 상세 로드 (members + clients 포함)
// ============================================
async function loadProjectDetail(projectId) {
  const project = await Project.findByPk(projectId, {
    include: [
      { model: Business, attributes: ['id', 'brand_name', 'name', 'slug'] },
      {
        model: ProjectMember,
        as: 'projectMembers',
        include: [{ model: User, attributes: ['id', 'name', 'email'] }],
      },
      {
        model: ProjectClient,
        as: 'projectClients',
        attributes: { exclude: ['invite_token'] }, // 토큰은 생성/조회 시만 별도 반환
      },
    ],
  });
  if (!project) return null;
  return project.toJSON();
}

module.exports = router;
