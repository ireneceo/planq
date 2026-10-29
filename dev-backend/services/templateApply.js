// 업무 템플릿 적용 서비스 (사이클 N+1)
// 템플릿 + 시작일 + 담당자 매핑 → Task 일괄 생성 + task_estimations(source='ai') row.
// 2026-10-29 (docs/TASK_TEMPLATE_DETAIL_DESIGN.md) — 일정 계산은 scheduleItems 한 벌(미리보기 dry_run·적용·AI 시작점이 같은 값).
//   선행 연결은 task_links 로 되살린다(옛 «[선행: …]» 글자 붙이기 폐지). 본문·주요·분류·공개 범위·반복·태그·액션도 따라간다.

const { Task, TaskEstimation, TaskTemplate, TaskTemplateItem, BusinessMember, User } = require('../models');
const { addDaysStr } = require('../utils/datetime');
const { templateGroups, ensureTemplateGroups, normalizeWorkstreamTitle } = require('./templateWorkstreams');

// 기간 — 마감 = 시작 + N일. 0 은 «시작일에 마감»(프로젝트에서 저장한 하루짜리 업무). 값이 없을 때만 1.
//   예전 `duration_days || 1` 은 0 을 1 로 바꿔 하루짜리 업무가 적용할 때마다 마감이 하루 밀렸다.
function itemDuration(item) {
  const d = Number(item?.duration_days);
  return Number.isInteger(d) && d >= 0 ? d : 1;
}

// 일정 한 벌 — «시작일만» 이면 오프셋 그대로, «시작일~끝날짜» 면 비례로 늘이거나 줄인다(Fable 설계 §2).
//   T = 날짜 있는 항목의 가장 늦은 끝(오프셋+기간), S = 끝날짜 − 시작일, k = S/T.
//   s' = round(s·k), e' = round((s+d)·k), d' = d===0 ? 0 : max(0, e'−s').
//   첫 항목(s=0)은 시작일 · e=T 인 항목의 마감 = 끝날짜 정확히 · 순서 보존(단조 반올림) · 하루짜리는 하루짜리 · 날짜 없음은 그대로.
//   주말 건너뛰기는 없다(달력일 — 저장·축척·AI 가 같은 달력).
// @returns {{ error?:string, scaled:boolean, reason?:string, span_days:number, rows:Array<{start_offset_days,duration_days,start_date,due_date}> }}
function scheduleItems(items, startDate, endDate = null) {
  const dated = items.filter((it) => it.start_offset_days !== null && it.start_offset_days !== undefined);
  const T = dated.reduce((m, it) => Math.max(m, Number(it.start_offset_days) + itemDuration(it)), 0);
  let k = 1;
  let scaled = false;
  let reason;
  if (endDate) {
    const S = Math.round((new Date(endDate + 'T00:00:00Z') - new Date(startDate + 'T00:00:00Z')) / 86400000);
    if (!Number.isFinite(S)) return { error: 'invalid_end_date' };
    if (S < 0) return { error: 'end_before_start' };
    if (T === 0) reason = 'zero_span';        // 전부 같은 날(옛 날짜 0 템플릿) — 늘릴 기준이 없다
    else { k = S / T; scaled = true; }
  }
  const rows = items.map((it) => {
    if (it.start_offset_days === null || it.start_offset_days === undefined) {
      return { start_offset_days: null, duration_days: null, start_date: null, due_date: null };
    }
    const s = Number(it.start_offset_days) || 0;
    const d = itemDuration(it);
    const s2 = scaled ? Math.round(s * k) : s;
    const d2 = scaled ? (d === 0 ? 0 : Math.max(0, Math.round((s + d) * k) - s2)) : d;
    return { start_offset_days: s2, duration_days: d2, start_date: addDaysStr(startDate, s2), due_date: addDaysStr(startDate, s2 + d2) };
  });
  const span = rows.reduce((m, r) => (r.start_offset_days === null ? m : Math.max(m, r.start_offset_days + r.duration_days)), 0);
  return { scaled, ...(reason ? { reason } : {}), span_days: span, rows };
}

