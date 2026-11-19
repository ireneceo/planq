// 이미 «요청» 으로 들어간 업무를 «배정 업무» 로 — 한 건 변환의 단일 착지점.
//
// 왜 있는가 — 2026-11-18 이전에는 남을 담당으로 넣으면 «요청하기» 를 고르지 않아도 전부 요청이 됐다
//   (만든 사람 자동 컨펌자 + 확인 단계). 그 뒤로는 «요청하기» 뜻일 때만 요청이다. 그 전에 일정 짜기로 들어간
//   요청을 일반 업무로 돌리는 일회성 길이다(설계 docs/TASK_REQUEST_INTENT_DESIGN.md §4-10, Fable DESIGN-READY).
//   업무별 손잡이는 만들지 않는다 — 잘못 건 요청 하나는 컨펌자 빼기로 풀린다.
//
// 대상 술어(ELIGIBLE_WHERE) — 두 인자(business_id·created_by)는 필수라 남의 요청은 건드릴 수 없다:
//   request_by = created_by ∧ source internal_request ∧ project 업무 ∧ 시작 전·진행대기·진행 중 ∧ 컨펌 라운드 0 ∧
//   컨펌자 중에 작성자(pending · 내부)가 있고 컨펌자 전원이 pending · 내부 ∧ 급여 송금 업무 아님. 메일 답변 업무는 컨펌자 0명이라 저절로 빠진다.
// 바꾸는 것: request_by → NULL · source → 'manual' · 알림 없음 · task:updated 신호 · 감사 1행.
//   컨펌자가 작성자 1명뿐 = 자동으로 붙은 것 → 그 행 삭제(Fable 설계 §4-10).
//   컨펌자가 여럿(작성자 + 다른 팀원) = 사람이 일부러 붙인 확인 → 컨펌자는 전부 그대로, 요청 표시만 뗀다
//   (2026-11-19 Irene «권고대로» A — 운영 지메이트 11건. 그날 «요청 확인함» 알림 7개가 전부 이쪽에서 왔다).
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
  AND NOT EXISTS (SELECT 1 FROM task_reviewers r WHERE r.task_id = t.id AND (r.state <> 'pending' OR r.is_client <> 0))
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
    const revs = await sequelize.query(
      'SELECT * FROM task_reviewers WHERE task_id = :id',
      { replacements: { id: row.id }, type: QueryTypes.SELECT, transaction: t },
    );
    const keep = revs.length > 1;   // 다른 팀원도 컨펌자 = 일부러 붙인 확인 → 컨펌자 그대로
    const rev = revs.find((r) => Number(r.user_id) === Number(creatorId));
    await sequelize.query(
      "UPDATE tasks SET request_by_user_id = NULL, source = 'manual', updated_at = NOW() WHERE id = :id",
      { replacements: { id: row.id }, transaction: t },
    );
    if (!keep) await sequelize.query('DELETE FROM task_reviewers WHERE id = :rid', { replacements: { rid: rev.id }, transaction: t });
    await t.commit();
    entry = { task_id: row.id, business_id: Number(businessId), creator_id: Number(creatorId), source: row.source, request_by_user_id: row.request_by_user_id,
      reviewer: keep ? null : rev, kept_reviewer_ids: keep ? revs.map((r) => Number(r.user_id)).sort((a, b) => a - b) : undefined };
  } catch (e) { await t.rollback(); throw e; }

  require('./auditService').logAudit(null, {
    userId: null, businessId: Number(businessId), action: 'task.request_to_assigned',
    targetType: 'task', targetId: entry.task_id,
    oldValue: { source: entry.source, request_by_user_id: entry.request_by_user_id, reviewer_user_id: Number(creatorId) },
    newValue: { source: 'manual', request_by_user_id: null, reviewer_user_id: entry.reviewer ? null : Number(creatorId),
      kept_reviewer_ids: entry.kept_reviewer_ids, via: 'script:convert-requests-to-assigned' },
  });
  await signal(entry.task_id);
  return entry;
}

