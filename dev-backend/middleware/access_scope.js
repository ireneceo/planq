// 권한 헬퍼 — PERMISSION_MATRIX.md §7 (Client 접근 범위) + §5 (역할별 매트릭스) 단일 구현
//
// 사용 패턴:
//   const { getUserScope, canAccessTask, taskListWhere } = require('../middleware/access_scope');
//
// 모든 함수는 비동기. 호출 측에서 await.
// 실패 시 throw 하지 않고 null/false 반환 — 라우트 핸들러가 직접 errorResponse(403) 호출.
//
// 핵심 개념:
//   member/owner → 워크스페이스 전체 데이터 (PERMISSION_MATRIX §1 열린 문화)
//   client       → 본인 참여 자원만 (§7 화이트리스트)
//   platform_admin → 모든 워크스페이스 통과

const { Op } = require('sequelize');
const {
  BusinessMember, Client, ProjectClient, ConversationParticipant,
  Conversation, Project, TaskReviewer,
} = require('../models');

// ─────────────────────────────────────────────
// getUserScope — 한 사용자의 워크스페이스 단위 역할 종합 조회
// ─────────────────────────────────────────────
async function getUserScope(userId, businessId, platformRole) {
  const scope = {
    userId,
    businessId,
    isPlatformAdmin: platformRole === 'platform_admin',
    isOwner: false,
    isMember: false,
    isClient: false,
    isAi: false,
    businessRole: null,
    clientIds: [],                  // me 와 매칭된 clients.id (보통 1개)
    projectClientProjectIds: [],    // me 가 ProjectClient.contact_user_id 인 project.id 들
  };
  if (scope.isPlatformAdmin) {
    scope.businessRole = 'admin';
    return scope;
  }
  if (!userId || !businessId) return scope;

  // 1) BusinessMember
  const bm = await BusinessMember.findOne({
    where: { user_id: userId, business_id: businessId },
    attributes: ['role'],
  });
  if (bm) {
    scope.businessRole = bm.role;
    scope.isOwner = bm.role === 'owner';
    scope.isMember = bm.role === 'member';
    scope.isAi = bm.role === 'ai';
  }

  // 2) Client (clients.user_id = me)
  const clientRows = await Client.findAll({
    where: { user_id: userId, business_id: businessId, status: 'active' },
    attributes: ['id'],
  });
  if (clientRows.length > 0) {
    scope.clientIds = clientRows.map((c) => c.id);
    if (!bm) {
      scope.isClient = true;
      scope.businessRole = 'client';
    }
  }

  // 3) ProjectClient (project_clients.contact_user_id = me) — 같은 워크스페이스 프로젝트만
  if (!bm) {
    const pcRows = await ProjectClient.findAll({
      where: { contact_user_id: userId },
      include: [{ model: Project, attributes: ['id'], where: { business_id: businessId }, required: true }],
      attributes: ['project_id'],
    });
    if (pcRows.length > 0) {
      scope.projectClientProjectIds = pcRows.map((r) => r.project_id);
      scope.isClient = true;
      if (!scope.businessRole) scope.businessRole = 'client';
    }
  }

  return scope;
}

// 워크스페이스 접근 가능 (member, client, platform_admin 모두 통과)
async function assertWorkspaceAccess(userId, businessId, platformRole) {
  const scope = await getUserScope(userId, businessId, platformRole);
  if (scope.isPlatformAdmin || scope.isOwner || scope.isMember || scope.isClient) return scope;
  return null;
}

// member 이상만 (client 차단)
function isMemberOrAbove(scope) {
  return !!(scope?.isPlatformAdmin || scope?.isOwner || scope?.isMember);
}

