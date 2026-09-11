// services/saleCommon.js — Q sale 라우트 3벌(sale · sale_interactions · sale_save)이 **같이 쓰는 것**
//
// 라우트 파일이 500줄을 넘으면 기능별로 나눈다(CLAUDE.md 파일 크기 기준). 나누되 술어는 한 벌로 둔다 —
// 체인(권한)·직렬화(접근 종류)·고객 조회를 파일마다 베끼면 한쪽만 고쳐지는 날이 온다.
const { Op } = require('sequelize');
const { Client, User, BusinessMember } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { errorResponse } = require('../middleware/errorHandler');
const { withAccess } = require('./clientAccess');

const IN_PROGRESS = ['inquiry', 'consulting', 'proposal', 'negotiation'];
const SOURCES = ['guest_link', 'email', 'phone', 'referral', 'web', 'event', 'manual', 'other'];
const INTERACTION_KINDS = ['call', 'meeting', 'visit', 'memo', 'other'];
const CURRENCIES = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'];

// memberOnly 가 이미 고객을 막지만, 이 메뉴는 고객에게 **존재 자체가 없어야** 한다 — 이중으로 둔다.
function blockClient(req, res, next) {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  return next();
}
const readChain = [authenticateToken, checkBusinessAccess, blockClient, requireMenu('qsale', 'read')];
const writeChain = [authenticateToken, checkBusinessAccess, blockClient, requireMenu('qsale', 'write')];

function broadcast(req, businessId, event, payload) {
  const io = req.app.get('io');
  if (io) io.to(`business:${businessId}`).emit(event, payload);
}

function trimOrNull(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
const normEmail = (v) => { const s = trimOrNull(v, 200); return s ? s.toLowerCase() : null; };
const normPhoneDigits = (v) => String(v || '').replace(/\D/g, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CLIENT_INCLUDE = [
  { model: User, as: 'user', attributes: ['id', 'name', 'email'] },
  { model: User, as: 'assignedMember', attributes: ['id', 'name'] },
];

async function findClient(businessId, clientId) {
  return Client.findOne({ where: { id: Number(clientId), business_id: businessId } });
}

async function loadClientWithIncludes(businessId, clientId) {
  return Client.findOne({ where: { id: Number(clientId), business_id: businessId }, include: CLIENT_INCLUDE });
}

async function isAssignableMember(businessId, userId) {
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
    attributes: ['id'],
  });
  return !!bm;
}

/**
 * "확인 필요" 에서 **누구의 것인가** — 한 함수 (docs/Q_SALE_DESIGN.md §16 U1)
 *
 * ① 담당자가 나인 고객
 * ② 담당자가 없거나 **지금 멤버가 아닌**(제거된) 사람인 고객 → owner·admin 에게
 *    ★ 멤버 제거 라우트는 `removed_at` 만 찍고 `assigned_member_id` 를 비우지 않는다.
 *      술어로 막지 않으면 퇴사자 담당 문의가 **아무 배지에도 안 뜬다**(U1 이 막으려던 바로 그 상태).
 *      제거 시 NULL 처리도 같이 하지만, 옛 행이 남아 있으므로 읽는 쪽도 막는다.
 */
async function saleOwnerWhere(businessId, userId, { isManager }) {
  const mine = { assigned_member_id: userId };
  if (!isManager) return mine;
  const members = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    attributes: ['user_id'], raw: true,
  });
  const active = members.map((m) => m.user_id).filter(Boolean);
  return {
    [Op.or]: [
      mine,
      { assigned_member_id: null },
      ...(active.length ? [{ assigned_member_id: { [Op.notIn]: active } }] : []),
    ],
  };
}

/** 마지막 접점 — 파생값이다. 뒤로 가지 않게 큰 값만 쓴다(원천은 타임라인). */
async function touchClient(client, at) {
  if (!client || !at) return;
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) return;
  if (!client.last_touch_at || new Date(client.last_touch_at) < when) {
    await client.update({ last_touch_at: when });
  }
}

/** 목록·상세 공통 직렬화 — 접근 종류는 서버가 정한다(프론트가 user_id 로 판정하지 않는다) */
async function serializeClients(businessId, rows) {
  const withA = await withAccess(businessId, rows);
  return withA.map((c) => ({
    id: c.id,
    display_name: c.display_name || c.user?.name || null,
    company_name: c.company_name,
    phone: c.phone,
    email: c.invite_email || c.user?.email || c.billing_contact_email || null,
    kind: c.kind,
    status: c.status,
    access_kind: c.access_kind,
    has_guest_link: c.has_guest_link,
    quota_counted: c.status !== 'prospect',
    sales_stage: c.sales_stage,
    sales_stage_changed_at: c.sales_stage_changed_at,
    sales_source: c.sales_source,
    lost_reason: c.lost_reason,
    lost_note: c.lost_note,
    expected_amount: c.expected_amount === null || c.expected_amount === undefined ? null : Number(c.expected_amount),
    expected_currency: c.expected_currency,
    last_touch_at: c.last_touch_at,
    assigned_member: c.assignedMember ? { id: c.assignedMember.id, name: c.assignedMember.name } : null,
    invited_at: c.invited_at,
    accepted_at: c.accepted_at,
    created_at: c.createdAt || c.created_at,
    updated_at: c.updatedAt || c.updated_at,
  }));
}

module.exports = {
  IN_PROGRESS, SOURCES, INTERACTION_KINDS, CURRENCIES, EMAIL_RE,
  blockClient, readChain, writeChain, broadcast,
  trimOrNull, normEmail, normPhoneDigits,
  CLIENT_INCLUDE, findClient, loadClientWithIncludes, isAssignableMember, touchClient, serializeClients,
  saleOwnerWhere,
};
