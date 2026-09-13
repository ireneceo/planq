// routes/sale.js — Q sale (영업 뷰). 같은 clients 테이블의 영업 축을 다룬다. docs/Q_SALE_DESIGN.md
//
// ★ 고객(client)·게스트에게는 보이지 않는다(§4.5). 모든 라우트 체인:
//     authenticateToken → checkBusinessAccess(memberOnly) → blockClient → requireMenu('qsale', level)
//   게스트(그림자 User)는 authenticateToken 자체를 못 지난다(middleware/auth.js guest_not_allowed).
// ★ 워크스페이스는 URL(:businessId)로만 받는다 — 서버가 범위를 추측하지 않는다(워크스페이스 단일 정본 계약).
// ★ 영업 단계는 services/salesStage.js setStage 로만 바꾼다. 여기서 sales_stage 를 직접 update 하지 않는다.
// ★ 상담 기록은 routes/sale_interactions.js · "고객으로 저장" 은 routes/sale_save.js — 같은 /api/sale 접두어.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const {
  Client, User, ClientStageHistory, GuestLink, Conversation, EmailThread, Project, ProjectClient,
} = require('../models');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../services/auditService');
const { accessWhere } = require('../services/clientAccess');
const { setStage, StageError, STAGES } = require('../services/salesStage');
const planEngine = require('../services/plan');
const {
  IN_PROGRESS, SOURCES, CURRENCIES, EMAIL_RE,
  readChain, writeChain, broadcast, trimOrNull, normEmail,
  CLIENT_INCLUDE, findClient, loadClientWithIncludes, isAssignableMember, serializeClients,
} = require('../services/saleCommon');

const quotaOf = async (businessId) => {
  const [usage, limits] = await Promise.all([
    planEngine.getUsage(businessId),
    planEngine.getEffectiveLimits(businessId),
  ]);
  return {
    clients: usage.clients,
    clients_max: planEngine.limitForJson(limits.clients_max),
    prospects: usage.prospects,
    prospects_max: planEngine.limitForJson(limits.prospects_max === undefined ? Infinity : limits.prospects_max),
  };
};

// ─── 목록 ─────────────────────────────────────────────────────────
// ?q= ?stage=(in_progress|none|<stage>) ?access=(guest|invited|member) ?assignee=(<userId>|none) ?limit ?page
router.get('/:businessId/clients', ...readChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const and = [{ business_id: businessId }];

    const stage = String(req.query.stage || '');
    if (stage === 'in_progress') and.push({ sales_stage: { [Op.in]: IN_PROGRESS } });
    else if (STAGES.includes(stage)) and.push({ sales_stage: stage });

    const aw = accessWhere(String(req.query.access || ''));
    if (aw) and.push(aw);

    const assignee = String(req.query.assignee || '');
    if (assignee === 'none') and.push({ assigned_member_id: null });
    else if (/^\d+$/.test(assignee)) and.push({ assigned_member_id: Number(assignee) });

    const q = trimOrNull(req.query.q, 100);
    if (q) {
      const like = { [Op.like]: `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` };
      and.push({ [Op.or]: [
        { display_name: like }, { company_name: like }, { phone: like }, { invite_email: like },
      ] });
    }

    const { rows, count } = await Client.findAndCountAll({
      where: { [Op.and]: and },
      include: CLIENT_INCLUDE,
      // 진행 중인 영업 먼저 → 최근 접점 순 (접점 기록이 없으면 마지막 수정 시각)
      order: [
        [Client.sequelize.literal('FIELD(`Client`.`sales_stage`, \'negotiation\', \'proposal\', \'consulting\', \'inquiry\') DESC')],
        [Client.sequelize.literal('COALESCE(`Client`.`last_touch_at`, `Client`.`updated_at`)'), 'DESC'],
      ],
      limit, offset, distinct: true,
    });
    const data = await serializeClients(businessId, rows);
    return paginatedResponse(res, data, count, { limit, page, offset });
  } catch (err) { next(err); }
});