// ─────────────────────────────────────────────
// Conversation
// ─────────────────────────────────────────────
async function canAccessConversation(userId, conversation, scope) {
  if (!conversation) return false;
  if (!scope) scope = await getUserScope(userId, conversation.business_id);
  if (isMemberOrAbove(scope)) return true;
  if (!scope.isClient) return false;
  // Client: participant 또는 client_id 매칭
  const participant = await ConversationParticipant.findOne({
    where: { conversation_id: conversation.id, user_id: userId },
    attributes: ['id'],
  });
  if (participant) return true;
  if (conversation.client_id && scope.clientIds.includes(conversation.client_id)) return true;
  return false;
}

async function conversationListWhere(userId, businessId, scope) {
  if (!scope) scope = await getUserScope(userId, businessId);
  if (isMemberOrAbove(scope)) return { business_id: businessId };
  if (!scope.isClient) return null;

  const partRows = await ConversationParticipant.findAll({
    where: { user_id: userId },
    attributes: ['conversation_id'],
  });
  const partConvIds = partRows.map((r) => r.conversation_id);

  let clientConvIds = [];
  if (scope.clientIds.length > 0) {
    const rows = await Conversation.findAll({
      where: { business_id: businessId, client_id: { [Op.in]: scope.clientIds } },
      attributes: ['id'],
    });
    clientConvIds = rows.map((c) => c.id);
  }

  const allowed = Array.from(new Set([...partConvIds, ...clientConvIds]));
  if (allowed.length === 0) return { business_id: businessId, id: { [Op.in]: [-1] } };
  return { business_id: businessId, id: { [Op.in]: allowed } };
}

// ─────────────────────────────────────────────
// Task
// ─────────────────────────────────────────────
async function canAccessTask(userId, task, scope) {
  if (!task) return false;
  if (!scope) scope = await getUserScope(userId, task.business_id);
  if (isMemberOrAbove(scope)) return true;
  if (!scope.isClient) return false;

  if (task.assignee_id === userId) return true;
  if (task.created_by === userId) return true;
  if (task.request_by_user_id === userId) return true;
  const reviewer = await TaskReviewer.findOne({ where: { task_id: task.id, user_id: userId }, attributes: ['id'] });
  if (reviewer) return true;
  if (task.conversation_id) {
    const part = await ConversationParticipant.findOne({
      where: { conversation_id: task.conversation_id, user_id: userId },
      attributes: ['id'],
    });
    if (part) return true;
  }
  if (task.project_id && scope.projectClientProjectIds.includes(task.project_id)) return true;
  return false;
}

async function taskListWhere(userId, businessId, scope) {
  if (!scope) scope = await getUserScope(userId, businessId);
  if (isMemberOrAbove(scope)) return { business_id: businessId };
  if (!scope.isClient) return null;

  const reviewerRows = await TaskReviewer.findAll({ where: { user_id: userId }, attributes: ['task_id'] });
  const reviewerTaskIds = reviewerRows.map((r) => r.task_id);
  const partRows = await ConversationParticipant.findAll({ where: { user_id: userId }, attributes: ['conversation_id'] });
  const convIds = partRows.map((r) => r.conversation_id);

  const orConds = [
    { assignee_id: userId },
    { created_by: userId },
    { request_by_user_id: userId },
  ];
  if (reviewerTaskIds.length > 0) orConds.push({ id: { [Op.in]: reviewerTaskIds } });
  if (convIds.length > 0) orConds.push({ conversation_id: { [Op.in]: convIds } });
  if (scope.projectClientProjectIds.length > 0) {
    orConds.push({ project_id: { [Op.in]: scope.projectClientProjectIds } });
  }
  return { business_id: businessId, [Op.or]: orConds };
}

// ─────────────────────────────────────────────
// Project
// ─────────────────────────────────────────────
async function canAccessProject(userId, project, scope) {
  if (!project) return false;
  if (!scope) scope = await getUserScope(userId, project.business_id);
  if (isMemberOrAbove(scope)) return true;
  if (!scope.isClient) return false;
  return scope.projectClientProjectIds.includes(project.id);
}

