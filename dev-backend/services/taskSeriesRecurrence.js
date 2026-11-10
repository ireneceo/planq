// 정기업무 시리즈의 **반복 규칙** 변경 — 단일 착지점.
//
// 왜 별도 파일인가
//   반복 규칙은 시리즈 전체가 공유하는 값인데, 화면은 회차(인스턴스)에서도 그것을 바꾼다.
//   "어느 행에 쓰고 / 무엇을 다시 잡을지" 판단이 라우트마다 흩어지면 반드시 갈라진다.
//   여기 하나만 둔다. (routes/tasks.js PUT 이 유일한 호출부)
//
// 모델 전제 (services/recurringTaskGenerator 와 동일)
//   parent   : recurrence_rule != null AND recurrence_parent_id IS NULL — 부모가 곧 첫 회차
//   instance : recurrence_rule == null AND recurrence_parent_id == parent.id
//   ★ 회차 행에 규칙을 쓰면 엔진이 **부모로도 회차로도 못 읽는 유령**이 된다 —
//     화면엔 반복으로 보이는데 다음 회차는 영영 안 생긴다. 그래서 값을 부모로 옮긴다.
const { Op } = require('sequelize');
const { RRule } = require('rrule');
const { Task } = require('../models');
const { computeNextOccurrence } = require('./recurringTaskGenerator');

/**
 * 새 규칙에서 `fromDate` 이상인 첫 회차 날짜(YYYY-MM-DD). 기준점(dtstart)은 시리즈 첫 회차(부모 마감일).
 * `skipDate` 와 같은 날이면 그다음 회차 — 그 날짜에는 남겨 둔 업무가 이미 있다.
 *
 * ★ 2026-11-10 Irene: *"반복설정 바꿨더니 과거 지연된 업무들 다 없어졌어 … 이 회차부터 적용 했는데"*
 *   옛 코드는 규칙을 바꾸면 생성 커서를 `부모 마감일 + 1주기` — **시리즈 맨 처음**으로 되돌렸다.
 *   생성기는 그 커서부터 오늘+7일까지 따라잡기 때문에 **이미 지난 날짜마다 새 규칙 회차를 지어냈다**
 *   (dev 실측: 5주 된 매주 월 → 매주 화 변경 → 10/13·10/20·10/27·11/03 가짜 지연 업무 4건).
 *   새 규칙은 «이제부터» 의 약속이다 — 커서는 경계일부터 잡는다.
 */
function firstOnOrAfter(ruleStr, anchorDate, fromDate, skipDate) {
  if (!ruleStr || !anchorDate || !fromDate) return null;
  let opts;
  try { opts = RRule.parseString(ruleStr); } catch (e) { return null; }
  opts.dtstart = new Date(`${anchorDate}T00:00:00Z`);
  const rule = new RRule(opts);
  let next = rule.after(new Date(`${fromDate}T00:00:00Z`), true);
  if (next && skipDate && next.toISOString().slice(0, 10) === skipDate) next = rule.after(next, false);
  return next ? next.toISOString().slice(0, 10) : null;
}

/** DATEONLY 안전 변환 — String(Date) 는 "Tue Sep 01 2026 …" 라 slice(0,10) 이 날짜가 아니다.
 *  이 함정으로 rrule 이 `Invalid options: dtstart` 500 을 냈다(실측 2026-08-31). */
