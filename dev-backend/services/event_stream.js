// services/event_stream.js — 워크스페이스 활동 타임라인 (읽기 전용)
// ─────────────────────────────────────────────────────────
//   6개 원장 테이블을 business_id 로 통합해 시간 역순 이벤트로 병합한다.
//   owner/admin 운영 뷰가 소비한다(라우트에서 게이트). 쓰기·부작용 0 → Fable 게이트 불필요.
//
//   business_id 도출:
//     audit_logs · invoice_status_history · project_status_history → 직접 컬럼
//     task_status_history → Task(task_id).business_id (join)
//     bill_events         → entity(invoice/quote).business_id (polymorphic, 2-step)
//     messages            → Conversation(conversation_id).business_id (join, 메타데이터만·본문 제외)
//
//   actor 정규화: user_id · actor_user_id · changed_by · sender_id → actor_user_id.
//     users.is_ai 로 사람/AI 파생(사후 배치 조회).

const { Op } = require('sequelize');
const {
  AuditLog, TaskStatusHistory, InvoiceStatusHistory, ProjectStatusHistory,
  BillEvent, Message, Task, Conversation, Invoice, Quote, User,
} = require('../models');

// 소스 카테고리 — kinds 필터가 이 이름들을 받는다
const SOURCES = ['audit', 'task', 'invoice', 'project', 'bill', 'message'];

const iso = (d) => (d ? new Date(d).toISOString() : null);

