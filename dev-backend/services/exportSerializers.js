// services/exportSerializers.js — 워크스페이스 백업의 «구조 데이터» 영역 한 벌
//   (2026-10-23, Fable 설계 docs/TRUST_SERVICES_DESIGN.md D3)
//
// ★ 컬럼은 **화이트리스트**다. 모델을 통째로(toJSON·`*`) 내보내지 않는다 — 컬럼이 늘면 그대로 샌다.
//   공유 토큰·초대 토큰·설문 열쇠·비밀번호 해시·Drive/Stripe 식별자·`_enc` 류는 목록에 **아예 없다**.
// ★ 빼는 것은 제품과 **같은 술어**다: «나만 보기»(vlevel L1) 는 모든 영역에서 · 사적 팀 대화는
//   access_scope.isPrivateConversation 과 같은 정의 · 지운 메시지는 maskDeletedMessages 뒤에 쓴다 ·
//   업무 «개인 메모» 댓글(visibility personal) · Q info·표의 비밀(secret) 칸은 라벨까지 뺀다(kbClientView 와 같은 선).
// ★ AREAS 의 key 와 EXCLUDED 의 area 는 화면 «포함 목록»(i18n common.trust.backupAreas.*)과 manifest.coverage 의
//   **한 원천**이다. 영역을 더하면 i18n 두 언어에 한 줄씩 더한다(e2e 가 대조한다).
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const m = require('../models');
const { csvLine, CSV_BOM } = require('../utils/csv');
const { maskDeletedMessages } = require('../utils/deletedMessage');
const { publicColumns, publicValues } = require('./kbClientView');

const CHUNK = 1000;

const notPrivate = { [Op.or]: [{ vlevel: { [Op.ne]: 'L1' } }, { vlevel: null }] };

// isPrivateConversation 의 SQL 판 — 프로젝트·고객이 없는 internal/group(또는 비어 있는 channel_type) 대화.
const notPrivateConversation = {
  [Op.or]: [
    { project_id: { [Op.ne]: null } },
    { client_id: { [Op.ne]: null } },
    { channel_type: { [Op.notIn]: ['internal', 'group'] } },
  ],
};

// 표(엑셀) 한 장 = 같은 행을 CSV + JSON 두 파일로
class TableWriter {
  constructor(dir, name, headers) {
    this.name = name;
    this.headers = headers;
    this.count = 0;
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    this.csvPath = path.join(dir, `${name}.csv`);
    this.jsonPath = path.join(dir, `${name}.json`);
    this.csv = fs.createWriteStream(this.csvPath);
    this.json = fs.createWriteStream(this.jsonPath);
    this.csv.write(CSV_BOM + csvLine(headers) + '\n');
    this.json.write('[\n');
  }
  async write(obj) {
    const line = csvLine(this.headers.map((h) => obj[h]));
    const okA = this.csv.write(line + '\n');
    const okB = this.json.write((this.count ? ',\n' : '') + JSON.stringify(obj));
    this.count += 1;
    if (!okA) await new Promise((r) => this.csv.once('drain', r));
    if (!okB) await new Promise((r) => this.json.once('drain', r));
  }
  close() {
    this.json.write('\n]\n');
    return Promise.all([
      new Promise((r) => this.csv.end(r)),
      new Promise((r) => this.json.end(r)),
    ]);
  }
}

// id 오름차순 1,000행씩 — 메모리에 영역 전체를 올리지 않는다
async function* chunks(Model, where, attributes) {
  let lastId = 0;
  for (;;) {
    const rows = await Model.findAll({
      where: { [Op.and]: [where, { id: { [Op.gt]: lastId } }] },
      attributes, order: [['id', 'ASC']], limit: CHUNK, raw: true,
    });
    if (!rows.length) return;
    yield rows;
    lastId = rows[rows.length - 1].id;
    if (rows.length < CHUNK) return;
  }
}

// 부모 id 묶음의 자식 행
async function childrenOf(Model, fk, ids, where, attributes) {
  if (!ids.length) return [];
  return Model.findAll({
    where: { [Op.and]: [{ [fk]: { [Op.in]: ids } }, where || {}] },
    attributes, order: [['id', 'ASC']], raw: true,
  });
}

const ts = (r, a) => r[a] || r[a.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] || null;

