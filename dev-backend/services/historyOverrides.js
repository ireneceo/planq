// services/historyOverrides.js — 자동 히스토리 «글 고치기» 한 곳 (2026-11-02)
// ─────────────────────────────────────────────────────────
//   Irene: *"자동기록 히스토리를 수동으로 수정하고 싶어. 수정하게 해주고 자동생성이 다시 또 되면서 엉망이 안되게 … 각 항목별 글자 수정"*
//   설계 docs/HISTORY_OVERRIDE_DESIGN.md (Fable 설계 판정 DESIGN-READY).
//
//   ★ 원장은 한 글자도 안 고친다. 표시 글은 읽을 때마다 원장에서 다시 만들어지므로(event_stream·/workflow),
//     사람이 고친 «설명 줄» 은 history_overrides 에 원장 좌표(source_table, source_id)로 두고
//     **읽기 마지막 단계에서** 여기 applyOverrides 가 덧입힌다. 새 사건은 새 좌표라 덮어쓰기 없이 정상 추가된다.
//   ★ 이벤트 id 접두어 ↔ 좌표 변환은 이 파일에만 둔다 — 접두어 문자열을 다른 파일에서 다시 쓰지 않는다.
//   ★ 고칠 수 있는 칸은 note 하나다. 라벨·이름·from→to·대상·회차·시각·작성자는 사실이라 안 고친다
//     (이름은 객체 이름을 바꾸면 따라온다). title 칸은 예약.
const { Op } = require('sequelize');

// 좌표 표 이름 ↔ 프로젝트 히스토리 이벤트 id 접두어
const PREFIX_OF = {
  task_status_history: 'task-status',
  project_status_history: 'project',
  invoice_status_history: 'invoice',
  task_created: 'task-created',
  project_created: 'project-created',
  post: 'post',
  file: 'file',
  project_note: 'note',
  qnote: 'qnote',
  client_interaction: 'interaction',
};
const TABLE_OF = Object.fromEntries(Object.entries(PREFIX_OF).map(([t, p]) => [p, t]));
const SOURCE_TABLES = Object.keys(PREFIX_OF);
const TASK_TABLES = new Set(['task_status_history', 'task_created']);
const EDITABLE = ['note'];
const NOTE_MAX = 1000;

function isSourceTable(t) { return SOURCE_TABLES.includes(String(t)); }

/** 'task-status:17' → { source_table:'task_status_history', source_id:17 } (모르는 접두어·manual 이면 null) */
function refOfEventId(id) {
  const s = String(id || '');
  const i = s.lastIndexOf(':');
  if (i < 0) return null;
  const table = TABLE_OF[s.slice(0, i)];
  const num = Number(s.slice(i + 1));
  if (!table || !Number.isFinite(num) || num <= 0) return null;
  return { source_table: table, source_id: num };
}
function eventIdOf(ref) { return `${PREFIX_OF[ref.source_table]}:${ref.source_id}`; }
const keyOf = (t, id) => `${t}:${Number(id)}`;

/**
 * 좌표가 가리키는 원장 행의 범위 — 워크스페이스·프로젝트·업무. 없는 행이면 null.
 *   business_id 는 **여기서만** 정한다(요청 값을 믿지 않는다).
 *   opts.projectId — 원장만으로 프로젝트가 정해지지 않는 좌표(qnote·상담 기록)에서 요청이 준 프로젝트.
 */
