// 정기업무 자동 인스턴스 생성 cron (매일 자정 실행).
//
// 모델:
//   parent (시리즈 원본): recurrence_rule != null AND recurrence_parent_id IS NULL.
//                        parent 자체가 첫 occurrence (due_date = 첫 occurrence date).
//   instance: recurrence_rule == null AND recurrence_parent_id == parent.id.
//
// 흐름:
//   1) cutoff = today + 7d. parent 중 next_occurrence_at <= cutoff 인 것만 처리 (D-7 미리 생성)
//   2) 멱등: 같은 parent + 같은 due_date 인스턴스 있으면 skip (cron 재실행 안전)
//   3) parent 필드 복사하여 새 인스턴스 생성. status = not_started, completed_at/actual_hours/progress_percent 리셋
//   4) parent.next_occurrence_at 을 rrule.after 로 다음 occurrence 로 advance
//   5) 종료 조건 (COUNT/UNTIL) 도달 시 next_occurrence_at = null → 시리즈 종결
//
// 멱등: 같은 날 여러 번 호출돼도 인스턴스 중복 생성 없음
// 안전: 한 시리즈 실패해도 다른 시리즈 계속 (try/catch per parent)

const { Op } = require('sequelize');
const { RRule } = require('rrule');
const { Task, TaskReviewer } = require('../models');

// YYYY-MM-DD string → UTC midnight Date (DATEONLY 비교용)
function dateOnlyToUTC(dateStr) {
  if (!dateStr) return null;
  const s = typeof dateStr === 'string' ? dateStr.slice(0, 10) : dateStr.toISOString().slice(0, 10);
  return new Date(s + 'T00:00:00Z');
}

function toDateOnlyStr(d) {
  return d.toISOString().slice(0, 10);
}

// rrule 표준 + dtstart 합쳐서 다음 occurrence 계산.
// generatedCount: 이미 만들어진 occurrences 수 (parent 1 + 인스턴스 수). COUNT 도달 체크용.
// 반환: 다음 occurrence Date (UTC) 또는 종료 시 null.
function computeNextOccurrence(ruleStr, lastOccurrenceDateStr, generatedCount) {
  if (!ruleStr || !lastOccurrenceDateStr) return null;
  const dtstart = dateOnlyToUTC(lastOccurrenceDateStr);

  let opts;
  try {
    opts = RRule.parseString(ruleStr);
  } catch (e) {
    console.warn('[recurringTask] invalid RRULE:', ruleStr, e.message);
    return null;
  }
  opts.dtstart = dtstart;
  const rule = new RRule(opts);

  // COUNT 도달
  if (opts.count != null && generatedCount >= opts.count) return null;

  // 다음 occurrence — dtstart 자체는 제외 (false)
  const nextDate = rule.after(dtstart, false);
  if (!nextDate) return null;

  // UNTIL 초과
  if (opts.until != null && nextDate > opts.until) return null;

  return nextDate;
}