// ─── 상담(고객 미등록 접점) ────────────────────────────────────────
// Irene 2026-09-12: "상세(채팅, 메일, 전화, 등등) > 고객 이렇게 들어가야지 · 게스트가 문의하거나 이메일로 문의온 경우"
// ?source=(guest_link|email|chat, 쉼표) ?q= ?needs_reply=true ?limit
//   새 테이블 없이 원본(게스트 링크·메일 스레드·고객 대화방)에서 client_id 가 비어 있는 것만 읽는다(services/saleInbox).
router.get('/:businessId/inbox', ...readChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    // ★ 상담 = **진행 중인 상담 전부**(미등록 접점 + 영업 단계의 고객). 합치는 곳은 서비스 한 곳이다.
    const { listConsults } = require('../services/saleInbox');
    const sources = String(req.query.source || '').split(',').map((s) => s.trim()).filter(Boolean);
    const { items, counts } = await listConsults(businessId, {
      userId: req.user.id,
      isManager: req.businessRole === 'owner' || req.businessRole === 'admin' || req.user.platform_role === 'platform_admin',
      sources: sources.length ? sources : null,
      q: trimOrNull(req.query.q, 100),
      needsReply: String(req.query.needs_reply || '') === 'true',
      limit: Math.min(Math.max(Number(req.query.limit) || 100, 1), 300),
    });
    return successResponse(res, { items, counts });
  } catch (err) { next(err); }
});

// ─── 요약 (단계 칩 · 한도 두 줄) ───────────────────────────────────
router.get('/:businessId/summary', ...readChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const rows = await Client.findAll({
      where: { business_id: businessId },
      attributes: ['sales_stage', [Client.sequelize.fn('COUNT', Client.sequelize.col('id')), 'n']],
      group: ['sales_stage'], raw: true,
    });
    const stage_counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
    for (const r of rows) stage_counts[r.sales_stage] = Number(r.n) || 0;

    // 이달 성사·종결 — 이력 기준(지금 단계가 아니라 이번 달에 그 단계로 간 고객 수)
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const monthly = await ClientStageHistory.findAll({
      where: { business_id: businessId, to_stage: { [Op.in]: ['won', 'lost'] }, createdAt: { [Op.gte]: monthStart } },
      attributes: [
        'to_stage',
        [ClientStageHistory.sequelize.fn('COUNT', ClientStageHistory.sequelize.fn('DISTINCT', ClientStageHistory.sequelize.col('client_id'))), 'n'],
      ],
      group: ['to_stage'], raw: true,
    });
    const this_month = { won: 0, lost: 0 };
    for (const r of monthly) this_month[r.to_stage] = Number(r.n) || 0;

    return successResponse(res, {
      stage_counts,
      in_progress: IN_PROGRESS.reduce((s, k) => s + stage_counts[k], 0),
      this_month,
      quota: await quotaOf(businessId),
    });
  } catch (err) { next(err); }
});