function asDateOnly(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/**
 * PUT 이 규칙을 payload 에 담아 왔을 때, **회차라면** 그 값을 updates 에서 빼낸다.
 * 반드시 권한 검사(FIELD_RULES) 이후·task.update 이전에 부를 것.
 * @returns {{rule: string|null}|undefined} 빼낸 값 (부모였으면 undefined — 그대로 저장하면 된다)
 */
function extractSeriesRuleChange(task, updates) {
  if (!task.recurrence_parent_id) return undefined;      // 부모면 그대로 저장하면 된다
  const out = {};
  if (updates.recurrence_rule !== undefined) {
    out.rule = updates.recurrence_rule;
    delete updates.recurrence_rule;
    delete updates.next_occurrence_at;
  }
  // ★ 2026-09-08 — `miss_policy` 도 **시리즈 값**이다. 여태 이 문을 안 거치고 열려 있는
  //   회차 행에 그대로 저장됐는데, 정리 엔진(`recurringTaskGenerator.skipMissedOccurrences`)은
  //   **부모의** 값만 읽는다. 그래서 사용자가 회차에서 "못 한 회차는 자동으로 넘기기" 를 골라도
  //   아무 일도 일어나지 않았다 — 화면은 저장됐다고 하고 동작만 안 바뀐다.
  //   운영 실측(2026-09-08): 자식 회차 12건에 `auto_skip` 이 찍혀 있는데 그 부모 7개는 전부
  //   `carry` 였고, 지난 미수행 회차 22건이 계속 목록에 떴다.
  //   Irene: *"저장하지 말고 넘기기 설정해도 안바뀌고 있어. 반복업무 같은 내용으로 저장하게 안돼?"*
  //   ★ 옛 코드의 주석은 이미 "시리즈 부모에만 의미가 있다" 라고 적혀 있었다 —
  //     주석이 규칙을 말하고 코드가 안 지키면, 주석은 검증되지 않는다.
  if (updates.miss_policy !== undefined) {
    out.missPolicy = updates.miss_policy;
    delete updates.miss_policy;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * 규칙을 시리즈에 적용하고, 아직 손대지 않은 앞으로의 회차를 비운다(=새 주기로 다시 생성되게).
 *
 * @returns {Promise<{ok:true, reset:number} | {ok:false, code:string, http:number}>}
 */
async function applySeriesRuleChange({
  task, updates, businessId, seriesRuleChange, scope, actorId, isOwnerOrAdmin, getToday, io,
}) {
  const parentRuleChanged = updates.recurrence_rule !== undefined && !task.recurrence_parent_id;
  if (!seriesRuleChange && !parentRuleChanged) return { ok: true, reset: 0 };

  const parent = seriesRuleChange
    ? await Task.findOne({ where: { id: task.recurrence_parent_id, business_id: businessId } })
    : task;
  if (!parent) return { ok: false, code: 'series_parent_not_found', http: 404 };

  if (seriesRuleChange) {
    // 부모 기준 재검사 — 회차 행의 created_by 가 부모와 다를 수 있다(이관·복사 경로).
    if (!(isOwnerOrAdmin || String(parent.created_by) === String(actorId))) {
      const f = seriesRuleChange.rule !== undefined ? 'recurrence_rule' : 'miss_policy';
      return { ok: false, code: `forbidden_fields:${f}`, http: 403 };
    }
    // 못 한 회차 정책 — 시리즈 값이므로 **부모에** 쓴다. 규칙 변경과 독립이다(둘 다 올 수도 있다).
    if (seriesRuleChange.missPolicy !== undefined) {
      await parent.update({ miss_policy: seriesRuleChange.missPolicy });
    }
  }
  if (seriesRuleChange && seriesRuleChange.rule !== undefined) {
    if (!seriesRuleChange.rule) {
      await parent.update({ recurrence_rule: null, next_occurrence_at: null });
    } else {
      if (!parent.due_date) return { ok: false, code: 'due_date is required for recurring tasks', http: 400 };
      await parent.update({
        recurrence_rule: seriesRuleChange.rule,
        // 기준일은 **부모의 첫 회차일**이다. 회차 날짜로 계산하면 시리즈가 통째로 이사한다.
        next_occurrence_at: computeNextOccurrence(seriesRuleChange.rule, parent.due_date, 1),
      });
    }
  }
  // (parentRuleChanged 는 호출부의 task.update 에서 이미 반영됐다 — 여기서는 회차 정리만)

  // 아직 손대지 않은 앞으로의 회차를 비운다.
  //   · scope='future' → 이 회차 이후    · scope='all' → 내일부터 전부 (오늘 회차는 남긴다)
  //   ★ **어느 쪽이든 오늘보다 앞은 건드리지 않는다** (2026-11-10 Irene 신고 — 위 firstOnOrAfter 주석).
  //     지연된 회차를 열어 «이 회차 이후» 를 고르면 경계가 그 회차 날짜라, 그 뒤의 **다른 지연 업무까지**
  //     지워졌다(dev 실측: 11/07 회차에서 바꿈 → 11/08·11/09 지연 업무 소실 · 첫 회차에서 바꾸면 지연 5건 전부).
  //     지난 회차는 기록이고, 지연된 회차는 아직 할 일이다 — 이미 지나간 날짜를 새 주기로 옮길 수도 없다.
  //   ★ **미착수(not_started)만** 지운다. 진행중·검토중·완료는 사람이 손댄 결과물이다.
  //   ★ 반복을 **끄는** 경우는 정리하지 않는다 — 잡혀 있던 앞으로의 회차는 계획된 일이고,
  //     "규칙을 끈다" 와 "남은 회차를 지운다" 는 다른 의사결정이다(사용자는 전자만 눌렀다).
  const newRule = seriesRuleChange ? seriesRuleChange.rule : updates.recurrence_rule;
  if (!newRule) return { ok: true, reset: 0 };
  //   ★ 오늘 날짜는 **필요할 때만** 구한다 — 워크스페이스 tz 조회가 딸려 있어서,
  //     반복과 무관한 모든 업무 저장에까지 쿼리를 하나 얹으면 안 된다.
  const today = await getToday();
  const taskDue = asDateOnly(task.due_date);
  const isAll = String(scope || 'future').toLowerCase() === 'all';
  const fromToday = isAll || !taskDue || taskDue <= today;
  const fromDate = fromToday ? today : taskDue;
  if (!fromDate) return { ok: true, reset: 0 };

  //   오늘 회차는 남긴다 — 오늘 할 일로 이미 잡혀 있던 것이 눈앞에서 사라지면 같은 신고가 된다.
  //   (오늘 회차가 새 규칙 날짜와 겹쳐도 생성기는 같은 날짜를 다시 만들지 않는다 — createOccurrence 멱등)
  const reset = await Task.destroy({
    where: {
      business_id: businessId,
      recurrence_parent_id: parent.id,
      id: { [Op.ne]: task.id },
      status: 'not_started',
      due_date: fromToday ? { [Op.gt]: today } : { [Op.gte]: fromDate },
    },
  });

  // 생성 커서 — 새 규칙의 경계일 이후 첫 회차. 지금 고친 업무가 경계 위에 남아 있으면 그 날짜는 건너뛴다.
  const anchor = asDateOnly(parent.due_date);
  const keptDate = taskDue && taskDue >= fromDate ? taskDue : null;
  const cursor = firstOnOrAfter(newRule, anchor, fromDate, keptDate);
  await parent.update({ next_occurrence_at: cursor });

  // 바로 만든다 — 자정 생성기를 기다리면 바꾼 직후 화면엔 고친 업무 하나만 남는다
  //   (2026-11-10 Irene: *"1개만 남았는데 이번 업무도 아니야. 평일매일로 선택했는데"*).
  //   ★ 알림은 보내지 않는다 — 버킷을 넘기고 비우지 않는다(사람이 지금 직접 바꾼 일이라 «준비됐어요» 알림이 필요 없다).
  //   실패해도 저장은 성공이다 — 자정 생성기가 같은 커서로 이어서 만든다(멱등).
  let created = 0;
  if (cursor) {
    try {
      const gen = require('./recurringTaskGenerator');
      const r = await gen.generateOneSeries(parent, new Date(), io || null, new Map());
      created = (r && r.created_count) || 0;
    } catch (e) { console.warn('[taskSeriesRecurrence] 즉시 생성 실패 — 자정 생성기가 이어 만든다', parent.id, e.message); }
  }
  return { ok: true, reset: reset || 0, next: cursor, created };
}

module.exports = { extractSeriesRuleChange, applySeriesRuleChange, asDateOnly, firstOnOrAfter };