/** 장부 한 줄을 되돌린다 — 요청 표시·컨펌자 행을 원래 값으로.
 *  변환 때와 같은 상태에서만 되돌린다(2026-11-18 Fable 완료 검증 지적 2): 같은 워크스페이스·같은 작성자 ∧ 여전히 배정 업무 ∧
 *  아직 열린 단계(시작 전·진행대기·진행 중) ∧ 컨펌자 0명 ∧ 라운드 0. 그 사이 완료됐거나 컨펌자가 붙었으면 건너뛴다 —
 *  안 그러면 «완료 + 컨펌자 pending»(막으려던 모양)을 되돌림이 만든다. 건너뛴 이유를 돌려준다. */
async function revertOne(entry) {
  if (entry && Array.isArray(entry.kept_reviewer_ids)) return revertKept(entry);
  if (!entry || !Number(entry.task_id) || !Number(entry.business_id) || !Number(entry.creator_id)
      || !entry.reviewer || Number(entry.reviewer.user_id) !== Number(entry.creator_id)
      // 되돌릴 값은 변환이 지운 모양 하나뿐이다 — 장부가 다른 값을 말하면 손댄 장부다(Fable 재검증 비차단 지적)
      || Number(entry.request_by_user_id) !== Number(entry.creator_id) || entry.source !== 'internal_request'
      || (entry.reviewer.task_id != null && Number(entry.reviewer.task_id) !== Number(entry.task_id))) return { ok: false, reason: 'bad_entry' };
  const t = await sequelize.transaction();
  try {
    const [row] = await sequelize.query(
      `SELECT t.id, t.status FROM tasks t
        WHERE t.id = :id AND t.business_id = :biz AND t.created_by = :creator
          AND t.request_by_user_id IS NULL AND t.source = 'manual'
          AND t.status IN ('not_started', 'waiting', 'in_progress') AND COALESCE(t.review_round, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM task_reviewers r WHERE r.task_id = t.id)
        FOR UPDATE`,
      { replacements: { id: Number(entry.task_id), biz: Number(entry.business_id), creator: Number(entry.creator_id) }, type: QueryTypes.SELECT, transaction: t },
    );
    if (!row) {
      const [cur] = await sequelize.query('SELECT status, source, request_by_user_id, business_id FROM tasks WHERE id = :id',
        { replacements: { id: Number(entry.task_id) }, type: QueryTypes.SELECT, transaction: t });
      await t.rollback();
      if (!cur) return { ok: false, reason: 'gone' };
      if (Number(cur.business_id) !== Number(entry.business_id)) return { ok: false, reason: 'other_workspace' };
      return { ok: false, reason: `changed:${cur.status}${cur.request_by_user_id ? ':request' : ''}` };
    }
    await sequelize.query(
      'UPDATE tasks SET request_by_user_id = :rb, source = :src, updated_at = NOW() WHERE id = :id',
      { replacements: { id: Number(entry.task_id), rb: Number(entry.creator_id), src: 'internal_request' }, transaction: t },
    );
    const r = entry.reviewer;
    const [dup] = await sequelize.query('SELECT id FROM task_reviewers WHERE task_id = :id AND user_id = :uid',
      { replacements: { id: entry.task_id, uid: r.user_id }, type: QueryTypes.SELECT, transaction: t });
    if (!dup) {
      // 칸은 화이트리스트 · 업무·사람·상태는 장부가 아니라 여기서 정한다(변환이 지운 행 = 작성자 pending 내부 컨펌자)
      await sequelize.query(
        `INSERT INTO task_reviewers (task_id, user_id, is_client, state, added_by_user_id, created_at, updated_at)
         VALUES (:task_id, :user_id, 0, 'pending', :added_by, :created_at, NOW())`,
        { replacements: {
          task_id: Number(entry.task_id), user_id: Number(entry.creator_id),
          added_by: r.added_by_user_id != null ? Number(r.added_by_user_id) : Number(entry.creator_id),
          created_at: r.created_at ? new Date(r.created_at) : new Date(),
        }, transaction: t },
      );
    }
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }
  require('./auditService').logAudit(null, {
    userId: null, businessId: Number(entry.business_id), action: 'task.assigned_to_request_revert',
    targetType: 'task', targetId: Number(entry.task_id),
    oldValue: { source: 'manual', request_by_user_id: null, reviewer_user_id: null },
    newValue: { source: entry.source, request_by_user_id: entry.request_by_user_id, reviewer_user_id: Number(entry.creator_id), via: 'script:convert-requests-to-assigned --revert' },
  });
  await signal(entry.task_id);
  return { ok: true };
}

