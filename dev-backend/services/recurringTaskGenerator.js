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
// ★ 캐치업 (피드백 #351) — 4) 는 **cutoff 를 넘을 때까지 반복**한다.
//   한 번의 실행에서 회차를 1건만 만들면, 서버가 며칠 멈췄다 재개됐을 때 밀린 회차가
//   하루 1건씩만 따라잡히고 새 회차도 하루 1건씩 쌓여 **밀림이 영구 고정**된다
//   (회차 due 가 항상 며칠 과거 → 시스템이 스스로 지연 문턱을 채운다).
//   시리즈당 상한 MAX_CATCHUP_PER_RUN 으로 폭주만 막는다. 멱등 체크가 이미 있어 중복은 없다.
//
// ★ 상속 (피드백 #348) — 회차는 parent 의 workstream_id·태그(task_tag_links)·
//   start~due 기간 offset 을 물려받는다. 없으면 캔버스 영역별 뷰에서 실제 회차가 전부 미분류로 떨어진다.
//   task_links 는 의도적으로 복사하지 않는다 (링크 행 폭증 — 회차 화면에서 parent 의 관련 업무를 조회 병합).
//
// ★ 알림 (피드백 #350) — 회차마다 1건씩 보내면 데일리·주간·월간이 겹치는 날 자정에 4~6건이 연속 발송된다.
//   실행 단위로 (사용자 × 워크스페이스) 로 모아 **다이제스트 1건**만 보낸다. 1건이면 기존 문구 그대로.
//
// 멱등: 같은 날 여러 번 호출돼도 인스턴스 중복 생성 없음
// 안전: 한 시리즈 실패해도 다른 시리즈 계속 (try/catch per parent)

const { Op } = require('sequelize');
const { RRule } = require('rrule');
const { Task, TaskReviewer, TaskTagLink, TaskStatusHistory } = require('../models');

// 시리즈 하나가 한 번의 실행에서 만들 수 있는 회차 상한.
// 밀린 회차 캐치업용 — 일간 시리즈가 한 달 밀려도 한 번에 따라잡되, 잘못된 RRULE 폭주는 막는다.
const MAX_CATCHUP_PER_RUN = 31;

// YYYY-MM-DD string → UTC midnight Date (DATEONLY 비교용)
function dateOnlyToUTC(dateStr) {
  if (!dateStr) return null;
  const s = typeof dateStr === 'string' ? dateStr.slice(0, 10) : dateStr.toISOString().slice(0, 10);
  return new Date(s + 'T00:00:00Z');
}

function toDateOnlyStr(d) {
  return d.toISOString().slice(0, 10);
}

/** DATEONLY 값을 'YYYY-MM-DD' 로 정규화. 문자열이 오든 Date 가 오든 같은 결과.
 *  dev/운영이 서로 다른 타입을 주므로 **비교 전에 반드시 이 함수를 통과시킨다.** */
