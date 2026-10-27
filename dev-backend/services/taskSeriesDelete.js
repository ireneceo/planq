// services/taskSeriesDelete.js — 반복 업무 삭제 범위 «이 업무만 / 이 업무와 이후 모두» (2026-10-27)
//
// Irene 2026-10-27: *"반복업무는 삭제할 때 다같이 삭제할건지 이것만 삭제할건지 물어야지.
//   이전거 삭제는 필요없지? 구글캘린더의 경우는 그렇게 하던데"*
//   → 구글 캘린더의 «이 일정 / 이 일정 및 향후 일정» 두 가지. 지난 회차는 기록이라 남긴다.
//
// 시리즈 모델(recurringTaskGenerator 머리말): 부모 = 첫 회차이자 규칙(recurrence_rule·next_occurrence_at)을 가진 행.
//   그래서 «이 업무만» 이 부모면 그냥 지우면 안 된다 — 규칙이 같이 사라져 반복이 통째로 멈춘다(옛 동작).
//   남은 회차 중 가장 이른 것에 규칙을 넘기고(handover) 나머지 회차를 그 밑으로 옮긴다.
//
//   single — 이 업무만. 회차를 지우면 생성기는 그 날짜를 다시 만들지 않는다(next_occurrence_at 이 이미 지나갔다).
//            COUNT(«N회 반복») 시리즈는 생성기가 남은 행 수로 끝을 판정하므로 COUNT 를 1 줄인다 —
//            안 줄이면 끝에 한 회차가 더 생겨 «지운 것이 뒤로 밀려난» 꼴이 된다.
//   future — 이 업무 + 마감일이 같거나 뒤인 **미착수** 회차를 지우고 반복을 이 업무 앞에서 끝낸다.
//            진행·컨펌·완료된 뒤 회차는 사람이 손댄 결과물이라 남긴다(taskSeriesRecurrence 의 «미착수만» 과 같은 선).
const { Op } = require('sequelize');
const { Task } = require('../models');
const { dateOnlyOf } = require('../utils/dateOnly');

const DELETE_SCOPES = ['single', 'future'];

function normalizeDeleteScope(raw) {
  const s = String(raw || 'single').toLowerCase();
  return DELETE_SCOPES.includes(s) ? s : 'single';
}

/** COUNT=n → COUNT=n+delta (최소 1). COUNT 가 없으면 그대로. */
function adjustCount(rule, delta) {
  if (!rule) return rule;
  return rule.replace(/(^|;)COUNT=(\d+)/i, (_m, pre, n) => `${pre}COUNT=${Math.max(1, Number(n) + delta)}`);
}

/** 규칙을 dateStr 하루 전 23:59:59Z 에서 끝낸다(COUNT 는 지운다). 이미 더 이른 UNTIL 이면 그대로. */
function endBefore(rule, dateStr) {
  if (!rule || !dateStr) return rule;
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const until = `${d.toISOString().slice(0, 10).replace(/-/g, '')}T235959Z`;
  const m = rule.match(/(?:^|;)UNTIL=(\d{8})/i);
  if (m && m[1] <= until.slice(0, 8)) return rule;
  const parts = rule.split(';').filter((p) => p && !/^(COUNT|UNTIL)=/i.test(p));
  parts.push(`UNTIL=${until}`);
  return parts.join(';');
}

/**
 * 같이 지울 다른 회차 id (scope='future' 일 때만). 지금 지우는 업무는 넣지 않는다.
 * 부모를 고르면 시리즈 첫 회차부터이므로 미착수 회차 전부가 대상이다.
 */
async function seriesDeleteExtras(task, rawScope) {
  const scope = normalizeDeleteScope(rawScope);
  if (scope !== 'future' || !(task.recurrence_rule || task.recurrence_parent_id)) return [];
  const parentId = task.recurrence_parent_id || task.id;
  const where = {
    business_id: task.business_id,
    recurrence_parent_id: parentId,
    id: { [Op.ne]: task.id },
    status: 'not_started',
  };
  const due = dateOnlyOf(task.due_date);
  if (task.recurrence_parent_id && due) where.due_date = { [Op.gte]: due };
  return (await Task.findAll({ where, attributes: ['id'] })).map((r) => r.id);
}

