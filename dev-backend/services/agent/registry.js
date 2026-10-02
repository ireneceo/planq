// AI 에이전트 도구 레지스트리 (#439, 설계 §3·§6) — provider 와 무관한 **카탈로그 한 벌**.
//
//   ChatGPT·Claude·(후속) Cue 가 같은 카탈로그를 본다. provider 마다 다른 것은 인증 모양·메타뿐(services/agent_oauth/config PROVIDERS).
//   각 도구: 이름 · 설명(사용자에게도 보이는 문장 — 비파괴성을 적는다) · zod 입력 · risk · scopes · write · handler.
//   ★ HIGH 위험 동작(삭제·금액·계약·외부 발송·권한·대량)은 **도구로 두지 않는다** — HIGH_NAMES 를 등록하면 시작 단계에서 던진다.
const { z } = require('zod');
const t = require('./tools/tasks');
const dir = require('./tools/directory');
const cal = require('./tools/calendar');

const dateOnly = t.dateOnly;
const idem = z.string().max(64).optional().describe('같은 요청을 다시 보낼 때 같은 값을 주면 한 번만 실행된다(선택)');
const confirm = z.string().max(200).optional().describe('Leave empty on the first call. PlanQ answers CONFIRMATION_REQUIRED with a preview and a token; show the preview to the user and, only if they agree, call again with the same arguments plus this token.');

