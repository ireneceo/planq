const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');
const router = express.Router();
const { sequelize } = require('../config/database');
const {
  Project, ProjectMember, ProjectClient,
  ProjectNote, ProjectIssue, TaskCandidate,
  Conversation, ConversationParticipant, Message, Task, TaskReviewer,
  BusinessMember, User, Business,
  ProjectStatusOption, ProjectProcessColumn, ProjectProcessPart,
} = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { createAuditLog } = require('../middleware/audit');
const taskExtractor = require('../services/task_extractor');
const cueOrchestrator = require('../services/cue_orchestrator');

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
      color,
      project_type,
      members = [],
      clients = [],
      channels,
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
    const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
    const project = await Project.create({
      business_id,
      name: name.trim(),
      description: description?.trim() || null,
      client_company: client_company?.trim() || null,
      start_date: start_date || null,
      end_date: end_date || null,
      color: (color && HEX_RE.test(color)) ? color : null,
      project_type: project_type === 'ongoing' ? 'ongoing' : 'fixed',
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

    // 5) 기본 상태 옵션 seed (프로세스 파트용)
    const defaultStatusOptions = [
      { status_key: 'not_started', label: '미시작', color: '#94A3B8', order_index: 0 },
      { status_key: 'in_progress', label: '진행중', color: '#14B8A6', order_index: 1 },
      { status_key: 'done', label: '완료', color: '#22C55E', order_index: 2 },
      { status_key: 'hold', label: '보류', color: '#F59E0B', order_index: 3 },
    ];
    await ProjectStatusOption.bulkCreate(
      defaultStatusOptions.map(o => ({ ...o, project_id: project.id })),
      { transaction: t }
    );

    // 6) 채팅방 자동 생성 없음 — 프로젝트는 데이터 컨테이너.
    //    대화가 필요하면 사용자가 Q Talk 에서 NewChatModal 로 별도 생성하고 project_id 로 연결.
    //    호환을 위해 channels 파라미터가 명시적으로 전달된 경우에만 생성.
    if (Array.isArray(channels) && channels.length > 0) {
      const biz = await Business.findByPk(business_id, { transaction: t });
      const validMemberIds = new Set(pmRows.map(r => r.user_id));
      for (const cv of channels) {
        const type = cv.channel_type === 'customer' ? 'customer' : 'internal';
        const title = String(cv.name || '').trim() || `${name.trim()} ${type === 'customer' ? '고객' : '내부'}`;
        const conv = await Conversation.create({
          business_id,
          project_id: project.id,
          title,
          channel_type: type,
          cue_enabled: type === 'customer',
          auto_extract_enabled: type === 'customer',
        }, { transaction: t });
        let participantIds = Array.isArray(cv.participant_user_ids)
          ? cv.participant_user_ids.filter(uid => validMemberIds.has(uid))
          : pmRows.map(r => r.user_id);
        if (!participantIds.includes(req.user.id)) participantIds = [req.user.id, ...participantIds];
        for (const uid of participantIds) {
          await ConversationParticipant.create({
            conversation_id: conv.id, user_id: uid, role: uid === req.user.id ? 'owner' : 'member',
          }, { transaction: t });
        }
        if (type === 'customer' && biz?.cue_user_id) {
          await ConversationParticipant.create({
            conversation_id: conv.id, user_id: biz.cue_user_id, role: 'member',
          }, { transaction: t });
        }
      }
    }

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

    const { name, description, client_company, start_date, end_date, status, default_assignee_user_id, color, project_type, process_tab_label } = req.body || {};
    const patch = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (description !== undefined) patch.description = description?.trim() || null;
    if (client_company !== undefined) patch.client_company = client_company?.trim() || null;
    if (start_date !== undefined) patch.start_date = start_date || null;
    if (end_date !== undefined) patch.end_date = end_date || null;
    if (status !== undefined && ['active', 'paused', 'closed'].includes(status)) patch.status = status;
    if (default_assignee_user_id !== undefined) patch.default_assignee_user_id = default_assignee_user_id || null;
    if (color !== undefined) {
      const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
      if (color && !HEX_RE.test(color)) return errorResponse(res, 'invalid color hex', 400);
      patch.color = color || null;
    }
    if (project_type !== undefined && ['fixed', 'ongoing'].includes(project_type)) patch.project_type = project_type;
    if (process_tab_label !== undefined) patch.process_tab_label = String(process_tab_label).trim().slice(0, 80) || '테이블';

    const prevStatus = project.status;
    await project.update(patch);
    // 프로젝트 'closed' 전환 시 연결 대화 자동 archived (cascade, soft). 데이터는 보존.
    if (patch.status === 'closed' && prevStatus !== 'closed') {
      await Conversation.update(
        { status: 'archived' },
        { where: { project_id: project.id, status: 'active' } },
      );
    }
    // 'active'로 복구 시 대화는 수동 복구 (의도치 않은 복원 방지)
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
    // cascade: 대화 archived
    await Conversation.update(
      { status: 'archived' },
      { where: { project_id: project.id, status: 'active' } },
    );
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

    // Socket.IO broadcast
    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${conv.id}`).emit('message:new', full.toJSON());
    }

    // Cue 자동 응답 트리거 (customer 채널 + 비 AI 메시지만, 비동기)
    if (conv.channel_type === 'customer' && !full.toJSON().is_ai) {
      setImmediate(async () => {
        try {
          const business = await Business.findByPk(conv.business_id);
          if (!business || !business.cue_user_id) return;
          const cueResult = await cueOrchestrator.respondToMessage({
            message: full.toJSON(),
            conversation: conv,
            business,
            client: null,
          });
          if (!cueResult.skipped && cueResult.message) {
            // Cue 응답 메시지에 sender 포함하여 브로드캐스트
            const cueMsg = await Message.findByPk(cueResult.message.id, {
              include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email'] }],
            });
            if (io && cueMsg) {
              const payload = cueMsg.toJSON();
              payload.ai_mode_used = cueResult.mode; // draft / auto
              io.to(`conv:${conv.id}`).emit('message:new', payload);
            }
          }
        } catch (err) {
          console.warn('[cue trigger]', err.message);
        }
      });
    }

    return successResponse(res, full.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// POST /api/projects/messages/:id/approve-draft — Cue Draft 승인
// ============================================
router.post('/messages/:id/approve-draft', authenticateToken, async (req, res, next) => {
  try {
    const msg = await Message.findByPk(req.params.id);
    if (!msg) return errorResponse(res, 'message_not_found', 404);
    if (!msg.is_ai) return errorResponse(res, 'not_ai_message', 400);
    if (msg.ai_draft_approved !== null) return errorResponse(res, 'already_resolved', 400);

    const conv = await Conversation.findByPk(msg.conversation_id);
    if (conv?.project_id) {
      const { role, error } = await loadProjectOrForbidden(conv.project_id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);
    }

    // 수정된 내용이 있으면 반영
    const { edited_content } = req.body || {};
    const updates = { ai_draft_approved: true, ai_draft_approved_by: req.user.id, ai_draft_approved_at: new Date() };
    if (edited_content && String(edited_content).trim()) {
      updates.content = String(edited_content).trim();
      updates.is_edited = true;
      updates.edited_at = new Date();
    }
    await msg.update(updates);

    const full = await Message.findByPk(msg.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email'] }],
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${msg.conversation_id}`).emit('message:updated', full.toJSON());
    }

    return successResponse(res, full.toJSON());
  } catch (err) { next(err); }
});