// 사람 이름 — id 만 있는 표는 읽을 수 없다. 워크스페이스 표시명 > 계정 이름.
async function peopleOf(businessId) {
  const map = new Map();
  const members = await m.BusinessMember.findAll({
    where: { business_id: businessId },
    attributes: ['user_id', 'name'],
    include: [{ model: m.User, as: 'user', attributes: ['id', 'name'], required: false }],
  }).catch(() => []);
  for (const bm of members) {
    if (bm.user_id) map.set(bm.user_id, bm.name || (bm.user && bm.user.name) || '');
  }
  const clients = await m.Client.findAll({ where: { business_id: businessId, user_id: { [Op.ne]: null } }, attributes: ['user_id', 'display_name'], raw: true });
  for (const c of clients) if (!map.has(c.user_id)) map.set(c.user_id, c.display_name || '');
  return (id) => (id ? (map.get(id) || `#${id}`) : '');
}

// ── 영역 ────────────────────────────────────────────────────────────────

async function exportTasks(ctx) {
  const tTasks = ctx.table('tasks/tasks', ['id', 'title', 'status', 'project_id', 'client_id', 'assignee', 'requested_by', 'created_by',
    'start_date', 'due_date', 'completed_at', 'estimated_hours', 'actual_hours', 'progress_percent', 'priority_level', 'category',
    'security_level', 'visibility', 'description', 'body', 'recurrence_rule', 'created_at', 'updated_at']);
  const tComments = ctx.table('tasks/task_comments', ['id', 'task_id', 'author', 'visibility', 'kind', 'content', 'created_at']);
  const tHistory = ctx.table('tasks/task_status_history', ['id', 'task_id', 'event_type', 'from_status', 'to_status', 'actor', 'round', 'note', 'created_at']);
  const tAtt = ctx.table('tasks/task_attachments', ['id', 'task_id', 'context', 'file_name', 'file_size', 'mime_type', 'uploaded_by', 'created_at']);
  const attrs = ['id', 'title', 'status', 'project_id', 'client_id', 'assignee_id', 'request_by_user_id', 'created_by', 'start_date', 'due_date',
    'completed_at', 'estimated_hours', 'actual_hours', 'progress_percent', 'priority_level', 'category', 'security_level', 'vlevel',
    'description', 'body', 'recurrence_rule', 'createdAt', 'updatedAt'];
  for await (const rows of chunks(m.Task, { business_id: ctx.businessId, ...notPrivate }, attrs)) {
    for (const r of rows) {
      await tTasks.write({
        id: r.id, title: r.title, status: r.status, project_id: r.project_id, client_id: r.client_id,
        assignee: ctx.who(r.assignee_id), requested_by: ctx.who(r.request_by_user_id), created_by: ctx.who(r.created_by),
        start_date: r.start_date, due_date: r.due_date, completed_at: r.completed_at, estimated_hours: r.estimated_hours,
        actual_hours: r.actual_hours, progress_percent: r.progress_percent, priority_level: r.priority_level, category: r.category,
        security_level: r.security_level, visibility: r.vlevel, description: ctx.text(r.description), body: ctx.text(r.body),
        recurrence_rule: r.recurrence_rule, created_at: ts(r, 'created_at'), updated_at: ts(r, 'updated_at'),
      });
    }
    const ids = rows.map((r) => r.id);
    for (const c of await childrenOf(m.TaskComment, 'task_id', ids,
      { [Op.and]: [{ [Op.or]: [{ visibility: { [Op.ne]: 'personal' } }, { visibility: null }] }, notPrivate] },
      ['id', 'task_id', 'user_id', 'visibility', 'kind', 'content', 'createdAt'])) {
      await tComments.write({ id: c.id, task_id: c.task_id, author: ctx.who(c.user_id), visibility: c.visibility, kind: c.kind,
        content: ctx.text(c.content), created_at: ts(c, 'created_at') });
    }
    for (const h of await childrenOf(m.TaskStatusHistory, 'task_id', ids, null,
      ['id', 'task_id', 'event_type', 'from_status', 'to_status', 'actor_user_id', 'round', 'note', 'createdAt'])) {
      await tHistory.write({ id: h.id, task_id: h.task_id, event_type: h.event_type, from_status: h.from_status, to_status: h.to_status,
        actor: ctx.who(h.actor_user_id), round: h.round, note: h.note, created_at: ts(h, 'created_at') });
    }
    for (const a of await childrenOf(m.TaskAttachment, 'task_id', ids, { business_id: ctx.businessId },
      ['id', 'task_id', 'context', 'original_name', 'file_size', 'mime_type', 'uploaded_by', 'created_at'])) {
      await tAtt.write({ id: a.id, task_id: a.task_id, context: a.context, file_name: a.original_name, file_size: a.file_size,
        mime_type: a.mime_type, uploaded_by: ctx.who(a.uploaded_by), created_at: a.created_at });
    }
  }
}