const TOOLS = [
  {
    name: 'get_context', risk: 'LOW', write: false, scopes: [],
    description: 'Who am I and which PlanQ workspace is connected, plus today\'s date and weekday in the workspace time zone. Call this before working out relative dates like "this Friday". Read-only.',
    input: {},
    handler: (p) => t.getContext(p),
  },
  {
    name: 'search_tasks', risk: 'LOW', write: false, scopes: ['tasks:read'],
    description: 'Search PlanQ tasks the user can see. Defaults to the user\'s own open tasks. Returns task_id for follow-up calls. Read-only.',
    input: {
      query: z.string().max(100).optional().describe('Words in the task title'),
      assignee: z.union([z.literal('me'), z.literal('anyone'), z.number().int().positive()]).optional()
        .describe('"me" (default), "anyone", or a user_id'),
      status: z.enum(['open', 'overdue', 'done', 'all']).optional().describe('Default "open"'),
      due_from: dateOnly.optional(), due_to: dateOnly.optional(),
      project_id: z.number().int().positive().optional(),
      client_id: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    handler: (p, a) => t.searchTasks(p, a),
  },
  {
    name: 'get_task', risk: 'LOW', write: false, scopes: ['tasks:read'],
    description: 'Get one task by task_id with its description and latest notes. Read-only.',
    input: { task_id: z.number().int().positive() },
    handler: (p, a) => t.getTask(p, a),
  },
  {
    name: 'create_task', risk: 'LOW', write: true, scopes: ['tasks:write'],
    description: 'Create one new task in PlanQ. Only adds — never edits or deletes existing data. If no assignee is given, PlanQ assigns it by its normal rules (project default or the user).',
    input: {
      title: z.string().trim().min(1).max(300),
      description: z.string().max(5000).optional(),
      due_date: dateOnly.optional(), start_date: dateOnly.optional(),
      assignee_user_id: z.number().int().positive().optional(),
      project_id: z.number().int().positive().optional(),
      client_id: z.number().int().positive().optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      idempotency_key: idem,
    },
    handler: (p, a, actor) => t.createTask(p, a, actor),
  },
  {
    name: 'get_task_notes', risk: 'LOW', write: false, scopes: ['notes:read'],
    description: 'List notes (comments) on a task, newest first. Read-only.',
    input: {
      task_id: z.number().int().positive(),
      limit: z.number().int().min(1).max(50).optional(),
      before_note_id: z.number().int().positive().optional(),
    },
    handler: (p, a) => t.getTaskNotes(p, a),
  },
  {
    name: 'add_task_note', risk: 'LOW', write: true, scopes: ['notes:write'],
    description: 'Add a note (comment) to a task. Only adds — never edits or deletes. Visibility "internal" (team only, default) or "shared" (also visible to the client).',
    input: {
      task_id: z.number().int().positive(),
      content: z.string().trim().min(1).max(5000),
      visibility: z.enum(['internal', 'shared']).optional(),
      idempotency_key: idem,
    },
    handler: (p, a, actor) => t.addTaskNote(p, a, actor),
  },
  // ── M2-a — 조회(고객·프로젝트·멤버·일정) ──────────────────────────
  {
    name: 'search_clients', risk: 'LOW', write: false, scopes: ['clients:read'],
    description: 'Search clients (customers) by name, company or email. Returns client_id for follow-up calls. Read-only.',
    input: { query: z.string().max(100).optional(), include_archived: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() },
    handler: (p, a) => dir.searchClients(p, a),
  },
  {
    name: 'get_client', risk: 'LOW', write: false, scopes: ['clients:read'],
    description: 'Get one client by client_id: summary, open tasks and the latest consultation records. No billing amounts. Read-only.',
    input: { client_id: z.number().int().positive() },
    handler: (p, a) => dir.getClient(p, a),
  },
  {
    name: 'search_projects', risk: 'LOW', write: false, scopes: ['projects:read'],
    description: 'Search projects by name or client company. Returns project_id. Read-only.',
    input: { query: z.string().max(100).optional(), status: z.string().max(30).optional(), limit: z.number().int().min(1).max(50).optional() },
    handler: (p, a) => dir.searchProjects(p, a),
  },
  {
    name: 'get_project', risk: 'LOW', write: false, scopes: ['projects:read'],
    description: 'Get one project by project_id with its open tasks. Read-only.',
    input: { project_id: z.number().int().positive() },
    handler: (p, a) => dir.getProject(p, a),
  },
  {
    name: 'search_members', risk: 'LOW', write: false, scopes: ['tasks:read'],
    description: 'List workspace members (to pick an assignee_user_id). Read-only.',
    input: { query: z.string().max(100).optional(), limit: z.number().int().min(1).max(50).optional() },
    handler: (p, a) => dir.searchMembers(p, a),
  },
  {
    name: 'list_events', risk: 'LOW', write: false, scopes: ['schedule:read'],
    description: 'List calendar events the user can see between from and to (ISO 8601, at most 62 days). Recurring events are returned once. Read-only.',
    input: { from: z.string().max(40), to: z.string().max(40) },
    handler: (p, a) => cal.listEvents(p, a),
  },
  {
    name: 'create_event', risk: 'LOW', write: true, scopes: ['schedule:write'],
    description: 'Create one calendar event without attendees. Only adds — never edits or deletes. Private to the user unless visibility is "team".',
    input: {
      title: z.string().trim().min(1).max(300),
      start_at: z.string().max(40), end_at: z.string().max(40),
      all_day: z.boolean().optional(),
      description: z.string().max(5000).optional(),
      location: z.string().max(300).optional(),
      project_id: z.number().int().positive().optional(),
      visibility: z.enum(['private', 'team']).optional(),
      idempotency_key: idem,
    },
    handler: (p, a, actor) => cal.createEvent(p, a, actor),
  },
  // ── M2-a — MEDIUM(확인 2단계): 첫 호출은 미리보기만, 동의 후 confirmation_token 으로 실행 ──
  {
    name: 'reschedule_task', risk: 'MEDIUM', write: true, scopes: ['tasks:write'],
    description: 'Change a task\'s due date and/or start date. Requires confirmation: the first call only returns a preview; nothing changes until called again with the confirmation_token after the user agrees.',
    input: {
      task_id: z.number().int().positive(),
      due_date: dateOnly.optional(), start_date: dateOnly.optional(),
      confirmation_token: confirm, idempotency_key: idem,
    },
    preview: (p, a) => t.previewReschedule(p, a),
    handler: (p, a, actor) => t.rescheduleTask(p, a, actor),
  },
  {
    name: 'complete_task', risk: 'MEDIUM', write: true, scopes: ['tasks:write'],
    description: 'Mark a task as completed (only its assignee can, and only when no reviewer sign-off is pending). Requires confirmation: the first call only returns a preview.',
    input: { task_id: z.number().int().positive(), confirmation_token: confirm, idempotency_key: idem },
    preview: (p, a) => t.previewComplete(p, a),
    handler: (p, a, actor) => t.completeTask(p, a, actor),
  },
];

// HIGH — 존재하면 안 되는 이름(가드 agentsurface 도 같은 표를 본다)
const HIGH_PATTERNS = [/^delete_/, /^remove_/, /^send_/, /invoice|payment|contract|refund/, /permission|role/, /^bulk_/];

for (const tool of TOOLS) {
  if (HIGH_PATTERNS.some((re) => re.test(tool.name))) throw new Error(`agent registry: HIGH 위험 도구는 등록할 수 없다 — ${tool.name}`);
  if (!['LOW', 'MEDIUM'].includes(tool.risk)) throw new Error(`agent registry: risk 선언 필수 — ${tool.name}`);
  if (tool.write && !tool.scopes.some((s) => s.endsWith(':write'))) throw new Error(`agent registry: 쓰기 도구는 쓰기 scope 필수 — ${tool.name}`);
  if (tool.risk === 'MEDIUM' && (typeof tool.preview !== 'function' || !tool.input.confirmation_token)) throw new Error(`agent registry: MEDIUM 도구는 preview + confirmation_token 필수 — ${tool.name}`);
}

const byName = new Map(TOOLS.map((x) => [x.name, x]));

module.exports = { TOOLS, byName, HIGH_PATTERNS };
