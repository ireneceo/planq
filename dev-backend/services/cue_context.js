// Cue 전방위 컨텍스트 빌더 — 사이클 G+.
// Cue 답변에 KB 자료뿐 아니라 프로젝트 상황·이전 대화·일정·고객 정보까지 종합.
//
// 우선순위 (LLM 토큰 예산 ~6K 안에 들어가도록):
//   1. 직전 대화 N=10 turn (~2K)
//   2. 프로젝트 상황 — active stage / next_action / 진행 중 task 5개 (~1K)
//   3. 다가오는 일정 5개 (~500)
//   4. 고객 360° 요약 — 이전 결제·서명·주요 활동 (~1K)
//   5. KB 검색 결과 top 3 (~1.5K)
//
// 호출:
//   const ctx = await buildCueContext({ businessId, conversationId, projectId, clientId, query });
//   ctx.markdown — system prompt 에 주입할 컨텍스트 텍스트
//   ctx.kbSnapshot — KB 검색 결과 (cue_orchestrator 가 has_results 체크용)

const { Op } = require('sequelize');
const {
  Conversation, Message, User,
  Project, ProjectStage,
  Task,
  CalendarEvent,
  Client,
  Invoice, InvoicePayment,
  SignatureRequest,
} = require('../models');
const kbService = require('./kb_service');

// 토큰 예산 — 대략 chars/4 ≈ tokens. 안전 margin.
const HISTORY_TURN_LIMIT = 10;
const TASK_LIMIT = 5;
const EVENT_LIMIT = 5;

function snip(s, max = 500) {
  if (!s) return '';
  const t = String(s).trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// ── 직전 대화 N turn — 가장 최근 부터 거꾸로
async function getConversationHistory(conversationId, limit = HISTORY_TURN_LIMIT) {
  if (!conversationId) return [];
  const msgs = await Message.findAll({
    where: { conversation_id: conversationId, is_deleted: false, is_internal: false },
    attributes: ['id', 'sender_id', 'content', 'is_ai', 'created_at'],
    include: [{ model: User, as: 'sender', attributes: ['id', 'name'], required: false }],
    order: [['created_at', 'DESC']],
    limit,
  });
  return msgs.reverse(); // 시간 순
}

// ── 프로젝트 현황: active stage, 진행 task, 다가오는 일정
async function getProjectSnapshot(projectId, businessId) {
  if (!projectId) return null;
  const project = await Project.findOne({
    where: { id: projectId, business_id: businessId },
    attributes: ['id', 'name', 'status', 'description'],
  });
  if (!project) return null;

  const stages = await ProjectStage.findAll({
    where: { project_id: projectId },
    attributes: ['id', 'order_index', 'kind', 'label', 'status'],
    order: [['order_index', 'ASC']],
  });
  const active = stages.find(s => s.status === 'active');
  const completed = stages.filter(s => s.status === 'completed').length;

  const tasks = await Task.findAll({
    where: {
      business_id: businessId,
      project_id: projectId,
      status: { [Op.in]: ['in_progress', 'reviewing', 'revision_requested', 'task_requested'] },
    },
    attributes: ['id', 'title', 'status', 'due_date', 'progress_percent', 'assignee_id'],
    include: [{ model: User, as: 'assignee', attributes: ['id', 'name'], required: false }],
    order: [['due_date', 'ASC']],
    limit: TASK_LIMIT,
  });

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86400 * 1000);
  const events = await CalendarEvent.findAll({
    where: {
      business_id: businessId,
      project_id: projectId,
      start_at: { [Op.between]: [now, weekAhead] },
    },
    attributes: ['id', 'title', 'start_at', 'location'],
    order: [['start_at', 'ASC']],
    limit: EVENT_LIMIT,
  });

  return { project, active, totalStages: stages.length, completed, tasks, events };
}