async function exportProjects(ctx) {
  const tP = ctx.table('projects/projects', ['id', 'name', 'status', 'kind', 'project_type', 'visibility', 'client_company', 'owner', 'start_date', 'end_date',
    'contract_amount', 'billing_type', 'monthly_fee', 'monthly_vat_rate', 'monthly_tax_mode', 'description', 'strategy_goal', 'created_at', 'updated_at']);
  const tM = ctx.table('projects/project_members', ['project_id', 'member', 'role', 'is_pm']);
  const tC = ctx.table('projects/project_clients', ['project_id', 'client_id', 'contact_name', 'contact_email', 'invited_at']);
  for await (const rows of chunks(m.Project, { business_id: ctx.businessId },
    ['id', 'name', 'status', 'kind', 'project_type', 'visibility', 'client_company', 'owner_user_id', 'start_date', 'end_date',
      'contract_amount', 'billing_type', 'monthly_fee', 'monthly_vat_rate', 'monthly_tax_mode', 'description', 'strategy_goal', 'createdAt', 'updatedAt'])) {
    for (const r of rows) {
      await tP.write({ id: r.id, name: r.name, status: r.status, kind: r.kind, project_type: r.project_type, visibility: r.visibility,
        client_company: r.client_company, owner: ctx.who(r.owner_user_id), start_date: r.start_date, end_date: r.end_date,
        contract_amount: r.contract_amount, billing_type: r.billing_type, monthly_fee: r.monthly_fee, monthly_vat_rate: r.monthly_vat_rate, monthly_tax_mode: r.monthly_tax_mode, description: ctx.text(r.description),
        strategy_goal: r.strategy_goal, created_at: ts(r, 'created_at'), updated_at: ts(r, 'updated_at') });
    }
    const ids = rows.map((r) => r.id);
    for (const pm of await childrenOf(m.ProjectMember, 'project_id', ids, null, ['id', 'project_id', 'user_id', 'role', 'is_pm'])) {
      await tM.write({ project_id: pm.project_id, member: ctx.who(pm.user_id), role: pm.role, is_pm: pm.is_pm });
    }
    for (const pc of await childrenOf(m.ProjectClient, 'project_id', ids, null, ['id', 'project_id', 'client_id', 'contact_name', 'contact_email', 'invited_at'])) {
      await tC.write({ project_id: pc.project_id, client_id: pc.client_id, contact_name: pc.contact_name, contact_email: pc.contact_email, invited_at: pc.invited_at });
    }
  }
}

const CLIENT_COLS = ['id', 'display_name', 'company_name', 'status', 'kind', 'sales_stage', 'sales_source', 'invite_email', 'phone', 'job_title', 'department',
  'country', 'is_business', 'biz_name', 'biz_ceo', 'biz_tax_id', 'biz_type', 'biz_item', 'biz_address', 'tax_invoice_email',
  'billing_contact_name', 'billing_contact_email', 'billing_contact_phone', 'expected_amount', 'expected_currency', 'assigned_member_id',
  'notes', 'summary', 'last_touch_at', 'createdAt', 'updatedAt'];

