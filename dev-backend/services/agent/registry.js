// AI 에이전트 도구 레지스트리 (#439, 설계 §3·§6) — provider 와 무관한 **카탈로그 한 벌**.
//
//   ChatGPT·Claude·(후속) Cue 가 같은 카탈로그를 본다. provider 마다 다른 것은 인증 모양·메타뿐(services/agent_oauth/config PROVIDERS).
//   각 도구: 이름 · 설명(사용자에게도 보이는 문장 — 비파괴성을 적는다) · zod 입력 · risk · scopes · write · handler.
//   ★ HIGH 위험 동작(삭제·금액·계약·외부 발송·권한·대량)은 **도구로 두지 않는다** — HIGH_NAMES 를 등록하면 시작 단계에서 던진다.
const { z } = require('zod');
const t = require('./tools/tasks');

const dateOnly = t.dateOnly;
const idem = z.string().max(64).optional().describe('같은 요청을 다시 보낼 때 같은 값을 주면 한 번만 실행된다(선택)');

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
];

// HIGH — 존재하면 안 되는 이름(가드 agentsurface 도 같은 표를 본다)
const HIGH_PATTERNS = [/^delete_/, /^remove_/, /^send_/, /invoice|payment|contract|refund/, /permission|role/, /^bulk_/];

for (const tool of TOOLS) {
  if (HIGH_PATTERNS.some((re) => re.test(tool.name))) throw new Error(`agent registry: HIGH 위험 도구는 등록할 수 없다 — ${tool.name}`);
  if (!['LOW', 'MEDIUM'].includes(tool.risk)) throw new Error(`agent registry: risk 선언 필수 — ${tool.name}`);
  if (tool.write && !tool.scopes.some((s) => s.endsWith(':write'))) throw new Error(`agent registry: 쓰기 도구는 쓰기 scope 필수 — ${tool.name}`);
}

const byName = new Map(TOOLS.map((x) => [x.name, x]));

module.exports = { TOOLS, byName, HIGH_PATTERNS };