function dateOnlyOf(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : toDateOnlyStr(d);
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

// parent 의 start~due 기간(일수)을 유지한 회차 시작일 (#348 ③).
// parent 가 start_date 를 갖는 기간형 업무(월간·분기)에서 무조건 null 로 리셋하면 시작일이 소실된다.
function inheritedStartDate(parent, nextDueStr) {
  if (!parent.start_date || !parent.due_date) return null;
  const ps = dateOnlyToUTC(parent.start_date);
  const pd = dateOnlyToUTC(parent.due_date);
  if (!ps || !pd) return null;
  const offsetDays = Math.round((pd.getTime() - ps.getTime()) / 86400000);
  if (!Number.isFinite(offsetDays) || offsetDays < 0) return null;
  const nd = dateOnlyToUTC(nextDueStr);
  nd.setUTCDate(nd.getUTCDate() - offsetDays);
  return toDateOnlyStr(nd);
}

// 회차 1건 생성 (멱등). 이미 같은 due_date 회차가 있으면 null 반환.
// notifyBucket: (사용자 × 워크스페이스) 알림 다이제스트 수집기 (#350). null 이면 알림 수집 생략.
async function createOccurrence(parent, nextDateStr, io = null, notifyBucket = null) {
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
      // #353 ⑤ — 중요도도 회차에 물려준다. 안 물려주면 부모는 "긴급" 인데 실제 회차는
      //   전부 미지정으로 태어난다 — workstream_id 가 그랬던 것과 같은 누락 계열(#348 ①).
      priority_level: parent.priority_level,
      // #348 ③ — parent 가 start~due 기간을 가지면 그 일수를 유지해 새 due 기준으로 재계산
      start_date: inheritedStartDate(parent, nextDateStr),
      due_date: nextDateStr,
      completed_at: null,
      estimated_hours: parent.estimated_hours,
      actual_hours: 0,
      progress_percent: 0,
      planned_week_start: null,
      category: parent.category,
      // #348 ① — 업무그룹(워크스트림) 상속. 누락 시 캔버스 영역별 뷰에서 실제 회차가 전부 미분류로 떨어진다
      // (운영 실측: 반복 인스턴스 28건 전부 workstream NULL). project_id 와 같은 누락-고아 계열.
      workstream_id: parent.workstream_id,
      is_milestone: parent.is_milestone,
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

    // #348 ② 태그(task_tag_links) 복사 — reviewer 복사와 동일 패턴.
    // 태그 기준으로 회차를 찾는 사용자에게 parent 만 걸리고 실제 회차가 안 걸리는 것을 막는다.
    try {
      const parentTags = await TaskTagLink.findAll({ where: { task_id: parent.id }, attributes: ['tag_id'] });
      if (parentTags.length) {
        await TaskTagLink.bulkCreate(
          parentTags.map((tl) => ({ task_id: inst.id, tag_id: tl.tag_id })),
          { ignoreDuplicates: true },
        );
      }
    } catch (e) {
      console.warn('[recurringTask] tag copy failed', inst.id, e.message);
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

    // #90 계열 — 정기 업무 새 회차 생성 시 담당자 알림.
    // #350: 회차마다 즉시 보내지 않고 실행 단위 다이제스트로 모은다 (자정 4~6건 연속 발송 차단).
    if (parent.assignee_id && notifyBucket) {
      const key = `${parent.assignee_id}:${parent.business_id}`;
      let entry = notifyBucket.get(key);
      if (!entry) {
        entry = { userId: parent.assignee_id, businessId: parent.business_id, items: [] };
        notifyBucket.set(key, entry);
      }
      entry.items.push({ taskId: inst.id, title: parent.title, dueDate: nextDateStr });
    }
  }

  return createdId;
}

// 모아둔 회차 생성 알림을 (사용자 × 워크스페이스) 당 1건으로 발송한다 (#350).
// 1건이면 기존 문구를 그대로 써서 해당 업무로 바로 들어가게 하고, 2건 이상이면 다이제스트로.
async function flushRecurringNotifications(notifyBucket, io = null) {
  if (!notifyBucket || notifyBucket.size === 0) return 0;
  const appUrl = process.env.APP_URL || 'https://dev.planq.kr';
  let sent = 0;
  for (const entry of notifyBucket.values()) {
    if (!entry.items.length) continue;
    try {
      const { notify } = require('../routes/notifications');
      const Business = require('../models/Business');
      const bizR = await Business.findByPk(entry.businessId, { attributes: ['name', 'brand_name'] });
      const workspaceName = bizR?.brand_name || bizR?.name || null;

      let payload;
      if (entry.items.length === 1) {
        const it = entry.items[0];
        payload = {
          title: '정기 업무가 생성되었습니다',
          body: `"${it.title}" · 마감 ${it.dueDate}`,
          link: `${appUrl}/tasks?task=${it.taskId}`,
          entityType: 'task', entityId: it.taskId,
        };
      } else {
        // 같은 시리즈가 여러 회차 생성되는 것이 정상이라 제목이 반복된다 — 업무명 기준으로 중복 제거.
        const titles = [...new Set(entry.items.map((it) => it.title))];
        const preview = titles.slice(0, 3).join(', ');
        const rest = Math.max(0, titles.length - 3);
        payload = {
          title: `오늘의 정기 업무 ${entry.items.length}건이 준비됐어요`,
          body: rest > 0 ? `${preview} 외 ${rest}건` : preview,
          link: `${appUrl}/tasks`,
          entityType: 'task', entityId: entry.items[0].taskId,
        };
      }

      await notify({
        userId: entry.userId, businessId: entry.businessId, eventKind: 'task',
        ...payload,
        ctaLabel: '업무 보기', workspaceName, ioApp: io || null,
      }).catch((e) => console.warn('[notify recurring]', e.message));
      sent += 1;
    } catch (e) {
      console.warn('[notify recurring outer]', e.message);
    }
  }
  return sent;
}

// io: socket.io Server instance (server.js 에서 주입). 없으면 broadcast 스킵 (단위 테스트 안전).
// notifyBucket: 실행 단위 알림 다이제스트 수집기 (#350). 없으면 이 함수가 자체 수집 후 바로 flush.
/**
 * #349 — 시리즈의 **지난 미수행 회차를 자동 마감**한다 (miss_policy='auto_skip' 일 때만).
 *
 * 루틴은 "그날 안 하면 넘어가는" 성격인데, 안 한 회차가 not_started 로 남으면 지연으로 쌓여
 *   인사이트 경고 + 프로젝트 health red 를 만든다(평일 데일리면 하루만 놓쳐도 문턱에 닿는다).
 *   사용자가 매주 금요일에 손으로 취소하던 일을 여기서 대신한다.
 *
 * ★ **생성 여부와 무관하게 돈다.** 처음엔 회차 생성 루프 안에 뒀는데, 다음 회차가 아직 멀면
 *   (주간·월간 시리즈) `not_due_yet` 으로 조기 반환돼 **정리가 영영 실행되지 않았다**(실측).
 *   정리는 생성의 곁가지가 아니라 독립된 일이다.
 * ★ 대상은 **지난 회차 중 손도 안 댄 것(not_started)** 뿐이다. 진행 중·컨펌 중·보류는
 *   사람이 이미 손을 댄 일이라 건드리지 않는다.
 * ★ 이력을 남긴다 — 남기지 않으면 사용자에겐 "업무가 조용히 사라진" 것으로 보인다.
 *
 * ★★ #349 의 **세 번째 구멍** (운영 신고 2026-09-03) — 첫 회차가 면제돼 있었다.
 *   Irene: *"설정을 이렇게 해도 지낸 리스트까지 오늘 업무리스트에 다 나와"*
 *   (매주 금 · 계속 반복 · 못 한 회차는 자동으로 넘기기)
 *   원인: **반복 업무의 첫 회차는 부모 행 자신**이다(`recurrence_parent_id IS NULL`).
 *   그런데 정리 조건이 `recurrence_parent_id = parent.id` 라 **자기 자신은 영원히 안 걸린다.**
 *   그래서 모든 시리즈의 첫 회차가 구조적으로 면제됐고, 지난 금요일 것이 오늘 목록에 지연으로
 *   계속 떴다(운영 실측: 같은 상태의 부모 5건 — #232·#233·#234·#235·#237).
 *   → 부모 자신도 "지난 미수행 회차" 면 같이 마감한다.
 *   ※ 시리즈는 죽지 않는다: 생성 대상 조회(:400-406)에 status 조건이 없고,
 *     createOccurrence 는 부모 상태를 보지 않으며(항상 not_started 로 새 회차를 만든다),
 *     반복 설정 편집 권한도 상태와 무관하다(작성자·소유자 기준). `next_occurrence_at` 은 건드리지 않는다.
 */
async function skipMissedOccurrences(parent, today = new Date(), io = null) {
  if (parent.miss_policy !== 'auto_skip') return [];
  const todayStr = toDateOnlyStr(today);
  const skippedIds = [];

  // ① 부모 행 자신 = 시리즈의 첫 회차.
  //   ★ due_date 를 문자열로 단정하지 말 것 (2026-09-03 운영 실측):
  //     dev 는 DATEONLY 를 'YYYY-MM-DD' **문자열**로 주는데 **운영은 Date 객체**로 준다.
  //     그래서 `String(due) < todayStr` 이 운영에서만 항상 false 였고, 배포 후 1회 실행에서
  //     skipped:0 이 나왔다 — dev 검증은 전부 통과한 채로. (memory feedback_dev_cannot_reproduce_prod_schema)
  //     자식 쪽은 SQL `Op.lt` 라 MySQL 이 알아서 비교해 멀쩡했다 — JS 비교를 한 이 줄만 깨졌다.
  const dueStr = dateOnlyOf(parent.due_date);
  if (parent.status === 'not_started' && dueStr && dueStr < todayStr) {
    await parent.update({ status: 'canceled', completed_at: null });
    try {
      await TaskStatusHistory.create({
        task_id: parent.id,
        event_type: 'status_change',
        from_status: 'not_started',
        to_status: 'canceled',
        actor_user_id: null,
        note: '미수행 회차 자동 마감 (시리즈 설정: 지난 회차 자동 넘김)',
      });
    } catch (e) { console.warn('[recurringTask] skip history(parent)', e.message); }
    skippedIds.push(parent.id);
  }

  // ② 자식 회차
  const stale = await Task.findAll({
    where: {
      recurrence_parent_id: parent.id,
      status: 'not_started',
      due_date: { [Op.lt]: todayStr },
    },
    attributes: ['id'],
  });
  for (const inst of stale) {
    await inst.update({ status: 'canceled', completed_at: null });
    try {
      await TaskStatusHistory.create({
        task_id: inst.id,
        event_type: 'status_change',
        from_status: 'not_started',
        to_status: 'canceled',
        actor_user_id: null,
        note: '미수행 회차 자동 마감 (시리즈 설정: 지난 회차 자동 넘김)',
      });
    } catch (e) { console.warn('[recurringTask] skip history', e.message); }
    skippedIds.push(inst.id);
  }
  if (skippedIds.length) {
    console.log('[recurringTask] parent', parent.id, '미수행 회차 자동 마감', skippedIds.length, '건');
    // CLAUDE.md 운영 안정성 16 — 같은 파일의 createOccurrence 는 task:new 를 쏘는데 취소는 안 쐈다.
    //   자정 배치만이면 영향이 작지만, 배포 직후 수동 1회 실행에서는 열어 둔 화면에 지운 항목이 남는다.
    if (io) {
      for (const id of skippedIds) {
        try {
          const payload = { id, status: 'canceled', business_id: parent.business_id, project_id: parent.project_id || null };
          if (parent.business_id) io.to(`business:${parent.business_id}`).emit('task:updated', payload);
          if (parent.project_id) io.to(`project:${parent.project_id}`).emit('task:updated', payload);
        } catch (e) { console.warn('[recurringTask] skip broadcast', id, e.message); }
      }
    }
  }
  return skippedIds;
}

async function generateOneSeries(parent, today = new Date(), io = null, notifyBucket = null) {
  // ★ 정리를 **먼저** 한다 — 아래 조기 반환(series_ended · not_due_yet)에 걸려도 실행되도록.
  const skippedIds = await skipMissedOccurrences(parent, today, io);

  if (!parent.next_occurrence_at) {
    return { parent_id: parent.id, skipped: 'series_ended', skipped_ids: skippedIds, skipped_count: skippedIds.length };
  }

  const ownBucket = notifyBucket ? null : new Map();
  const bucket = notifyBucket || ownBucket;

  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() + 7);

  let nextDateStr = typeof parent.next_occurrence_at === 'string'
    ? parent.next_occurrence_at.slice(0, 10)
    : toDateOnlyStr(parent.next_occurrence_at);

  if (dateOnlyToUTC(nextDateStr) > cutoff) {
    return { parent_id: parent.id, skipped: 'not_due_yet', next: nextDateStr, skipped_ids: skippedIds, skipped_count: skippedIds.length };
  }

  // 이미 만들어진 occurrence 수 (parent 1 + 인스턴스). COUNT 종료조건 판정 기준 — 루프 안에서 증가시킨다.
  let generated = await Task.count({
    where: { [Op.or]: [{ id: parent.id }, { recurrence_parent_id: parent.id }] },
  });

  const createdIds = [];
  const dueDates = [];
  let nextNextStr = null;
  let rounds = 0;

  // ★ 캐치업 루프 (#351) — cutoff 를 넘거나 시리즈가 끝날 때까지 계속 만든다.
  while (rounds < MAX_CATCHUP_PER_RUN) {
    rounds += 1;

    const createdId = await createOccurrence(parent, nextDateStr, io, bucket);
    if (createdId) {
      createdIds.push(createdId);
      generated += 1;
    }
    dueDates.push(nextDateStr);

    const nextNext = computeNextOccurrence(parent.recurrence_rule, nextDateStr, generated);
    nextNextStr = nextNext ? toDateOnlyStr(nextNext) : null;
    await parent.update({ next_occurrence_at: nextNextStr });

    if (!nextNextStr) break;                                   // 종료조건 도달 (COUNT/UNTIL)
    if (dateOnlyToUTC(nextNextStr) > cutoff) break;            // cutoff 밖 — 다음 실행에서
    nextDateStr = nextNextStr;
  }

  if (rounds >= MAX_CATCHUP_PER_RUN && nextNextStr && dateOnlyToUTC(nextNextStr) <= cutoff) {
    // 상한에 걸렸다 = 남은 밀린 회차가 있다. 다음 실행에서 이어서 따라잡는다 (멱등이라 안전).
    console.warn('[recurringTask] parent', parent.id, 'catch-up capped at', MAX_CATCHUP_PER_RUN, 'next', nextNextStr);
  }

  if (ownBucket) await flushRecurringNotifications(ownBucket, io);

  return {
    parent_id: parent.id,
    instance_id: createdIds[0] || null,   // 하위호환 — 첫 회차 id
    instance_ids: createdIds,
    created_count: createdIds.length,
    due_date: dueDates[0] || null,
    due_dates: dueDates,
    next: nextNextStr,
    series_ended: !nextNextStr,
    skipped_ids: skippedIds,
    skipped_count: skippedIds.length,
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

  // #350 — 실행 전체에서 알림을 모았다가 (사용자 × 워크스페이스) 당 1건만 보낸다.
  const notifyBucket = new Map();

  const out = { ok: 0, skip: 0, fail: 0, created: 0, skipped: 0, notified: 0, results: [] };
  for (const p of parents) {
    try {
      const r = await generateOneSeries(p, today, io, notifyBucket);
      const n = r.created_count || 0;
      if (n > 0) { out.ok += 1; out.created += n; }
      else out.skip += 1;
      out.skipped += r.skipped_count || 0;
      out.results.push(r);
    } catch (e) {
      console.warn('[recurringTask] parent', p.id, 'crash', e.message);
      out.fail += 1;
      out.results.push({ parent_id: p.id, error: e.message });
    }
  }

  // ★ #349 의 반쪽 구멍 (Fable 설계 게이트 2026-08-30) — 지난 미수행 회차 정리가
  //   **생성 대상 parent 에만** 돌고 있었다. 위 parents 조회가 `next_occurrence_at <= cutoff` 를
  //   요구하기 때문이다. generateOneSeries 안의 조기반환(series_ended · not_due_yet)은 이미
  //   고쳤지만 **바깥 WHERE 가 그대로 남아**, 정리는 여전히 생성의 곁가지였다.
  //   실제 피해 폭: 월간 시리즈는 한 달 중 ~3주, 분기는 ~11주, 연간은 ~51주 동안 정리가 안 돌고,
  //   종결된 시리즈(next_occurrence_at NULL)는 **영영** 안 돈다.
  //   → 정리는 생성과 독립된 일이므로 **대상도 독립으로 조회한다** (auto_skip 시리즈 전체).
  const handledIds = parents.map((p) => p.id);
  const cleanupOnly = await Task.findAll({
    where: {
      recurrence_rule: { [Op.ne]: null },
      recurrence_parent_id: null,
      miss_policy: 'auto_skip',
      ...(handledIds.length ? { id: { [Op.notIn]: handledIds } } : {}),
    },
  });
  for (const p of cleanupOnly) {
    try {
      const skippedIds = await skipMissedOccurrences(p, today, io);
      if (skippedIds.length) {
        out.skipped += skippedIds.length;
        out.results.push({
          parent_id: p.id, cleanup_only: true,
          skipped_ids: skippedIds, skipped_count: skippedIds.length,
        });
      }
    } catch (e) {
      console.warn('[recurringTask] cleanup parent', p.id, 'crash', e.message);
      out.fail += 1;
      out.results.push({ parent_id: p.id, cleanup_only: true, error: e.message });
    }
  }

  out.notified = await flushRecurringNotifications(notifyBucket, io);
  return out;
}

module.exports = {
  runDailyRecurringTaskGen,
  generateOneSeries,
  skipMissedOccurrences,
  createOccurrence,
  flushRecurringNotifications,
  computeNextOccurrence,
};