async function exportClients(ctx) {
  const headers = CLIENT_COLS.map((c) => (c === 'invite_email' ? 'email' : c === 'assigned_member_id' ? 'assigned_member'
    : c === 'createdAt' ? 'created_at' : c === 'updatedAt' ? 'updated_at' : c));
  const tC = ctx.table('clients/clients', headers);
  const tI = ctx.table('clients/client_interactions', ['id', 'client_id', 'project_id', 'kind', 'direction', 'occurred_at', 'duration_seconds',
    'title', 'body', 'summary', 'created_by', 'created_at']);
  for await (const rows of chunks(m.Client, { business_id: ctx.businessId }, CLIENT_COLS)) {
    for (const r of rows) {
      const o = {};
      CLIENT_COLS.forEach((c, i) => { o[headers[i]] = r[c]; });
      o.assigned_member = ctx.who(r.assigned_member_id);
      o.notes = ctx.text(r.notes);
      await tC.write(o);
    }
  }
  for await (const rows of chunks(m.ClientInteraction, { business_id: ctx.businessId, deleted_at: null },
    ['id', 'client_id', 'project_id', 'kind', 'direction', 'occurred_at', 'duration_seconds', 'title', 'body', 'summary', 'created_by', 'createdAt'])) {
    for (const r of rows) {
      await tI.write({ id: r.id, client_id: r.client_id, project_id: r.project_id, kind: r.kind, direction: r.direction, occurred_at: r.occurred_at,
        duration_seconds: r.duration_seconds, title: r.title, body: ctx.text(r.body), summary: ctx.text(r.summary), created_by: ctx.who(r.created_by),
        created_at: ts(r, 'created_at') });
    }
  }
}

async function exportConversations(ctx) {
  const tC = ctx.table('conversations/conversations', ['id', 'title', 'channel_type', 'project_id', 'client_id', 'status', 'last_message_at', 'created_at']);
  const tP = ctx.table('conversations/conversation_participants', ['conversation_id', 'person', 'role', 'joined_at']);
  const tM = ctx.table('conversations/messages', ['id', 'conversation_id', 'sender', 'kind', 'content', 'is_ai', 'is_internal', 'is_edited',
    'is_deleted', 'reply_to_message_id', 'created_at']);
  for await (const rows of chunks(m.Conversation, { business_id: ctx.businessId, ...notPrivateConversation },
    ['id', 'title', 'display_name', 'channel_type', 'project_id', 'client_id', 'status', 'last_message_at', 'createdAt'])) {
    for (const r of rows) {
      await tC.write({ id: r.id, title: r.display_name || r.title, channel_type: r.channel_type, project_id: r.project_id, client_id: r.client_id,
        status: r.status, last_message_at: r.last_message_at, created_at: ts(r, 'created_at') });
    }
    const ids = rows.map((r) => r.id);
    for (const p of await childrenOf(m.ConversationParticipant, 'conversation_id', ids, null, ['id', 'conversation_id', 'user_id', 'role', 'joined_at'])) {
      await tP.write({ conversation_id: p.conversation_id, person: ctx.who(p.user_id), role: p.role, joined_at: p.joined_at });
    }
    // 대화 하나씩 메시지를 1,000행씩 — 한 대화에 수만 줄이 있어도 메모리에 다 올리지 않는다
    for (const convId of ids) {
      for await (const msgs of chunks(m.Message, { conversation_id: convId },
        ['id', 'conversation_id', 'sender_id', 'kind', 'content', 'is_ai', 'is_internal', 'is_edited', 'is_deleted', 'reply_to_message_id', 'createdAt'])) {
        maskDeletedMessages(msgs);
        for (const g of msgs) {
          await tM.write({ id: g.id, conversation_id: g.conversation_id || convId, sender: g.is_ai ? 'Cue' : ctx.who(g.sender_id), kind: g.kind,
            content: g.content, is_ai: g.is_ai, is_internal: g.is_internal, is_edited: g.is_edited, is_deleted: !!g.is_deleted,
            reply_to_message_id: g.reply_to_message_id, created_at: ts(g, 'created_at') });
        }
      }
    }
  }
}

async function exportCalendar(ctx) {
  const t = ctx.table('calendar/events', ['id', 'title', 'start_at', 'end_at', 'all_day', 'location', 'category', 'project_id', 'meeting_url',
    'visibility', 'booking_status', 'rrule', 'description', 'created_by', 'created_at']);
  for await (const rows of chunks(m.CalendarEvent, { business_id: ctx.businessId, ...notPrivate },
    ['id', 'title', 'start_at', 'end_at', 'all_day', 'location', 'category', 'project_id', 'meeting_url', 'vlevel', 'booking_status', 'rrule',
      'description', 'created_by', 'createdAt'])) {
    for (const r of rows) {
      await t.write({ id: r.id, title: r.title, start_at: r.start_at, end_at: r.end_at, all_day: r.all_day, location: r.location, category: r.category,
        project_id: r.project_id, meeting_url: r.meeting_url, visibility: r.vlevel, booking_status: r.booking_status, rrule: r.rrule,
        description: ctx.text(r.description), created_by: ctx.who(r.created_by), created_at: ts(r, 'created_at') });
    }
  }
}