// ── 사용자 본인 스냅샷 — 도움말 챗 (/api/cue/help) 에서 활용
//    본인의 이번 주 task, 다가오는 일정, 받은 업무 요청
async function getUserSnapshot(userId, businessId, businessTimezone) {
  if (!userId || !businessId) return null;
  // 이번 주 본인 담당 task
  const myTasks = await Task.findAll({
    where: {
      business_id: businessId,
      assignee_id: userId,
      status: { [Op.in]: ['in_progress', 'reviewing', 'revision_requested', 'task_requested', 'waiting'] },
    },
    attributes: ['id', 'title', 'status', 'due_date', 'progress_percent'],
    order: [['due_date', 'ASC']],
    limit: 8,
  });

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86400 * 1000);
  // 본인 참석 일정
  const events = await CalendarEvent.findAll({
    where: { business_id: businessId, start_at: { [Op.between]: [now, weekAhead] } },
    attributes: ['id', 'title', 'start_at', 'location'],
    order: [['start_at', 'ASC']],
    limit: EVENT_LIMIT,
  });

  // 받은 업무 요청 (ack 전)
  const inboxTasks = await Task.findAll({
    where: {
      business_id: businessId,
      assignee_id: userId,
      request_by_user_id: { [Op.ne]: userId, [Op.not]: null },
      request_ack_at: null,
      status: { [Op.notIn]: ['completed', 'canceled'] },
    },
    attributes: ['id', 'title', 'due_date'],
    limit: 5,
  });

  return { myTasks, events, inboxTasks, businessTimezone };
}

// ── 고객 360° 요약 — 이전 결제·서명·기본 정보
async function getClientSnapshot(clientId, businessId) {
  if (!clientId) return null;
  const client = await Client.findOne({
    where: { id: clientId, business_id: businessId },
    attributes: ['id', 'display_name', 'biz_name', 'company_name', 'is_business', 'country', 'memo'],
  });
  if (!client) return null;

  const recentInvoices = await Invoice.findAll({
    where: { business_id: businessId, client_id: clientId },
    attributes: ['id', 'invoice_number', 'grand_total', 'paid_amount', 'status', 'currency', 'sent_at'],
    order: [['created_at', 'DESC']],
    limit: 5,
  });
  const totalSent = recentInvoices.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  const totalPaid = recentInvoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);

  const recentSigs = await SignatureRequest.count({
    where: { business_id: businessId, status: { [Op.in]: ['signed', 'sent', 'viewed'] } },
  });

  return { client, recentInvoices, totalSent, totalPaid, totalSigs: recentSigs };
}

