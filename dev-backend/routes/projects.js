const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Op } = require('sequelize');
const router = express.Router();
const { sequelize } = require('../config/database');
const {
  Project, ProjectMember, ProjectClient,
  ProjectNote, ProjectIssue, TaskCandidate,
  Conversation, ConversationParticipant, Message, Task, TaskReviewer,
  BusinessMember, User, Business, Client,
  ProjectStatusOption, ProjectProcessColumn, ProjectProcessPart,
  File, FileFolder, MessageAttachment, TaskAttachment,
  ProjectWorkstream, Post, Document, Department, Team, TaskLink, ProjectStage, ProjectLink,
} = require('../models');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { createAuditLog } = require('../middleware/audit');
const taskExtractor = require('../services/task_extractor');
const cueOrchestrator = require('../services/cue_orchestrator');
const { applyMemberDisplayName, applyMemberDisplayNameOne, getMemberNameMap } = require('../services/displayName');
const { todayInTz, mondayOfDateStr, addDaysStr } = require('../utils/datetime');
const { fetchProjectStats } = require('../services/weeklyReviewSnapshot');

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

// 독립 대화(project_id null) scope 체크 — 워크스페이스 멤버여야 접근 가능.
// 반환: { conversation, role } 또는 { error }. role 은 'owner'|'member'.
async function loadStandaloneConvOrForbidden(convId, userId) {
  const conv = await Conversation.findByPk(convId);
  if (!conv) return { error: { code: 404, message: 'conversation_not_found' } };
  const bm = await requireBusinessMember(userId, conv.business_id);
  if (!bm) return { error: { code: 403, message: 'not_workspace_member' } };
  return { conversation: conv, role: bm.role };
}