// 옛 템플릿(10-27 이전 저장 — 날짜 읽기 버그로 오프셋이 전부 0) 표시. 저장하지 않는 계산 값.
function scheduleMissing(items) {
  const dated = (items || []).filter((it) => it.start_offset_days !== null && it.start_offset_days !== undefined);
  return dated.length >= 2 && dated.every((it) => !Number(it.start_offset_days) && !Number(it.duration_days));
}

// 멤버 매핑 — role_hint → user_id (assignee_map 명시 우선, 없으면 fuzzy)
function resolveAssignee(roleHint, assigneeMap, members) {
  if (!roleHint) return null;
  // 1) 사용자가 명시적으로 매핑한 경우
  if (assigneeMap && Object.prototype.hasOwnProperty.call(assigneeMap, roleHint)) {
    const explicit = assigneeMap[roleHint];
    return explicit ? Number(explicit) : null;
  }
  // 2) fuzzy — job_title / expertise 토큰 매칭
  const h = String(roleHint).toLowerCase().trim();
  if (!h || !members || members.length === 0) return null;
  const matches = members.filter(m => {
    const fields = [m.job_title, m.expertise, m.role].filter(Boolean).join(' ').toLowerCase();
    if (!fields) return false;
    const tokens = h.split(/[\s,/+]+/).filter(t => t.length >= 2);
    return tokens.some(tok => fields.includes(tok));
  });
  return matches.length === 1 ? matches[0].user_id : null;
}

/**
 * 템플릿 적용 — task 일괄 생성.
 * @param {Object} opts
 * @param {number} opts.templateId
 * @param {number} opts.businessId
 * @param {number} [opts.projectId]
 * @param {string} opts.startDate — YYYY-MM-DD (시작 기준일)
 * @param {string} [opts.endDate] — YYYY-MM-DD 주면 전체 일정을 이 날에 끝나게 비례 조정(scheduleItems)
 * @param {boolean} [opts.dryRun] — 만들지 않고 계산한 일정만(미리보기·AI 시작점)
 * @param {Object} [opts.assigneeMap] — { roleHint: userId } 명시 매핑
 * @param {number} opts.actorUserId — 생성자
 */
