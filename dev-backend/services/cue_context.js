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
const { taskListWhere, invoiceListWhere, calendarListWhere, isMemberOrAbove } = require('../middleware/access_scope');

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
//    ★ 질문자 권한 scope 관통 필수 — Cue 답변은 고객이 있는 대화방으로도 나간다.
//      scope 없이 business_id 만으로 긁으면 남의 개인(L1) 일정·내부 업무가 고객에게 흘러간다.
async function getProjectSnapshot(projectId, businessId, scope) {
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

  // 업무 — 질문자가 볼 수 있는 것만 (client 면 관여분만)
  const taskBase = await taskListWhere(scope?.userId, businessId, scope);
  const tasks = taskBase ? await Task.findAll({
    where: {
      [Op.and]: [
        taskBase,
        { project_id: projectId, status: { [Op.in]: ['in_progress', 'reviewing', 'revision_requested', 'task_requested'] } },
      ],
    },
    attributes: ['id', 'title', 'status', 'due_date', 'progress_percent', 'assignee_id'],
    include: [{ model: User, as: 'assignee', attributes: ['id', 'name'], required: false }],
    order: [['due_date', 'ASC']],
    limit: TASK_LIMIT,
  }) : [];

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86400 * 1000);
  // 일정 — 캘린더 가시성 규칙(access_scope 단일 원천) 통과분만
  const calBase = await calendarListWhere(scope?.userId, businessId, scope);
  const events = calBase ? await CalendarEvent.findAll({
    where: { [Op.and]: [calBase, { project_id: projectId, start_at: { [Op.between]: [now, weekAhead] } }] },
    attributes: ['id', 'title', 'start_at', 'location'],
    order: [['start_at', 'ASC']],
    limit: EVENT_LIMIT,
  }) : [];

  return { project, active, totalStages: stages.length, completed, tasks, events };
}