// 관리자 전용 액션(프로젝트 멤버 관리·삭제·종료·이관) 가드.
// owner 또는 platform_admin 만 통과.
async function requireProjectAdmin(projectId, user) {
  const loaded = await loadProjectOrForbidden(projectId, user.id);
  if (loaded.error) return loaded;
  const isPlatformAdmin = user.platform_role === 'platform_admin';
  if (!isPlatformAdmin && loaded.role !== 'owner') {
    return { error: { code: 403, message: 'owner_only' } };
  }
  return loaded;
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
      kind,              // 내부/고객 구분 (client|internal)
      stage_template,    // Phase D+1: 거래 시퀀스 템플릿 (fixed/subscription/consulting/custom)
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

    // 플랜 쿼터 체크 — 진행중(active/draft) 프로젝트만 카운트
    const planEngine = require('../services/plan');
    const planCan = await planEngine.can(business_id, 'create_project');
    if (!planCan.ok) {
      await t.rollback();
      return res.status(422).json(planEngine.buildQuotaError(planCan, business_id));
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
      kind: kind === 'internal' ? 'internal' : 'client',
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
        // 생성자 = 프로젝트 owner = 자동 PM (PERMISSION_MATRIX §3)
        is_pm: m.user_id === req.user.id,
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

    // Phase D+1: 거래 시퀀스 stage 시드 (트랜잭션 내부에서 — 멱등 보장)
    const { seedStages, STAGE_TEMPLATE_KEYS, progressProject } = require('../services/projectStageEngine');
    const tplKey = STAGE_TEMPLATE_KEYS.includes(stage_template)
      ? stage_template
      : (project_type === 'ongoing' ? 'subscription' : 'fixed'); // 기본값 매핑
    await seedStages(project.id, tplKey, t);

    await t.commit();

    // 시드 후 자동 진행 1회 (이미 첨부된 entity 가 있을 수 있어)
    progressProject(project.id).catch(() => null);

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
// N+1 최적화: loadProjectDetail(projectId) 를 프로젝트마다 호출하던 구조 제거.
// 단일 findAll 에 include 로 연관 한 번에 로드 (기존 응답 시그니처 유지).
// ============================================
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    const bm = await requireBusinessMember(req.user.id, businessId);

    const where = { business_id: businessId };
    if (req.query.status) where.status = req.query.status;

    // 고객이면 본인 참여 프로젝트만
    let projectIdFilter = null;
    if (!bm) {
      const myClientRows = await ProjectClient.findAll({
        where: { contact_user_id: req.user.id },
        attributes: ['project_id'],
        include: [{ model: Project, attributes: ['id'], where: { business_id: businessId } }],
      });
      projectIdFilter = myClientRows.map(r => r.project_id);
      if (projectIdFilter.length === 0) return successResponse(res, []);
      where.id = { [Op.in]: projectIdFilter };
    }

    const projects = await Project.findAll({
      where,
      order: [['created_at', 'DESC']],
      include: [
        { model: Business, attributes: ['id', 'brand_name', 'name', 'slug'] },
        {
          model: ProjectMember,
          as: 'projectMembers',
          include: [{ model: User, attributes: ['id', 'name', 'name_localized', 'email'] }],
        },
        {
          model: ProjectClient,
          as: 'projectClients',
          attributes: { exclude: ['invite_token'] },
        },
      ],
    });

    // 워크스페이스 표시명 enrichment — BusinessMember.name 이 있으면 그걸 우선.
    // 메모 project_account_workspace_profile_split: 사이드바·UserChip·리스트 모두 워크스페이스 표시명 우선.
    // 응답의 User 객체에 display_name 과 display_name_localized 채워서 displayName() 헬퍼가 자동 적용.
    const bms = await BusinessMember.findAll({
      where: { business_id: businessId },
      attributes: ['user_id', 'name', 'name_localized', 'role', 'department_id', 'team_id'],
    });
    const bmMap = new Map(bms.map(b => [b.user_id, { name: b.name, name_localized: b.name_localized, role: b.role, department_id: b.department_id, team_id: b.team_id }]));

    // #99 — 그룹핑용: 담당자(owner) 소속 부서/팀 이름. 프로젝트에 팀/부서 필드가 없어 owner 기준.
    const { Department, Team } = require('../models');
    const [depts, teams] = await Promise.all([
      Department.findAll({ where: { business_id: businessId }, attributes: ['id', 'name'] }),
      Team.findAll({ where: { business_id: businessId }, attributes: ['id', 'name'] }),
    ]);
    const deptMap = new Map(depts.map(d => [d.id, d.name]));
    const teamMap = new Map(teams.map(t => [t.id, t.name]));

    const result = projects.map(p => {
      const json = p.toJSON();
      // owner 소속 부서/팀 (그룹핑용)
      const ownerBm = bmMap.get(json.owner_user_id);
      json.owner_department = ownerBm?.department_id ? (deptMap.get(ownerBm.department_id) || null) : null;
      json.owner_team = ownerBm?.team_id ? (teamMap.get(ownerBm.team_id) || null) : null;
      if (Array.isArray(json.projectMembers)) {
        json.projectMembers = json.projectMembers.map(m => {
          const bm = bmMap.get(m.user_id);
          if (m.User && bm) {
            m.User.display_name = bm.name || null;
            m.User.display_name_localized = bm.name_localized || null;
            m.User.workspace_role = bm.role;
          }
          return m;
        });
      }
      return json;
    });

    return successResponse(res, result);
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

// ─── 상태 변경 이력 (기본 히스토리 — active/paused/closed 전이 타임라인) ───
router.get('/:id/status-history', authenticateToken, async (req, res, next) => {
  try {
    const { project, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const { ProjectStatusHistory, User } = require('../models');
    const { applyMemberDisplayName } = require('../services/displayName');
    const rows = await ProjectStatusHistory.findAll({
      where: { project_id: project.id },
      include: [{ model: User, as: 'changer', attributes: ['id', 'name', 'name_localized'] }],
      order: [['created_at', 'ASC']],
    });
    const data = rows.map((r) => ({
      id: r.id,
      from_status: r.from_status,
      to_status: r.to_status,
      note: r.note || null,
      created_at: r.createdAt, // underscored 모델 — 인스턴스 접근자는 createdAt
      changer: r.changer ? { id: r.changer.id, name: r.changer.name, name_localized: r.changer.name_localized } : null,
    }));
    await applyMemberDisplayName(data, project.business_id, ['changer']);
    return successResponse(res, data.map((d) => ({
      id: d.id, from_status: d.from_status, to_status: d.to_status, note: d.note,
      created_at: d.created_at, changed_by_name: d.changer ? (d.changer.name || null) : null,
    })));
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

    const { name, description, client_company, start_date, end_date, status, default_assignee_user_id, color, project_type, process_tab_label, kind } = req.body || {};
    // 프로젝트 종료/재개는 owner 또는 platform_admin 만
    if (status !== undefined && status !== project.status) {
      const isPlatformAdmin = req.user.platform_role === 'platform_admin';
      if (!isPlatformAdmin && role !== 'owner') return errorResponse(res, 'owner_only', 403);
    }
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
    // 내부/고객 구분 (수익성 세그먼트 축) — 멤버 이상 편집 가능(재무 게이트 아님, 분류일 뿐)
    if (kind !== undefined && ['client', 'internal'].includes(kind)) patch.kind = kind;

    // ─── 정기청구 설정 (재무) — owner/platform_admin 만. 자동발행 여부는 고객에게 자동 발송을 좌우하므로 invoice 정책과 동일하게 owner 전용. ───
    const { billing_type, monthly_fee, invoice_billing_day, auto_invoice_enabled, auto_invoice_mode } = req.body || {};
    const billingTouched = [billing_type, monthly_fee, invoice_billing_day, auto_invoice_enabled, auto_invoice_mode].some(v => v !== undefined);
    if (billingTouched) {
      const isPlatformAdmin = req.user.platform_role === 'platform_admin';
      if (!isPlatformAdmin && role !== 'owner') return errorResponse(res, 'owner_only — billing settings require workspace owner', 403);
      if (billing_type !== undefined && ['fixed', 'hourly', 'subscription', 'milestone', 'internal'].includes(billing_type)) patch.billing_type = billing_type;
      if (monthly_fee !== undefined) { const f = Number(monthly_fee); if (Number.isFinite(f) && f >= 0) patch.monthly_fee = f; }
      if (invoice_billing_day !== undefined) { const d = parseInt(invoice_billing_day, 10); if (d >= 1 && d <= 31) patch.invoice_billing_day = d; }
      if (auto_invoice_enabled !== undefined) patch.auto_invoice_enabled = !!auto_invoice_enabled;
      if (auto_invoice_mode !== undefined && ['auto', 'draft_review'].includes(auto_invoice_mode)) patch.auto_invoice_mode = auto_invoice_mode;
    }

    const prevStatus = project.status;
    const prevName = project.name;
    await project.update(patch);
    // 프로젝트 'closed' 전환 시 연결 대화 자동 archived (cascade, soft). 데이터는 보존.
    if (patch.status === 'closed' && prevStatus !== 'closed') {
      await Conversation.update(
        { status: 'archived' },
        { where: { project_id: project.id, status: 'active' } },
      );
    }
    // 사이클 N+21 — Project 상태 전이 history 박제
    if (patch.status && patch.status !== prevStatus) {
      try {
        const { ProjectStatusHistory } = require('../models');
        await ProjectStatusHistory.create({
          project_id: project.id,
          business_id: project.business_id,
          from_status: prevStatus,
          to_status: patch.status,
          changed_by: req.user.id,
          note: null,
        });
      } catch (e) { console.warn('[ProjectStatusHistory create]', e.message); }
    }
    // 이름 변경 시 파생 이름 동기화 (#150)
    if (patch.name && patch.name !== prevName) {
      // (1) 대화방 제목 — 생성 시 프로젝트명을 제목에 구워 저장한다("{프로젝트명} 고객"). 그래서
      //     프로젝트를 rename 해도 채팅방은 옛 이름을 계속 보여줬다(사용자 신고 지점).
      //     사용자가 직접 바꾼 제목까지 덮어쓰면 안 되므로 **아직 옛 이름으로 시작하는 제목만** 옮긴다.
      try {
        const convs = await Conversation.findAll({
          where: { project_id: project.id, business_id: project.business_id },
          attributes: ['id', 'title'],
        });
        for (const c of convs) {
          const title = c.title || '';
          if (!title.startsWith(prevName)) continue;   // 사용자가 직접 지은 이름 — 손대지 않는다
          const nextTitle = patch.name + title.slice(prevName.length);
          if (nextTitle !== title) await c.update({ title: nextTitle });
        }
      } catch (e) { console.error('[projects] conversation title sync failed:', e.message); }

      // (2) 외부 클라우드 폴더 이름
      const { BusinessCloudToken } = require('../models');
      if (project.gdrive_folder_id) {
        try {
          const gdrive = require('../services/gdrive');
          const t = await BusinessCloudToken.findOne({ where: { business_id: project.business_id, provider: 'gdrive' } });
          if (t) await gdrive.renameFile(await gdrive.getDriveClient(t), project.gdrive_folder_id, patch.name);
        } catch (e) { console.error('[projects] gdrive rename failed:', e.message); }
      }
    }
    // 'active'로 복구 시 대화는 수동 복구 (의도치 않은 복원 방지)
    const detail = await loadProjectDetail(project.id);
    // N+93 — 프로젝트 변경(특히 이름) 실시간 반영 (§16). Q Task 등 프로젝트명 live-join 페이지가
    // 옛 이름 유지하던 회귀 fix. business + project room 에 broadcast → 리스너가 reload.
    try {
      const io = req.app.get('io');
      if (io) {
        const payload = { id: project.id, name: project.name, business_id: project.business_id };
        io.to(`business:${project.business_id}`).emit('project:updated', payload);
        io.to(`project:${project.id}`).emit('project:updated', payload);
        io.to(`business:${project.business_id}`).emit('inbox:refresh', { reason: 'project_updated', project_id: project.id });
        // 대화방 제목이 프로젝트명에서 파생되므로 rename 은 채팅 목록도 갱신해야 한다 (#150)
        if (patch.name && patch.name !== prevName) {
          io.to(`business:${project.business_id}`).emit('conversation:updated', { project_id: project.id, business_id: project.business_id });
        }
      }
    } catch (e) { console.warn('[projects] broadcast failed', e.message); }
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
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    if (!isPlatformAdmin && role !== 'owner') return errorResponse(res, 'owner_only', 403);
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
    // 권한: owner/platform_admin 만. 멤버 구성 변경은 인사/조직 관리 영역.
    // PERMISSION_MATRIX.md §5.5 — "프로젝트 멤버 추가·제거".
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    if (!isPlatformAdmin && role !== 'owner') {
      await t.rollback();
      return errorResponse(res, '프로젝트 멤버 관리는 워크스페이스 오너만 가능합니다', 403);
    }

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
      rows.push({
        project_id: project.id,
        user_id: m.user_id,
        role: m.role || '기타',
        role_order: 0,
        // PM 플래그 — 클라이언트 입력 반영 + 프로젝트 owner 는 강제 PM (PERMISSION_MATRIX §3)
        is_pm: m.user_id === project.owner_user_id ? true : !!m.is_pm,
      });
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
    const where = { project_id: project.id, archived_at: null };
    if (role === 'client') where.channel_type = 'customer';
    const convs = await Conversation.findAll({
      where,
      order: [['channel_type', 'DESC'], ['id', 'ASC']], // customer 먼저
    });
    return successResponse(res, convs.map((c) => c.toJSON()));
  } catch (err) { next(err); }
});

// ============================================
// ============================================
// POST /api/projects/conversations/:id/unlink — 프로젝트 ↔ 채팅방 연결 끊기
// 채팅방은 project_id=null 로 변경 → 워크스페이스 standalone 채팅으로 전환.
// 메시지/참가자 보존. 권한: 프로젝트 owner/admin (client 제외).
// ============================================
router.post('/conversations/:id/unlink', authenticateToken, async (req, res, next) => {
  try {
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    if (!conv.project_id) return errorResponse(res, 'already_standalone', 400);
    const { role, error } = await loadProjectOrForbidden(conv.project_id, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    // owner / admin / member 가능. client 는 차단 (자기 연결 끊기 위험).
    if (role === 'client') return errorResponse(res, 'forbidden', 403);

    const prevProjectId = conv.project_id;
    await conv.update({ project_id: null });
    require('../services/auditService').logAudit(req, {
      action: 'conversation.unlink_project',
      targetType: 'conversation',
      targetId: conv.id,
      oldValue: { project_id: prevProjectId },
      newValue: { project_id: null },
    });
    return successResponse(res, conv.toJSON());
  } catch (err) { next(err); }
});

// PATCH /api/projects/conversations/:id — 채널 설정 변경
// 바디: { display_name?, auto_extract_enabled?, translation_enabled?, translation_languages? }
// translation_enabled true 시 translation_languages (정확히 2-원소, 서로 다른 언어) 필수.
// ============================================
router.patch('/conversations/:id', authenticateToken, async (req, res, next) => {
  try {
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    // 프로젝트 conv 면 프로젝트 권한, standalone 이면 워크스페이스 멤버 권한
    if (conv.project_id) {
      const { role, error } = await loadProjectOrForbidden(conv.project_id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);
    } else {
      const { error } = await loadStandaloneConvOrForbidden(conv.id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
    }

    const { display_name, auto_extract_enabled, translation_enabled, translation_languages } = req.body || {};
    const patch = {};
    if (typeof display_name === 'string' && display_name.trim()) {
      patch.display_name = display_name.trim();
    }
    if (typeof auto_extract_enabled === 'boolean') {
      patch.auto_extract_enabled = auto_extract_enabled;
    }
    if (translation_enabled !== undefined || translation_languages !== undefined) {
      const { validateLanguages } = require('../services/translation_service');
      const nextEnabled = typeof translation_enabled === 'boolean' ? translation_enabled : conv.translation_enabled;
      const nextLangs = translation_languages !== undefined ? translation_languages : conv.translation_languages;
      if (nextEnabled) {
        const v = validateLanguages(nextLangs);
        if (!v.ok) return errorResponse(res, `translation_languages_${v.reason}`, 400);
        patch.translation_enabled = true;
        patch.translation_languages = v.normalized;
      } else {
        // OFF — languages 는 유지 또는 null (사용자 의도 존중, 마지막 선택 기억)
        patch.translation_enabled = false;
        if (translation_languages !== undefined) {
          if (translation_languages === null) patch.translation_languages = null;
          else {
            const v = validateLanguages(translation_languages);
            if (!v.ok) return errorResponse(res, `translation_languages_${v.reason}`, 400);
            patch.translation_languages = v.normalized;
          }
        }
      }
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
    // content 빈 값 허용 — 이미지/파일만 첨부한 메시지 (post-link 형태) 가능.
    // 단, content 와 첨부가 모두 비어 있으면 useless 이지만 그건 클라이언트 책임.
    const cleaned = content ? String(content).trim() : '';

    const msg = await Message.create({
      conversation_id: conv.id,
      sender_id: req.user.id,
      content: cleaned,
      kind: kind || 'text',
      is_ai: false,
      is_internal: false,
      reply_to_message_id: reply_to_message_id || null,
    });
    // last_message_at 업데이트
    await conv.update({ last_message_at: new Date() });

    // 응답에 sender 포함
    const full = await Message.findByPk(msg.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized'] }],
    });
    const fullJson = full.toJSON();
    await applyMemberDisplayNameOne(fullJson, conv.business_id, ['sender']);

    // Socket.IO broadcast — 메시지 즉시 발송 (번역 기다리지 않음)
    // N+71 fix — conv room + business room 둘 다 emit (Q Talk 리스트 실시간 갱신 회귀 fix)
    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${conv.id}`).emit('message:new', fullJson);
      io.to(`business:${conv.business_id}`).emit('message:new', fullJson);
    }

    // ──────────────────────────────────────────────────────────────
    // 알림 fan-out — 멘션(eventKind='mention') + 일반 새 메시지(eventKind='message')
    // ──────────────────────────────────────────────────────────────
    // CLAUDE.md §13 박제: 새 메시지/status 전이 라우트는 notify 호출 강제.
    // 사이클 N+13 회귀 fix — qtalk.ts sendMessage 가 이 라우트로 발송하는데
    // notify 누락 상태였음. 채팅 push 가 절대 안 가던 근본 원인.
    //
    // 보내는 사람(sender)은 제외, channel_type='customer' 가 아니면 client 도 제외.
    // mention 된 user 는 'mention' 으로만 발송(중복 방지).
    try {
      const { resolveMentions } = require('../services/mention_parser');
      const { notifyMany } = require('./notifications');
      const biz = await Business.findByPk(conv.business_id, { attributes: ['name', 'brand_name'] });
      const wsName = biz?.brand_name || biz?.name || null;
      const previewBody = cleaned.length > 140 ? cleaned.slice(0, 140) + '…' : cleaned;
      const link = `${process.env.APP_URL || 'https://dev.planq.kr'}/talk?conv=${conv.id}`;
      // #132 — 알림 표시명은 워크스페이스 표시명 우선(계정명 노출 금지).
      const senderUser = await User.findByPk(req.user.id, { attributes: ['name'] });
      const { getMemberDisplayName } = require('../services/displayName');
      const senderDisp = await getMemberDisplayName(conv.business_id, req.user.id, senderUser?.name);
      const senderName = senderDisp.name || 'PlanQ';
      const convTitle = conv.title || conv.display_name || '대화';

      const mentioned = cleaned ? await resolveMentions(cleaned, conv.business_id, req.user.id) : [];

      // 참여자: sender 제외. client 는 채널이 customer 일 때만 (internal 채널은 client 비참여)
      const participants = await ConversationParticipant.findAll({
        where: { conversation_id: conv.id, user_id: { [Op.ne]: req.user.id } },
        attributes: ['user_id', 'role'],
      });
      let recipientIds = participants.map((p) => p.user_id);
      if (conv.channel_type !== 'customer') {
        const clientParts = participants.filter((p) => p.role === 'client').map((p) => p.user_id);
        recipientIds = recipientIds.filter((id) => !clientParts.includes(id));
      }
      const mentionedSet = new Set(mentioned);
      const plainRecipients = recipientIds.filter((id) => !mentionedSet.has(id));

      if (mentioned.length > 0) {
        notifyMany({
          userIds: mentioned, businessId: conv.business_id, eventKind: 'mention',
          title: `${senderName} 님이 ${convTitle} 에서 언급`,
          body: previewBody, link, ctaLabel: '대화 보기', workspaceName: wsName,
          tag: `conv:${conv.id}`,
          // N+93 — entity 전달: 토스터 활성방 스킵 (#8a)
          entityType: 'conversation', entityId: conv.id,
        }).catch((e) => console.warn('[notify mention]', e.message));
      }
      if (plainRecipients.length > 0) {
        notifyMany({
          userIds: plainRecipients, businessId: conv.business_id, eventKind: 'message',
          title: `${senderName} · ${convTitle}`,
          body: previewBody, link, ctaLabel: '대화 보기', workspaceName: wsName,
          tag: `conv:${conv.id}`,
          entityType: 'conversation', entityId: conv.id,
        }).catch((e) => console.warn('[notify message]', e.message));
      }
    } catch (e) { console.warn('[notify message outer]', e.message); }

    // 비동기 번역 — 메시지 발송 응답 후 백그라운드에서 LLM 호출 + DB 업데이트 + Socket.IO push
    if (conv.translation_enabled && Array.isArray(conv.translation_languages) && (kind || 'text') === 'text') {
      setImmediate(async () => {
        try {
          const { translateWithRetry } = require('../services/translation_service');
          const tr = await translateWithRetry(cleaned, conv.translation_languages, conv.business_id);
          console.log(`[translation] msg=${msg.id} fallback=${tr.fallback} reason=${tr.reason || '-'} hasTr=${!!tr.translations}`);
          if (!tr.fallback && tr.translations) {
            await msg.update({ translations: tr.translations, detected_language: tr.detected_language });
            if (io) {
              const payload = {
                id: msg.id,
                conversation_id: conv.id,
                translations: tr.translations,
                detected_language: tr.detected_language,
              };
              io.to(`conv:${conv.id}`).emit('message:translated', payload);
              // fallback: 전체 메시지 객체로 message:updated 도 emit (기존 핸들러 활용)
              const updated = await Message.findByPk(msg.id, {
                include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized'] }],
              });
              if (updated) io.to(`conv:${conv.id}`).emit('message:updated', updated.toJSON());
              console.log(`[translation] emitted message:translated + message:updated to conv:${conv.id}`);
            }
          }
        } catch (e) { console.warn('[message translation]', e.message, e.stack); }
      });
    }

    // Cue 자동 응답 트리거 — customer 채널 + 비 AI + **고객(외부) 발화일 때만**.
    // Cue 는 고객 대응 팀원 → 내부 스태프(owner/admin/member) 발화엔 끼어들지 않는다.
    // 내부 스태프는 business_members 에 있고(owner 포함), 고객(Client)은 없으므로 멤버 여부로 판별.
    // (Client.user_id 링크 유무와 무관하게 견고. Cue 자신은 !is_ai 로 이미 제외.)
    if (conv.channel_type === 'customer' && !fullJson.is_ai) {
      setImmediate(async () => {
        try {
          const senderIsStaff = await BusinessMember.findOne({
            where: { business_id: conv.business_id, user_id: fullJson.sender_id },
            attributes: ['id'],
          });
          if (senderIsStaff) return; // 내부 스태프 발화 → Cue 응답 안 함
          const cueClient = conv.client_id
            ? await Client.findByPk(conv.client_id, { attributes: ['id', 'user_id', 'business_id'] })
            : null;
          const business = await Business.findByPk(conv.business_id);
          if (!business || !business.cue_user_id) return;
          const cueResult = await cueOrchestrator.respondToMessage({
            message: fullJson,
            conversation: conv,
            business,
            client: cueClient,
          });
          if (!cueResult.skipped && cueResult.message) {
            // Cue 응답 메시지에 sender 포함하여 브로드캐스트
            const cueMsg = await Message.findByPk(cueResult.message.id, {
              include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized'] }],
            });
            if (io && cueMsg) {
              const payload = cueMsg.toJSON();
              await applyMemberDisplayNameOne(payload, conv.business_id, ['sender']);
              payload.ai_mode_used = cueResult.mode; // draft / auto
              io.to(`conv:${conv.id}`).emit('message:new', payload);
            }
          }
        } catch (err) {
          console.warn('[cue trigger]', err.message);
        }
      });
    }

    // 사이클 N+27 — 자동 업무 추출 디바운스 트리거 (auto_extract_enabled 대화만)
    // in-memory timer 가 60초 무활동 또는 5+ 메시지 누적 시 LLM 호출
    if (conv.auto_extract_enabled && !fullJson.is_ai && (kind || 'text') === 'text') {
      try {
        const { scheduleExtract } = require('../services/taskExtractorScheduler');
        scheduleExtract(conv.id);
      } catch (e) { console.warn('[auto extract schedule]', e.message); }
    }

    return successResponse(res, fullJson);
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
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized'] }],
    });
    const fullJson = full.toJSON();
    await applyMemberDisplayNameOne(fullJson, conv?.business_id, ['sender']);

    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${msg.conversation_id}`).emit('message:updated', fullJson);
    }

    return successResponse(res, fullJson);
  } catch (err) { next(err); }
});

// ============================================
// POST /api/projects/messages/:id/cue-rating — Cue 답변 평가 (사이클 N+27 Phase 5-4)
// body: { rating: 1 | -1 | 0 } (1=up, -1=down, 0=취소)
// ============================================
router.post('/messages/:id/cue-rating', authenticateToken, async (req, res, next) => {
  try {
    const msg = await Message.findByPk(req.params.id);
    if (!msg) return errorResponse(res, 'message_not_found', 404);
    if (!msg.is_ai) return errorResponse(res, 'not_ai_message', 400);
    const conv = await Conversation.findByPk(msg.conversation_id);
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);
    // 워크스페이스 멤버 (owner/admin/member) 또는 conversation participant 만 평가 가능
    const { BusinessMember, ConversationParticipant } = require('../models');
    const member = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: conv.business_id } });
    if (!member) {
      const participant = await ConversationParticipant.findOne({ where: { user_id: req.user.id, conversation_id: conv.id } });
      if (!participant) return errorResponse(res, 'forbidden', 403);
    }
    const { rating } = req.body || {};
    if (![1, -1, 0].includes(rating)) return errorResponse(res, 'invalid_rating', 400);
    await msg.update({
      cue_rating: rating === 0 ? null : rating,
      cue_rating_at: rating === 0 ? null : new Date(),
      cue_rating_by_user_id: rating === 0 ? null : req.user.id,
    });
    // Socket.IO broadcast — 같은 conv 의 다른 사용자도 즉시 갱신
    const io = req.app.get('io');
    if (io) {
      io.to(`conv:${conv.id}`).emit('message:updated', (await msg.reload()).toJSON());
    }
    return successResponse(res, { id: msg.id, cue_rating: msg.cue_rating });
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
    } else {
      // 독립 대화(standalone, project_id 없음) — 접근 검사 (cross-tenant/IDOR 차단).
      //   워크스페이스 멤버 이상 또는 참여 client 만. 옛 코드는 standalone 에 검사 없어 conv id 열거로
      //   타 워크스페이스 메시지 조회 가능했던 갭. (검증 사이클 발견 fix)
      const { canAccessConversation } = require('../middleware/access_scope');
      if (!(await canAccessConversation(req.user.id, conv))) {
        return errorResponse(res, 'forbidden', 403);
      }
    }
    const { MessageAttachment, ConversationParticipant } = require('../models');
    // 페이지네이션 — 최신 N개를 우선 로드 (옛 'ASC limit 200' 은 긴 대화에서 '오래된 200개' 만 보이는 버그).
    //   ?limit=N (default 50, max 200) · ?before=<messageId> → 그 메시지보다 오래된 N개 (무한 스크롤 업).
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const beforeId = Number(req.query.before) || null;
    const msgWhere = { conversation_id: conv.id, is_deleted: false };
    if (beforeId) msgWhere.id = { [Op.lt]: beforeId };
    const [msgsDesc, parts] = await Promise.all([
      Message.findAll({
        where: msgWhere,
        include: [
          { model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized'] },
          // 첨부 — 페이지 새로고침/재진입 시 채팅 이미지·파일이 사라지지 않도록 필수.
          // association alias 'attachments' (models/index.js:119)
          { model: MessageAttachment, as: 'attachments', attributes: ['id', 'file_name', 'file_size', 'mime_type', 'file_id'], required: false },
          // #138 — 리액션 동봉 (conversations.js 와 동일)
          { model: require('../models').MessageReaction, as: 'reactions', attributes: ['id', 'user_id', 'emoji'], required: false },
        ],
        order: [['id', 'DESC']],   // 최신 우선
        limit: limit + 1,          // +1 로 has_more 판별
      }),
      ConversationParticipant.findAll({
        where: { conversation_id: conv.id },
        attributes: ['user_id', 'last_read_at'],
      }),
    ]);
    const hasMore = msgsDesc.length > limit;
    const msgs = msgsDesc.slice(0, limit).reverse(); // 화면 표시용 시간순(ASC) 복원
    // 사이클 N+15-C — 메시지마다 read_by_count + other_count 부착.
    // read_by_count: sender 외 참여자 중 last_read_at >= m.created_at 인 수.
    // other_count: sender 외 참여자 총수 (1:1 ↔ 그룹 판별용).
    const result = msgs.map((m) => {
      const json = m.toJSON();
      const createdMs = new Date(m.created_at).getTime();
      let readBy = 0;
      let others = 0;
      for (const p of parts) {
        if (p.user_id === m.sender_id) continue;
        others += 1;
        if (p.last_read_at && new Date(p.last_read_at).getTime() >= createdMs) readBy += 1;
      }
      json.read_by_count = readBy;
      json.other_count = others;
      return json;
    });
    await applyMemberDisplayName(result, conv.business_id, ['sender']);
    // data 는 기존과 동일하게 메시지 배열 (호출처 무변경). has_more 만 추가 (무한 스크롤 업 판별용).
    return res.json({ success: true, data: result, has_more: hasMore });
  } catch (err) { next(err); }
});