async function resolveScope(ref, opts = {}) {
  const m = require('../models');
  const id = Number(ref.source_id);
  const pick = (business_id, project_id, extra = {}) => (business_id
    ? { business_id: Number(business_id), project_id: project_id ? Number(project_id) : null, ...extra } : null);
  switch (ref.source_table) {
    case 'task_status_history': {
      const h = await m.TaskStatusHistory.findByPk(id, { attributes: ['id', 'task_id'], raw: true });
      if (!h) return null;
      const task = await m.Task.findByPk(h.task_id);
      return task ? pick(task.business_id, task.project_id, { task }) : null;
    }
    case 'task_created': {
      const task = await m.Task.findByPk(id);
      return task ? pick(task.business_id, task.project_id, { task }) : null;
    }
    case 'project_status_history': {
      const r = await m.ProjectStatusHistory.findByPk(id, { attributes: ['business_id', 'project_id'], raw: true });
      return r ? pick(r.business_id, r.project_id) : null;
    }
    case 'project_created': {
      const p = await m.Project.findByPk(id, { attributes: ['id', 'business_id'], raw: true });
      return p ? pick(p.business_id, p.id) : null;
    }
    case 'invoice_status_history': {
      const r = await m.InvoiceStatusHistory.findByPk(id, { attributes: ['business_id', 'invoice_id'], raw: true });
      if (!r) return null;
      const inv = await m.Invoice.findByPk(r.invoice_id, { attributes: ['business_id', 'project_id'], raw: true });
      if (!inv || Number(inv.business_id) !== Number(r.business_id)) return null;
      return pick(r.business_id, inv.project_id);
    }
    case 'post': {
      const r = await m.Post.findByPk(id, { attributes: ['business_id', 'project_id', 'author_id', 'vlevel'], raw: true });
      return r ? pick(r.business_id, r.project_id, { owner: r.author_id, l1: r.vlevel === 'L1' }) : null;
    }
    case 'file': {
      const r = await m.File.findByPk(id, { attributes: ['business_id', 'project_id', 'uploader_id', 'vlevel', 'deleted_at'], raw: true });
      return (r && !r.deleted_at) ? pick(r.business_id, r.project_id, { owner: r.uploader_id, l1: r.vlevel === 'L1' }) : null;
    }
    case 'project_note': {
      const r = await m.ProjectNote.findByPk(id, { attributes: ['business_id', 'project_id', 'author_user_id', 'visibility'], raw: true });
      return r ? pick(r.business_id, r.project_id, { owner: r.author_user_id, l1: r.visibility === 'personal' }) : null;
    }
    case 'client_interaction': {
      // 상담 기록은 고객에 붙는다 — 그 고객이 요청한 프로젝트에 연결돼 있을 때만(히스토리 소스와 같은 선, project_clients).
      const r = await m.ClientInteraction.findByPk(id, { attributes: ['business_id', 'client_id', 'deleted_at'], raw: true });
      if (!r || r.deleted_at || !opts.projectId) return null;
      const link = await m.ProjectClient.findOne({ where: { project_id: Number(opts.projectId), client_id: r.client_id }, attributes: ['project_id'], raw: true });
      return link ? pick(r.business_id, opts.projectId) : null;
    }
    case 'qnote': {
      // Q Note 는 다른 서비스(SQLite)라 행을 못 읽는다 — 요청이 준 프로젝트로 범위를 잡는다.
      if (!opts.projectId) return null;
      const p = await m.Project.findByPk(Number(opts.projectId), { attributes: ['id', 'business_id'], raw: true });
      return p ? pick(p.business_id, p.id) : null;
    }
    default: return null;
  }
}

/**
 * 이 사람이 이 좌표의 설명 줄을 고칠 수 있나 — { ok, scope } 또는 { ok:false, http, code }.
 *   업무 계열: 업무를 볼 수 있음(canAccessTask) ∧ 워크스페이스 멤버(고객 아님).
 *   프로젝트 계열: 프로젝트 역할 ≠ client(loadProjectOrForbidden — 프로젝트 조회와 같은 문) ∧ 나만 보기 항목은 주인만.
 */
async function authorize(userId, ref, opts = {}) {
  const scope = await resolveScope(ref, opts);
  if (!scope) return { ok: false, http: 404, code: 'not_found' };
  const { requireBusinessMember, loadProjectOrForbidden } = require('./projectAccess');
  const bm = await requireBusinessMember(userId, scope.business_id);
  if (!bm || bm.role === 'client') return { ok: false, http: 403, code: 'member_only' };
  if (TASK_TABLES.has(ref.source_table)) {
    const can = await require('../middleware/access_scope').canAccessTask(userId, scope.task);
    if (!can) return { ok: false, http: 404, code: 'not_found' };
    return { ok: true, scope };
  }
  if (!scope.project_id) return { ok: false, http: 404, code: 'not_found' };
  const { project, role, error } = await loadProjectOrForbidden(scope.project_id, userId);
  if (error) return { ok: false, http: error.code, code: error.message };
  if (role === 'client') return { ok: false, http: 403, code: 'member_only' };
  if (Number(project.business_id) !== scope.business_id) return { ok: false, http: 404, code: 'not_found' };
  if (scope.l1 && Number(scope.owner) !== Number(userId)) return { ok: false, http: 404, code: 'not_found' };
  return { ok: true, scope };
}

