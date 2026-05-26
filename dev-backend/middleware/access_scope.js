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
  Conversation, Project, ProjectMember, TaskReviewer,
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
    projectMemberIds: [],           // me 가 ProjectMember 인 project.id 들 (옵션 A — L2 권한 검사용)
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

  // 4) ProjectMember — 옵션 A (사이클 N+9) L2 권한 검사용.
  //    내가 멤버 (owner/member) 일 때만 채움. client 는 ProjectClient 로 별도 권한.
  if (bm && (bm.role === 'owner' || bm.role === 'member')) {
    const pmRows = await ProjectMember.findAll({
      where: { user_id: userId },
      include: [{ model: Project, attributes: ['id'], where: { business_id: businessId }, required: true }],
      attributes: ['project_id'],
    });
    scope.projectMemberIds = pmRows.map((r) => r.project_id);
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

// member 이상 boolean 가드 — 라우트의 인라인 BusinessMember.findOne 패턴 통일용.
// posts.js / docs.js 의 자체 assertMember/assertBusinessAccess 와 동일 로직 + Business.owner_id fallback.
// 사용: if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) return 403;
async function assertMemberOrAbove(userId, businessId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  if (!userId || !businessId) return false;
  const bm = await BusinessMember.findOne({
    where: { user_id: userId, business_id: businessId },
    attributes: ['role'],
  });
  if (bm && (bm.role === 'owner' || bm.role === 'member' || bm.role === 'admin' || bm.role === 'ai')) return true;
  // Fallback: Business.owner_id 직접 매칭 (BusinessMember 자동 생성 누락 케이스 대비)
  const { Business } = require('../models');
  const biz = await Business.findOne({ where: { id: businessId, owner_id: userId }, attributes: ['id'] });
  return !!biz;
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
// 4단계 Visibility (사이클 N+9, 2026-05-11) — VISIBILITY_VOCABULARY.md 옵션 A
//   L1=개인(uploader/author 본인만), L2=팀(프로젝트 멤버), L3=워크스페이스, L4=외부(share_token)
//   files / posts / kb_documents 에 적용. Task / Conversation 등 협업 자산은 별도 정책.
//
//   기존 헬퍼 (canAccessFile/Post, fileListWhere/postListWhere) 는 "열린 문화" 유지.
//   신규 헬퍼는 "ByLevel" suffix — 단계적 도입 (라우트 별로 교체).
// ─────────────────────────────────────────────

// File — L1=uploader, L2=project_id IN projectMemberIds, L3=workspace member, L4=workspace member (share_token 은 public route 별도)
async function canAccessFileByLevel(userId, file, scope) {
  if (!file) return false;
  if (!scope) scope = await getUserScope(userId, file.business_id);
  if (scope.isPlatformAdmin) return true;
  // 본인 업로드 무조건 OK
  if (file.uploader_id === userId) return true;
  const v = file.visibility;
  if (v === 'L1') return false;
  // N+72 fix — L4 도 워크스페이스 멤버는 보여야 (옛 false 회귀, "삭제됨" 표시 원인)
  if (v === 'L4') return scope.isOwner || scope.isMember;
  if (v === 'L3') return scope.isOwner || scope.isMember;
  if (v === 'L2') {
    if (file.project_id) {
      return (scope.projectMemberIds || []).includes(file.project_id) || scope.isOwner;
    }
    return scope.isOwner || scope.isMember;
  }
  return scope.isOwner || scope.isMember;
}

function fileListWhereByLevel(scope) {
  if (scope.isPlatformAdmin) return { business_id: scope.businessId };
  const conds = [];
  conds.push({ visibility: 'L1', uploader_id: scope.userId });
  if (scope.isOwner || scope.isMember) {
    conds.push({ visibility: 'L3' });
    conds.push({ visibility: 'L4' });  // N+72 fix — L4 도 워크스페이스 멤버 list 에 보여야
    conds.push({ visibility: null });
  }
  if (scope.isOwner) {
    conds.push({ visibility: 'L2' });
  } else if ((scope.projectMemberIds || []).length > 0) {
    conds.push({ visibility: 'L2', project_id: { [Op.in]: scope.projectMemberIds } });
  }
  if (conds.length === 0) return { business_id: scope.businessId, id: { [Op.in]: [-1] } };
  return { business_id: scope.businessId, [Op.or]: conds };
}

// Post (vlevel) — 동일 패턴
async function canAccessPostByLevel(userId, post, scope) {
  if (!post) return false;
  if (!scope) scope = await getUserScope(userId, post.business_id);
  if (scope.isPlatformAdmin) return true;
  // 본인 작성 무조건 OK
  if (post.author_id === userId) return true;
  const v = post.vlevel;
  // L1 — 본인만 (위에서 처리)
  if (v === 'L1') return false;
  // L4 — 외부 공개 = 워크스페이스 멤버 + share_token 으로 외부도 OK (raw 인증 사용자는 멤버여야)
  // N+72 fix: L4 면서 워크스페이스 멤버면 OK (옛 false 회귀 — "삭제됨" 표시 원인)
  if (v === 'L4') return scope.isOwner || scope.isMember;
  // L3 — 워크스페이스 전체
  if (v === 'L3') return scope.isOwner || scope.isMember;
  // L2 — 프로젝트 (project_id 있음) 또는 specific members (target_member_ids)
  if (v === 'L2') {
    if (post.project_id) {
      return (scope.projectMemberIds || []).includes(post.project_id) || scope.isOwner;
    }
    // L2-members 분기 — target_member_ids 검사
    const targetIds = Array.isArray(post.target_member_ids) ? post.target_member_ids : [];
    if (targetIds.length > 0) {
      return targetIds.includes(userId) || scope.isOwner;
    }
    // 옛 L2 (target 없음) — workspace fallback
    return scope.isOwner || scope.isMember;
  }
  // vlevel NULL legacy fallback
  return scope.isOwner || scope.isMember;
}

function postListWhereByLevel(scope) {
  if (scope.isPlatformAdmin) return { business_id: scope.businessId };
  const conds = [];
  conds.push({ vlevel: 'L1', author_id: scope.userId });
  if (scope.isOwner || scope.isMember) {
    conds.push({ vlevel: 'L3' });
    conds.push({ vlevel: 'L4' });  // N+72 fix — L4 도 워크스페이스 멤버 보여야
    conds.push({ vlevel: null });
  }
  if (scope.isOwner) {
    conds.push({ vlevel: 'L2' });
  } else if ((scope.projectMemberIds || []).length > 0) {
    conds.push({ vlevel: 'L2', project_id: { [Op.in]: scope.projectMemberIds } });
  }
  if (conds.length === 0) return { business_id: scope.businessId, id: { [Op.in]: [-1] } };
  return { business_id: scope.businessId, [Op.or]: conds };
}

// KbDocument (scope) — 'private' 추가
async function canAccessKbDocumentByLevel(userId, doc, scope) {
  if (!doc) return false;
  if (!scope) scope = await getUserScope(userId, doc.business_id);
  if (scope.isPlatformAdmin) return true;
  const s = doc.scope;
  // private = 본인 (uploaded_by)
  if (s === 'private') return doc.uploaded_by === userId;
  // workspace = member 이상
  if (s === 'workspace') return scope.isOwner || scope.isMember;
  // project = project 멤버 또는 owner
  if (s === 'project') {
    if (doc.project_id) {
      return (scope.projectMemberIds || []).includes(doc.project_id) || scope.isOwner;
    }
    return scope.isOwner || scope.isMember;
  }
  // client = 해당 client 의 멤버 또는 workspace owner
  if (s === 'client') {
    if (scope.isOwner) return true;
    if (scope.isClient && scope.clientIds.includes(doc.client_id)) return true;
    return scope.isMember; // member 는 client KB 접근 가능 (열린 문화)
  }
  return scope.isOwner || scope.isMember;
}

function kbDocumentsListWhereByLevel(scope) {
  if (scope.isPlatformAdmin) return { business_id: scope.businessId };
  const conds = [];
  conds.push({ scope: 'private', uploaded_by: scope.userId });
  if (scope.isOwner || scope.isMember) {
    conds.push({ scope: 'workspace' });
    conds.push({ scope: 'client' }); // 멤버는 client KB 도 접근 (열린 문화)
  }
  if (scope.isOwner) {
    conds.push({ scope: 'project' });
  } else if ((scope.projectMemberIds || []).length > 0) {
    conds.push({ scope: 'project', project_id: { [Op.in]: scope.projectMemberIds } });
  }
  if (scope.isClient && scope.clientIds.length > 0) {
    conds.push({ scope: 'client', client_id: { [Op.in]: scope.clientIds } });
  }
  if (conds.length === 0) return { business_id: scope.businessId, id: { [Op.in]: [-1] } };
  return { business_id: scope.businessId, [Op.or]: conds };
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
// N+69 — opts.platformAdminAs: 옛 checkBusinessAccess 호환용. platform_admin 의 businessRole
//        을 'owner' 로 강제 (기본은 'admin'). 옛 라우트가 `businessRole === 'owner'` 검사 시 호환.
function attachWorkspaceScope(opts = {}) {
  const allowClient = opts.memberOnly !== true;
  const platformAdminAs = opts.platformAdminAs;  // 'owner' | 'admin' | undefined
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
      // platformAdminAs 옵션 적용 (옛 호환)
      if (platformAdminAs && scope.isPlatformAdmin) {
        scope.businessRole = platformAdminAs;
      }
      const allowed =
        scope.isPlatformAdmin ||
        scope.isOwner ||
        scope.isMember ||
        (allowClient && scope.isClient);
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'No access to this business' });
      }
      req.scope = scope;
      req.businessId = businessId;  // 옛 checkBusinessAccess 호환
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
  assertMemberOrAbove,
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
  // 사이클 N+9 — 4단계 Visibility 옵션 A
  canAccessFileByLevel,
  fileListWhereByLevel,
  canAccessPostByLevel,
  postListWhereByLevel,
  canAccessKbDocumentByLevel,
  kbDocumentsListWhereByLevel,
};