/**
 * «이 업무만» 으로 부모를 지울 때 이어받을 회차가 없으면 다음 회차를 지금 만든다
 * (월간처럼 생성기가 아직 다음 회차를 안 만든 시리즈). 트랜잭션 **밖에서** 부른다 — 생성기는 트랜잭션을 받지 않는다.
 * 멱등(같은 날짜 회차가 있으면 만들지 않음)이라 삭제가 실패해도 생성기가 어차피 만들 행 하나가 먼저 생길 뿐이다.
 */
async function ensureHeir(task, rawScope, io = null) {
  if (normalizeDeleteScope(rawScope) !== 'single') return;
  if (!task.recurrence_rule || task.recurrence_parent_id || !task.next_occurrence_at) return;
  const has = await Task.count({ where: { business_id: task.business_id, recurrence_parent_id: task.id } });
  if (has) return;
  const gen = require('./recurringTaskGenerator');
  const nextStr = dateOnlyOf(task.next_occurrence_at);
  await gen.createOccurrence(task, nextStr, io, null);
  const generated = await Task.count({ where: { [Op.or]: [{ id: task.id }, { recurrence_parent_id: task.id }] } });
  const nn = gen.computeNextOccurrence(task.recurrence_rule, nextStr, generated);
  await task.update({ next_occurrence_at: nn ? nn.toISOString().slice(0, 10) : null });
}

/**
 * 지우기 직전, 같은 트랜잭션 안에서 시리즈를 정리한다.
 * 반환: { heir_id } — 규칙을 이어받은 회차(부모를 «이 업무만» 지웠을 때).
 */
async function prepareSeriesDelete(task, rawScope, t) {
  const scope = normalizeDeleteScope(rawScope);
  const isParent = !!task.recurrence_rule && !task.recurrence_parent_id;

  if (isParent) {
    const children = await Task.findAll({
      where: { business_id: task.business_id, recurrence_parent_id: task.id },
      order: [['due_date', 'ASC'], ['id', 'ASC']],
      transaction: t,
    });
    // future = 시리즈 전체가 끝난다. 남는(손댄) 회차는 독립 업무로 떼어 둔다(옛 동작과 같다).
    if (scope === 'future' || !children.length) {
      if (children.length) {
        await Task.update({ recurrence_parent_id: null }, { where: { recurrence_parent_id: task.id }, transaction: t });
      }
      return { heir_id: null };
    }
    const heir = children[0];
    await Task.update(
      { recurrence_parent_id: heir.id },
      { where: { recurrence_parent_id: task.id, id: { [Op.ne]: heir.id } }, transaction: t },
    );
    await heir.update({
      recurrence_parent_id: null,
      recurrence_rule: adjustCount(task.recurrence_rule, -1),
      next_occurrence_at: task.next_occurrence_at,
      miss_policy: task.miss_policy,
    }, { transaction: t });
    return { heir_id: heir.id };
  }

  if (task.recurrence_parent_id) {
    const parent = await Task.findOne({
      where: { id: task.recurrence_parent_id, business_id: task.business_id }, transaction: t,
    });
    if (parent && parent.recurrence_rule) {
      if (scope === 'future') {
        await parent.update({ recurrence_rule: endBefore(parent.recurrence_rule, dateOnlyOf(task.due_date)), next_occurrence_at: null }, { transaction: t });
      } else if (/(^|;)COUNT=/i.test(parent.recurrence_rule)) {
        await parent.update({ recurrence_rule: adjustCount(parent.recurrence_rule, -1) }, { transaction: t });
      }
    }
  }
  return { heir_id: null };
}

module.exports = { normalizeDeleteScope, seriesDeleteExtras, ensureHeir, prepareSeriesDelete, adjustCount, endBefore, DELETE_SCOPES };