/** 입력 정리 — { note } 또는 { error } */
function cleanInput(body) {
  if (body && Object.prototype.hasOwnProperty.call(body, 'title')) return { error: 'field_not_editable' };
  const note = String(body?.note ?? '').replace(/\r\n/g, '\n').trim();
  if (!note) return { error: 'note_required' };
  if (note.length > NOTE_MAX) return { error: 'note_too_long' };
  return { note };
}

/**
 * 히스토리 행들에 고친 설명 줄을 덧입힌다(제자리 변경 + 반환).
 *   refOf(row) → 좌표 | null · opts.forClient — 고객이 보는 응답이면 «고쳐졌다» 는 표시를 싣지 않는다(글은 같은 글).
 *   opts.canEdit — 이 응답을 받는 사람이 고칠 수 있으면 editable 을 싣는다(화면이 연필을 그릴지).
 *   ★ 화면이 읽는 키(note)는 그대로 둔다 — 기존 화면이 안 깨진다.
 */
async function applyOverrides(businessId, rows, refOf, opts = {}) {
  if (!Array.isArray(rows) || !rows.length || !businessId) return rows;
  const refs = rows.map((r) => refOf(r));
  const byTable = new Map();
  refs.forEach((ref) => {
    if (!ref) return;
    if (!byTable.has(ref.source_table)) byTable.set(ref.source_table, []);
    byTable.get(ref.source_table).push(Number(ref.source_id));
  });
  const map = new Map();
  if (byTable.size) {
    const { HistoryOverride } = require('../models');
    const found = await HistoryOverride.findAll({
      where: {
        business_id: Number(businessId),
        [Op.or]: [...byTable.entries()].map(([t, ids]) => ({ source_table: t, source_id: { [Op.in]: [...new Set(ids)] } })),
      },
      attributes: ['source_table', 'source_id', 'note', 'edited_by', 'updated_at'],
      raw: true,
    });
    found.forEach((o) => map.set(keyOf(o.source_table, o.source_id), o));
  }
  // 고친 사람 이름 — 워크스페이스 표시명(계정 이름을 그대로 내보내지 않는다)
  const names = new Map();
  if (!opts.forClient && map.size) {
    const { getMemberNameMap } = require('./displayName');
    const editorIds = [...new Set([...map.values()].map((o) => o.edited_by).filter(Boolean))];
    const { User } = require('../models');
    const users = await User.findAll({ where: { id: { [Op.in]: editorIds } }, attributes: ['id', 'name'], raw: true });
    users.forEach((u) => names.set(u.id, u.name || null));
    const disp = getMemberNameMap ? await getMemberNameMap(businessId, editorIds) : null;
    if (disp && disp.size) disp.forEach((v, k) => { const n = typeof v === 'string' ? v : v?.name; if (n) names.set(Number(k), n); });
  }
  rows.forEach((row, i) => {
    const ref = refs[i];
    if (!ref) return;
    if (opts.canEdit && !opts.forClient) {
      row.editable = EDITABLE;
      row.history_ref = { source_table: ref.source_table, source_id: Number(ref.source_id) };
    }
    const o = map.get(keyOf(ref.source_table, ref.source_id));
    if (!o) return;
    const original = row.note ?? null;
    row.note = o.note;
    if (opts.forClient) return;
    row.note_original = original;
    row.edited_by = o.edited_by;
    row.edited_by_name = names.get(Number(o.edited_by)) || null;
    row.edited_at = o.updated_at ? new Date(o.updated_at).toISOString() : null;
    // 고친 업무 추가 줄은 접지 않는다 — 고친 글이 «업무 N개 추가» 묶음 안에 숨지 않게(판정 ⑦)
    if (ref.source_table === 'task_created') row.groupable = false;
  });
  return rows;
}

module.exports = {
  SOURCE_TABLES, TASK_TABLES, EDITABLE, NOTE_MAX,
  isSourceTable, refOfEventId, eventIdOf, resolveScope, authorize, cleanInput, applyOverrides,
};