// ============================================
// GET /api/projects/:id/tasks — 프로젝트 업무
// ============================================
// ============================================
// GET /api/projects/:id/transactions — 거래 통합 뷰 (Phase D3 → D+1 확장)
// 계약/견적/SOW posts + invoices + installments + signature 진행 상태 + stages + next_action
// ============================================
// ============================================
// GET /api/projects/:id/stages — 거래 시퀀스 stage 목록 (Phase D+1)
// POST/PUT/DELETE 는 사용자 정의 stage 관리용
// ============================================
router.get('/:id/stages', authenticateToken, async (req, res, next) => {
  try {
    const { project, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const { ProjectStage } = require('../models');
    const { progressProject } = require('../services/projectStageEngine');
    await progressProject(project.id).catch(() => null);
    const stages = await ProjectStage.findAll({
      where: { project_id: project.id },
      order: [['order_index', 'ASC']],
    });
    return successResponse(res, stages);
  } catch (err) { next(err); }
});

router.post('/:id/stages/init', authenticateToken, async (req, res, next) => {
  // template 재시드 (이미 stage 있으면 no-op)
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const { seedStages, STAGE_TEMPLATE_KEYS, progressProject } = require('../services/projectStageEngine');
    const tplKey = STAGE_TEMPLATE_KEYS.includes(req.body?.template) ? req.body.template : 'fixed';
    await seedStages(project.id, tplKey);
    progressProject(project.id).catch(() => null);
    const { ProjectStage } = require('../models');
    const stages = await ProjectStage.findAll({ where: { project_id: project.id }, order: [['order_index', 'ASC']] });
    return successResponse(res, stages);
  } catch (err) { next(err); }
});

router.post('/:id/stages', authenticateToken, async (req, res, next) => {
  // 사용자 정의 stage 추가
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const { ProjectStage } = require('../models');
    const { kind = 'custom', label, order_index, metadata = null, expected_due_date = null } = req.body || {};
    if (!label?.trim()) return errorResponse(res, 'label required', 400);
    const max = await ProjectStage.max('order_index', { where: { project_id: project.id } });
    const nextOrder = order_index || (Number(max || 0) + 1);
    const stage = await ProjectStage.create({
      project_id: project.id,
      order_index: nextOrder,
      kind: ['quote','proposal','contract','invoice','tax_invoice','custom'].includes(kind) ? kind : 'custom',
      label: String(label).slice(0, 80),
      status: 'pending',
      metadata,
      expected_due_date,
      is_template_seeded: false,
    });
    return successResponse(res, stage, 'Stage added', 201);
  } catch (err) { next(err); }
});

router.put('/:id/stages/:stageId', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const { ProjectStage } = require('../models');
    const stage = await ProjectStage.findOne({ where: { id: req.params.stageId, project_id: project.id } });
    if (!stage) return errorResponse(res, 'stage_not_found', 404);
    const patch = {};
    if (req.body?.label !== undefined) patch.label = String(req.body.label).slice(0, 80);
    if (req.body?.order_index !== undefined) patch.order_index = Number(req.body.order_index);
    if (req.body?.expected_due_date !== undefined) patch.expected_due_date = req.body.expected_due_date || null;
    if (req.body?.status !== undefined && ['pending','active','completed','skipped'].includes(req.body.status)) {
      patch.status = req.body.status;
      if (req.body.status === 'completed') patch.completed_at = new Date();
      // ① 수동 설정 — 자동 엔진이 덮어쓰지 않도록 lock (외부 체결 계약 등 PlanQ 밖 진행 케이스).
      //   pending 으로 되돌리면 lock 해제 → 자동 진행 재개.
      const meta = { ...(stage.metadata || {}) };
      if (req.body.status === 'pending') delete meta.manual_locked;
      else meta.manual_locked = true;
      patch.metadata = meta;
    }
    await stage.update(patch);
    return successResponse(res, stage);
  } catch (err) { next(err); }
});

// 인접 stage 와 순서 swap (↑/↓ 버튼)
// body: { direction: 'up' | 'down' }
router.post('/:id/stages/:stageId/move', authenticateToken, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) { await t.rollback(); return errorResponse(res, error.message, error.code); }
    if (role === 'client') { await t.rollback(); return errorResponse(res, 'forbidden', 403); }

    const direction = req.body?.direction;
    if (direction !== 'up' && direction !== 'down') {
      await t.rollback(); return errorResponse(res, 'invalid_direction', 400);
    }
    const { ProjectStage } = require('../models');
    const stage = await ProjectStage.findOne({
      where: { id: req.params.stageId, project_id: project.id }, transaction: t,
    });
    if (!stage) { await t.rollback(); return errorResponse(res, 'stage_not_found', 404); }

    const all = await ProjectStage.findAll({
      where: { project_id: project.id },
      order: [['order_index', 'ASC']], transaction: t,
    });
    const idx = all.findIndex(s => s.id === stage.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= all.length) {
      await t.rollback(); return errorResponse(res, 'cannot_move', 400);
    }
    const other = all[swapIdx];
    const a = stage.order_index;
    const b = other.order_index;
    // 동일 order_index 인 경우 (방어적): a 앞쪽으로 강제 분리
    if (a === b) {
      await stage.update({ order_index: direction === 'up' ? a - 1 : a + 1 }, { transaction: t });
    } else {
      await stage.update({ order_index: b }, { transaction: t });
      await other.update({ order_index: a }, { transaction: t });
    }
    await t.commit();
    const refreshed = await ProjectStage.findAll({
      where: { project_id: project.id },
      order: [['order_index', 'ASC']],
    });
    return successResponse(res, refreshed);
  } catch (err) { try { await t.rollback(); } catch {} next(err); }
});

router.delete('/:id/stages/:stageId', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const { ProjectStage } = require('../models');
    const stage = await ProjectStage.findOne({ where: { id: req.params.stageId, project_id: project.id } });
    if (!stage) return errorResponse(res, 'stage_not_found', 404);
    if (stage.is_template_seeded) return errorResponse(res, 'cannot_delete_template_stage', 400);
    await stage.destroy();
    return successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

// ============================================================
// D3 #65 프로젝트 캔버스 — 전략 프레임 + 워크스트림 + 집계
// 멤버 전용 (role==='client' 차단 — 전략은 내부 데이터)
// ============================================================

// 워크스트림 직렬화 + 업무 rollup
function serializeWorkstream(ws, tasks) {
  const mine = tasks.filter((t) => t.workstream_id === ws.id);
  const total = mine.length;
  const completed = mine.filter((t) => t.status === 'completed').length;
  const inProgress = mine.filter((t) => t.status === 'in_progress').length;
  const today = todayInTz('Asia/Seoul');
  const overdue = mine.filter((t) =>
    t.due_date && String(t.due_date).slice(0, 10) < today &&
    t.status !== 'completed' && t.status !== 'canceled').length;
  const progressPct = total > 0
    ? Math.round(mine.reduce((s, t) => s + (Number(t.progress_percent) || 0), 0) / total)
    : 0;
  return {
    id: ws.id, title: ws.title, description: ws.description,
    order_index: ws.order_index, color: ws.color, status: ws.status,
    source: ws.source || 'manual', // ⑤ 자동/수동 인지
    rollup: { total, completed, in_progress: inProgress, overdue, progress_pct: progressPct },
  };
}

// 캔버스 mutation 후 실시간 broadcast (canvas 페이지가 project:updated listen)
function broadcastCanvas(req, project, reason) {
  const io = req.app.get('io');
  if (!io) return;
  const payload = { id: project.id, business_id: project.business_id, actor_user_id: req.user.id };
  io.to(`business:${project.business_id}`).emit('project:updated', payload);
  io.to(`project:${project.id}`).emit('project:updated', payload);
  io.to(`business:${project.business_id}`).emit('inbox:refresh', { reason, project_id: project.id });
}

// GET /:id/canvas — 캔버스 집계 (1콜)
router.get('/:id/canvas', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const bizId = project.business_id;

    // 워크스트림 + 프로젝트 전체 task (rollup 용)
    const [workstreams, allTasks] = await Promise.all([
      ProjectWorkstream.findAll({ where: { project_id: project.id }, order: [['order_index', 'ASC'], ['id', 'ASC']] }),
      Task.findAll({
        where: { project_id: project.id },
        attributes: ['id', 'title', 'status', 'due_date', 'progress_percent', 'assignee_id', 'workstream_id', 'planned_week_start'],
        include: [{ model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false }],
      }),
    ]);
    const tasksPlain = allTasks.map((t) => t.toJSON());
    await applyMemberDisplayName(tasksPlain, bizId, ['assignee']);

    // 금주/차주 포커스 (planned_week_start 기준)
    const today = todayInTz('Asia/Seoul');
    const weekStart = mondayOfDateStr(today);
    const nextWeekStart = addDaysStr(weekStart, 7);
    const briefOf = (t) => ({
      id: t.id, title: t.title, status: t.status, due_date: t.due_date,
      progress_percent: t.progress_percent, assignee_id: t.assignee_id,
      assignee_name: t.assignee?.name || null, workstream_id: t.workstream_id,
    });
    const weekOf = (mon) => tasksPlain
      .filter((t) => t.planned_week_start && String(t.planned_week_start).slice(0, 10) === mon && t.status !== 'canceled')
      .map(briefOf);

    // 산출물 (published Post + Document, 최신순 cap 30)
    const [posts, documents] = await Promise.all([
      Post.findAll({
        where: { project_id: project.id, status: 'published' },
        attributes: ['id', 'title', 'category', 'status', 'created_at', 'share_token'],
        order: [['created_at', 'DESC']], limit: 30,
      }),
      Document.findAll({
        where: { project_id: project.id },
        attributes: ['id', 'title', 'kind', 'status', 'created_at'],
        order: [['created_at', 'DESC']], limit: 30,
      }),
    ]);
    const deliverables = [
      ...posts.map((p) => ({ kind: 'post', id: p.id, title: p.title, category: p.category, status: p.status, created_at: p.created_at, link: `/projects/p/${project.id}?tab=docs&post=${p.id}` })),
      ...documents.map((d) => ({ kind: 'document', id: d.id, title: d.title, category: d.kind, status: d.status, created_at: d.created_at, link: `/documents/${d.id}` })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 30);

    // 이해관계자 (프로젝트 멤버 + 부서/팀 · 프로젝트 client + kind)
    const [pms, pcs, risks] = await Promise.all([
      ProjectMember.findAll({ where: { project_id: project.id }, include: [{ model: User, attributes: ['id', 'name', 'name_localized'], required: false }] }),
      ProjectClient.findAll({ where: { project_id: project.id }, include: [{ model: Client, attributes: ['id', 'display_name', 'company_name', 'kind'], required: false }] }),
      ProjectIssue.findAll({ where: { project_id: project.id }, attributes: ['id', 'body', 'created_at'], order: [['created_at', 'DESC']], limit: 8 }),
    ]);
    // 멤버 부서/팀 이름 매핑
    const memberUserIds = pms.map((pm) => pm.user_id).filter(Boolean);
    const bms = memberUserIds.length ? await BusinessMember.findAll({
      where: { business_id: bizId, user_id: { [Op.in]: memberUserIds } },
      include: [{ model: Department, as: 'department', attributes: ['id', 'name'], required: false }, { model: Team, as: 'team', attributes: ['id', 'name'], required: false }],
    }) : [];
    const bmByUser = new Map(bms.map((b) => [b.user_id, b]));
    const members = pms.map((pm) => {
      const bm = bmByUser.get(pm.user_id);
      return {
        user_id: pm.user_id,
        // #87 — 워크스페이스 표시명(BusinessMember.name) 우선. 없을 때만 계정명 fallback.
        name: bm?.name_localized?.ko || bm?.name || pm.User?.name_localized?.ko || pm.User?.name || `user ${pm.user_id}`,
        role: pm.role,
        is_pm: !!pm.is_pm, // PM 배지 — 정식 project_members.is_pm (옛 default_assignee 임시 프록시 대체)
        dept: bm?.department?.name || null,
        team: bm?.team?.name || null,
      };
    });
    const clients = pcs.filter((pc) => pc.Client).map((pc) => ({
      id: pc.Client.id, name: pc.Client.display_name || pc.Client.company_name || pc.contact_name || '파트너', kind: pc.Client.kind || 'customer',
    }));

    // 업무연계도 — 이 프로젝트 task 간 task_links (양방향)
    const taskIds = tasksPlain.map((t) => t.id);
    const links = taskIds.length ? await TaskLink.findAll({
      where: { task_a_id: { [Op.in]: taskIds }, task_b_id: { [Op.in]: taskIds } },
      attributes: ['task_a_id', 'task_b_id'],
    }) : [];

    return successResponse(res, {
      project: {
        id: project.id, name: project.name, status: project.status,
        start_date: project.start_date, end_date: project.end_date,
        color: project.color, description: project.description, owner_user_id: project.owner_user_id,
      },
      strategy: {
        context: project.strategy_context, key_question: project.strategy_key_question,
        goal: project.strategy_goal, governing_thought: project.strategy_governing_thought,
        approach: project.strategy_approach,
      },
      // ⑤ 자동/수동 인지 — 전략 필드별 출처(ai/manual). null 은 전부 manual(옛/수동).
      strategy_sources: (project.strategy_sources && typeof project.strategy_sources === 'object') ? project.strategy_sources : {},
      success_metrics: Array.isArray(project.success_metrics) ? project.success_metrics : [],
      workstreams: workstreams.map((ws) => serializeWorkstream(ws, tasksPlain)),
      tasks: tasksPlain.map((t) => ({ id: t.id, title: t.title, status: t.status, workstream_id: t.workstream_id, assignee_name: t.assignee?.name || null })),
      task_links: links.map((l) => ({ a: l.task_a_id, b: l.task_b_id })),
      week_focus: { week_start: weekStart, next_week_start: nextWeekStart, this_week: weekOf(weekStart), next_week: weekOf(nextWeekStart) },
      deliverables,
      stakeholders: { members, clients },
      risks: risks.map((r) => ({ id: r.id, body: r.body, created_at: r.created_at })),
    });
  } catch (err) { next(err); }
});