// ─── 상세 ─────────────────────────────────────────────────────────
router.get('/:businessId/clients/:clientId', ...readChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const client = await loadClientWithIncludes(businessId, req.params.clientId);
    if (!client) return errorResponse(res, 'Client not found', 404);
    const [out] = await serializeClients(businessId, [client]);

    const history = await ClientStageHistory.findAll({
      where: { business_id: businessId, client_id: client.id },
      include: [{ model: User, as: 'changer', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']], limit: 30,
    });
    out.stage_history = history.map((h) => ({
      id: h.id, from: h.from_stage, to: h.to_stage, origin: h.origin, reason: h.reason,
      changed_by: h.changer ? { id: h.changer.id, name: h.changer.name } : null,
      at: h.createdAt,
    }));

    // 등록자·등록 시각 — **단계 이력의 첫 행**이 곧 등록 시점이다(새 컬럼을 만들지 않는다).
    //   Irene 2026-09-12: "문의 추가에 … 작성자 기록". 값은 이미 원장에 있었고 **화면에 없었을 뿐**이다.
    //   ★ 위 stage_history 는 최신 30건(DESC)이라 오래된 고객의 첫 행이 그 안에 없다 — 따로 읽는다.
    const firstStage = await ClientStageHistory.findOne({
      where: { business_id: businessId, client_id: client.id },
      include: [{ model: User, as: 'changer', attributes: ['id', 'name'] }],
      order: [['createdAt', 'ASC']],
    });
    out.registered_by = firstStage?.changer ? { id: firstStage.changer.id, name: firstStage.changer.name } : null;
    out.registered_at = firstStage ? firstStage.createdAt : (client.createdAt || null);

    const [conversations, threads, guestLinks] = await Promise.all([
      Conversation.count({ where: { business_id: businessId, client_id: client.id } }),
      EmailThread.count({ where: { business_id: businessId, client_id: client.id } }),
      GuestLink.count({ where: { business_id: businessId, client_id: client.id, kind: 'shared', revoked_at: null } }),
    ]);
    out.channels = { conversations, email_threads: threads, guest_links: guestLinks };

    // 연결 프로젝트 — project_clients.client_id 또는 (계정이 있으면) contact_user_id
    const pcOr = [{ client_id: client.id }];
    if (client.user_id) pcOr.push({ contact_user_id: client.user_id });
    const pcs = await ProjectClient.findAll({
      where: { [Op.or]: pcOr },
      include: [{ model: Project, attributes: ['id', 'name', 'status'], where: { business_id: businessId }, required: true }],
      attributes: ['id', 'project_id'],
    });
    const seen = new Set();
    out.projects = [];
    for (const pc of pcs) {
      if (!pc.Project || seen.has(pc.Project.id)) continue;
      seen.add(pc.Project.id);
      out.projects.push({ id: pc.Project.id, name: pc.Project.name, status: pc.Project.status });
    }

    // ★ 2026-09-12 (Irene: "설정에서 고객/파트너에 나오는 정보랑 통합해서 제대로 만들어줘") —
    //   우측 패널·전체보기·설정이 **같은 응답**을 나눠 쓴다. 화면마다 따로 모으면 반드시 갈라진다.
    //   ★ 목록용 serializeClients 는 email 을 하나로 **접어서** 내보낸다(초대→계정→청구 순).
    //     그러면 화면이 "어떤 주소인지" 를 말할 수 없다 — 상세에서는 종류별로 편다.
    //   ★ 관리(초대 재발송·보관 스위치·삭제·한도)는 여기 싣지 않는다. 그건 설정의 몫이다.
    out.contact = {
      invite_email: client.invite_email || null,
      account_email: client.user?.email || null,
      billing_email: client.billing_contact_email || null,
      tax_invoice_email: client.tax_invoice_email || null,
      phone: client.phone || null,
      billing_phone: client.billing_contact_phone || null,
      billing_contact_name: client.billing_contact_name || null,
    };
    out.biz = client.biz_name || client.biz_tax_id ? {
      name: client.biz_name || null,
      ceo: client.biz_ceo || null,
      tax_id: client.biz_tax_id || null,
      type: client.biz_type || null,
      item: client.biz_item || null,
      address: client.biz_address || null,
      address_en: client.biz_address_en || null,
    } : null;

    return successResponse(res, out);
  } catch (err) { next(err); }
});