// ============================================
// POST /api/projects/messages/:id/reject-draft — Cue Draft 거절
// ============================================
router.post('/messages/:id/reject-draft', authenticateToken, async (req, res, next) => {
  try {
    const msg = await Message.findByPk(req.params.id);
    if (!msg) return errorResponse(res, 'message_not_found', 404);
    if (!msg.is_ai) return errorResponse(res, 'not_ai_message', 400);
    if (msg.ai_draft_approved !== null) return errorResponse(res, 'already_resolved', 400);

    const conv = await Conversation.findByPk(msg.conversation_id);
    if (conv?.project_id) {
      const { role, error } = await loadProjectOrForbidden(conv.project_id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);
    }

    await msg.update({ ai_draft_approved: false, ai_draft_approved_by: req.user.id, ai_draft_approved_at: new Date() });

    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${msg.conversation_id}`).emit('message:updated', msg.toJSON());
    }

    return successResponse(res, msg.toJSON());
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
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name'], required: false },
        { model: User, as: 'requester', attributes: ['id', 'name'], required: false },
        { model: TaskReviewer, as: 'reviewers', attributes: ['id', 'user_id', 'state', 'is_client'], required: false },
      ],
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
// POST /api/projects/conversations/:convId/task-candidates/extract — 수동 추출 트리거
// 커서 기반: last_extracted_message_id 이후 메시지만 LLM에 전달
// ============================================
router.post('/conversations/:convId/task-candidates/extract', authenticateToken, async (req, res, next) => {
  try {
    const conversationId = Number(req.params.convId);
    const conv = await Conversation.findByPk(conversationId);
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    if (!conv.project_id) return errorResponse(res, 'conversation_not_in_project', 400);
    const { role, error } = await loadProjectOrForbidden(conv.project_id, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);

    const result = await taskExtractor.extractTaskCandidates({
      conversationId,
      userId: req.user.id,
      businessId: conv.business_id,
    });

    // Socket.IO: 새 후보 알림
    if (result.candidates?.length > 0 && conv.project_id) {
      const io = req.app.get('io');
      if (io) {
        io.to(`project:${conv.project_id}`).emit('candidates:created', {
          project_id: conv.project_id,
          conversation_id: conversationId,
          candidates: result.candidates,
        });
      }
    }

    return successResponse(res, result);
  } catch (err) {
    if (err.message === 'extraction_already_in_progress') {
      return errorResponse(res, 'extraction_already_in_progress', 409);
    }
    next(err);
  }
});

// ============================================
// POST /api/projects/task-candidates/:id/register — 후보 → 정식 업무 등록
// ============================================
router.post('/task-candidates/:id/register', authenticateToken, async (req, res, next) => {
  try {
    const candidate = await TaskCandidate.findByPk(req.params.id);
    if (!candidate) return errorResponse(res, 'candidate_not_found', 404);
    const { role, error } = await loadProjectOrForbidden(candidate.project_id, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);

    const result = await taskExtractor.registerCandidate(candidate.id, req.user.id);

    // Socket.IO: Q Task 페이지 실시간 반영을 위해 business room 에 task:new 발행
    const io = req.app.get('io');
    if (io && result.task) {
      if (result.task.project_id) io.to(`project:${result.task.project_id}`).emit('task:new', result.task);
      if (result.task.business_id) io.to(`business:${result.task.business_id}`).emit('task:new', result.task);
    }

    return successResponse(res, result);
  } catch (err) {
    if (err.message === 'candidate_already_resolved') {
      return errorResponse(res, 'candidate_already_resolved', 400);
    }
    next(err);
  }
});

// ============================================
// POST /api/projects/task-candidates/:id/merge-into/:taskId — 기존 업무에 병합
// ============================================
router.post('/task-candidates/:id/merge-into/:taskId', authenticateToken, async (req, res, next) => {
  try {
    const candidate = await TaskCandidate.findByPk(req.params.id);
    if (!candidate) return errorResponse(res, 'candidate_not_found', 404);
    const { role, error } = await loadProjectOrForbidden(candidate.project_id, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);

    const targetTaskId = Number(req.params.taskId);
    const result = await taskExtractor.mergeCandidate(candidate.id, targetTaskId, req.user.id);
    return successResponse(res, result);
  } catch (err) {
    if (err.message === 'candidate_already_resolved') {
      return errorResponse(res, 'candidate_already_resolved', 400);
    }
    if (err.message === 'target_task_not_found') {
      return errorResponse(res, 'target_task_not_found', 404);
    }
    next(err);
  }
});

// ============================================
// POST /api/projects/task-candidates/:id/reject — 후보 거절
// ============================================
router.post('/task-candidates/:id/reject', authenticateToken, async (req, res, next) => {
  try {
    const candidate = await TaskCandidate.findByPk(req.params.id);
    if (!candidate) return errorResponse(res, 'candidate_not_found', 404);
    const { role, error } = await loadProjectOrForbidden(candidate.project_id, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);

    const result = await taskExtractor.rejectCandidate(candidate.id, req.user.id);
    return successResponse(res, result);
  } catch (err) {
    if (err.message === 'candidate_already_resolved') {
      return errorResponse(res, 'candidate_already_resolved', 400);
    }
    next(err);
  }
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
    if (req.query.mine === '1') where.assignee_id = req.user.id;
    else if (req.query.assignee_id) where.assignee_id = Number(req.query.assignee_id);

    const tasks = await Task.findAll({
      where,
      include: [
        { model: Project, attributes: ['id', 'name', 'client_company', 'status'] },
        { model: User, as: 'assignee', attributes: ['id', 'name'], required: false },
        { model: User, as: 'requester', attributes: ['id', 'name'], required: false },
        { model: TaskReviewer, as: 'reviewers', attributes: ['id', 'user_id', 'state', 'is_client'], required: false },
      ],
      order: [['createdAt', 'DESC']],
    });
    return successResponse(res, tasks.map((t) => t.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// POST /api/projects/:id/issues — 이슈 추가 (멤버만)
// ============================================
// ============================================
// POST /api/projects/:id/clients — 기존 프로젝트에 고객 추가 (초대 토큰 발급)
// ============================================
router.post('/:id/clients', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const { name, email } = req.body || {};
    if (!name || !String(name).trim()) return errorResponse(res, 'name is required', 400);
    const token = crypto.randomBytes(24).toString('hex');
    // email 이 이미 User 존재하면 contact_user_id 매칭 (client role 권한 체크 기준)
    let contact_user_id = null;
    if (email && email.trim()) {
      const { User: UserM, Client: ClientM } = require('../models');
      const existingUser = await UserM.findOne({ where: { email: email.trim() } });
      if (existingUser) contact_user_id = existingUser.id;
      // Client 테이블에도 없으면 자동 생성 (워크스페이스 고객으로 편입)
      if (existingUser) {
        const exists = await ClientM.findOne({ where: { business_id: project.business_id, user_id: existingUser.id } });
        if (!exists) {
          await ClientM.create({
            business_id: project.business_id, user_id: existingUser.id,
            display_name: String(name).trim(),
            status: 'invited',
            invited_by: req.user.id, invited_at: new Date(),
          });
        }
      }
    }
    const row = await ProjectClient.create({
      project_id: project.id,
      contact_user_id,
      contact_name: String(name).trim(),
      contact_email: email?.trim() || null,
      invite_token: token,
      invited_by: req.user.id,
    });
    await createAuditLog({
      userId: req.user.id, businessId: project.business_id,
      action: 'project.client_added', targetType: 'project_client', targetId: row.id,
      newValue: { project_id: project.id, project_name: project.name, client_id: contact_user_id ? (await require('../models').Client.findOne({ where: { business_id: project.business_id, user_id: contact_user_id } }))?.id : null, name: row.contact_name, email: row.contact_email },
    });
    return successResponse(res, row);
  } catch (err) { next(err); }
});

// DELETE /api/projects/:id/clients/:clientId
router.delete('/:id/clients/:clientId', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const row = await ProjectClient.findOne({ where: { id: req.params.clientId, project_id: project.id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    // client_id 매칭 — 같은 워크스페이스의 Client row 를 같은 email/user 로 찾음
    let clientId = null;
    try {
      const { Client: ClientM } = require('../models');
      const cl = await ClientM.findOne({
        where: {
          business_id: project.business_id,
          ...(row.contact_user_id ? { user_id: row.contact_user_id } : {}),
        },
      });
      clientId = cl?.id || null;
    } catch { /* ignore */ }
    await row.destroy();
    await createAuditLog({
      userId: req.user.id, businessId: project.business_id,
      action: 'project.client_removed', targetType: 'project_client', targetId: Number(req.params.clientId),
      oldValue: { project_id: project.id, project_name: project.name, client_id: clientId, name: row.contact_name, email: row.contact_email },
    });
    return successResponse(res, { id: Number(req.params.clientId), deleted: true });
  } catch (err) { next(err); }
});

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

    // Socket.IO: 이슈 생성 알림
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${project.id}`).emit('issue:new', full.toJSON());
    }

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

    // Socket.IO: 내부 메모는 프로젝트 room에만 (personal은 본인만 볼 수 있으므로 브로드캐스트 안 함)
    if (vis === 'internal') {
      const io = req.app.get('io');
      if (io) {
        io.to(`project:${project.id}`).emit('note:new', full.toJSON());
      }
    }

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

// ============================================
// GET /api/projects/invite/:token — 초대 링크 검증 (공개 — 인증 불필요)
// ============================================
router.get('/invite/:token', async (req, res, next) => {
  try {
    const pc = await ProjectClient.findOne({ where: { invite_token: req.params.token } });
    if (!pc) return errorResponse(res, 'invalid_or_expired_invite', 404);

    const project = await Project.findByPk(pc.project_id, {
      include: [{ model: Business, attributes: ['id', 'brand_name', 'name'] }],
    });
    if (!project) return errorResponse(res, 'project_not_found', 404);

    return successResponse(res, {
      project_name: project.name,
      client_company: project.client_company,
      workspace_name: project.Business?.brand_name || project.Business?.name,
      contact_name: pc.contact_name,
      contact_email: pc.contact_email,
      already_linked: !!pc.contact_user_id,
    });
  } catch (err) { next(err); }
});

// ============================================
// POST /api/projects/invite/:token/accept — 초대 수락 (인증 필요 — 기가입자)
// ============================================
router.post('/invite/:token/accept', authenticateToken, async (req, res, next) => {
  try {
    const pc = await ProjectClient.findOne({ where: { invite_token: req.params.token } });
    if (!pc) return errorResponse(res, 'invalid_or_expired_invite', 404);
    if (pc.contact_user_id) return errorResponse(res, 'already_accepted', 400);

    // 사용자 연결
    await pc.update({ contact_user_id: req.user.id, accepted_at: new Date() });

    return successResponse(res, { project_id: pc.project_id, linked: true });
  } catch (err) { next(err); }
});

module.exports = router;