// ─── 통합 스트림 ───
//   opts: { since?: Date|ISO, actor?: userId, kinds?: string[], limit?: number }
//   반환: [{ id, source, kind, at, actor_user_id, actor_name, actor_is_ai,
//            entity_type, entity_id, from_status, to_status, summary }] (시간 역순)
async function getWorkspaceStream(businessId, opts = {}) {
  const bizId = Number(businessId);
  if (!bizId) return [];

  const since = opts.since ? new Date(opts.since) : null;
  const actor = opts.actor ? Number(opts.actor) : null;
  const kinds = (Array.isArray(opts.kinds) && opts.kinds.length)
    ? opts.kinds.filter((k) => SOURCES.includes(k))
    : SOURCES;
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  const perSource = limit;   // 소스별 최대 limit → 병합 후 상위 limit 로 다시 자른다

  const timeWhere = since ? { created_at: { [Op.gte]: since } } : {};
  const want = (k) => kinds.includes(k);
  const jobs = [];

  // ── audit_logs (business_id 직접, actor=user_id) ──
  if (want('audit')) jobs.push(
    AuditLog.findAll({
      where: { business_id: bizId, ...(actor ? { user_id: actor } : {}), ...timeWhere },
      attributes: ['id', 'action', 'target_type', 'target_id', 'user_id', 'created_at'],
      order: [['created_at', 'DESC']], limit: perSource, raw: true,
    }).then((rows) => rows.map((r) => ({
      id: `audit:${r.id}`, source: 'audit', kind: r.action,
      at: iso(r.created_at), actor_user_id: r.user_id,
      entity_type: r.target_type || null, entity_id: r.target_id || null,
      from_status: null, to_status: null, summary: r.action,
    })))
  );

  // ── invoice_status_history (business_id 직접, actor=changed_by) ──
  if (want('invoice')) jobs.push(
    InvoiceStatusHistory.findAll({
      where: { business_id: bizId, ...(actor ? { changed_by: actor } : {}), ...timeWhere },
      attributes: ['id', 'invoice_id', 'from_status', 'to_status', 'changed_by', 'created_at'],
      order: [['created_at', 'DESC']], limit: perSource, raw: true,
    }).then((rows) => rows.map((r) => ({
      id: `invoice:${r.id}`, source: 'invoice', kind: `invoice.${r.to_status}`,
      at: iso(r.created_at), actor_user_id: r.changed_by,
      entity_type: 'invoice', entity_id: r.invoice_id,
      from_status: r.from_status || null, to_status: r.to_status || null,
      summary: `invoice ${r.from_status || '·'} → ${r.to_status}`,
    })))
  );

  // ── project_status_history (business_id 직접, actor=changed_by) ──
  if (want('project')) jobs.push(
    ProjectStatusHistory.findAll({
      where: { business_id: bizId, ...(actor ? { changed_by: actor } : {}), ...timeWhere },
      attributes: ['id', 'project_id', 'from_status', 'to_status', 'changed_by', 'created_at'],
      order: [['created_at', 'DESC']], limit: perSource, raw: true,
    }).then((rows) => rows.map((r) => ({
      id: `project:${r.id}`, source: 'project', kind: `project.${r.to_status}`,
      at: iso(r.created_at), actor_user_id: r.changed_by,
      entity_type: 'project', entity_id: r.project_id,
      from_status: r.from_status || null, to_status: r.to_status || null,
      summary: `project ${r.from_status || '·'} → ${r.to_status}`,
    })))
  );

  // ── task_status_history (Task.business_id join, actor=actor_user_id) ──
  if (want('task')) jobs.push(
    TaskStatusHistory.findAll({
      where: { ...(actor ? { actor_user_id: actor } : {}), ...timeWhere },
      attributes: ['id', 'task_id', 'event_type', 'from_status', 'to_status', 'actor_user_id', 'created_at'],
      include: [{ model: Task, attributes: ['id'], where: { business_id: bizId }, required: true }],
      order: [['created_at', 'DESC']], limit: perSource,
    }).then((rows) => rows.map((r) => ({
      id: `task:${r.id}`, source: 'task', kind: `task.${r.event_type || r.to_status}`,
      at: iso(r.created_at), actor_user_id: r.actor_user_id,
      entity_type: 'task', entity_id: r.task_id,
      from_status: r.from_status || null, to_status: r.to_status || null,
      summary: `task ${r.event_type || `${r.from_status || '·'} → ${r.to_status}`}`,
    })))
  );

  // ── bill_events (polymorphic — invoice/quote id 를 먼저 모은 뒤 IN 조회) ──
  if (want('bill')) jobs.push((async () => {
    const [invIds, quoteIds] = await Promise.all([
      Invoice.findAll({ where: { business_id: bizId }, attributes: ['id'], raw: true }).then((r) => r.map((x) => x.id)),
      Quote.findAll({ where: { business_id: bizId }, attributes: ['id'], raw: true }).then((r) => r.map((x) => x.id)),
    ]);
    const or = [];
    if (invIds.length) or.push({ entity_type: 'invoice', entity_id: { [Op.in]: invIds } });
    if (quoteIds.length) or.push({ entity_type: 'quote', entity_id: { [Op.in]: quoteIds } });
    if (!or.length) return [];
    const rows = await BillEvent.findAll({
      where: { ...(actor ? { actor_user_id: actor } : {}), ...timeWhere, [Op.or]: or },
      attributes: ['id', 'entity_type', 'entity_id', 'event_type', 'actor_user_id', 'created_at'],
      order: [['created_at', 'DESC']], limit: perSource, raw: true,
    });
    return rows.map((r) => ({
      id: `bill:${r.id}`, source: 'bill', kind: `bill.${r.event_type}`,
      at: iso(r.created_at), actor_user_id: r.actor_user_id,
      entity_type: r.entity_type, entity_id: r.entity_id,
      from_status: null, to_status: null, summary: `${r.entity_type} ${r.event_type}`,
    }));
  })());

  // ── messages (Conversation.business_id join, actor=sender_id, 본문 제외·메타데이터만) ──
  if (want('message')) jobs.push(
    Message.findAll({
      where: { is_deleted: false, ...(actor ? { sender_id: actor } : {}), ...timeWhere },
      attributes: ['id', 'conversation_id', 'sender_id', 'created_at'],
      include: [{ model: Conversation, attributes: ['id'], where: { business_id: bizId }, required: true }],
      order: [['created_at', 'DESC']], limit: perSource,
    }).then((rows) => rows.map((r) => ({
      id: `message:${r.id}`, source: 'message', kind: 'message.sent',
      at: iso(r.created_at), actor_user_id: r.sender_id,
      entity_type: 'conversation', entity_id: r.conversation_id,
      from_status: null, to_status: null, summary: 'message sent',
    })))
  );

  const merged = (await Promise.all(jobs)).flat();
  merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const top = merged.slice(0, limit);

  // ── actor 배치 조회 — 사람/AI 파생 ──
  const actorIds = [...new Set(top.map((e) => e.actor_user_id).filter(Boolean))];
  const actorMap = new Map();
  if (actorIds.length) {
    const users = await User.findAll({
      where: { id: { [Op.in]: actorIds } },
      attributes: ['id', 'name', 'username', 'is_ai'], raw: true,
    });
    users.forEach((u) => actorMap.set(u.id, u));
  }
  return top.map((e) => {
    const u = e.actor_user_id ? actorMap.get(e.actor_user_id) : null;
    return {
      ...e,
      actor_name: u ? (u.name || u.username || null) : null,
      actor_is_ai: u ? !!u.is_ai : false,
    };
  });
}

module.exports = { getWorkspaceStream, SOURCES };