// PATCH /:id/strategy — 전략 5필드 부분 갱신 (AutoSave)
router.patch('/:id/strategy', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const ALLOWED = ['context', 'key_question', 'goal', 'governing_thought', 'approach'];
    const updates = {};
    const editedFields = [];
    for (const k of ALLOWED) {
      if (k in (req.body || {})) { updates[`strategy_${k}`] = req.body[k] == null ? null : String(req.body[k]); editedFields.push(k); }
    }
    if (Object.keys(updates).length === 0) return errorResponse(res, 'no_fields', 400);
    // ⑤ — 사용자가 손댄 필드는 출처를 'manual' 로 flip (AI 초안이 사용자 편집분으로 전환).
    if (editedFields.length) {
      const src = (project.strategy_sources && typeof project.strategy_sources === 'object') ? { ...project.strategy_sources } : {};
      for (const k of editedFields) src[k] = 'manual';
      updates.strategy_sources = src;
    }
    await project.update(updates);
    broadcastCanvas(req, project, 'strategy_updated');
    return successResponse(res, {
      context: project.strategy_context, key_question: project.strategy_key_question,
      goal: project.strategy_goal, governing_thought: project.strategy_governing_thought,
      approach: project.strategy_approach,
    });
  } catch (err) { next(err); }
});

// PUT /:id/success-metrics — 성공 지표 리스트 전체 교체
router.put('/:id/success-metrics', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const raw = Array.isArray(req.body?.metrics) ? req.body.metrics : null;
    if (!raw) return errorResponse(res, 'metrics_array_required', 400);
    if (raw.length > 10) return errorResponse(res, 'too_many_metrics', 400);
    const metrics = [];
    for (let i = 0; i < raw.length; i++) {
      const m = raw[i] || {};
      if (!m.label || !String(m.label).trim()) return errorResponse(res, 'metric_label_required', 400);
      metrics.push({
        id: m.id || `m_${Date.now()}_${i}`,
        label: String(m.label).trim().slice(0, 120),
        target: m.target != null ? String(m.target).slice(0, 60) : '',
        current: m.current != null ? String(m.current).slice(0, 60) : '',
        unit: m.unit != null ? String(m.unit).slice(0, 20) : '',
      });
    }
    await project.update({ success_metrics: metrics });
    broadcastCanvas(req, project, 'metrics_updated');
    return successResponse(res, metrics);
  } catch (err) { next(err); }
});

// POST /:id/canvas/ai-draft — ⑤ AI 캔버스 초안 생성 (전략·지표·추진과제 비파괴 채움 + source='ai')
//   비어있는 필드만 AI로 채운다 — 사용자 수동 입력은 절대 덮어쓰지 않음. 채운 필드는 source='ai'(수정하면 flip).
{
  const { perUserDaily } = require('../middleware/costGuard');
  const canvasAiGuards = perUserDaily('canvas_draft', { perMin: 3, perDay: 30 });
  router.post('/:id/canvas/ai-draft', authenticateToken, ...canvasAiGuards, async (req, res, next) => {
    try {
      const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'member_only', 403);
      const businessId = project.business_id;

      // plan 게이트 — LLM 비용 (운영 안정성 1번: rate-limit + plan.can + 입력 캡)
      const planEngine = require('../services/plan');
      const can = await planEngine.can(businessId, 'use_cue');
      if (!can.ok) return res.status(422).json(planEngine.buildQuotaError(can, businessId));

      // 컨텍스트 — 고객명 + 관련 업무 제목
      let clientName = null;
      try {
        const pc = await ProjectClient.findOne({ where: { project_id: project.id }, include: [{ model: Client, attributes: ['display_name', 'company_name'], required: false }] });
        clientName = pc?.Client?.display_name || pc?.Client?.company_name || null;
      } catch { /* optional */ }
      const relTasks = await Task.findAll({ where: { project_id: project.id }, attributes: ['title'], limit: 20, order: [['created_at', 'DESC']] });
      const taskTitles = relTasks.map((t) => t.title).filter(Boolean);

      const { generateCanvasDraft } = require('../services/canvasDraft');
      let draft;
      try {
        draft = await generateCanvasDraft(project, { clientName, taskTitles });
      } catch (e) {
        if (e.message === 'llm_unavailable') return errorResponse(res, 'ai_unavailable', 503);
        return errorResponse(res, 'ai_draft_failed', 502);
      }

      // 비파괴 병합 — 빈 전략 필드만 채우고 source='ai'. 채워진 것은 보존.
      const STRAT = ['context', 'key_question', 'goal', 'governing_thought', 'approach'];
      const updates = {};
      const src = (project.strategy_sources && typeof project.strategy_sources === 'object') ? { ...project.strategy_sources } : {};
      let strategyFilled = 0;
      for (const k of STRAT) {
        const cur = project[`strategy_${k}`];
        if ((cur == null || String(cur).trim() === '') && draft.strategy[k]) {
          updates[`strategy_${k}`] = draft.strategy[k]; src[k] = 'ai'; strategyFilled++;
        }
      }
      const curMetrics = Array.isArray(project.success_metrics) ? project.success_metrics : [];
      let metricsFilled = 0;
      if (curMetrics.length === 0 && draft.metrics.length) {
        updates.success_metrics = draft.metrics.map((m, i) => ({ id: `m_${Date.now()}_${i}`, ...m, source: 'ai' }));
        metricsFilled = updates.success_metrics.length;
      }
      if (Object.keys(updates).length) { updates.strategy_sources = src; await project.update(updates); }

      // 추진과제 — 현재 없을 때만 AI 생성 (source='ai')
      let workstreamsCreated = 0;
      const wsCount = await ProjectWorkstream.count({ where: { project_id: project.id } });
      if (wsCount === 0 && draft.workstreams.length) {
        for (let i = 0; i < draft.workstreams.length; i++) {
          const w = draft.workstreams[i];
          await ProjectWorkstream.create({ business_id: project.business_id, project_id: project.id, title: w.title, description: w.description || null, order_index: i, status: 'active', created_by: req.user.id, source: 'ai' });
          workstreamsCreated++;
        }
      }

      // 사용량 기록 (cue_usage) + 감사
      try {
        const { CueUsage } = require('../models'); const ym = new Date().toISOString().slice(0, 7);
        const inTok = draft.usage?.input_tokens || 0; const outTok = draft.usage?.output_tokens || 0;
        const [row, created] = await CueUsage.findOrCreate({ where: { business_id: businessId, year_month: ym, action_type: 'canvas_draft' }, defaults: { action_count: 1, token_input: inTok, token_output: outTok, cost_usd: 0 } });
        if (!created) await row.update({ action_count: (row.action_count || 0) + 1, token_input: (row.token_input || 0) + inTok, token_output: (row.token_output || 0) + outTok });
      } catch (e) { console.warn('[canvas-draft] usage', e.message); }
      createAuditLog({ userId: req.user.id, businessId, action: 'project.canvas_ai_draft', targetType: 'project', targetId: project.id, newValue: { strategy_filled: strategyFilled, metrics_filled: metricsFilled, workstreams_created: workstreamsCreated } });

      broadcastCanvas(req, project, 'ai_draft');
      return successResponse(res, { strategy_filled: strategyFilled, metrics_filled: metricsFilled, workstreams_created: workstreamsCreated });
    } catch (err) { next(err); }
  });
}

// GET /:id/workstreams — 목록 + rollup
router.get('/:id/workstreams', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const [workstreams, tasks] = await Promise.all([
      ProjectWorkstream.findAll({ where: { project_id: project.id }, order: [['order_index', 'ASC'], ['id', 'ASC']] }),
      Task.findAll({ where: { project_id: project.id }, attributes: ['id', 'status', 'due_date', 'progress_percent', 'workstream_id'] }),
    ]);
    const tp = tasks.map((t) => t.toJSON());
    return successResponse(res, workstreams.map((ws) => serializeWorkstream(ws, tp)));
  } catch (err) { next(err); }
});

// POST /:id/workstreams — 생성
router.post('/:id/workstreams', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const { title, description, color } = req.body || {};
    if (!title || !String(title).trim()) return errorResponse(res, 'title_required', 400);
    const max = await ProjectWorkstream.max('order_index', { where: { project_id: project.id } });
    const ws = await ProjectWorkstream.create({
      business_id: project.business_id, project_id: project.id,
      title: String(title).trim().slice(0, 200),
      description: description ? String(description) : null,
      color: color || null,
      order_index: (Number.isFinite(max) ? max : -1) + 1,
      created_by: req.user.id,
    });
    broadcastCanvas(req, project, 'workstream_new');
    return successResponse(res, serializeWorkstream(ws, []));
  } catch (err) { next(err); }
});

// PATCH /:id/workstreams/:wsId — 수정
router.patch('/:id/workstreams/:wsId', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const ws = await ProjectWorkstream.findOne({ where: { id: req.params.wsId, project_id: project.id } });
    if (!ws) return errorResponse(res, 'workstream_not_found', 404);
    const updates = {};
    if ('title' in req.body) {
      if (!String(req.body.title || '').trim()) return errorResponse(res, 'title_required', 400);
      updates.title = String(req.body.title).trim().slice(0, 200);
    }
    if ('description' in req.body) updates.description = req.body.description ? String(req.body.description) : null;
    if ('color' in req.body) updates.color = req.body.color || null;
    if ('status' in req.body && ['active', 'done', 'dropped'].includes(req.body.status)) updates.status = req.body.status;
    if ('order_index' in req.body && Number.isFinite(Number(req.body.order_index))) updates.order_index = Number(req.body.order_index);
    await ws.update(updates);
    const tasks = await Task.findAll({ where: { project_id: project.id }, attributes: ['id', 'status', 'due_date', 'progress_percent', 'workstream_id'] });
    broadcastCanvas(req, project, 'workstream_updated');
    return successResponse(res, serializeWorkstream(ws, tasks.map((t) => t.toJSON())));
  } catch (err) { next(err); }
});

// DELETE /:id/workstreams/:wsId — 삭제 (task.workstream_id → NULL)
router.delete('/:id/workstreams/:wsId', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const ws = await ProjectWorkstream.findOne({ where: { id: req.params.wsId, project_id: project.id } });
    if (!ws) return errorResponse(res, 'workstream_not_found', 404);
    // 소속 업무는 미분류로 보존 — 영향받은 id 를 먼저 확보해 클라이언트 수렴용 broadcast 준비
    const affected = await Task.findAll({ where: { workstream_id: ws.id }, attributes: ['id'] });
    await Task.update({ workstream_id: null }, { where: { workstream_id: ws.id } });
    await ws.destroy();
    broadcastCanvas(req, project, 'workstream_deleted');
    // §16 — 각 업무 task:updated 로 workstream_id=null 수렴 (전체 reload 없이 미분류 그룹으로 이동).
    //   누락 시 클라이언트 state 의 옛 workstream_id 가 stale → 삭제된 그룹에도 미분류에도 안 잡혀 리스트에서 사라짐.
    const io = req.app.get('io');
    if (io) {
      for (const tk of affected) {
        const payload = { id: tk.id, project_id: project.id, workstream_id: null, actor_user_id: req.user.id };
        io.to(`project:${project.id}`).emit('task:updated', payload);
        io.to(`business:${project.business_id}`).emit('task:updated', payload);
      }
    }
    return successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

// POST /:id/workstreams/reorder — 일괄 정렬
router.post('/:id/workstreams/reorder', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const ids = Array.isArray(req.body?.ordered_ids) ? req.body.ordered_ids.map(Number) : null;
    if (!ids) return errorResponse(res, 'ordered_ids_required', 400);
    // 이 프로젝트 소속 워크스트림만 (cross 차단)
    const owned = await ProjectWorkstream.findAll({ where: { id: { [Op.in]: ids }, project_id: project.id }, attributes: ['id'] });
    const ownedSet = new Set(owned.map((w) => w.id));
    await Promise.all(ids.filter((id) => ownedSet.has(id)).map((id, idx) =>
      ProjectWorkstream.update({ order_index: idx }, { where: { id, project_id: project.id } })));
    broadcastCanvas(req, project, 'workstream_reordered');
    return successResponse(res, { reordered: true });
  } catch (err) { next(err); }
});