const INVOICE_COLS = ['id', 'invoice_number', 'title', 'client_id', 'project_id', 'status', 'currency', 'subtotal', 'vat_rate', 'tax_mode', 'tax_amount', 'total_amount',
  'grand_total', 'paid_amount', 'installment_mode', 'payment_method', 'receipt_type', 'issued_at', 'due_date', 'paid_at', 'sent_at', 'recipient_email',
  'recipient_business_name', 'recipient_business_number', 'payment_terms', 'tax_invoice_status', 'tax_invoice_issued_at', 'cash_receipt_status',
  'cash_receipt_no', 'notes', 'createdAt'];

async function exportInvoices(ctx) {
  const headers = INVOICE_COLS.map((c) => (c === 'createdAt' ? 'created_at' : c));
  const tI = ctx.table('invoices/invoices', headers);
  const tIt = ctx.table('invoices/invoice_items', ['invoice_id', 'description', 'detail', 'quantity', 'unit_price', 'amount', 'sort_order']);
  const tInst = ctx.table('invoices/invoice_installments', ['invoice_id', 'installment_no', 'label', 'percent', 'amount', 'due_date', 'status', 'paid_at',
    'tax_invoice_no', 'tax_invoice_at', 'cash_receipt_no', 'cash_receipt_at']);
  for await (const rows of chunks(m.Invoice, { business_id: ctx.businessId }, INVOICE_COLS)) {
    for (const r of rows) {
      const o = {};
      INVOICE_COLS.forEach((c, i) => { o[headers[i]] = r[c]; });
      await tI.write(o);
    }
    const ids = rows.map((r) => r.id);
    for (const it of await childrenOf(m.InvoiceItem, 'invoice_id', ids, null, ['id', 'invoice_id', 'description', 'detail', 'quantity', 'unit_price', 'amount', 'sort_order'])) {
      await tIt.write(it);
    }
    for (const s of await childrenOf(m.InvoiceInstallment, 'invoice_id', ids, null, ['id', 'invoice_id', 'installment_no', 'label', 'percent', 'amount',
      'due_date', 'status', 'paid_at', 'tax_invoice_no', 'tax_invoice_at', 'cash_receipt_no', 'cash_receipt_at'])) {
      await tInst.write(s);
    }
  }
}

async function exportKnowledge(ctx) {
  const t = ctx.table('knowledge/knowledge', ['id', 'title', 'category', 'scope', 'project_id', 'client_id', 'tags', 'security_level', 'visibility',
    'fields', 'body', 'created_by', 'created_at', 'updated_at']);
  for await (const rows of chunks(m.KbDocument, { business_id: ctx.businessId, deleted_at: null, ...notPrivate },
    ['id', 'title', 'category', 'scope', 'project_id', 'client_id', 'tags', 'security_level', 'vlevel', 'custom_columns', 'custom_values', 'body',
      'uploaded_by', 'createdAt', 'updatedAt'])) {
    for (const r of rows) {
      const doc = { custom_columns: parseJson(r.custom_columns), custom_values: parseJson(r.custom_values) };
      const cols = publicColumns(doc);
      const vals = publicValues(doc, cols);
      const fields = {};
      for (const c of cols) if (vals[c.id] != null && vals[c.id] !== '') fields[c.name || c.id] = vals[c.id];
      await t.write({ id: r.id, title: r.title, category: r.category, scope: r.scope, project_id: r.project_id, client_id: r.client_id,
        tags: parseJson(r.tags), security_level: r.security_level, visibility: r.vlevel, fields, body: r.body,
        created_by: ctx.who(r.uploaded_by), created_at: ts(r, 'created_at'), updated_at: ts(r, 'updated_at') });
    }
  }
}