// ── 사용자 본인 스냅샷 — 도움말 챗 (/api/cue/help) 에서 활용
//    본인의 이번 주 task, 다가오는 일정, 받은 업무 요청
async function getUserSnapshot(userId, businessId, businessTimezone, scope) {
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
  // 다가오는 일정 — "본인 참석 일정" 이라는 주석과 달리 여태 워크스페이스 전체를 필터 없이 긁어
  // 남의 개인(L1) 일정까지 프롬프트에 들어갔다. 캘린더 가시성 규칙 통과분만.
  const calBase = await calendarListWhere(userId, businessId, scope);
  const events = calBase ? await CalendarEvent.findAll({
    where: { [Op.and]: [calBase, { start_at: { [Op.between]: [now, weekAhead] } }] },
    attributes: ['id', 'title', 'start_at', 'location'],
    order: [['start_at', 'ASC']],
    limit: EVENT_LIMIT,
  }) : [];

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
async function getClientSnapshot(clientId, businessId, scope) {
  if (!clientId) return null;
  const client = await Client.findOne({
    where: { id: clientId, business_id: businessId },
    // KNOWLEDGE_LOOP 축1 — 옛 'memo' 는 존재하지 않는 컬럼 (clients 는 notes) → clientId 있을 때
    // Promise.all 전체가 죽던 실버그 fix. summary(Cue 생성 고객요약) 재사용 루프도 여기서 연결.
    attributes: ['id', 'display_name', 'biz_name', 'company_name', 'is_business', 'country', 'notes', 'summary'],
  });
  if (!client) return null;

  // 재무(청구) 는 볼 권한이 있는 사람에게만. 여태 scope 무관하게 프롬프트에 들어갔다.
  //   - 워크스페이스 재무 권한자(owner/admin/platform_admin) → 그 고객 청구 내역
  //   - 그 고객 본인(client 계정) → 자기 청구 내역 (invoiceListWhere 가 clientIds 로 격리)
  //   - 그 외(일반 멤버·스코프 없음) → 재무 데이터 없음 (fail-closed)
  const invBase = scope ? await invoiceListWhere(scope.userId, businessId, scope) : null;
  const canFinance = Boolean(invBase) && (scope.isOwner || scope.isAdmin || scope.isPlatformAdmin || scope.isClient);
  const recentInvoices = canFinance ? await Invoice.findAll({
    where: { [Op.and]: [invBase, { client_id: clientId }] },
    attributes: ['id', 'invoice_number', 'grand_total', 'paid_amount', 'status', 'currency', 'sent_at'],
    order: [['created_at', 'DESC']],
    limit: 5,
  }) : [];
  const totalSent = recentInvoices.reduce((s, i) => s + Number(i.grand_total || 0), 0);
  const totalPaid = recentInvoices.reduce((s, i) => s + Number(i.paid_amount || 0), 0);

  const recentSigs = canFinance ? await SignatureRequest.count({
    where: { business_id: businessId, status: { [Op.in]: ['signed', 'sent', 'viewed'] } },
  }) : 0;

  return { client, recentInvoices, totalSent, totalPaid, totalSigs: recentSigs };
}

// ── #61 — 질문 기반 워크스페이스 전방위 검색 (질문자 권한 범위 내)
//    "모든 곳을 확인하되 권한 기준으로" — access_scope 헬퍼로 격리 보장.
//    재무(invoice)는 owner/admin 또는 본인 청구(client)만. 일반 member 는 제외(재무 누출 차단).
function queryTerms(q) {
  return String(q || '').toLowerCase()
    .split(/[\s,.;:!?()[\]{}"'`/\\]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 6);
}
function likeAny(fields, terms) {
  return { [Op.or]: fields.flatMap((f) => terms.map((t) => ({ [f]: { [Op.like]: `%${t}%` } }))) };
}

async function getWorkspaceMatches({ businessId, scope, query }) {
  const terms = queryTerms(query);
  if (!businessId || !scope || terms.length === 0) return null;
  const isStaff = isMemberOrAbove(scope);
  const isClient = !!scope.isClient;
  if (!isStaff && !isClient) return null;

  const out = { tasks: [], projects: [], clients: [], invoices: [] };

  // 업무 — 권한 scope 그대로 (member 이상=전체 / client=본인 관여분)
  try {
    const base = await taskListWhere(scope.userId, businessId, scope);
    if (base) {
      out.tasks = await Task.findAll({
        where: { [Op.and]: [base, likeAny(['title', 'description'], terms)] },
        attributes: ['id', 'title', 'status', 'progress_percent', 'due_date'],
        include: [{ model: User, as: 'assignee', attributes: ['name'] }],
        order: [['updated_at', 'DESC']], limit: 6,
      });
    }
  } catch (e) { /* best-effort */ void e; }

  // 프로젝트 — member 이상=전체 / client=관여 프로젝트
  try {
    const where = { business_id: businessId, ...likeAny(['name', 'description'], terms) };
    if (!isStaff) {
      const ids = [...new Set([...(scope.projectClientProjectIds || []), ...(scope.projectMemberIds || [])])];
      if (ids.length === 0) throw new Error('no project scope');
      where.id = { [Op.in]: ids };
    }
    out.projects = await Project.findAll({
      where, attributes: ['id', 'name', 'description', 'status'],
      order: [['updated_at', 'DESC']], limit: 4,
    });
  } catch (e) { void e; }

  // 고객 — staff 만 (client 는 타 고객 검색 불가)
  if (isStaff) {
    try {
      out.clients = await Client.findAll({
        where: { business_id: businessId, ...likeAny(['display_name', 'company_name', 'biz_name'], terms) },
        attributes: ['id', 'display_name', 'company_name', 'biz_name', 'status'],
        order: [['updated_at', 'DESC']], limit: 4,
      });
    } catch (e) { void e; }
  }

  // 청구서(재무) — owner/admin/platform_admin 또는 본인 청구(client) 만
  const canFinance = scope.isOwner || scope.isAdmin || scope.isPlatformAdmin || isClient;
  if (canFinance) {
    try {
      const base = await invoiceListWhere(scope.userId, businessId, scope);
      if (base) {
        out.invoices = await Invoice.findAll({
          where: { [Op.and]: [base, likeAny(['invoice_number', 'recipient_business_name'], terms)] },
          attributes: ['id', 'invoice_number', 'recipient_business_name', 'status', 'grand_total', 'paid_amount', 'currency', 'due_date'],
          order: [['created_at', 'DESC']], limit: 4,
        });
      }
    } catch (e) { void e; }
  }

  const total = out.tasks.length + out.projects.length + out.clients.length + out.invoices.length;
  return total > 0 ? out : null;
}

// #61 — 권한 스코프 워크스페이스 현황 (쿼리 무관, 항상 주입).
// Cue 가 "프로젝트 진행 어때?" "업무 얼마나 남았어?" 같은 일반 질문에 답하도록 전체 그림 제공.
// 가시성은 질문자 권한 기준: member 이상=전체 / client=관여분 / 재무=owner·admin.
const ACTIVE_TASK = ['not_started', 'waiting', 'in_progress', 'reviewing', 'revision_requested'];
function todayStr(tz) {
  try { return new Date().toLocaleDateString('en-CA', { timeZone: tz || 'Asia/Seoul' }); }
  catch { return new Date().toISOString().slice(0, 10); }
}
async function getWorkspaceOverview({ businessId, scope, businessTimezone }) {
  if (!businessId || !scope) return null;
  const isStaff = isMemberOrAbove(scope);
  const isClient = !!scope.isClient;
  if (!isStaff && !isClient) return null;
  const today = todayStr(businessTimezone);
  const ov = { projects: [], taskCounts: {}, taskTotal: 0, overdue: 0, urgentTasks: [], finance: null };

  // 활성 프로젝트 — member: 전체 / client: 관여 프로젝트
  try {
    const where = { business_id: businessId, status: { [Op.in]: ['active', 'paused'] } };
    if (!isStaff) {
      const ids = [...new Set([...(scope.projectClientProjectIds || []), ...(scope.projectMemberIds || [])])];
      where.id = ids.length ? { [Op.in]: ids } : -1;
    }
    ov.projects = await Project.findAll({ where, attributes: ['id', 'name', 'status'], order: [['updated_at', 'DESC']], limit: 15 });
  } catch (e) { void e; }

  // 업무 — 권한 스코프(taskListWhere). 상태별 집계 + 지연 + 임박 활성업무
  try {
    const base = await taskListWhere(scope.userId, businessId, scope);
    if (base) {
      const all = await Task.findAll({ where: base, attributes: ['status', 'due_date'], limit: 800 });
      ov.taskTotal = all.length;
      for (const t of all) {
        ov.taskCounts[t.status] = (ov.taskCounts[t.status] || 0) + 1;
        if (t.due_date && ACTIVE_TASK.includes(t.status) && String(t.due_date).slice(0, 10) < today) ov.overdue++;
      }
      ov.urgentTasks = await Task.findAll({
        where: { [Op.and]: [base, { status: { [Op.in]: ACTIVE_TASK }, due_date: { [Op.ne]: null } }] },
        attributes: ['id', 'title', 'status', 'due_date', 'progress_percent'],
        include: [{ model: User, as: 'assignee', attributes: ['name'], required: false }],
        order: [['due_date', 'ASC']], limit: 10,
      });
    }
  } catch (e) { void e; }

  // 재무 요약 — owner/admin/platform_admin
  if (scope.isOwner || scope.isAdmin || scope.isPlatformAdmin) {
    try {
      const base = await invoiceListWhere(scope.userId, businessId, scope);
      if (base) {
        const inv = await Invoice.findAll({ where: base, attributes: ['status', 'grand_total', 'paid_amount', 'currency', 'due_date'], limit: 500 });
        let unpaid = 0, unpaidAmt = 0, overdueInv = 0, cur = 'KRW';
        for (const i of inv) {
          if (['sent', 'viewed', 'partially_paid', 'overdue'].includes(i.status)) {
            unpaid++; unpaidAmt += Number(i.grand_total || 0) - Number(i.paid_amount || 0);
            if (i.due_date && String(i.due_date).slice(0, 10) < today) overdueInv++;
            cur = i.currency || cur;
          }
        }
        if (unpaid > 0) ov.finance = { unpaid, unpaidAmt, overdueInv, currency: cur };
      }
    } catch (e) { void e; }
  }
  return ov;
}

// ── 마크다운 합성 — system prompt 에 주입
function composeMarkdown({ history, project, client, kb, userSnap, matches, overview, businessTimezone }) {
  const parts = [];

  // #61 — 워크스페이스 현황 (권한 스코프, 일반 질문 대응). 맨 위에 전체 그림.
  if (overview) {
    const o = overview;
    const hasAny = (o.projects?.length || o.taskTotal || o.finance);
    if (hasAny) {
      parts.push('## 워크스페이스 현황 (질문자 권한 범위 내 — 이 데이터로 답하세요)');
      if (o.projects?.length) {
        parts.push(`- 활성 프로젝트 ${o.projects.length}개: ${o.projects.map(p => `${p.name}(${p.status})`).join(', ')}`);
      }
      if (o.taskTotal) {
        const byStatus = Object.entries(o.taskCounts).map(([s, n]) => `${s} ${n}`).join(', ');
        parts.push(`- 업무 총 ${o.taskTotal}건 (${byStatus})${o.overdue ? ` · ⚠ 마감 지난 활성 업무 ${o.overdue}건` : ''}`);
      }
      if (o.urgentTasks?.length) {
        parts.push(`- 마감 임박/지난 활성 업무:`);
        o.urgentTasks.forEach(t => {
          const due = t.due_date ? String(t.due_date).slice(0, 10) : '미정';
          const who = t.assignee?.name ? ` · ${t.assignee.name}` : '';
          parts.push(`  · ${t.title} (${t.status}, 진행 ${t.progress_percent || 0}%, 마감 ${due}${who})`);
        });
      }
      if (o.finance) {
        parts.push(`- 미수금(미입금 청구) ${o.finance.unpaid}건, 합계 약 ${Math.round(o.finance.unpaidAmt).toLocaleString()} ${o.finance.currency}${o.finance.overdueInv ? ` · 결제기한 지난 ${o.finance.overdueInv}건` : ''}`);
      }
    }
  }

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
    if (client.client.notes) parts.push(`- 메모: ${snip(client.client.notes, 200)}`);
    if (client.client.summary) parts.push(`- 고객 요약(Cue 생성): ${snip(client.client.summary, 400)}`);
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

  if (matches) {
    parts.push('\n## 워크스페이스 검색 결과 (질문 관련 · 질문자 권한 내)');
    if (matches.tasks?.length) {
      parts.push(`- 업무 ${matches.tasks.length}건:`);
      matches.tasks.forEach((t) => {
        const due = t.due_date ? String(t.due_date).slice(0, 10) : '미정';
        parts.push(`  · ${t.title} (${t.status}, 진행 ${t.progress_percent || 0}%, 마감 ${due}, 담당 ${t.assignee?.name || '-'})`);
      });
    }
    if (matches.projects?.length) {
      parts.push(`- 프로젝트 ${matches.projects.length}건:`);
      matches.projects.forEach((p) => parts.push(`  · ${p.name} (${p.status || '-'})${p.description ? ` — ${snip(p.description, 80)}` : ''}`));
    }
    if (matches.clients?.length) {
      parts.push(`- 고객 ${matches.clients.length}건:`);
      matches.clients.forEach((c) => parts.push(`  · ${c.company_name || c.biz_name || c.display_name || `#${c.id}`} (${c.status || '-'})`));
    }
    if (matches.invoices?.length) {
      parts.push(`- 청구서 ${matches.invoices.length}건:`);
      matches.invoices.forEach((i) => {
        const owed = Number(i.grand_total || 0) - Number(i.paid_amount || 0);
        parts.push(`  · ${i.invoice_number}${i.recipient_business_name ? ` (${i.recipient_business_name})` : ''} — ${i.status}, 잔액 ${owed.toLocaleString('ko-KR')} ${i.currency || 'KRW'}`);
      });
    }
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
async function buildCueContext({ businessId, conversationId, projectId, clientId, userId, query, businessTimezone, scope }) {
  // 개별 스냅샷 실패가 컨텍스트 전체를 죽이면 안 됨 (memo 컬럼 실사고 재발 방지) — 모두 개별 .catch
  // 1. 대화 히스토리
  const historyP = getConversationHistory(conversationId).catch(() => []);
  // 2. 프로젝트 스냅샷 — 질문자 권한 scope 관통 (없으면 fail-closed)
  const projectP = projectId ? getProjectSnapshot(projectId, businessId, scope).catch(() => null) : Promise.resolve(null);
  // 3. 고객 스냅샷 — 재무는 권한자에게만
  const clientP = clientId ? getClientSnapshot(clientId, businessId, scope).catch(() => null) : Promise.resolve(null);
  // 4. 사용자 본인 스냅샷 (도움말 챗 / userId 명시 시)
  const userP = userId ? getUserSnapshot(userId, businessId, businessTimezone, scope).catch(() => null) : Promise.resolve(null);
  // 5. KB 검색 (사이클 G 의 ctx 우선순위 활용)
  //    P0 — 질문자가 내부 사람(멤버/owner/admin)이면 그 사람 권한 안에서만 검색한다.
  //    (여태 business_id 로 전체를 긁어, 참여하지 않은 프로젝트의 KB 가 답변 재료로 들어갔다.)
  //    ⚠️ 외부 고객이 질문자인 경우는 의도적으로 필터하지 않는다 — 고객 문의에 워크스페이스 KB 로
  //    답하는 것이 Cue 자동응답의 존재 이유. "어떤 KB 를 고객에게 인용해도 되는가" 는 별도 제품 정책
  //    (KB 문서에 고객 공개 플래그) 이며 이번 절단면 밖.
  const internalAsker = !!(scope && (scope.isMember || scope.isOwner || scope.isAdmin || scope.isPlatformAdmin));
  const kbDocWhere = internalAsker
    ? require('../middleware/access_scope').kbDocumentsListWhereByLevel(scope)
    : null;
  const kbP = query
    ? kbService.hybridSearch(businessId, query, {
        limit: 5, project_id: projectId, client_id: clientId, docWhere: kbDocWhere,
      })
    : Promise.resolve({ has_results: false });
  // 6. #61 — 질문 기반 워크스페이스 전방위 검색 (권한 scope 있을 때만)
  const matchesP = (query && scope)
    ? getWorkspaceMatches({ businessId, scope, query }).catch(() => null)
    : Promise.resolve(null);
  // 7. #61 — 권한 스코프 워크스페이스 현황 (쿼리 무관, scope 있으면 항상)
  const overviewP = scope
    ? getWorkspaceOverview({ businessId, scope, businessTimezone }).catch(() => null)
    : Promise.resolve(null);

  // 8. KNOWLEDGE_LOOP 축1 — 팀이 확정한 워크스페이스 지식 카드 (active 만)
  const knowledgeP = require('./cueKnowledge').buildKnowledgeBlock(businessId).catch(() => '');

  const [history, project, client, userSnap, kb, matches, overview, knowledgeBlock] = await Promise.all([historyP, projectP, clientP, userP, kbP, matchesP, overviewP, knowledgeP]);
  let markdown = composeMarkdown({ history, project, client, kb, userSnap, matches, overview, businessTimezone });
  if (knowledgeBlock) markdown = `${knowledgeBlock}\n\n${markdown}`;
  return { markdown, kb, history, project, client, userSnap, matches, overview };
}

// 읽기 함수 개별 노출 — MCP 읽기 서버(#D-4)가 재포장한다. 전부 scope 인자로 격리된다.
module.exports = {
  buildCueContext,
  getWorkspaceOverview, getWorkspaceMatches, getClientSnapshot, getProjectSnapshot,
};