// GET /:id/report — #64 프로젝트뷰 (Live 파생 상태 보고서). 멤버 전용.
//   캔버스 직렬화(전략·지표·워크스트림) + fetchProjectStats(health·진행델타) + 금주/차주·이슈·산출물·팀.
router.get('/:id/report', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const bizId = project.business_id;

    const today = todayInTz('Asia/Seoul');
    const weekStart = req.query.week_start && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week_start)
      ? mondayOfDateStr(req.query.week_start) : mondayOfDateStr(today);
    const weekEnd = addDaysStr(weekStart, 6);
    const nextWeekStart = addDaysStr(weekStart, 7);

    // 정규 health·진행델타 (주간보고와 동일 로직)
    const stats = (await fetchProjectStats(bizId, [project.id], weekStart, true))[0] || {
      progress_percent: 0, progress_delta: 0, completed_tasks: 0, total_tasks: 0,
      overdue_count: 0, open_issues: 0, end_date: project.end_date, d_day: null, health: 'yellow',
    };

    // 프로젝트 전체 task (rollup·하이라이트·리스크·금주/차주·팀 파생)
    const allTasks = await Task.findAll({
      where: { project_id: project.id },
      attributes: ['id', 'title', 'status', 'due_date', 'progress_percent', 'assignee_id', 'workstream_id', 'planned_week_start', 'completed_at'],
      include: [{ model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false }],
    });
    const tp = allTasks.map((t) => t.toJSON());
    await applyMemberDisplayName(tp, bizId, ['assignee']);

    const workstreams = await ProjectWorkstream.findAll({ where: { project_id: project.id }, order: [['order_index', 'ASC'], ['id', 'ASC']] });
    const inWeek = (d) => d && String(d).slice(0, 10) >= weekStart && String(d).slice(0, 10) <= weekEnd;
    const briefOf = (t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date, assignee_name: t.assignee?.name || null, workstream_id: t.workstream_id });

    const highlights = tp.filter((t) => t.status === 'completed' && inWeek(t.completed_at)).map(briefOf).slice(0, 12);
    const risks = tp.filter((t) => t.due_date && String(t.due_date).slice(0, 10) < today && t.status !== 'completed' && t.status !== 'canceled').map(briefOf).slice(0, 12);
    const nextWeek = tp.filter((t) => t.planned_week_start && String(t.planned_week_start).slice(0, 10) === nextWeekStart && t.status !== 'canceled').map(briefOf);
    const thisWeekCompleted = highlights.length;

    // 팀 — 프로젝트 멤버별 active/완료 task 수
    const pms = await ProjectMember.findAll({ where: { project_id: project.id }, include: [{ model: User, attributes: ['id', 'name', 'name_localized'], required: false }] });
    const bms = pms.length ? await BusinessMember.findAll({
      where: { business_id: bizId, user_id: { [Op.in]: pms.map((p) => p.user_id).filter(Boolean) } },
      include: [{ model: Department, as: 'department', attributes: ['name'], required: false }],
    }) : [];
    const deptByUser = new Map(bms.map((b) => [b.user_id, b.department?.name || null]));
    const nameByUser = new Map(bms.map((b) => [b.user_id, b.name_localized?.ko || b.name || null]));  // #87 워크스페이스 표시명
    const team = pms.map((pm) => {
      const mine = tp.filter((t) => t.assignee_id === pm.user_id && t.status !== 'canceled');
      return {
        user_id: pm.user_id,
        name: nameByUser.get(pm.user_id) || pm.User?.name_localized?.ko || pm.User?.name || `user ${pm.user_id}`,
        dept: deptByUser.get(pm.user_id) || null,
        active: mine.filter((t) => t.status !== 'completed').length,
        completed: mine.filter((t) => t.status === 'completed').length,
      };
    });

    // 산출물·이슈·단계
    const [posts, documents, issues, stages] = await Promise.all([
      Post.findAll({ where: { project_id: project.id, status: 'published' }, attributes: ['id', 'title', 'category', 'created_at'], order: [['created_at', 'DESC']], limit: 20 }),
      Document.findAll({ where: { project_id: project.id }, attributes: ['id', 'title', 'kind', 'created_at'], order: [['created_at', 'DESC']], limit: 20 }),
      ProjectIssue.findAll({ where: { project_id: project.id }, attributes: ['id', 'body', 'created_at'], order: [['created_at', 'DESC']], limit: 10 }),
      ProjectStage.findAll({ where: { project_id: project.id }, attributes: ['id', 'kind', 'label', 'status', 'order_index'], order: [['order_index', 'ASC']] }),
    ]);
    const deliverables = [
      ...posts.map((p) => ({ kind: 'post', id: p.id, title: p.title, category: p.category, created_at: p.created_at, link: `/projects/p/${project.id}?tab=docs&post=${p.id}` })),
      ...documents.map((d) => ({ kind: 'document', id: d.id, title: d.title, category: d.kind, created_at: d.created_at, link: `/documents/${d.id}` })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20);

    return successResponse(res, {
      project: { id: project.id, name: project.name, status: project.status, start_date: project.start_date, end_date: project.end_date, owner_user_id: project.owner_user_id },
      period: { week_start: weekStart, week_end: weekEnd },
      kpi: {
        progress_percent: stats.progress_percent, progress_delta: stats.progress_delta,
        completed_tasks: stats.completed_tasks, total_tasks: stats.total_tasks,
        overdue_count: stats.overdue_count, open_issues: stats.open_issues,
        d_day: stats.d_day, health: stats.health, this_week_completed: thisWeekCompleted,
      },
      strategy: {
        context: project.strategy_context, key_question: project.strategy_key_question,
        goal: project.strategy_goal, governing_thought: project.strategy_governing_thought, approach: project.strategy_approach,
      },
      success_metrics: Array.isArray(project.success_metrics) ? project.success_metrics : [],
      workstreams: workstreams.map((ws) => serializeWorkstream(ws, tp)),
      highlights, risks, next_week: nextWeek,
      stages: stages.map((s) => ({ id: s.id, kind: s.kind, label: s.label, status: s.status })),
      issues: issues.map((i) => ({ id: i.id, body: i.body, created_at: i.created_at })),
      deliverables,
      team,
    });
  } catch (err) { next(err); }
});

// GET /:id/timeline?key_only= — R1 일정 진행 타임라인 데이터 (멤버 전용)
//   업무를 일정 축에 배치 + 마일스톤 + 워크스트림 색 + 진행률·일정대비 상태.
router.get('/:id/timeline', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const keyOnly = req.query.key_only === '1' || req.query.key_only === 'true';

    const [tasks, workstreams] = await Promise.all([
      Task.findAll({
        where: { project_id: project.id, status: { [Op.ne]: 'canceled' } },
        attributes: ['id', 'title', 'status', 'start_date', 'due_date', 'progress_percent', 'workstream_id', 'is_milestone', 'assignee_id'],
        include: [{ model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false }],
        order: [['due_date', 'ASC'], ['start_date', 'ASC']],
      }),
      ProjectWorkstream.findAll({ where: { project_id: project.id }, attributes: ['id', 'title', 'color', 'order_index'], order: [['order_index', 'ASC']] }),
    ]);
    const tp = tasks.map((t) => t.toJSON());
    await applyMemberDisplayName(tp, project.business_id, ['assignee']);

    // 진행률 + 일정대비 상태
    const active = tp.filter((t) => t.status !== 'canceled');
    const total = active.length;
    const percent = total === 0 ? 0 : Math.round(active.reduce((s, t) => s + (t.status === 'completed' ? 100 : (Number(t.progress_percent) || 0)), 0) / total);
    const today = todayInTz('Asia/Seoul');
    const start = project.start_date ? String(project.start_date).slice(0, 10) : null;
    const end = project.end_date ? String(project.end_date).slice(0, 10) : null;
    let expectedPercent = null; let scheduleStatus = null; let dDay = null;
    if (start && end && end > start) {
      const span = (new Date(end) - new Date(start)) / 86400000;
      const elapsed = Math.max(0, Math.min(span, (new Date(today) - new Date(start)) / 86400000));
      expectedPercent = Math.round((elapsed / span) * 100);
      const gap = percent - expectedPercent;
      scheduleStatus = gap >= -5 ? (gap >= 5 ? 'ahead' : 'ontrack') : 'behind';
      dDay = Math.round((new Date(end) - new Date(today)) / 86400000);
    }

    const rows = (keyOnly ? tp.filter((t) => t.is_milestone) : tp).map((t) => ({
      id: t.id, title: t.title, status: t.status,
      start_date: t.start_date, due_date: t.due_date,
      progress_percent: t.progress_percent, workstream_id: t.workstream_id,
      is_milestone: !!t.is_milestone, assignee_name: t.assignee?.name || null,
    }));

    return successResponse(res, {
      project: { id: project.id, name: project.name, start_date: start, end_date: end },
      today,
      progress: { percent, expected_percent: expectedPercent, schedule_status: scheduleStatus, d_day: dDay },
      key_only_default: !!project.timeline_key_only,
      workstreams: workstreams.map((w) => ({ id: w.id, title: w.title, color: w.color, order_index: w.order_index })),
      tasks: rows,
    });
  } catch (err) { next(err); }
});

// PATCH /:id/timeline-settings — 주요만 보기 기본값 (멤버 전용)
router.patch('/:id/timeline-settings', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    if ('key_only' in (req.body || {})) await project.update({ timeline_key_only: !!req.body.key_only });
    broadcastCanvas(req, project, 'timeline_settings');
    return successResponse(res, { timeline_key_only: project.timeline_key_only });
  } catch (err) { next(err); }
});

// ── 관련 프로젝트 (project_links) ──
// GET /:id/links — 연결된 프로젝트 + 상태 요약
router.get('/:id/links', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const links = await ProjectLink.findAll({
      where: { business_id: project.business_id, [Op.or]: [{ project_a_id: project.id }, { project_b_id: project.id }] },
    });
    const otherIds = links.map((l) => (l.project_a_id === project.id ? l.project_b_id : l.project_a_id));
    if (otherIds.length === 0) return successResponse(res, []);
    const stats = await fetchProjectStats(project.business_id, otherIds, mondayOfDateStr(todayInTz('Asia/Seoul')), true);
    const statById = new Map(stats.map((s) => [s.project_id, s]));
    const projs = await Project.findAll({ where: { id: { [Op.in]: otherIds }, business_id: project.business_id }, attributes: ['id', 'name', 'status', 'start_date', 'end_date'] });
    const projById = new Map(projs.map((p) => [p.id, p]));
    const out = links.map((l) => {
      const otherId = l.project_a_id === project.id ? l.project_b_id : l.project_a_id;
      const p = projById.get(otherId); if (!p) return null;
      const s = statById.get(otherId) || {};
      return {
        link_id: l.id, relation_label: l.relation_label,
        project: { id: p.id, name: p.name, status: p.status, start_date: p.start_date, end_date: p.end_date,
          progress_percent: s.progress_percent ?? 0, health: s.health || 'yellow', overdue_count: s.overdue_count ?? 0, d_day: s.d_day ?? null },
      };
    }).filter(Boolean);
    return successResponse(res, out);
  } catch (err) { next(err); }
});

// POST /:id/links { target_project_id, relation_label? } — 프로젝트 연결
router.post('/:id/links', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const targetId = Number(req.body?.target_project_id);
    if (!targetId) return errorResponse(res, 'target_project_id_required', 400);
    if (targetId === project.id) return errorResponse(res, 'cannot_link_self', 400);
    const target = await Project.findOne({ where: { id: targetId, business_id: project.business_id }, attributes: ['id'] });
    if (!target) return errorResponse(res, 'invalid_project', 400);  // 같은 워크스페이스만 (cross-tenant 차단)
    const [a, b] = project.id < targetId ? [project.id, targetId] : [targetId, project.id];
    const exists = await ProjectLink.findOne({ where: { project_a_id: a, project_b_id: b } });
    if (exists) return errorResponse(res, 'already_linked', 409);
    await ProjectLink.create({ business_id: project.business_id, project_a_id: a, project_b_id: b, relation_label: req.body?.relation_label ? String(req.body.relation_label).slice(0, 40) : null, created_by: req.user.id });
    broadcastCanvas(req, project, 'project_linked');
    return successResponse(res, { linked: true });
  } catch (err) { next(err); }
});

// DELETE /:id/links/:targetId — 연결 해제
router.delete('/:id/links/:targetId', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'member_only', 403);
    const targetId = Number(req.params.targetId);
    const [a, b] = project.id < targetId ? [project.id, targetId] : [targetId, project.id];
    const link = await ProjectLink.findOne({ where: { business_id: project.business_id, project_a_id: a, project_b_id: b } });
    if (!link) return errorResponse(res, 'link_not_found', 404);
    await link.destroy();
    broadcastCanvas(req, project, 'project_unlinked');
    return successResponse(res, { unlinked: true });
  } catch (err) { next(err); }
});