async function applyTemplate({ templateId, businessId, projectId = null, startDate, endDate = null, dryRun = false, assigneeMap = {}, actorUserId }) {
  if (!templateId) throw new Error('templateId required');
  if (!businessId) throw new Error('businessId required');
  if (!startDate) throw new Error('startDate required (YYYY-MM-DD)');
  if (!actorUserId) throw new Error('actorUserId required');

  const template = await TaskTemplate.findByPk(templateId, {
    include: [{ model: TaskTemplateItem, as: 'items' }],
  });
  if (!template) throw new Error('template_not_found');

  // 시스템 preset 또는 같은 워크스페이스 템플릿만 적용 가능
  if (!template.is_system && template.business_id !== Number(businessId)) {
    throw new Error('forbidden_template');
  }

  const items = (template.items || []).sort((a, b) => a.order_index - b.order_index);
  const sched = scheduleItems(items, startDate, endDate);
  if (sched.error) throw new Error(sched.error);
  if (dryRun) {
    return {
      created: [], templateId: template.id, dryRun: true,
      scaled: sched.scaled, reason: sched.reason || null, span_days: sched.span_days,
      schedule_missing: scheduleMissing(items),
      items: items.map((it, i) => ({ order_index: it.order_index, ...sched.rows[i] })),
    };
  }
  if (items.length === 0) {
    return { created: [], templateId: template.id };
  }

  // 멤버 목록 (fuzzy 매칭용)
  const memberRows = await BusinessMember.findAll({
    where: { business_id: businessId },
    attributes: ['user_id', 'role', 'job_title', 'expertise', 'name'],
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
  });
  const members = memberRows.map(m => ({
    user_id: m.user_id,
    name: m.name || m.user?.name || '',
    job_title: m.job_title || '',
    expertise: m.expertise || '',
    role: m.role || '',
  }));

  // 추진과제(그룹) — 프로젝트에 넣을 때만. 같은 이름 그룹이 있으면 그것, 없으면 템플릿 순서대로 만든다.
  let workstreamsCreated = 0;
  let wsIdByKey = new Map();
  if (projectId) {
    const wantedKeys = new Set(items.map((it) => normalizeWorkstreamTitle(it.workstream_title)).filter(Boolean));
    if (wantedKeys.size) {
      const r = await ensureTemplateGroups({ kind: 'user', userId: actorUserId }, {
        projectId, businessId, groups: templateGroups(template, items), wantedKeys,
      });
      wsIdByKey = r.idByKey;
      workstreamsCreated = r.created;
    }
  }

  const created = [];
  const pairs = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const { start_date: start, due_date: due } = sched.rows[i];
    const assigneeId = resolveAssignee(item.role_hint, assigneeMap, members) || actorUserId;
    const isInternalRequest = assigneeId !== actorUserId;
    // 프로젝트 없이 넣으면 «프로젝트 범위»(L2)가 성립하지 않는다 — 워크스페이스(L3)로(넓히는 게 아니라 그 범위의 최소).
    const vlevel = ['L2', 'L3', 'L4'].includes(item.vlevel) ? (item.vlevel === 'L2' && !projectId ? 'L3' : item.vlevel) : 'L3';
    // 반복은 마감일이 첫 회차다 — 날짜 없는 항목에는 걸지 않는다.
    const rr = due && item.recurrence_rule ? require('./rruleFromRecurrence').sanitizeRRule(item.recurrence_rule).rule : null;
    // 다음 회차 = task_actions.createTask 와 같은 계산(마감일이 첫 회차).
    let nextOcc = null;
    if (rr) {
      const next = require('./recurringTaskGenerator').computeNextOccurrence(rr, due, 1);
      nextOcc = next ? next.toISOString().slice(0, 10) : null;
    }

    const task = await Task.create({
      business_id: businessId,
      project_id: projectId,
      workstream_id: item.workstream_title ? (wsIdByKey.get(normalizeWorkstreamTitle(item.workstream_title)) || null) : null,
      // #353 ⑤ — 템플릿 항목의 중요도(task_template_items.priority ENUM). 같은 4값이라 그대로 옮긴다.
      priority_level: ['low', 'normal', 'high', 'urgent'].includes(item.priority) ? item.priority : null,
      title: String(item.title).slice(0, 200),
      description: item.description ? String(item.description).slice(0, 2000) : null,
      body: item.body || undefined,
      is_milestone: !!item.is_milestone,
      category: item.category || null,
      vlevel,
      security_level: item.security_level || 'general',
      recurrence_rule: rr,
      recurrence_parent_id: null,
      next_occurrence_at: nextOcc,
      assignee_id: assigneeId,
      start_date: start,
      due_date: due,
      estimated_hours: item.estimated_hours ? Number(item.estimated_hours) : null,
      created_by: actorUserId,
      source: isInternalRequest ? 'internal_request' : 'manual',
      request_by_user_id: isInternalRequest ? actorUserId : null,
    });

    if (item.estimated_hours) {
      try {
        await TaskEstimation.create({
          task_id: task.id,
          business_id: task.business_id,
          value: Number(item.estimated_hours),
          source: 'ai',
          model: 'task_template',
        });
      } catch { /* ignore — TaskEstimation 미존재 케이스 */ }
    }

    pairs.push({ task, item });
    created.push(task);
  }

  // 태그·결과물 액션·선행 연결 — confirm 경로와 같은 함수.
  const extras = await require('./templateDetails').materializeItemExtras(pairs, {
    businessId: Number(businessId), actorUserId, indexOf: (it) => it.order_index,
  });

  // usage_count 증가
  try {
    await template.increment('usage_count', { by: 1 });
  } catch { /* ignore */ }

  return { created, templateId: template.id, workstreamsCreated, scaled: sched.scaled, reason: sched.reason || null, extras };
}

module.exports = { applyTemplate, resolveAssignee, itemDuration, scheduleItems, scheduleMissing };