// io: socket.io Server instance (server.js 에서 주입). 없으면 broadcast 스킵 (단위 테스트 안전).
async function generateOneSeries(parent, today = new Date(), io = null) {
  if (!parent.next_occurrence_at) {
    return { parent_id: parent.id, skipped: 'series_ended' };
  }

  const nextDateStr = typeof parent.next_occurrence_at === 'string'
    ? parent.next_occurrence_at.slice(0, 10)
    : toDateOnlyStr(parent.next_occurrence_at);
  const nextDate = dateOnlyToUTC(nextDateStr);
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() + 7);

  if (nextDate > cutoff) {
    return { parent_id: parent.id, skipped: 'not_due_yet', next: nextDateStr };
  }

  // 멱등 체크 — 같은 parent + 같은 due_date 인스턴스 있는지
  const existing = await Task.findOne({
    where: { recurrence_parent_id: parent.id, due_date: nextDateStr, id: { [Op.ne]: parent.id } },
    attributes: ['id'],
  });

  let createdId = null;
  if (!existing) {
    const inst = await Task.create({
      business_id: parent.business_id,
      project_id: parent.project_id, // ★ 누락 시 프로젝트 정기업무 인스턴스가 고아(목록서 사라짐)
      conversation_id: parent.conversation_id,
      source_message_id: null,
      title: parent.title,
      description: parent.description,
      body: null,
      assignee_id: parent.assignee_id,
      client_id: parent.client_id,
      status: 'not_started',
      cue_kind: parent.cue_kind,
      cue_context_ref: parent.cue_context_ref,
      review_policy: parent.review_policy,
      review_round: 0,
      requires_client_review: parent.requires_client_review,
      client_share_custom: parent.client_share_custom,
      client_share_content: parent.client_share_content,
      source: parent.source,
      request_by_user_id: parent.request_by_user_id,
      request_ack_at: null,
      priority_order: parent.priority_order,
      start_date: null,
      due_date: nextDateStr,
      completed_at: null,
      estimated_hours: parent.estimated_hours,
      actual_hours: 0,
      progress_percent: 0,
      planned_week_start: null,
      category: parent.category,
      created_by: parent.created_by,
      from_candidate_id: null,
      recurrence_rule: null,
      recurrence_parent_id: parent.id,
      next_occurrence_at: null,
    });
    createdId = inst.id;

    // 컨펌자(reviewer) 복사 — review_policy 만 복사되면 reviewer 0명이라 인스턴스가 완료 불가.
    // 각 회차는 parent 와 같은 컨펌자를 갖되 상태는 pending 으로 리셋.
    try {
      const parentReviewers = await TaskReviewer.findAll({ where: { task_id: parent.id } });
      if (parentReviewers.length) {
        await TaskReviewer.bulkCreate(parentReviewers.map((rv) => ({
          task_id: inst.id,
          user_id: rv.user_id,
          is_client: rv.is_client,
          state: 'pending',
          reverted_once: false,
          action_at: null,
          added_by_user_id: rv.added_by_user_id,
        })));
      }
    } catch (e) {
      console.warn('[recurringTask] reviewer copy failed', inst.id, e.message);
    }

    // 실시간 동기화 — 새 인스턴스가 다른 사용자/디바이스에 즉시 보이도록.
    // CLAUDE.md "운영 안정성 16번" — 모든 task 생성 라우트는 broadcast 강제.
    if (io) {
      try {
        const { Task: TaskModel, Project, User } = require('../models');
        const full = await TaskModel.findByPk(inst.id, {
          include: [
            { model: Project, attributes: ['id', 'name'], required: false },
            { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
            { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
          ],
        });
        if (full) {
          // actor_user_id null — cron 발생이라 본인 액션 토스터 차단 대상 없음
          const payload = { ...full.toJSON(), actor_user_id: null, _source: 'recurring_cron' };
          if (parent.business_id) io.to(`business:${parent.business_id}`).emit('task:new', payload);
          if (parent.project_id) io.to(`project:${parent.project_id}`).emit('task:new', payload);
        }
      } catch (e) {
        console.warn('[recurringTask] broadcast failed', inst.id, e.message);
      }
    }
  }

  // parent.next_occurrence_at advance
  const total = await Task.count({
    where: {
      [Op.or]: [{ id: parent.id }, { recurrence_parent_id: parent.id }],
    },
  });
  const nextNext = computeNextOccurrence(parent.recurrence_rule, nextDateStr, total);
  await parent.update({
    next_occurrence_at: nextNext ? toDateOnlyStr(nextNext) : null,
  });

  return {
    parent_id: parent.id,
    instance_id: createdId,
    due_date: nextDateStr,
    next: nextNext ? toDateOnlyStr(nextNext) : null,
    series_ended: !nextNext,
  };
}

// io: server.js 가 cron 진입점에서 주입.
async function runDailyRecurringTaskGen(today = new Date(), io = null) {
  const cutoffDate = new Date(today);
  cutoffDate.setDate(today.getDate() + 7);
  const cutoffStr = toDateOnlyStr(cutoffDate);

  // parent: recurrence_rule != null AND recurrence_parent_id IS NULL
  const parents = await Task.findAll({
    where: {
      recurrence_rule: { [Op.ne]: null },
      recurrence_parent_id: null,
      next_occurrence_at: { [Op.ne]: null, [Op.lte]: cutoffStr },
    },
  });

  const out = { ok: 0, skip: 0, fail: 0, results: [] };
  for (const p of parents) {
    try {
      const r = await generateOneSeries(p, today, io);
      if (r.instance_id) out.ok += 1;
      else out.skip += 1;
      out.results.push(r);
    } catch (e) {
      console.warn('[recurringTask] parent', p.id, 'crash', e.message);
      out.fail += 1;
      out.results.push({ parent_id: p.id, error: e.message });
    }
  }
  return out;
}

module.exports = {
  runDailyRecurringTaskGen,
  generateOneSeries,
  computeNextOccurrence,
};