// ── 마크다운 합성 — system prompt 에 주입
function composeMarkdown({ history, project, client, kb, userSnap, businessTimezone }) {
  const parts = [];

  if (userSnap) {
    parts.push('## 내 현황 (본인)');
    if (userSnap.myTasks?.length) {
      parts.push(`- 진행 중 업무 (${userSnap.myTasks.length}):`);
      userSnap.myTasks.forEach(t => {
        const due = t.due_date ? String(t.due_date).slice(0, 10) : '미정';
        parts.push(`  · ${t.title} (${t.status}, 진행 ${t.progress_percent || 0}%, 마감 ${due})`);
      });
    }
    if (userSnap.inboxTasks?.length) {
      parts.push(`- 받은 업무 요청 (확인 대기 ${userSnap.inboxTasks.length}건):`);
      userSnap.inboxTasks.forEach(t => parts.push(`  · ${t.title}${t.due_date ? ` (마감 ${String(t.due_date).slice(0,10)})` : ''}`));
    }
    if (userSnap.events?.length) {
      parts.push(`- 다가오는 일정:`);
      userSnap.events.forEach(e => {
        const dt = e.start_at ? new Date(e.start_at).toLocaleString('ko-KR', { timeZone: userSnap.businessTimezone || 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }) : '미정';
        parts.push(`  · ${e.title} — ${dt}${e.location ? ` @ ${e.location}` : ''}`);
      });
    }
    parts.push('');
  }

  if (project) {
    parts.push('## 프로젝트 상황');
    parts.push(`- 이름: ${project.project.name}${project.project.description ? ` — ${snip(project.project.description, 100)}` : ''}`);
    if (project.active) {
      parts.push(`- 현재 단계: ${project.active.label} (${project.active.kind})`);
    }
    parts.push(`- 단계 진행: ${project.completed}/${project.totalStages} 완료`);
    if (project.tasks.length) {
      parts.push(`- 진행 중 업무 (상위 ${project.tasks.length}):`);
      project.tasks.forEach(t => {
        const due = t.due_date ? String(t.due_date).slice(0, 10) : '미정';
        parts.push(`  · ${t.title} (${t.status}, 진행 ${t.progress_percent || 0}%, 마감 ${due}, 담당 ${t.assignee?.name || '-'})`);
      });
    }
    if (project.events.length) {
      parts.push(`- 다가오는 일정:`);
      project.events.forEach(e => {
        const dt = e.start_at ? new Date(e.start_at).toLocaleString('ko-KR', { timeZone: businessTimezone || 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }) : '미정';
        parts.push(`  · ${e.title} — ${dt}${e.location ? ` @ ${e.location}` : ''}`);
      });
    }
  }

  if (client) {
    parts.push('\n## 고객 정보');
    const name = client.client.biz_name || client.client.company_name || client.client.display_name || `Client #${client.client.id}`;
    parts.push(`- ${name}${client.client.is_business ? ' (사업자)' : ''}${client.client.country ? ` · ${client.client.country}` : ''}`);
    if (client.client.memo) parts.push(`- 메모: ${snip(client.client.memo, 200)}`);
    if (client.recentInvoices.length) {
      parts.push(`- 최근 청구서 ${client.recentInvoices.length}건 / 발행 ${client.totalSent.toLocaleString()} / 수금 ${client.totalPaid.toLocaleString()}`);
    }
  }

  if (history?.length) {
    parts.push('\n## 직전 대화 흐름 (시간 순)');
    history.forEach(m => {
      const who = m.is_ai ? 'Cue' : (m.sender?.name || '사용자');
      parts.push(`- ${who}: ${snip(m.content, 200)}`);
    });
  }

  if (kb?.has_results) {
    parts.push('\n## 회사 자료 (Q knowledge)');
    if (kb.pinned_faqs?.length) {
      kb.pinned_faqs.slice(0, 2).forEach(f => parts.push(`- FAQ: ${snip(f.question, 80)} → ${snip(f.answer, 200)}`));
    }
    if (kb.kb_chunks?.length) {
      kb.kb_chunks.slice(0, 3).forEach(c => parts.push(`- ${c.document_title}${c.section_title ? ` / ${c.section_title}` : ''}: ${snip(c.snippet, 200)}`));
    }
  }

  return parts.join('\n');
}

// ── 메인 빌더
async function buildCueContext({ businessId, conversationId, projectId, clientId, userId, query, businessTimezone }) {
  // 1. 대화 히스토리
  const historyP = getConversationHistory(conversationId);
  // 2. 프로젝트 스냅샷
  const projectP = projectId ? getProjectSnapshot(projectId, businessId) : Promise.resolve(null);
  // 3. 고객 스냅샷
  const clientP = clientId ? getClientSnapshot(clientId, businessId) : Promise.resolve(null);
  // 4. 사용자 본인 스냅샷 (도움말 챗 / userId 명시 시)
  const userP = userId ? getUserSnapshot(userId, businessId, businessTimezone) : Promise.resolve(null);
  // 5. KB 검색 (사이클 G 의 ctx 우선순위 활용)
  const kbP = query
    ? kbService.hybridSearch(businessId, query, { limit: 5, project_id: projectId, client_id: clientId })
    : Promise.resolve({ has_results: false });

  const [history, project, client, userSnap, kb] = await Promise.all([historyP, projectP, clientP, userP, kbP]);
  const markdown = composeMarkdown({ history, project, client, kb, userSnap, businessTimezone });
  return { markdown, kb, history, project, client, userSnap };
}

module.exports = { buildCueContext };
