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
const { sequelize } = require('../config/database');
const {
  BusinessMember, Client, ProjectClient, ConversationParticipant,
  Conversation, Project, ProjectMember, TaskReviewer, Business,
  CalendarEventAttendee,
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
    isAdmin: false,        // BusinessMember.role === 'admin' (N+21). 데이터 접근은 owner 급 전권, owner_only(재무)만 제외.
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
    scope.isAdmin = bm.role === 'admin';
    scope.isAi = bm.role === 'ai';
  }

  // 운영 #14/#36 — BusinessMember.role 이 'owner' 로 안 박혀있어도(또는 BM row 자체가 없어도)
  // businesses.owner_id 본인이면 owner 로 인정. 운영 워크스페이스는 생성 경로에 따라
  // owner 가 BM 'owner' row 없이 owner_id 로만 owner 인 경우가 있어, 이 fallback 이 없으면
  // assertBusinessAccess(워크스페이스 접근) 부터 project_id 변경까지 전부 403 으로 막힘.
  // owner_id 는 business 당 유일 → 실제 owner 에게만 owner 권한 부여(타인 오상승 불가).
  if (!scope.isOwner) {
    const biz = await Business.findOne({ where: { id: businessId, owner_id: userId }, attributes: ['id'] });
    if (biz) {
      scope.isOwner = true;
      if (!scope.businessRole) scope.businessRole = 'owner';
    }
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
  if (bm && (bm.role === 'owner' || bm.role === 'member' || bm.role === 'admin')) {
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
  if (scope.isPlatformAdmin || scope.isOwner || scope.isMember || scope.isAdmin || scope.isClient) return scope;
  return null;
}

// member 이상만 (client 차단). admin(N+21) 도 member 이상 — 데이터 접근 전권.
function isMemberOrAbove(scope) {
  return !!(scope?.isPlatformAdmin || scope?.isOwner || scope?.isMember || scope?.isAdmin);
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
// assertAssignable — D2-b (#66) 외부 파트너 담당자/컨펌자 배정 게이트키퍼 (보안민감)
//
// 업무 assignee / reviewer 로 지정 가능한 대상인지 검증. 단일 진실 원천.
//   - 워크스페이스 멤버(owner/member/admin + AI Cue) → 모든 업무 배정 가능 (기존 열린 문화 유지)
//   - 외부 파트너(active Client + user 계정) → 그 업무의 project 에 참여 중일 때만 (B중간 결정)
//   - 그 외 user_id (타 워크스페이스·유령 계정) → 차단 (기존 검증 부재 취약점 동시 차단)
//   - project 없는 업무 → 외부인 배정 불가 (격리 스코프 근거 없음)
//
// 격리는 taskListWhere(배정 업무만 조회) + serializeTaskForClient(내부 공수·AI·internal 댓글 차단)
// 가 그대로 책임. 이 함수는 "배정 시점" 게이트만 담당.
//
// 반환: { ok: boolean, kind?: 'member'|'client', clientIds?: number[], reason?: string }
//   reason ∈ not_workspace_user | external_requires_project | external_not_in_project
// ─────────────────────────────────────────────
async function assertAssignable(targetUserId, businessId, projectId) {
  if (!targetUserId || !businessId) return { ok: false, reason: 'not_workspace_user' };
  const targetScope = await getUserScope(Number(targetUserId), Number(businessId));
  // 멤버(AI Cue 포함) — 워크스페이스 전체 업무 배정 가능
  if (isMemberOrAbove(targetScope) || targetScope.isAi) return { ok: true, kind: 'member' };
  // 외부 파트너 — active client 이어야 하고, 그 프로젝트 참여자여야 함
  if (!targetScope.isClient) return { ok: false, reason: 'not_workspace_user' };
  const pid = Number(projectId);
  if (!pid) return { ok: false, reason: 'external_requires_project' };
  // (a) contact_user_id 로 프로젝트 참여 (getUserScope 가 이미 수집)
  if (targetScope.projectClientProjectIds.includes(pid)) {
    return { ok: true, kind: 'client', clientIds: targetScope.clientIds };
  }
  // (b) client_id 로 프로젝트 참여 (ProjectClient.client_id 링크 — contact_user_id 미설정 케이스)
  if (targetScope.clientIds.length > 0) {
    const pc = await ProjectClient.findOne({
      where: { project_id: pid, client_id: { [Op.in]: targetScope.clientIds } },
      attributes: ['id'],
    });
    if (pc) return { ok: true, kind: 'client', clientIds: targetScope.clientIds };
  }
  return { ok: false, reason: 'external_not_in_project' };
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

// ─────────────────────────────────────────────
// CalendarEvent — 가시성 where 단일 원천
//
// 여태 이 규칙은 routes/calendar.js 안에만 인라인으로 있었다. 그래서 Cue 컨텍스트 빌더가
// 캘린더를 business_id 만으로 긁으면서 남의 개인(L1) 일정까지 LLM 프롬프트에 넣고 있었다.
// 사람 라우트와 AI 가 같은 규칙을 쓰도록 추출한다.
//
//   client        — 본인이 attendee 인 business event 만 (PERMISSION_MATRIX §7)
//   owner/admin   — 전체
//   member        — 본인 생성 / L3 / L4 / L2(참여 프로젝트 또는 target_member_ids) / legacy
//   scope 없음    — fail-closed: L3·L4 (워크스페이스 공개분) 만
//
// 반환: where 조각 (business_id 포함). null = 볼 수 있는 것 없음.
// ─────────────────────────────────────────────
async function calendarListWhere(userId, businessId, scope) {
  if (!scope) scope = await getUserScope(userId, businessId);
  const uid = parseInt(userId, 10);

  if (scope?.isClient) {
    const rows = await CalendarEventAttendee.findAll({ where: { user_id: uid }, attributes: ['event_id'] });
    const ids = rows.map((a) => a.event_id);
    if (ids.length === 0) return null;
    return { business_id: businessId, id: { [Op.in]: ids }, visibility: 'business' };
  }

  const isAdmin = scope?.isOwner || scope?.isAdmin || scope?.isPlatformAdmin;
  if (isAdmin) return { business_id: businessId };

  if (!scope || !isMemberOrAbove(scope)) {
    // 스코프를 모르면 개인·팀 일정은 절대 흘리지 않는다 (fail-closed)
    return { business_id: businessId, vlevel: { [Op.in]: ['L3', 'L4'] } };
  }

  const myProjectIds = (await ProjectMember.findAll({
    where: { user_id: uid }, attributes: ['project_id'],
  })).map((r) => r.project_id);

  return {
    business_id: businessId,
    [Op.and]: [{
      [Op.or]: [
        { created_by: uid },
        { vlevel: 'L3' },
        { vlevel: 'L4' },
        { vlevel: 'L2', project_id: { [Op.in]: myProjectIds.length > 0 ? myProjectIds : [0] } },
        sequelize.literal(`vlevel='L2' AND JSON_CONTAINS(target_member_ids, '${uid}')`),
        // legacy fallback (vlevel NULL) — 옛 visibility 기반
        { vlevel: null, visibility: 'business' },
        { vlevel: null, visibility: 'personal', created_by: uid },
      ],
    }],
  };
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

// File — N+74 vlevel 컬럼 우선 (legacy visibility 도 fallback). Post 와 동일 정책.
//   L1=uploader / L2=project_id 또는 target_member_ids / L3=workspace / L4=workspace member + share_token
async function canAccessFileByLevel(userId, file, scope) {
  if (!file) return false;
  if (!scope) scope = await getUserScope(userId, file.business_id);
  if (scope.isPlatformAdmin) return true;
  // 본인 업로드 무조건 OK
  if (file.uploader_id === userId) return true;
  // N+74 — vlevel 신컬럼 우선, legacy visibility fallback
  const v = file.vlevel || file.visibility;
  if (v === 'L1') return false;
  // admin(N+21) 은 owner 급 전권 — 모든 분기에서 owner 와 동일 취급 (Post 헬퍼 동일 패턴)
  const fullView = scope.isOwner || scope.isAdmin;
  // L4 도 워크스페이스 멤버는 보여야 (N+72 fix)
  if (v === 'L4') return fullView || scope.isMember;
  if (v === 'L3') return fullView || scope.isMember;
  if (v === 'L2') {
    if (file.project_id) {
      return (scope.projectMemberIds || []).includes(file.project_id) || fullView;
    }
    // N+74 — L2-members 분기 (target_member_ids)
    const targetIds = Array.isArray(file.target_member_ids) ? file.target_member_ids : [];
    if (targetIds.length > 0) {
      return targetIds.includes(userId) || fullView;
    }
    return fullView || scope.isMember;
  }
  return fullView || scope.isMember;
}

function fileListWhereByLevel(scope) {
  if (scope.isPlatformAdmin) return { business_id: scope.businessId };
  const fullView = scope.isOwner || scope.isAdmin;  // admin(N+21) = owner 급 가시성
  const conds = [];
  // L1 — 본인 업로드 (vlevel 또는 legacy visibility)
  conds.push({ [Op.or]: [{ vlevel: 'L1' }, { visibility: 'L1' }], uploader_id: scope.userId });
  if (fullView || scope.isMember) {
    // L3 / L4 / legacy null — 워크스페이스 멤버는 모두 OK
    conds.push({ vlevel: 'L3' });
    conds.push({ vlevel: 'L4' });
    // ★ legacy visibility 는 vlevel 미마이그레이션(null)일 때만 권위 — vlevel 이 우선 컬럼.
    //   (보안 fix: vlevel='L1' 개인파일인데 옛 visibility='L3' 이면 L3 조건에 걸려 전 멤버 노출되던 누출 차단)
    conds.push({ vlevel: null, visibility: 'L3' });
    conds.push({ vlevel: null, visibility: 'L4' });
    conds.push({ vlevel: null, visibility: null });
  }
  if (fullView) {
    conds.push({ vlevel: 'L2' });
    conds.push({ vlevel: null, visibility: 'L2' });
  } else {
    // L2 — project_id 매칭 OR target_member_ids 안 본인 포함
    if ((scope.projectMemberIds || []).length > 0) {
      conds.push({ vlevel: 'L2', project_id: { [Op.in]: scope.projectMemberIds } });
      conds.push({ vlevel: null, visibility: 'L2', project_id: { [Op.in]: scope.projectMemberIds } });
    }
    // N+74 — L2-members (target_member_ids JSON contains userId). MySQL JSON_CONTAINS 사용.
    conds.push(sequelize.literal(`vlevel = 'L2' AND JSON_CONTAINS(target_member_ids, '${Number(scope.userId)}')`));
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
  // admin(N+21) 은 owner 급 전권 — 모든 분기에서 owner 와 동일 취급
  const fullView = scope.isOwner || scope.isAdmin;
  if (v === 'L4') return fullView || scope.isMember;
  // L3 — 워크스페이스 전체
  if (v === 'L3') return fullView || scope.isMember;
  // L2 — 프로젝트 (project_id 있음) 또는 specific members (target_member_ids)
  if (v === 'L2') {
    if (post.project_id) {
      return (scope.projectMemberIds || []).includes(post.project_id) || fullView;
    }
    // L2-members 분기 — target_member_ids 검사
    const targetIds = Array.isArray(post.target_member_ids) ? post.target_member_ids : [];
    if (targetIds.length > 0) {
      return targetIds.includes(userId) || fullView;
    }
    // 옛 L2 (target 없음) — workspace fallback
    return fullView || scope.isMember;
  }
  // vlevel NULL legacy fallback
  return fullView || scope.isMember;
}

function postListWhereByLevel(scope) {
  if (scope.isPlatformAdmin) return { business_id: scope.businessId };
  const conds = [];
  conds.push({ vlevel: 'L1', author_id: scope.userId });
  // 작성자 본인 글은 vlevel 무관 항상 노출 (KB uploaded_by 패턴) — member 가 프로젝트 멤버 아니어도 자기 L2 문서 보임 (운영 #13·#18 fix)
  conds.push({ author_id: scope.userId });
  // admin(N+21) 은 owner 급 전권 — owner 와 동일 가시성
  const fullView = scope.isOwner || scope.isAdmin;
  if (fullView || scope.isMember) {
    conds.push({ vlevel: 'L3' });
    conds.push({ vlevel: 'L4' });  // N+72 fix — L4 도 워크스페이스 멤버 보여야
    conds.push({ vlevel: null });
  }
  if (fullView) {
    conds.push({ vlevel: 'L2' });
  } else if ((scope.projectMemberIds || []).length > 0) {
    conds.push({ vlevel: 'L2', project_id: { [Op.in]: scope.projectMemberIds } });
  }
  // N+74 — L2-members (target_member_ids JSON 에 본인 포함). owner/admin 은 위에서 이미 통과
  if (!fullView) {
    conds.push(sequelize.literal(`vlevel = 'L2' AND JSON_CONTAINS(target_member_ids, '${Number(scope.userId)}')`));
  }
  if (conds.length === 0) return { business_id: scope.businessId, id: { [Op.in]: [-1] } };
  return { business_id: scope.businessId, [Op.or]: conds };
}

// KbDocument — 본인 + scope (private/workspace/project/client) + N+72 vlevel L2-members
async function canAccessKbDocumentByLevel(userId, doc, scope) {
  if (!doc) return false;
  if (!scope) scope = await getUserScope(userId, doc.business_id);
  if (scope.isPlatformAdmin) return true;
  // 본인 업로드 무조건 OK
  if (doc.uploaded_by === userId) return true;
  // admin(N+21) 은 owner 급 전권 (Post/File 헬퍼 동일 패턴)
  const fullView = scope.isOwner || scope.isAdmin;
  // N+72 — vlevel L2-members 분기 우선 (KbDocument 도 target_member_ids 있음)
  if (doc.vlevel === 'L2' && doc.scope !== 'project') {
    const targetIds = Array.isArray(doc.target_member_ids) ? doc.target_member_ids : [];
    if (targetIds.length > 0) {
      return targetIds.includes(userId) || fullView;
    }
  }
  const s = doc.scope;
  if (s === 'private') return false;  // 본인 외 차단 (위에서 본인 통과)
  if (s === 'workspace') return fullView || scope.isMember;
  if (s === 'project') {
    if (doc.project_id) {
      return (scope.projectMemberIds || []).includes(doc.project_id) || fullView;
    }
    return fullView || scope.isMember;
  }
  if (s === 'client') {
    if (fullView) return true;
    if (scope.isClient && scope.clientIds.includes(doc.client_id)) return true;
    return scope.isMember;
  }
  return fullView || scope.isMember;
}

function kbDocumentsListWhereByLevel(scope) {
  if (scope.isPlatformAdmin) return { business_id: scope.businessId };
  const fullView = scope.isOwner || scope.isAdmin;  // admin(N+21) = owner 급 가시성
  const conds = [];
  conds.push({ scope: 'private', uploaded_by: scope.userId });
  if (fullView || scope.isMember) {
    conds.push({ scope: 'workspace' });
    conds.push({ scope: 'client' }); // 멤버는 client KB 도 접근 (열린 문화)
  }
  if (fullView) {
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
        scope.isAdmin ||        // N+21 admin — owner 급 워크스페이스 접근 (재무 owner_only 는 라우트별 assertInvoiceMutationOwner 로 별도 차단)
        scope.isMember ||
        (allowClient && scope.isClient);
      if (!allowed) {
        return res.status(403).json({ success: false, message: 'No access to this business' });
      }
      req.scope = scope;
      req.businessId = businessId;  // 옛 checkBusinessAccess 호환
      req.businessRole = scope.businessRole;
      if (scope.isOwner || scope.isMember || scope.isAdmin) {
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
  assertAssignable,
  canAccessProject,
  fileListWhere,
  invoiceListWhere,
  calendarListWhere,
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
