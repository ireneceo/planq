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
const { Task } = require('../models');
const { computeNextOccurrence } = require('./recurringTaskGenerator');

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
  if (updates.recurrence_rule === undefined || !task.recurrence_parent_id) return undefined;
  const out = { rule: updates.recurrence_rule };
  delete updates.recurrence_rule;
  delete updates.next_occurrence_at;
  return out;
}

/**
 * 규칙을 시리즈에 적용하고, 아직 손대지 않은 앞으로의 회차를 비운다(=새 주기로 다시 생성되게).
 *
 * @returns {Promise<{ok:true, reset:number} | {ok:false, code:string, http:number}>}
 */
async function applySeriesRuleChange({
  task, updates, businessId, seriesRuleChange, scope, actorId, isOwnerOrAdmin, getToday,
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
      return { ok: false, code: 'forbidden_fields:recurrence_rule', http: 403 };
    }
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
  //   · scope='future' → 이 회차 이후    · scope='all' → 오늘 이후 전부
  //   지난 회차는 기록이라 보존한다 — 이미 지나간 날짜를 새 주기로 옮길 수는 없다.
  //   ★ **미착수(not_started)만** 지운다. 진행중·검토중·완료는 사람이 손댄 결과물이다.
  //   ★ 반복을 **끄는** 경우는 정리하지 않는다 — 잡혀 있던 앞으로의 회차는 계획된 일이고,
  //     "규칙을 끈다" 와 "남은 회차를 지운다" 는 다른 의사결정이다(사용자는 전자만 눌렀다).
  const newRule = seriesRuleChange ? seriesRuleChange.rule : updates.recurrence_rule;
  if (!newRule) return { ok: true, reset: 0 };
  //   ★ 오늘 날짜는 **필요할 때만** 구한다 — 워크스페이스 tz 조회가 딸려 있어서,
  //     반복과 무관한 모든 업무 저장에까지 쿼리를 하나 얹으면 안 된다.
  const fromDate = String(scope || 'future').toLowerCase() === 'all'
    ? await getToday()
    : asDateOnly(task.due_date);
  if (!fromDate) return { ok: true, reset: 0 };

  const reset = await Task.destroy({
    where: {
      business_id: businessId,
      recurrence_parent_id: parent.id,
      id: { [Op.ne]: task.id },
      status: 'not_started',
      due_date: { [Op.gte]: fromDate },
    },
  });
  return { ok: true, reset: reset || 0 };
}

module.exports = { extractSeriesRuleChange, applySeriesRuleChange, asDateOnly };