router.get('/:id/transactions', authenticateToken, async (req, res, next) => {
  try {
    const { project, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);

    const { Post, Invoice, InvoiceInstallment, SignatureRequest, Client, ProjectStage } = require('../models');
    const { progressProject, computeNextAction, seedStages } = require('../services/projectStageEngine');
    const { Op } = require('sequelize');

    // Phase D+1 — 레거시 프로젝트 (stage 없음) 에 대해 lazy 시드.
    // project_type 기준 매핑: ongoing=subscription, fixed=fixed (기본).
    const stageCount = await ProjectStage.count({ where: { project_id: project.id } });
    if (stageCount === 0) {
      const tplKey = project.project_type === 'ongoing' ? 'subscription' : 'fixed';
      await seedStages(project.id, tplKey).catch(() => null);
    }

    // 자동 진행 — 응답 직전에 한 번 동기화 (멱등). best-effort.
    await progressProject(project.id).catch(() => null);

    // 계약/견적/SOW/제안 (status published)
    const posts = await Post.findAll({
      where: {
        project_id: project.id,
        category: { [Op.in]: ['contract', 'quote', 'sow', 'proposal'] },
      },
      attributes: ['id', 'title', 'category', 'status', 'created_at', 'shared_at', 'share_token'],
      order: [['created_at', 'ASC']],
    });
    const postIds = posts.map(p => p.id);

    // 각 post 의 서명 진행 상태
    const sigs = postIds.length
      ? await SignatureRequest.findAll({
          where: { entity_type: 'post', entity_id: { [Op.in]: postIds } },
          attributes: ['id', 'entity_id', 'signer_email', 'signer_name', 'status', 'signed_at', 'rejected_at'],
          order: [['created_at', 'ASC']],
        })
      : [];
    const sigsByPost = {};
    for (const s of sigs) {
      if (!sigsByPost[s.entity_id]) sigsByPost[s.entity_id] = [];
      sigsByPost[s.entity_id].push({
        id: s.id, signer_email: s.signer_email, signer_name: s.signer_name,
        status: s.status, signed_at: s.signed_at, rejected_at: s.rejected_at,
      });
    }

    // 청구서 (project_id 기준)
    const invoices = await Invoice.findAll({
      where: { project_id: project.id },
      attributes: ['id', 'invoice_number', 'title', 'status', 'installment_mode',
                   'grand_total', 'paid_amount', 'currency', 'issued_at', 'due_date', 'sent_at',
                   'paid_at', 'notify_paid_at', 'source_post_id', 'created_at'],
      include: [
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Client, attributes: ['id', 'display_name', 'biz_name', 'company_name', 'is_business'] },
      ],
      order: [['created_at', 'ASC']],
    });

    // 요약
    const totalContracted = posts
      .filter(p => p.category === 'contract' || p.category === 'sow')
      .length; // 계약 건수만 (금액은 invoices 기반)
    const totalInvoiced = invoices.reduce((s, i) => s + Number(i.grand_total || 0), 0);
    const totalPaid = invoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
    const totalUnpaid = totalInvoiced - totalPaid;
    const overdueCount = invoices.filter(i => i.status === 'overdue').length;
    const taxPending = invoices.reduce((s, inv) => {
      const insts = inv.installments || [];
      return s + insts.filter(it => it.status === 'paid' && !it.tax_invoice_no).length;
    }, 0);

    // currency 기본값 (대표값 — 첫 invoice 또는 KRW)
    const currency = invoices[0]?.currency || 'KRW';

    // 거래 stages + next_action
    const stages = await ProjectStage.findAll({
      where: { project_id: project.id },
      order: [['order_index', 'ASC']],
    });
    const nextAction = await computeNextAction(project.id);

    // ② 구독형 — 다음 청구 예정/월 금액/자동발행 상태 (recurring_invoice.js 스케줄 규칙 동일).
    //   엔진(recurring_invoice daily cron)이 invoice_billing_day 에 월 청구 자동 생성 — 그 스케줄을 표면화.
    let subscription = null;
    if (project.billing_type === 'subscription') {
      const day = project.invoice_billing_day || null;
      let nextDue = null;
      if (day && project.auto_invoice_enabled) {
        const today = new Date();
        const lastAt = project.last_auto_invoice_at ? new Date(project.last_auto_invoice_at) : null;
        const billedThisMonth = lastAt && lastAt.getFullYear() === today.getFullYear() && lastAt.getMonth() === today.getMonth();
        const domOf = (yy, mm) => Math.min(day, new Date(yy, mm + 1, 0).getDate());
        let y = today.getFullYear(), m = today.getMonth();
        if (billedThisMonth || today.getDate() > domOf(y, m)) { m += 1; if (m > 11) { m = 0; y += 1; } }
        nextDue = `${y}-${String(m + 1).padStart(2, '0')}-${String(domOf(y, m)).padStart(2, '0')}`;
      }
      subscription = {
        monthly_fee: Number(project.monthly_fee || 0),
        billing_day: day,
        auto_enabled: !!project.auto_invoice_enabled,
        mode: project.auto_invoice_mode,  // 'auto'=자동 발행+발송 / 'draft_review'=초안+검토 후 수동 발행
        last_billed_at: project.last_auto_invoice_at || null,
        next_due_at: nextDue,
        currency,
      };
    }
    // 정기청구 설정 편집용 현재값 — billing_type 무관하게 항상 반환 (구독 ON/OFF 토글 포함).
    const billingConfig = {
      billing_type: project.billing_type,
      monthly_fee: Number(project.monthly_fee || 0),
      billing_day: project.invoice_billing_day || 1,
      auto_enabled: !!project.auto_invoice_enabled,
      mode: project.auto_invoice_mode || 'draft_review',
      currency,
    };

    return successResponse(res, {
      project: { id: project.id, name: project.name, status: project.status },
      subscription,
      billingConfig,
      stages: stages.map(s => ({
        id: s.id, order: s.order_index, kind: s.kind, label: s.label, status: s.status,
        linked_entity_type: s.linked_entity_type, linked_entity_id: s.linked_entity_id,
        started_at: s.started_at, completed_at: s.completed_at,
        metadata: s.metadata, is_template_seeded: s.is_template_seeded,
      })),
      next_action: nextAction,
      summary: {
        contracts_count: totalContracted,
        invoices_count: invoices.length,
        total_invoiced: totalInvoiced,
        total_paid: totalPaid,
        total_unpaid: totalUnpaid,
        overdue_count: overdueCount,
        tax_pending: taxPending,
        currency,
      },
      posts: posts.map(p => ({
        id: p.id,
        title: p.title,
        category: p.category,
        status: p.status,
        created_at: p.created_at,
        shared_at: p.shared_at,
        share_token: p.share_token,
        signatures: sigsByPost[p.id] || [],
      })),
      invoices: invoices.map(inv => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        title: inv.title,
        status: inv.status,
        installment_mode: inv.installment_mode,
        grand_total: Number(inv.grand_total || 0),
        paid_amount: Number(inv.paid_amount || 0),
        currency: inv.currency,
        issued_at: inv.issued_at,
        due_date: inv.due_date,
        sent_at: inv.sent_at,
        paid_at: inv.paid_at,
        notify_paid_at: inv.notify_paid_at,
        source_post_id: inv.source_post_id,
        client: inv.Client ? {
          id: inv.Client.id,
          display_name: inv.Client.display_name,
          biz_name: inv.Client.biz_name,
          company_name: inv.Client.company_name,
          is_business: inv.Client.is_business,
        } : null,
        installments: (inv.installments || []).map(i => ({
          id: i.id, installment_no: i.installment_no, label: i.label,
          percent: Number(i.percent), amount: Number(i.amount), due_date: i.due_date,
          status: i.status, paid_at: i.paid_at,
          tax_invoice_no: i.tax_invoice_no, tax_invoice_at: i.tax_invoice_at,
          notify_paid_at: i.notify_paid_at,
        })),
      })),
    });
  } catch (err) { next(err); }
});

router.get('/:id/tasks', authenticateToken, async (req, res, next) => {
  try {
    const { project, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const { literal } = require('sequelize');
    const tasks = await Task.findAll({
      where: { project_id: project.id },
      attributes: {
        include: [
          // 최신 estimation source — AI 자동 예측 task 시각 분기 (회색 + ✨)
          [literal('(SELECT source FROM task_estimations WHERE task_id = `Task`.`id` ORDER BY id DESC LIMIT 1)'), 'latest_estimation_source'],
        ],
      },
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: TaskReviewer, as: 'reviewers', attributes: ['id', 'user_id', 'state', 'is_client'], required: false },
      ],
      order: [['created_at', 'DESC']],
    });
    // 워크스페이스 표시명(BusinessMember.name) 적용 — 타임라인 등에서 User.name(예: 한수정) 대신 표시명(예: 루아) 노출
    const json = tasks.map((t) => t.toJSON());
    await applyMemberDisplayName(json, project.business_id, ['assignee', 'requester']);
    return successResponse(res, json);
  } catch (err) { next(err); }
});

// ============================================
// 독립 대화(project 없음) 우측패널 스코프 — notes / issues / task-candidates / tasks
// ============================================