/** 컨펌자를 그대로 둔 변환(kept_reviewer_ids)의 되돌림 — 요청 표시만 다시 붙인다.
 *  같은 조건: 여전히 배정 업무 · 열린 단계 · 라운드 0 · 컨펌자가 변환 때와 같은 사람들이고 전원 pending · 내부. */
async function revertKept(entry) {
  if (!Number(entry.task_id) || !Number(entry.business_id) || !Number(entry.creator_id)
      || Number(entry.request_by_user_id) !== Number(entry.creator_id) || entry.source !== 'internal_request'
      || !entry.kept_reviewer_ids.map(Number).includes(Number(entry.creator_id))) return { ok: false, reason: 'bad_entry' };
  const t = await sequelize.transaction();
  try {
    const [row] = await sequelize.query(
      `SELECT t.id FROM tasks t
        WHERE t.id = :id AND t.business_id = :biz AND t.created_by = :creator
          AND t.request_by_user_id IS NULL AND t.source = 'manual'
          AND t.status IN ('not_started', 'waiting', 'in_progress') AND COALESCE(t.review_round, 0) = 0
        FOR UPDATE`,
      { replacements: { id: Number(entry.task_id), biz: Number(entry.business_id), creator: Number(entry.creator_id) }, type: QueryTypes.SELECT, transaction: t },
    );
    const revs = row ? await sequelize.query('SELECT user_id, state, is_client FROM task_reviewers WHERE task_id = :id',
      { replacements: { id: Number(entry.task_id) }, type: QueryTypes.SELECT, transaction: t }) : [];
    const ids = (a) => a.map(Number).sort((x, y) => x - y).join(',');
    const same = !!row && revs.every((r) => r.state === 'pending' && Number(r.is_client) === 0)
      && ids(revs.map((r) => r.user_id)) === ids(entry.kept_reviewer_ids);
    if (!same) { await t.rollback(); return { ok: false, reason: row ? 'changed:reviewers' : 'changed' }; }
    await sequelize.query(
      "UPDATE tasks SET request_by_user_id = :rb, source = 'internal_request', updated_at = NOW() WHERE id = :id",
      { replacements: { id: Number(entry.task_id), rb: Number(entry.creator_id) }, transaction: t },
    );
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }
  require('./auditService').logAudit(null, {
    userId: null, businessId: Number(entry.business_id), action: 'task.assigned_to_request_revert',
    targetType: 'task', targetId: Number(entry.task_id),
    oldValue: { source: 'manual', request_by_user_id: null },
    newValue: { source: entry.source, request_by_user_id: entry.request_by_user_id, kept_reviewer_ids: entry.kept_reviewer_ids, via: 'script:convert-requests-to-assigned --revert' },
  });
  await signal(entry.task_id);
  return { ok: true };
}

async function signal(taskId) {
  try {
    const { Task } = require('../models');
    const task = await Task.findByPk(taskId);
    if (task) await require('./taskTransition').broadcastTask(task, 'task:updated', null);
  } catch (e) { console.warn('[taskRequestConvert signal]', e.message); }
}

module.exports = { ELIGIBLE_WHERE, findEligible, convertOne, revertOne };