// ─── 프로필 수정 (AutoSaveField) ───────────────────────────────────
router.patch('/:businessId/clients/:clientId', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const client = await findClient(businessId, req.params.clientId);
    if (!client) return errorResponse(res, 'Client not found', 404);
    const body = req.body || {};
    const patch = {};

    if (body.display_name !== undefined) patch.display_name = trimOrNull(body.display_name, 100);
    if (body.company_name !== undefined) patch.company_name = trimOrNull(body.company_name, 200);
    if (body.phone !== undefined) patch.phone = trimOrNull(body.phone, 40);
    if (body.email !== undefined) {
      // 초대 메일이 이미 나간 고객의 주소를 여기서 바꾸면 초대 토큰과 받는 주소가 갈라진다 — 문의 고객만
      if (client.status !== 'prospect') return errorResponse(res, 'email_locked_after_invite', 400);
      const e = normEmail(body.email);
      if (e && !EMAIL_RE.test(e)) return errorResponse(res, 'invalid_email', 400);
      patch.invite_email = e;
    }
    if (body.sales_source !== undefined) {
      if (body.sales_source !== null && !SOURCES.includes(body.sales_source)) return errorResponse(res, 'invalid_source', 400);
      patch.sales_source = body.sales_source || null;
    }
    if (body.assigned_member_id !== undefined) {
      if (body.assigned_member_id === null || body.assigned_member_id === '') patch.assigned_member_id = null;
      else {
        const uid = Number(body.assigned_member_id);
        if (!uid || !(await isAssignableMember(businessId, uid))) return errorResponse(res, 'invalid_assignee', 400);
        patch.assigned_member_id = uid;
      }
    }
    if (body.expected_amount !== undefined) {
      if (body.expected_amount === null || body.expected_amount === '') patch.expected_amount = null;
      else {
        const n = Number(body.expected_amount);
        if (!Number.isFinite(n) || n < 0 || n >= 1e12) return errorResponse(res, 'invalid_amount', 400);
        patch.expected_amount = n;
      }
    }
    if (body.expected_currency !== undefined) {
      if (body.expected_currency !== null && !CURRENCIES.includes(body.expected_currency)) return errorResponse(res, 'invalid_currency', 400);
      patch.expected_currency = body.expected_currency || null;
    }
    // 이름과 회사 중 하나는 남아야 목록에서 알아볼 수 있다
    const nextName = patch.display_name !== undefined ? patch.display_name : client.display_name;
    const nextCompany = patch.company_name !== undefined ? patch.company_name : client.company_name;
    if (!nextName && !nextCompany && !client.user_id) return errorResponse(res, 'name_required', 400);

    const before = {};
    for (const k of Object.keys(patch)) before[k] = client[k];
    await client.update(patch);
    createAuditLog({
      userId: req.user.id, businessId, action: 'client.updated', targetType: 'client', targetId: client.id,
      oldValue: before, newValue: patch,
    });
    broadcast(req, businessId, 'client:updated', { id: client.id, business_id: businessId });
    const fresh = await loadClientWithIncludes(businessId, client.id);
    const [out] = await serializeClients(businessId, [fresh]);
    return successResponse(res, out);
  } catch (err) { next(err); }
});

// ─── 단계 변경 (사람) ──────────────────────────────────────────────
router.post('/:businessId/clients/:clientId/stage', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const client = await findClient(businessId, req.params.clientId);
    if (!client) return errorResponse(res, 'Client not found', 404);
    const { to, reason, lost_reason: lostReason, lost_note: lostNote } = req.body || {};
    try {
      const r = await setStage(client, String(to || ''), {
        origin: 'manual', by: req.user.id, reason, lostReason, lostNote, io: req.app.get('io'),
      });
      return successResponse(res, { ...r, sales_stage: client.sales_stage, sales_stage_changed_at: client.sales_stage_changed_at });
    } catch (e) {
      if (e instanceof StageError) return errorResponse(res, e.code, e.status);
      throw e;
    }
  } catch (err) { next(err); }
});

// ─── 타임라인 (기존 4채널 + 상담 기록·단계·게스트 링크) ─────────────
router.get('/:businessId/clients/:clientId/timeline', ...readChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const client = await Client.findOne({ where: { id: Number(req.params.clientId), business_id: businessId }, attributes: ['id'] });
    if (!client) return errorResponse(res, 'Client not found', 404);
    const { getClientTimeline, ALL_CHANNELS } = require('../services/clientTimeline');
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
    const asked = req.query.channels ? String(req.query.channels).split(',').map((s) => s.trim()).filter(Boolean) : [];
    const channels = asked.length ? asked.filter((c) => ALL_CHANNELS.includes(c)) : ALL_CHANNELS;
    const out = await getClientTimeline(businessId, client.id, {
      userId: req.user.id, limit, before: req.query.before || null, channels,
      // 요약 자리(우측 패널)만 채널 쿼터를 쓴다 — 전체 목록은 시간순 그대로가 사실이다
      balanced: req.query.balanced === '1' || req.query.balanced === 'true',
    });
    return successResponse(res, out);
  } catch (err) { next(err); }
});

// 한도 두 줄 — 초대 모달·고객 관리 화면이 같은 값을 쓴다(화면이 직접 세지 않는다)
router.get('/:businessId/quota', ...readChain, async (req, res, next) => {
  try {
    return successResponse(res, await quotaOf(Number(req.params.businessId)));
  } catch (err) { next(err); }
});

module.exports = router;