// GET /api/projects/conversations/:convId/notes — 독립 대화 메모
router.get('/conversations/:convId/notes', authenticateToken, async (req, res, next) => {
  try {
    const convId = Number(req.params.convId);
    const { conversation, error } = await loadStandaloneConvOrForbidden(convId, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const { Op } = require('sequelize');
    const notes = await ProjectNote.findAll({
      where: {
        conversation_id: conversation.id,
        [Op.or]: [
          { visibility: 'internal' },
          { visibility: 'personal', author_user_id: req.user.id },
        ],
      },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
      order: [['created_at', 'DESC']],
    });
    const notesJson = notes.map((n) => n.toJSON());
    await applyMemberDisplayName(notesJson, conversation.business_id, ['author']);  // #87 표시명
    return successResponse(res, notesJson);
  } catch (err) { next(err); }
});

// POST /api/projects/conversations/:convId/notes — 독립 대화 메모 작성
router.post('/conversations/:convId/notes', authenticateToken, async (req, res, next) => {
  try {
    const convId = Number(req.params.convId);
    const { conversation, error } = await loadStandaloneConvOrForbidden(convId, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const { body, visibility } = req.body || {};
    if (!body || !String(body).trim()) return errorResponse(res, 'body is required', 400);
    const vis = visibility === 'internal' ? 'internal' : 'personal';
    const note = await ProjectNote.create({
      project_id: null,
      conversation_id: conversation.id,
      author_user_id: req.user.id,
      visibility: vis,
      body: String(body).trim(),
    });
    const full = await ProjectNote.findByPk(note.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
    });
    const noteJson = full.toJSON();
    await applyMemberDisplayNameOne(noteJson, conversation.business_id, ['author']);  // #87 표시명
    // N+38 — business room broadcast (CLAUDE.md 16번 박제)
    const io = req.app.get('io');
    if (io && conversation.business_id) {
      io.to(`business:${conversation.business_id}`).emit('note:new', noteJson);
    }
    return successResponse(res, noteJson);
  } catch (err) { next(err); }
});

// GET /api/projects/conversations/:convId/issues — 독립 대화 이슈
router.get('/conversations/:convId/issues', authenticateToken, async (req, res, next) => {
  try {
    const convId = Number(req.params.convId);
    const { conversation, error } = await loadStandaloneConvOrForbidden(convId, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const issues = await ProjectIssue.findAll({
      where: { conversation_id: conversation.id },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
      order: [['created_at', 'DESC']],
    });
    const issuesJson = issues.map((i) => i.toJSON());
    await applyMemberDisplayName(issuesJson, conversation.business_id, ['author']);  // #87 표시명
    return successResponse(res, issuesJson);
  } catch (err) { next(err); }
});

// POST /api/projects/conversations/:convId/issues — 독립 대화 이슈 추가
router.post('/conversations/:convId/issues', authenticateToken, async (req, res, next) => {
  try {
    const convId = Number(req.params.convId);
    const { conversation, error } = await loadStandaloneConvOrForbidden(convId, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const { body } = req.body || {};
    if (!body || !String(body).trim()) return errorResponse(res, 'body is required', 400);
    const issue = await ProjectIssue.create({
      project_id: null,
      conversation_id: conversation.id,
      body: String(body).trim(),
      author_user_id: req.user.id,
    });
    const full = await ProjectIssue.findByPk(issue.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
    });
    // N+38 — business room broadcast
    const io = req.app.get('io');
    if (io && conversation.business_id) {
      io.to(`business:${conversation.business_id}`).emit('issue:new', full.toJSON());
    }
    return successResponse(res, full.toJSON());
  } catch (err) { next(err); }
});

// GET /api/projects/conversations/:convId/task-candidates — 독립 대화 후보
router.get('/conversations/:convId/task-candidates', authenticateToken, async (req, res, next) => {
  try {
    const convId = Number(req.params.convId);
    const { conversation, error } = await loadStandaloneConvOrForbidden(convId, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const status = req.query.status || 'pending';
    const where = { conversation_id: conversation.id };
    if (status !== 'all') where.status = status;
    // N+36 옵션 D — 기본은 hidden_at=null 만. ?include_hidden=true 시 모두 (이전 후보 보기 토글).
    if (req.query.include_hidden !== 'true') where.hidden_at = null;
    const cands = await TaskCandidate.findAll({
      where,
      include: [{ model: User, as: 'guessedAssignee', attributes: ['id', 'name', 'name_localized'], required: false }],
      order: [['extracted_at', 'DESC']],
    });
    const candsJson = cands.map((c) => c.toJSON());
    await applyMemberDisplayName(candsJson, conversation.business_id, ['guessedAssignee']);
    return successResponse(res, candsJson);
  } catch (err) { next(err); }
});

// GET /api/projects/conversations/:convId/tasks — 독립 대화 업무 (from_candidate 경로로 만들어진 것들)
router.get('/conversations/:convId/tasks', authenticateToken, async (req, res, next) => {
  try {
    const convId = Number(req.params.convId);
    const { conversation, error } = await loadStandaloneConvOrForbidden(convId, req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    const tasks = await Task.findAll({
      where: { conversation_id: conversation.id, project_id: null },
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
      ],
      order: [['created_at', 'DESC']],
    });
    const tasksJson = tasks.map((t) => t.toJSON());
    await applyMemberDisplayName(tasksJson, conversation.business_id, ['assignee']);
    return successResponse(res, tasksJson);
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
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
      order: [['created_at', 'DESC']],
    });
    const notesJson = notes.map((n) => n.toJSON());
    await applyMemberDisplayName(notesJson, project.business_id, ['author']);  // #87 표시명
    return successResponse(res, notesJson);
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
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
      order: [['created_at', 'DESC']],
    });
    const issuesJson = issues.map((i) => i.toJSON());
    await applyMemberDisplayName(issuesJson, project.business_id, ['author']);  // #87 표시명
    return successResponse(res, issuesJson);
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
    // N+36 옵션 D — 기본 hidden_at=null. ?include_hidden=true 시 모두.
    if (req.query.include_hidden !== 'true') where.hidden_at = null;
    const cands = await TaskCandidate.findAll({
      where,
      include: [{ model: User, as: 'guessedAssignee', attributes: ['id', 'name', 'name_localized'] }],
      order: [['extracted_at', 'DESC']],
    });
    const candsJson = cands.map((c) => c.toJSON());
    await applyMemberDisplayName(candsJson, project.business_id, ['guessedAssignee']);
    return successResponse(res, candsJson);
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
    // 프로젝트 연결 시 프로젝트 권한, 없으면 워크스페이스 멤버 권한.
    if (conv.project_id) {
      const { role, error } = await loadProjectOrForbidden(conv.project_id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);
    } else {
      const { error } = await loadStandaloneConvOrForbidden(conversationId, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
    }

    const result = await taskExtractor.extractTaskCandidates({
      conversationId,
      userId: req.user.id,
      businessId: conv.business_id,
    });

    // Socket.IO: 새 후보 알림 (프로젝트 room 있으면 거기로, 아니면 conversation room 으로)
    if (result.candidates?.length > 0) {
      const io = req.app.get('io');
      if (io) {
        const payload = {
          project_id: conv.project_id,
          conversation_id: conversationId,
          candidates: result.candidates,
        };
        if (conv.project_id) {
          io.to(`project:${conv.project_id}`).emit('candidates:created', payload);
        } else {
          io.to(`conv:${conversationId}`).emit('candidates:created', payload);
        }
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
    if (candidate.project_id) {
      const { role, error } = await loadProjectOrForbidden(candidate.project_id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);
    } else if (candidate.conversation_id) {
      const { error } = await loadStandaloneConvOrForbidden(candidate.conversation_id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
    } else {
      return errorResponse(res, 'candidate_unowned', 400);
    }

    // 우측 패널에서 사용자가 인라인 편집한 값 (title / assignee_id / start_date / due_date / description) 받아 적용.
    // 미전달 필드는 candidate 의 LLM 추측값 사용.
    const overrides = {};
    if (req.body && typeof req.body === 'object') {
      if (typeof req.body.title === 'string') overrides.title = req.body.title;
      if ('assignee_id' in req.body) overrides.assignee_id = req.body.assignee_id;
      if ('start_date' in req.body) overrides.start_date = req.body.start_date;
      if ('due_date' in req.body) overrides.due_date = req.body.due_date;
      if (typeof req.body.description === 'string') overrides.description = req.body.description;
    }
    // 생성·broadcast·알림·감사는 행동 계층이 소유한다 (services/actions/task_actions.createTask).
    //   여태 caller 3곳이 각자 task:new 를 쐈고 payload 도 서로 달랐다(어떤 곳은 inbox:refresh 누락).
    const result = await taskExtractor.registerCandidate(candidate.id, req.user.id, overrides);
    return successResponse(res, result);
  } catch (err) {
    if (err.message === 'candidate_already_resolved') {
      return errorResponse(res, 'candidate_already_resolved', 400);
    }
    // 행동 계층의 거부는 그 상태 그대로 (cannot_assign·menu_forbidden 403 …) — 사람이 쓰는 POST /api/tasks 와 같은 코드.
    //   여기서 http 를 잃으면 "권한 없음" 이 500 서버 오류로 둔갑한다.
    if (err.http) return errorResponse(res, err.message, err.http);
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
    // 운영 #47 — register 와 동일하게 프로젝트 후보 + 독립 대화(채팅) 후보 모두 처리.
    //   기존엔 project_id 만 검사해 conversation_id 만 있는 채팅 추출 후보는 거절이 막혔다(등록만 됨).
    if (candidate.project_id) {
      const { role, error } = await loadProjectOrForbidden(candidate.project_id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);
    } else if (candidate.conversation_id) {
      const { error } = await loadStandaloneConvOrForbidden(candidate.conversation_id, req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
    } else {
      return errorResponse(res, 'candidate_unowned', 400);
    }

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
// 권한:
//   멤버 — 워크스페이스 안 모든 업무 (project 무·유 무관). business_id 로 직접 필터.
//   고객 — 자기 참여 프로젝트의 업무 + 자기에게 배정된 업무 (project null 포함).
// ============================================
router.get('/workspace/:businessId/all-tasks', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const bm = await requireBusinessMember(req.user.id, businessId);

    let where;
    if (bm && bm.role !== 'ai') {
      // 멤버: 워크스페이스 전체 업무 (프로젝트 미지정 task 도 포함)
      where = { business_id: businessId };
    } else {
      // 고객: 자기가 project_clients 에 등록된 프로젝트의 업무 OR 본인에게 배정된 업무
      const pcs = await ProjectClient.findAll({
        where: { contact_user_id: req.user.id },
        include: [{ model: Project, where: { business_id: businessId }, attributes: ['id'] }],
      });
      const projectIds = pcs.map((pc) => pc.project_id).filter(Boolean);
      const orConds = [{ assignee_id: req.user.id }, { request_by_user_id: req.user.id }];
      if (projectIds.length > 0) orConds.push({ project_id: projectIds });
      where = { business_id: businessId, [Op.or]: orConds };
    }

    if (req.query.status) where.status = req.query.status;
    if (req.query.project_id) where.project_id = Number(req.query.project_id);
    if (req.query.mine === '1') where.assignee_id = req.user.id;
    else if (req.query.assignee_id) where.assignee_id = Number(req.query.assignee_id);

    // 사이클 N+50 — pagination. 워크스페이스 전체 task 누적 — default 500 / max 1000
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 500, maxLimit: 1000 });
    const { rows, count } = await Task.findAndCountAll({
      where,
      include: [
        { model: Project, attributes: ['id', 'name', 'client_company', 'status'] },
        { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
        { model: TaskReviewer, as: 'reviewers', attributes: ['id', 'user_id', 'state', 'is_client'], required: false },
      ],
      order: [['createdAt', 'DESC']],
      limit, offset,
      distinct: true,
    });
    const rowsJson = rows.map((t) => t.toJSON());
    await applyMemberDisplayName(rowsJson, businessId, ['assignee', 'requester']);
    return paginatedResponse(res, rowsJson, count, { limit, page, offset });
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
    // 프로젝트 고객 초대 = 워크스페이스 Client 로도 항상 편입.
    //  - 옛 버그: 이미 가입한 User 일 때만 Client 행 생성 → 미가입 초대 고객은 청구서/고객목록에 안 떠서
    //    "가입해야만 나옴" 호소. 이제 이메일만으로 초대해도 status='invited' Client 행을 즉시 만든다.
    const { User: UserM, Client: ClientM } = require('../models');
    let contact_user_id = null;
    let clientRow = null;
    const emailTrim = email && email.trim() ? email.trim() : null;
    if (emailTrim) {
      const existingUser = await UserM.findOne({ where: { email: emailTrim } });
      if (existingUser) contact_user_id = existingUser.id;
      // 기존 Client 매칭: user_id(가입자) 우선, 없으면 같은 워크스페이스 invite_email
      if (existingUser) {
        clientRow = await ClientM.findOne({ where: { business_id: project.business_id, user_id: existingUser.id } });
      }
      if (!clientRow) {
        clientRow = await ClientM.findOne({ where: { business_id: project.business_id, invite_email: emailTrim } });
      }
      if (!clientRow) {
        clientRow = await ClientM.create({
          business_id: project.business_id,
          user_id: existingUser ? existingUser.id : null,
          invite_email: emailTrim,
          display_name: String(name).trim(),
          status: 'invited',
          invited_by: req.user.id, invited_at: new Date(),
        });
      }
    } else {
      // 이메일 없이 이름만 — 워크스페이스 Client 로 편입 (수동 청구 대상으로 노출)
      clientRow = await ClientM.create({
        business_id: project.business_id,
        user_id: null,
        display_name: String(name).trim(),
        status: 'invited',
        invited_by: req.user.id, invited_at: new Date(),
      });
    }
    const row = await ProjectClient.create({
      project_id: project.id,
      client_id: clientRow ? clientRow.id : null,
      contact_user_id,
      contact_name: String(name).trim(),
      contact_email: emailTrim,
      invite_token: token,
      invited_by: req.user.id,
    });
    await createAuditLog({
      userId: req.user.id, businessId: project.business_id,
      action: 'project.client_added', targetType: 'project_client', targetId: row.id,
      newValue: { project_id: project.id, project_name: project.name, client_id: clientRow ? clientRow.id : null, name: row.contact_name, email: row.contact_email },
    });

    // 초대 이메일 발송 (실패해도 초대 자체는 성공 처리)
    if (row.contact_email) {
      try {
        const { sendInviteEmail } = require('../services/emailService');
        const biz = await Business.findByPk(project.business_id, { attributes: ['brand_name', 'name'] });
        const inviter = await User.findByPk(req.user.id, { attributes: ['name'] });
        await sendInviteEmail({
          to: row.contact_email,
          workspaceName: biz?.brand_name || biz?.name || 'PlanQ',
          inviterName: inviter?.name || '',
          targetName: row.contact_name,
          kind: 'project',
          contextName: project.name,
          token,
        });
      } catch (e) { console.warn('invite email send failed:', e.message); }
    }

    return successResponse(res, row);
  } catch (err) { next(err); }
});

// POST /api/projects/:id/clients/:clientId/resend-invite — 초대 메일 재발송 (대기 중인 고객만)
router.post('/:id/clients/:clientId/resend-invite', authenticateToken, async (req, res, next) => {
  try {
    const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);
    if (role === 'client') return errorResponse(res, 'forbidden', 403);
    const row = await ProjectClient.findOne({ where: { id: Number(req.params.clientId), project_id: project.id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    if (row.invite_token_used_at || row.contact_user_id) return errorResponse(res, 'already_accepted', 400);
    if (!row.contact_email) return errorResponse(res, 'no_email', 400);
    // 기존 토큰 유지(옛 메일 링크도 유효) + 발송 시점 갱신.
    await row.update({ invited_at: new Date() });
    try {
      const { sendInviteEmail } = require('../services/emailService');
      const biz = await Business.findByPk(project.business_id, { attributes: ['brand_name', 'name'] });
      const inviter = await User.findByPk(req.user.id, { attributes: ['name'] });
      await sendInviteEmail({
        to: row.contact_email,
        workspaceName: biz?.brand_name || biz?.name || 'PlanQ',
        inviterName: inviter?.name || '',
        targetName: row.contact_name,
        kind: 'project',
        contextName: project.name,
        token: row.invite_token,
      });
    } catch (e) {
      console.warn('resend project invite email failed:', e.message);
      return errorResponse(res, 'email_send_failed', 502);
    }
    return successResponse(res, { id: row.id, invited_at: row.invited_at, resent: true });
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
    const { body, conversation_id } = req.body || {};
    if (!body || !String(body).trim()) return errorResponse(res, 'body is required', 400);
    // conversation_id 옵션 — 같은 프로젝트 소속 대화인지 검증
    let convIdToStore = null;
    if (conversation_id) {
      const conv = await Conversation.findByPk(conversation_id);
      if (conv && conv.project_id === project.id) convIdToStore = conv.id;
    }
    const issue = await ProjectIssue.create({
      project_id: project.id,
      conversation_id: convIdToStore,
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
    const { body, visibility, conversation_id } = req.body || {};
    if (!body || !String(body).trim()) return errorResponse(res, 'body is required', 400);
    // 고객은 personal 만 작성 가능
    let vis = visibility === 'internal' ? 'internal' : 'personal';
    if (role === 'client') vis = 'personal';
    // conversation_id 옵션 — 같은 프로젝트 소속 대화인지 검증
    let convIdToStore = null;
    if (conversation_id) {
      const conv = await Conversation.findByPk(conversation_id);
      if (conv && conv.project_id === project.id) convIdToStore = conv.id;
    }
    const note = await ProjectNote.create({
      project_id: project.id,
      conversation_id: convIdToStore,
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
        include: [{ model: User, attributes: ['id', 'name', 'name_localized', 'email'] }],
      },
      {
        model: ProjectClient,
        as: 'projectClients',
        attributes: { exclude: ['invite_token'] },
      },
    ],
  });
  if (!project) return null;
  const json = project.toJSON();
  // 워크스페이스 표시명 enrichment — BusinessMember.name 우선
  const bms = await BusinessMember.findAll({
    where: { business_id: project.business_id },
    attributes: ['user_id', 'name', 'name_localized', 'role'],
  });
  const bmMap = new Map(bms.map(b => [b.user_id, { name: b.name, name_localized: b.name_localized, role: b.role }]));
  if (Array.isArray(json.projectMembers)) {
    json.projectMembers = json.projectMembers.map(m => {
      const bm = bmMap.get(m.user_id);
      if (m.User && bm) {
        m.User.display_name = bm.name || null;
        m.User.display_name_localized = bm.name_localized || null;
        m.User.workspace_role = bm.role;
      }
      return m;
    });
  }
  // 운영 #66 — projectClients 표시명·수락상태 enrichment.
  //   client_id 로만 연결되고 contact_name/contact_email/contact_user_id 가 null 인 row(설정>고객에서
  //   추가 후 프로젝트 연결된 케이스)는 명단에 이름 공백 + "초대 대기" 로 오표시됨.
  //   연결된 Client(display_name·user_id·이메일·status)로 null 필드를 보완 → 이름 + "참여 중" 정상.
  if (Array.isArray(json.projectClients) && json.projectClients.length > 0) {
    const cids = [...new Set(json.projectClients.map(c => c.client_id).filter(Boolean))];
    if (cids.length > 0) {
      const clients = await Client.findAll({
        where: { id: cids, business_id: project.business_id },
        attributes: ['id', 'display_name', 'company_name', 'biz_name', 'user_id', 'status',
          'invite_email', 'tax_invoice_email', 'billing_contact_email'],
      });
      const cMap = new Map(clients.map(c => [c.id, c]));
      json.projectClients = json.projectClients.map(pc => {
        const cli = pc.client_id ? cMap.get(pc.client_id) : null;
        if (cli) {
          pc.contact_name = pc.contact_name || cli.display_name || cli.company_name || cli.biz_name || pc.contact_name;
          pc.contact_email = pc.contact_email || cli.tax_invoice_email || cli.billing_contact_email || cli.invite_email || null;
          // 연결된 Client 가 실제 사용자(user_id)면 '참여 중'. (contact_user_id 가 명단의 joined 판정 기준)
          if (!pc.contact_user_id && cli.user_id && cli.status === 'active') pc.contact_user_id = cli.user_id;
          pc.client_status = cli.status;
        }
        return pc;
      });
    }
  }
  return json;
}

// ============================================
// GET /api/projects/invite/:token — 초대 링크 검증 (공개 — 인증 불필요)
// 만료: invited_at 으로부터 30일
// ============================================
const INVITE_EXPIRY_DAYS = 30;
function isInviteExpired(invitedAt) {
  if (!invitedAt) return false;
  const diffMs = Date.now() - new Date(invitedAt).getTime();
  return diffMs > INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
}

router.get('/invite/:token', async (req, res, next) => {
  try {
    const pc = await ProjectClient.findOne({ where: { invite_token: req.params.token } });
    if (!pc) return errorResponse(res, 'invalid_or_expired_invite', 404);
    if (isInviteExpired(pc.invited_at) && !pc.contact_user_id) {
      return errorResponse(res, 'invalid_or_expired_invite', 410);
    }

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
// 이메일 검증: 로그인 유저 email 과 초대 대상 email 이 다르면 거부
// ============================================
router.post('/invite/:token/accept', authenticateToken, async (req, res, next) => {
  try {
    const pc = await ProjectClient.findOne({ where: { invite_token: req.params.token } });
    if (!pc) return errorResponse(res, 'invalid_or_expired_invite', 404);
    if (pc.contact_user_id) return errorResponse(res, 'already_accepted', 400);
    if (isInviteExpired(pc.invited_at)) return errorResponse(res, 'invalid_or_expired_invite', 410);

    // ★ 토큰=인증: 초대 토큰 소유 = 메일함 수신 증명 = 본인. 이메일 주소 대조 제거 (다중 이메일 대응).

    // 사용자 연결
    await pc.update({ contact_user_id: req.user.id, accepted_at: new Date() });

    return successResponse(res, { project_id: pc.project_id, linked: true });
  } catch (err) { next(err); }
});

// ─── 워크스페이스 전역 파일 집계 (모든 프로젝트) ───
router.get('/workspace/:bizId/all-files', authenticateToken, async (req, res, next) => {
  try {
    const bizId = Number(req.params.bizId);
    // checkBusinessAccess 로직 인라인 — 멤버/오너만
    const isMember = req.user.platform_role === 'platform_admin'
      || await BusinessMember.findOne({ where: { business_id: bizId, user_id: req.user.id } })
      || await Business.findOne({ where: { id: bizId, owner_id: req.user.id } });
    if (!isMember) return errorResponse(res, 'Access denied', 403);
    // #106 fix — visibility(L1~L4) 필터 필수. 옛 버그: 필터 없어 L1(나만보기) 파일이 전 멤버에게 노출.
    const { getUserScope, fileListWhereByLevel } = require('../middleware/access_scope');
    const fileScope = await getUserScope(req.user.id, bizId, req.user.platform_role);

    // 사이클 N+50 — UNION-style 집계 (direct + chat + task + post). 정식 pagination 은 SQL UNION refactor 필요.
    // 임시: 각 source 최대 2000 cap + 최종 merge 결과 limit/offset 인메모리 슬라이스.
    // 운영 워크스페이스 source 별 2000 초과 드물 — 초과 시 후속 사이클에 SQL UNION 으로 전환.
    const MAX_PER_SOURCE = 2000;
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 500, maxLimit: 1000 });

    const projects = await Project.findAll({
      where: { business_id: bizId },
      attributes: ['id', 'name', 'color']
    });
    const projMap = new Map(projects.map(p => [p.id, p]));
    const projIds = projects.map(p => p.id);
    // 프로젝트가 없어도 "내 파일"(project_id NULL) 은 조회 필요 — 아래 로직 진행

    const results = [];

    // 1) direct 파일 — 프로젝트 소속 + "내 파일"(project_id NULL) 둘 다 포함
    const directFiles = await File.findAll({
      where: {
        [Op.and]: [
          fileListWhereByLevel(fileScope),   // #106 — L1 개인파일은 소유자만, L2 프로젝트/지정멤버, L3/L4 전체
          { deleted_at: null },
          { [Op.or]: [
            { project_id: { [Op.in]: projIds } },
            { project_id: null }
          ] },
        ],
      },
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name'] },
        { model: FileFolder, as: 'folder', attributes: ['id', 'name'] }
      ],
      order: [['created_at', 'DESC']],
      limit: MAX_PER_SOURCE,
    });
    for (const f of directFiles) {
      const proj = projMap.get(f.project_id);
      // 이미지면 public-image 엔드포인트로 썸네일 노출 (<img src> 호환).
      // 비이미지나 외부저장(gdrive)은 preview_url 생략.
      const isImage = f.mime_type && f.mime_type.startsWith('image/');
      const isPlanQ = f.storage_provider === 'planq' || !f.storage_provider;
      const previewUrl = (isImage && isPlanQ && f.file_path)
        ? `/api/files/public-image/${require('path').basename(f.file_path)}`
        : undefined;
      results.push({
        id: `direct-${f.id}`,
        source: 'direct',
        file_name: f.file_name,
        file_size: Number(f.file_size),
        mime_type: f.mime_type,
        uploader_id: f.uploader_id,
        uploader_name: f.uploader ? f.uploader.name : null,
        uploaded_at: (f.createdAt || f.created_at || new Date()).toISOString ? (f.createdAt || f.created_at).toISOString() : new Date().toISOString(),
        download_url: f.storage_provider === 'gdrive' && f.external_url
          ? f.external_url
          : `/api/files/${bizId}/${f.id}/download`,
        preview_url: previewUrl,
        external_id: f.external_id,
        external_url: f.external_url,
        folder_id: f.folder_id,
        project_context: proj ? { id: proj.id, name: proj.name, color: proj.color } : null,
        deletable: true,
        storage_provider: f.storage_provider,
        // N+67 — visibility 노출 (frontend file detail drawer 에 표시 + 변경 UI)
        visibility: f.visibility,
        project_id: f.project_id,
      });
    }

    // 2) chat 첨부
    const conversations = await Conversation.findAll({
      where: { business_id: bizId, project_id: { [Op.in]: projIds } },
      attributes: ['id', 'title', 'project_id']
    });
    const convMap = new Map(conversations.map(c => [c.id, c]));
    if (conversations.length > 0) {
      const chatFiles = await MessageAttachment.findAll({
        include: [{
          model: Message,
          where: { conversation_id: { [Op.in]: conversations.map(c => c.id) } },
          attributes: ['id', 'conversation_id', 'sender_id'],
          include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'name_localized'] }]
        }],
        order: [['created_at', 'DESC']],
        limit: MAX_PER_SOURCE,
      });
      for (const a of chatFiles) {
        const conv = convMap.get(a.Message.conversation_id);
        const proj = conv ? projMap.get(conv.project_id) : null;
        const isImage = a.mime_type && a.mime_type.startsWith('image/');
        const previewUrl = (isImage && a.file_path)
          ? `/api/message-attachments/public/${path.basename(a.file_path)}`
          : undefined;
        results.push({
          id: `chat-${a.id}`,
          source: 'chat',
          file_name: a.file_name,
          file_size: Number(a.file_size),
          mime_type: a.mime_type,
          uploader_id: a.Message.sender_id,
          uploader_name: a.Message.sender ? a.Message.sender.name : null,
          uploaded_at: (a.createdAt || a.created_at || new Date()).toISOString ? (a.createdAt || a.created_at).toISOString() : new Date().toISOString(),
          download_url: a.file_path ? `/uploads/${path.relative(path.join(__dirname, '..', 'uploads'), a.file_path)}` : null,
          preview_url: previewUrl,
          context: conv ? { kind: 'conversation', id: conv.id, label: conv.title || '대화방' } : undefined,
          project_context: proj ? { id: proj.id, name: proj.name, color: proj.color } : null,
          folder_id: null,
          deletable: false,
          storage_provider: 'planq'
        });
      }
    }

    // 3) task 첨부
    const tasks = await Task.findAll({
      where: { business_id: bizId, project_id: { [Op.in]: projIds } },
      attributes: ['id', 'title', 'project_id']
    });
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    if (tasks.length > 0) {
      const taskFiles = await TaskAttachment.findAll({
        where: { task_id: { [Op.in]: tasks.map(t => t.id) } },
        include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
        order: [['created_at', 'DESC']],
        limit: MAX_PER_SOURCE,
      });
      for (const a of taskFiles) {
        const task = taskMap.get(a.task_id);
        const proj = task ? projMap.get(task.project_id) : null;
        // 이미지면 task 첨부 public 엔드포인트로 썸네일 노출 (direct/chat 소스와 동일 규칙)
        const previewUrl = (a.mime_type && a.mime_type.startsWith('image/') && a.stored_name)
          ? `/api/tasks/public/attach/${a.stored_name}`
          : undefined;
        results.push({
          id: `task-${a.id}`,
          source: 'task',
          file_name: a.original_name || a.stored_name,
          file_size: Number(a.file_size),
          mime_type: a.mime_type,
          uploader_id: a.uploaded_by,
          uploader_name: a.uploader ? a.uploader.name : null,
          uploaded_at: (a.createdAt || a.created_at || new Date()).toISOString ? (a.createdAt || a.created_at).toISOString() : new Date().toISOString(),
          // 라우터 마운트 경로 포함 — `/public/attach/...` 는 존재하지 않는 경로라 404 였다
          download_url: a.storage_provider === 'gdrive' && a.external_url
            ? a.external_url
            : `/api/tasks/public/attach/${a.stored_name}`,
          preview_url: previewUrl,
          external_id: a.external_id || null,
          external_url: a.external_url || null,
          context: task ? { kind: 'task', id: task.id, label: task.title } : undefined,
          project_context: proj ? { id: proj.id, name: proj.name, color: proj.color } : null,
          folder_id: null,
          deletable: false,
          storage_provider: 'planq'
        });
      }
    }

    // 4) 문서(포스트) 첨부 — File 참조 기반. 좌측 "문서" 필터에서 모아 볼 수 있도록
    //    direct 와 중복되더라도 post source 로 별도 등록 (의도된 이중 노출)
    const { Post, PostAttachment } = require('../models');
    const postsInBiz = await Post.findAll({
      where: { business_id: bizId },
      attributes: ['id', 'title', 'project_id']
    });
    if (postsInBiz.length > 0) {
      const postMap = new Map(postsInBiz.map(p => [p.id, p]));
      const postAtts = await PostAttachment.findAll({
        where: { post_id: { [Op.in]: postsInBiz.map(p => p.id) } },
        include: [{ model: File, as: 'file', include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }] }],
        order: [['created_at', 'DESC']],
        limit: MAX_PER_SOURCE,
      });
      for (const a of postAtts) {
        const f = a.file;
        if (!f || f.deleted_at) continue;
        const post = postMap.get(a.post_id);
        const proj = post && post.project_id ? projMap.get(post.project_id) : null;
        results.push({
          id: `post-${a.id}`,
          source: 'post',
          file_name: f.file_name,
          file_size: Number(f.file_size),
          mime_type: f.mime_type,
          uploader_id: f.uploader_id,
          uploader_name: f.uploader ? f.uploader.name : null,
          uploaded_at: (f.createdAt || f.created_at || new Date()).toISOString
            ? (f.createdAt || f.created_at).toISOString() : new Date().toISOString(),
          download_url: f.storage_provider === 'gdrive' && f.external_url
            ? f.external_url : `/api/files/${bizId}/${f.id}/download`,
          preview_url: (f.mime_type && f.mime_type.startsWith('image/')
            && (f.storage_provider === 'planq' || !f.storage_provider) && f.file_path)
            ? `/api/files/public-image/${path.basename(f.file_path)}`
            : undefined,
          external_id: f.external_id, external_url: f.external_url,
          context: post ? { kind: 'post', id: post.id, label: post.title } : undefined,
          project_context: proj ? { id: proj.id, name: proj.name, color: proj.color } : null,
          folder_id: null, deletable: false, storage_provider: f.storage_provider
        });
      }
    }

    results.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    // 사이클 N+50 — merged results 인메모리 슬라이스 (pagination 응답 형식 정합)
    const total = results.length;
    const sliced = results.slice(offset, offset + limit);
    // 업로더/발신자 이름 = 워크스페이스 표시명 (flat uploader_name 은 helper 대상 밖이라 계정명 누출 → 표시명 맵으로 후처리. 카나리 크롤 검출 2026-07-06)
    const nameMap = await getMemberNameMap(bizId, sliced.map((r) => r.uploader_id));
    for (const r of sliced) { const dn = r.uploader_id && nameMap.get(Number(r.uploader_id)); if (dn && dn.name) r.uploader_name = dn.name; }
    return paginatedResponse(res, sliced, total, { limit, page, offset });
  } catch (error) {
    next(error);
  }
});

// ─── 프로젝트 파일 집계 (direct + chat + task + meeting) ───
router.get('/:id/files', authenticateToken, async (req, res, next) => {
  try {
    const { project, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
    if (error) return errorResponse(res, error.message, error.code);

    const bizId = project.business_id;
    const projId = project.id;
    const results = [];

    // 1) direct 파일
    const directFiles = await File.findAll({
      where: { business_id: bizId, project_id: projId, deleted_at: null },
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name'] },
        { model: FileFolder, as: 'folder', attributes: ['id', 'name'] }
      ],
      order: [['created_at', 'DESC']]
    });
    for (const f of directFiles) {
      // 이미지면 public-image 엔드포인트로 썸네일 노출 (all-files 와 동일 규칙).
      // 비이미지나 외부저장(gdrive)은 preview_url 생략.
      const isImage = f.mime_type && f.mime_type.startsWith('image/');
      const isPlanQ = f.storage_provider === 'planq' || !f.storage_provider;
      results.push({
        id: `direct-${f.id}`,
        source: 'direct',
        file_name: f.file_name,
        file_size: Number(f.file_size),
        mime_type: f.mime_type,
        uploader_id: f.uploader_id,
        uploader_name: f.uploader ? f.uploader.name : null,
        uploaded_at: (f.createdAt || f.created_at || new Date()).toISOString ? (f.createdAt || f.created_at).toISOString() : new Date().toISOString(),
        download_url: f.storage_provider === 'gdrive' && f.external_url
          ? f.external_url
          : `/api/files/${bizId}/${f.id}/download`,
        preview_url: (isImage && isPlanQ && f.file_path)
          ? `/api/files/public-image/${path.basename(f.file_path)}`
          : undefined,
        external_id: f.external_id,
        external_url: f.external_url,
        folder_id: f.folder_id,
        deletable: true,
        storage_provider: f.storage_provider
      });
    }

    // 2) chat 첨부 — 프로젝트 연결된 대화의 메시지 첨부
    const conversations = await Conversation.findAll({
      where: { business_id: bizId, project_id: projId },
      attributes: ['id', 'title', 'channel_type']
    });
    const convMap = new Map(conversations.map(c => [c.id, c]));
    if (conversations.length > 0) {
      const chatFiles = await MessageAttachment.findAll({
        include: [{
          model: Message,
          where: { conversation_id: { [Op.in]: conversations.map(c => c.id) } },
          attributes: ['id', 'conversation_id', 'sender_id'],
          include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'name_localized'] }]
        }],
        order: [['created_at', 'DESC']]
      });
      for (const a of chatFiles) {
        const conv = convMap.get(a.Message.conversation_id);
        results.push({
          id: `chat-${a.id}`,
          source: 'chat',
          file_name: a.file_name,
          file_size: Number(a.file_size),
          mime_type: a.mime_type,
          uploader_id: a.Message.sender_id,
          uploader_name: a.Message.sender ? a.Message.sender.name : null,
          uploaded_at: (a.createdAt || a.created_at || new Date()).toISOString ? (a.createdAt || a.created_at).toISOString() : new Date().toISOString(),
          download_url: a.file_path ? `/uploads/${path.relative(path.join(__dirname, '..', 'uploads'), a.file_path)}` : null,
          preview_url: (a.mime_type && a.mime_type.startsWith('image/') && a.file_path)
            ? `/api/message-attachments/public/${path.basename(a.file_path)}`
            : undefined,
          context: conv ? { kind: 'conversation', id: conv.id, label: conv.title || '대화방' } : undefined,
          folder_id: null,
          deletable: false,
          storage_provider: 'planq'
        });
      }
    }

    // 3) task 첨부 — 프로젝트의 업무에 첨부된 파일
    const tasks = await Task.findAll({
      where: { business_id: bizId, project_id: projId },
      attributes: ['id', 'title']
    });
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    if (tasks.length > 0) {
      const taskFiles = await TaskAttachment.findAll({
        where: { task_id: { [Op.in]: tasks.map(t => t.id) } },
        include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
        order: [['created_at', 'DESC']]
      });
      for (const a of taskFiles) {
        const task = taskMap.get(a.task_id);
        results.push({
          id: `task-${a.id}`,
          source: 'task',
          file_name: a.original_name || a.stored_name,
          file_size: Number(a.file_size),
          mime_type: a.mime_type,
          uploader_id: a.uploaded_by,
          uploader_name: a.uploader ? a.uploader.name : null,
          uploaded_at: (a.createdAt || a.created_at || new Date()).toISOString ? (a.createdAt || a.created_at).toISOString() : new Date().toISOString(),
          // 라우터 마운트 경로 포함 — `/public/attach/...` 는 존재하지 않는 경로라 404 였다
          download_url: a.storage_provider === 'gdrive' && a.external_url
            ? a.external_url
            : `/api/tasks/public/attach/${a.stored_name}`,
          preview_url: (a.mime_type && a.mime_type.startsWith('image/') && a.stored_name)
            ? `/api/tasks/public/attach/${a.stored_name}`
            : undefined,
          external_id: a.external_id || null,
          external_url: a.external_url || null,
          context: task ? { kind: 'task', id: task.id, label: task.title } : undefined,
          folder_id: null,
          deletable: false,
          storage_provider: 'planq'
        });
      }
    }

    // 4) meeting (Q Note) 자료는 별도 스토리지 — 현재 연동 미구현, 빈 배열 (추후 확장)

    results.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
    // 업로더/발신자 이름 = 워크스페이스 표시명 (flat uploader_name 계정명 누출 fix, 2026-07-06)
    const nameMap = await getMemberNameMap(bizId, results.map((r) => r.uploader_id));
    for (const r of results) { const dn = r.uploader_id && nameMap.get(Number(r.uploader_id)); if (dn && dn.name) r.uploader_name = dn.name; }
    successResponse(res, results);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
