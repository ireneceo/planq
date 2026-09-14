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
/**
 * 상담 메모가 **어디에 붙는가** — 화면(`components/QSale/SaleNoteThread.tsx` 의 target 판정)과
 * 서버(`routes/sale_interactions.js` 의 NOTE_KINDS)가 쓰는 **같은 술어**.
 *
 * ★ 2026-09-14 — 이것을 한 곳으로 모은 이유:
 *   목록의 `note_count` 가 **메모가 아니라 응대 내역(ClientInteraction)** 을 세고 있었다.
 *   둘은 다른 표다(메모 = `project_notes`, 응대 내역 = `client_interactions`). 그래서
 *   ①메모를 아무리 달아도 숫자가 안 늘고 ②응대 내역만 있는 행에는 메모가 0건인데도 손잡이가 떴다.
 *   [메모보기] 손잡이가 `note_count > 0` 에 달리면서 그 어긋남이 **기능 결손**이 됐다
 *   (메모를 달았는데 손잡이가 영영 안 나온다 — memory feedback_backend_done_ui_missing 계열).
 *   메일·채팅·게스트 행은 아예 `note_count` 를 받지 못해 **항상 0** 이기도 했다.
 */
const NOTE_REF_COL = { email_thread: 'email_thread_id', conversation: 'conversation_id', client: 'client_id' };

/** 행의 ref → 메모가 붙는 (칼럼, id). 게스트 링크의 메모는 그 **대화방**에 붙는다(화면과 같다). */
function noteTargetOf(ref, clientId) {
  if (!ref) return clientId ? { col: 'client_id', id: clientId } : null;
  if (ref.kind === 'guest_link') return ref.conversation_id ? { col: 'conversation_id', id: ref.conversation_id } : null;
  const col = NOTE_REF_COL[ref.kind];
  if (col && ref.id) return { col, id: ref.id };
  return clientId ? { col: 'client_id', id: clientId } : null;
}

/**
 * 목록 행들의 **메모 건수**를 한 번에 센다.
 * `personal` 은 본인 것만 — 조회 라우트(GET …/notes)와 **같은 가시성 술어**다. 안 맞추면
 * 손잡이는 뜨는데 열면 비어 있다(남의 personal 을 세는 경우).
 */
async function noteCountsForItems(items, userId) {
  const { ProjectNote } = require('../models');
  const { fn, col: colRef } = require('sequelize');
  const byCol = { email_thread_id: new Set(), conversation_id: new Set(), client_id: new Set() };
  for (const it of items) {
    const t = noteTargetOf(it.ref, it.client_id);
    if (t && byCol[t.col]) byCol[t.col].add(t.id);
  }
  const counts = new Map();                       // `${col}:${id}` → n
  // ★ **세는 것은 DB 가 센다.** 행을 끌어와 자바스크립트로 세면 `limit` 에 걸리는 순간
  //   숫자가 **조용히 작아진다** — 오류도 안 나고 손잡이만 사라진다(memory feedback_silent_no_output_paths).
  //   GROUP BY 면 대상 수만큼만 돌아오므로 상한이 곧 행 수다.
  //   칼럼이 셋이라 쿼리도 최대 셋 — 행 수와 무관하다(N+1 아님).
  for (const [c, ids] of Object.entries(byCol)) {
    if (!ids.size) continue;
    const rows = await ProjectNote.findAll({
      where: {
        [c]: { [Op.in]: [...ids] },
        // personal 은 본인 것만 — GET …/notes 와 **같은 가시성 술어**. 안 맞추면 손잡이는 뜨는데
        // 열면 비어 있다(남의 personal 을 센 경우).
        [Op.or]: [{ visibility: { [Op.ne]: 'personal' } }, { author_user_id: userId || 0 }],
      },
      attributes: [c, [fn('COUNT', colRef('id')), 'n']],
      group: [c],
      raw: true,
    });
    for (const r of rows) counts.set(`${c}:${r[c]}`, Number(r.n) || 0);
  }
  return counts;
}

/** 위 두 함수를 묶어 행에 숫자를 박는다 — 부르는 곳이 매핑을 다시 쓰지 않게. */
function applyNoteCounts(items, counts) {
  for (const it of items) {
    const t = noteTargetOf(it.ref, it.client_id);
    it.note_count = t ? (counts.get(`${t.col}:${t.id}`) || 0) : 0;
  }
  return items;
}

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
  noteTargetOf, noteCountsForItems, applyNoteCounts,

  IN_PROGRESS, SOURCES, INTERACTION_KINDS, CURRENCIES, EMAIL_RE,
  blockClient, readChain, writeChain, broadcast,
  trimOrNull, normEmail, normPhoneDigits,
  CLIENT_INCLUDE, findClient, loadClientWithIncludes, isAssignableMember, touchClient, serializeClients,
  saleOwnerWhere,
};