// ─────────────────────────────────────────────
// File / Folder
// ─────────────────────────────────────────────
async function fileListWhere(userId, businessId, scope) {
  if (!scope) scope = await getUserScope(userId, businessId);
  if (isMemberOrAbove(scope)) return { business_id: businessId };
  if (!scope.isClient) return null;

  const orConds = [{ uploader_id: userId }];
  if (scope.projectClientProjectIds.length > 0) {
    orConds.push({ project_id: { [Op.in]: scope.projectClientProjectIds } });
  }
  return { business_id: businessId, [Op.or]: orConds };
}

// ─────────────────────────────────────────────
// Invoice
// ─────────────────────────────────────────────
async function invoiceListWhere(userId, businessId, scope) {
  if (!scope) scope = await getUserScope(userId, businessId);
  if (isMemberOrAbove(scope)) return { business_id: businessId };
  if (!scope.isClient) return null;
  if (scope.clientIds.length === 0) return { business_id: businessId, id: { [Op.in]: [-1] } };
  return { business_id: businessId, client_id: { [Op.in]: scope.clientIds } };
}

async function canAccessInvoice(userId, invoice, scope) {
  if (!invoice) return false;
  if (!scope) scope = await getUserScope(userId, invoice.business_id);
  if (isMemberOrAbove(scope)) return true;
  if (!scope.isClient) return false;
  return scope.clientIds.includes(invoice.client_id);
}

// ─────────────────────────────────────────────
// Post (Q docs / 문서)
// ─────────────────────────────────────────────
async function postListWhere(userId, businessId, scope) {
  if (!scope) scope = await getUserScope(userId, businessId);
  if (isMemberOrAbove(scope)) return { business_id: businessId };
  if (!scope.isClient) return null;
  if (scope.projectClientProjectIds.length === 0) {
    return { business_id: businessId, id: { [Op.in]: [-1] } };
  }
  return { business_id: businessId, project_id: { [Op.in]: scope.projectClientProjectIds } };
}

async function canAccessPost(userId, post, scope) {
  if (!post) return false;
  if (!scope) scope = await getUserScope(userId, post.business_id);
  if (isMemberOrAbove(scope)) return true;
  if (!scope.isClient) return false;
  if (post.project_id && scope.projectClientProjectIds.includes(post.project_id)) return true;
  return false;
}

// ─────────────────────────────────────────────
// 미들웨어: req.scope 주입 + 워크스페이스 접근 확인
// 사용법:
//   router.get('/:businessId', authenticateToken, attachWorkspaceScope(), handler);
//   router.post('/:businessId', authenticateToken, attachWorkspaceScope({ memberOnly: true }), handler);
//
// 주입되는 필드:
//   req.scope         — getUserScope() 결과
//   req.businessRole  — 'owner' | 'member' | 'client' | 'admin'
//   req.businessMember — { role, business_id, user_id } (member/owner 일 때만, client 면 null)
// ─────────────────────────────────────────────
function attachWorkspaceScope(opts = {}) {
  const allowClient = opts.memberOnly !== true;
  return async function attachScope(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      const rawBizId =
        req.params.businessId || req.body?.business_id || req.query?.business_id;
      const businessId = Number(rawBizId);
      if (!businessId || Number.isNaN(businessId)) {
        return res.status(400).json({ success: false, message: 'Business ID required' });
      }
      const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
      const allowed =
        scope.isPlatformAdmin ||
        scope.isOwner ||
        scope.isMember ||
        (allowClient && scope.isClient);
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'No access to this business' });
      }
      req.scope = scope;
      req.businessRole = scope.businessRole;
      if (scope.isOwner || scope.isMember) {
        req.businessMember = { role: scope.businessRole, business_id: businessId, user_id: req.user.id };
      } else {
        req.businessMember = null;
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  getUserScope,
  assertWorkspaceAccess,
  isMemberOrAbove,
  attachWorkspaceScope,
  canAccessConversation,
  conversationListWhere,
  canAccessTask,
  taskListWhere,
  canAccessProject,
  fileListWhere,
  invoiceListWhere,
  canAccessInvoice,
  postListWhere,
  canAccessPost,
};
