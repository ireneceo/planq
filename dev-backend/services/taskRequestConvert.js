// 이미 «요청» 으로 들어간 업무를 «배정 업무» 로 — 한 건 변환의 단일 착지점.
//
// 왜 있는가 — 2026-11-18 이전에는 남을 담당으로 넣으면 «요청하기» 를 고르지 않아도 전부 요청이 됐다
//   (만든 사람 자동 컨펌자 + 확인 단계). 그 뒤로는 «요청하기» 뜻일 때만 요청이다. 그 전에 일정 짜기로 들어간
//   요청을 일반 업무로 돌리는 일회성 길이다(설계 docs/TASK_REQUEST_INTENT_DESIGN.md §4-10, Fable DESIGN-READY).
//   업무별 손잡이는 만들지 않는다 — 잘못 건 요청 하나는 컨펌자 빼기로 풀린다.
//
// 대상 술어(ELIGIBLE_WHERE) — 두 인자(business_id·created_by)는 필수라 남의 요청은 건드릴 수 없다:
//   request_by = created_by ∧ source internal_request ∧ project 업무 ∧ 시작 전·진행대기·진행 중 ∧ 컨펌 라운드 0 ∧
//   컨펌자가 정확히 작성자 1명(pending · 내부) ∧ 급여 송금 업무 아님. 메일 답변 업무는 컨펌자 0명이라 저절로 빠진다.
// 바꾸는 것: request_by → NULL · source → 'manual' · 작성자 컨펌자 행 삭제. 알림 없음 · task:updated 신호 · 감사 1행.
//   request_ack_at 은 두지만 요청이 아니면 읽히지 않는다(확인 단계 술어가 request_by 를 먼저 본다).

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ELIGIBLE_WHERE = `
      t.business_id = :businessId
  AND t.created_by = :creatorId
  AND t.request_by_user_id = t.created_by
  AND t.source = 'internal_request'
  AND t.project_id IS NOT NULL
  AND t.status IN ('not_started', 'waiting', 'in_progress')
  AND COALESCE(t.review_round, 0) = 0
  AND (SELECT COUNT(*) FROM task_reviewers r WHERE r.task_id = t.id) = 1
  AND EXISTS (SELECT 1 FROM task_reviewers r WHERE r.task_id = t.id AND r.user_id = t.created_by
                 AND r.state = 'pending' AND r.is_client = 0)
  AND NOT EXISTS (SELECT 1 FROM payroll_entries pe WHERE pe.transfer_task_id = t.id)`;

async function findEligible({ businessId, creatorId }, opts = {}) {
  if (!Number(businessId) || !Number(creatorId)) throw new Error('businessId·creatorId 둘 다 필요');
  return sequelize.query(
    `SELECT t.id, t.title, t.status, t.request_ack_at, t.assignee_id
       FROM tasks t WHERE ${ELIGIBLE_WHERE}${opts.lock ? ' FOR UPDATE' : ''}
      ORDER BY t.id`,
    { replacements: { businessId: Number(businessId), creatorId: Number(creatorId) }, type: QueryTypes.SELECT, transaction: opts.transaction },
  );
}

/** 한 건 변환 — 트랜잭션 안에서 술어를 다시 확인한다. 되돌림 장부 한 줄을 돌려준다(대상이 아니면 null). */
async function convertOne(taskId, { businessId, creatorId }) {
  const t = await sequelize.transaction();
  let entry = null;
  try {
    const [row] = await sequelize.query(
      `SELECT t.id, t.source, t.request_by_user_id FROM tasks t WHERE t.id = :id AND ${ELIGIBLE_WHERE} FOR UPDATE`,
      { replacements: { id: Number(taskId), businessId: Number(businessId), creatorId: Number(creatorId) }, type: QueryTypes.SELECT, transaction: t },
    );
    if (!row) { await t.rollback(); return null; }
    const [rev] = await sequelize.query(
      'SELECT * FROM task_reviewers WHERE task_id = :id AND user_id = :uid',
      { replacements: { id: row.id, uid: Number(creatorId) }, type: QueryTypes.SELECT, transaction: t },
    );
    await sequelize.query(
      "UPDATE tasks SET request_by_user_id = NULL, source = 'manual', updated_at = NOW() WHERE id = :id",
      { replacements: { id: row.id }, transaction: t },
    );
    await sequelize.query('DELETE FROM task_reviewers WHERE id = :rid', { replacements: { rid: rev.id }, transaction: t });
    await t.commit();
    entry = { task_id: row.id, source: row.source, request_by_user_id: row.request_by_user_id, reviewer: rev };
  } catch (e) { await t.rollback(); throw e; }

  require('./auditService').logAudit(null, {
    userId: null, businessId: Number(businessId), action: 'task.request_to_assigned',
    targetType: 'task', targetId: entry.task_id,
    oldValue: { source: entry.source, request_by_user_id: entry.request_by_user_id, reviewer_user_id: Number(creatorId) },
    newValue: { source: 'manual', request_by_user_id: null, reviewer_user_id: null, via: 'script:convert-requests-to-assigned' },
  });
  await signal(entry.task_id);
  return entry;
}

/** 장부 한 줄을 되돌린다 — 요청 표시·컨펌자 행을 원래 값으로. 이미 다른 컨펌자가 붙었거나 값이 바뀌었으면 건너뛴다. */
async function revertOne(entry) {
  const t = await sequelize.transaction();
  try {
    const [row] = await sequelize.query(
      "SELECT id FROM tasks WHERE id = :id AND request_by_user_id IS NULL AND source = 'manual' FOR UPDATE",
      { replacements: { id: entry.task_id }, type: QueryTypes.SELECT, transaction: t },
    );
    if (!row) { await t.rollback(); return false; }
    await sequelize.query(
      'UPDATE tasks SET request_by_user_id = :rb, source = :src, updated_at = NOW() WHERE id = :id',
      { replacements: { id: entry.task_id, rb: entry.request_by_user_id, src: entry.source }, transaction: t },
    );
    const r = entry.reviewer;
    const [dup] = await sequelize.query('SELECT id FROM task_reviewers WHERE task_id = :id AND user_id = :uid',
      { replacements: { id: entry.task_id, uid: r.user_id }, type: QueryTypes.SELECT, transaction: t });
    if (!dup) {
      const cols = Object.keys(r).filter((k) => k !== 'id');
      await sequelize.query(
        `INSERT INTO task_reviewers (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${cols.map((c) => `:${c}`).join(',')})`,
        { replacements: r, transaction: t },
      );
    }
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }
  await signal(entry.task_id);
  return true;
}

async function signal(taskId) {
  try {
    const { Task } = require('../models');
    const task = await Task.findByPk(taskId);
    if (task) await require('./taskTransition').broadcastTask(task, 'task:updated', null);
  } catch (e) { console.warn('[taskRequestConvert signal]', e.message); }
}

module.exports = { ELIGIBLE_WHERE, findEligible, convertOne, revertOne };