async function exportTables(ctx) {
  const tIndex = ctx.table('tables/_tables', ['id', 'name', 'category', 'project_id', 'rows', 'file', 'created_at']);
  for await (const rows of chunks(m.QRecord, { business_id: ctx.businessId, ...notPrivate },
    ['id', 'name', 'category', 'project_id', 'columns', 'createdAt'])) {
    for (const r of rows) {
      const cols = (parseJson(r.columns) || []).filter((c) => c && c.id && c.type !== 'secret')
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      const used = new Map();
      const heads = ['row_id', ...cols.map((c) => { const n = String(c.name || c.id); const k = used.get(n) || 0; used.set(n, k + 1); return k ? `${n} (${k + 1})` : n; })];
      const file = `tables/table-${r.id}`;
      const tw = ctx.table(file, heads);
      for await (const rr of chunks(m.QRecordRow, { q_record_id: r.id }, ['id', 'values'])) {
        for (const row of rr) {
          const v = parseJson(row.values) || {};
          const o = { row_id: row.id };
          cols.forEach((c, i) => { o[heads[i + 1]] = v[c.id]; });
          await tw.write(o);
        }
      }
      await tIndex.write({ id: r.id, name: r.name, category: r.category, project_id: r.project_id, rows: tw.count, file: `${file}.csv`, created_at: ts(r, 'created_at') });
    }
  }
}

function parseJson(v) {
  if (v == null || typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

// 화면 «포함 목록» 과 같은 키(i18n common.trust.backupAreas.<key>)
const AREAS = [
  { key: 'tasks', run: exportTasks },
  { key: 'projects', run: exportProjects },
  { key: 'clients', run: exportClients },
  { key: 'conversations', run: exportConversations },
  { key: 'calendar', run: exportCalendar },
  { key: 'invoices', run: exportInvoices },
  { key: 'knowledge', run: exportKnowledge },
  { key: 'tables', run: exportTables },
];
// files·documents 는 기존 zip 분기(routes/export collectWorkspace)가 담는다 — 목록 키만 같이 쓴다.
const INCLUDED_KEYS = ['files', 'documents', ...AREAS.map((a) => a.key)];
const EXCLUDED = [
  { area: 'private', reason: 'private_items' },        // 나만 보기 · 사적 팀 대화 · 개인 메모 댓글
  { area: 'drive_files', reason: 'stored_in_drive' },  // Google Drive 에 저장된 파일은 Drive 에 원본이 있다
  { area: 'secret_fields', reason: 'secret_values' },  // Q info·표의 비밀 칸
  { area: 'mail', reason: 'next_phase' },
  { area: 'qnote', reason: 'personal_space' },         // 워크스페이스분은 다음 단계, 본인 것은 개인 내보내기
  { area: 'attendance_payroll', reason: 'next_phase' },
  { area: 'audit_logs', reason: 'next_phase' },
];

// HTML 본문(업무 설명 등)을 사람이 읽는 글로 — 표에 태그가 그대로 들어가지 않게
function htmlToText(v) {
  if (v == null) return v;
  const s = String(v);
  if (!/[<>]/.test(s)) return s;
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// 워크스페이스 구조 데이터 전부를 dir 아래 data/… 에 쓴다. 돌려주는 값 = 표별 행 수(manifest 용).
async function writeWorkspaceData(businessId, dir) {
  const tables = [];
  const ctx = {
    businessId,
    who: await peopleOf(businessId),
    text: htmlToText,
    table(name, headers) {
      const tw = new TableWriter(path.join(dir, 'data'), name, headers);
      tables.push(tw);
      return tw;
    },
  };
  for (const a of AREAS) {
    await a.run(ctx);
  }
  await Promise.all(tables.map((t) => t.close()));
  return tables.map((t) => ({ file: `data/${t.name}.csv`, json: `data/${t.name}.json`, rows: t.count, csvPath: t.csvPath, jsonPath: t.jsonPath }));
}

// 미리보기 — 영역별 대략 행 수(같은 술어)
async function previewCounts(businessId) {
  const [tasks, projects, clients, conversations, calendar, invoices, knowledge, tables] = await Promise.all([
    m.Task.count({ where: { business_id: businessId, ...notPrivate } }),
    m.Project.count({ where: { business_id: businessId } }),
    m.Client.count({ where: { business_id: businessId } }),
    m.Conversation.count({ where: { business_id: businessId, ...notPrivateConversation } }),
    m.CalendarEvent.count({ where: { business_id: businessId, ...notPrivate } }),
    m.Invoice.count({ where: { business_id: businessId } }),
    m.KbDocument.count({ where: { business_id: businessId, deleted_at: null, ...notPrivate } }),
    m.QRecord.count({ where: { business_id: businessId, ...notPrivate } }),
  ]);
  return { tasks, projects, clients, conversations, calendar, invoices, knowledge, tables };
}

module.exports = { writeWorkspaceData, previewCounts, INCLUDED_KEYS, EXCLUDED, AREAS };
