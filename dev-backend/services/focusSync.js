'use strict';

// ============================================================
// Focus 세션 ↔ Task status 동기화 (피드백 ID 15/16)
// ------------------------------------------------------------
// N+32 옵션 A 박제: task status 가 Focus 의 진실 원천.
//   - in_progress 진입 → 담당자의 기존 active/paused 세션 stop + 이 task active 세션 생성
//   - in_progress 이탈(완료/검토/대기 등) → 이 task 의 active/paused 세션 stop
//
// 기존엔 routes/tasks.js PUT 에만 이 로직이 있어 워크플로(task_workflow.js: complete/approve/
// submit-review/revision)로 status 가 바뀌면 Focus 세션이 안 끊겨 좌측 [포커스 중] 배너가
// 완료 후에도 계속 남던 회귀. 이 헬퍼로 단일화하여 모든 status 전이 지점에서 호출한다.
//
// 주의: Focus 의 주인은 "담당자(assignee)" 다 (actor 아님). 컨펌 승인처럼 actor≠담당자인
//       자동완료에서도 담당자의 세션이 종료돼야 한다.
// ============================================================

const { Op } = require('sequelize');

async function syncFocusOnTaskStatus(task, prevStatus, newStatus, options = {}) {
  if (!task || !task.assignee_id) return;
  if (prevStatus === newStatus) return;

  const enteringProgress = newStatus === 'in_progress' && prevStatus !== 'in_progress';
  const leavingProgress = prevStatus === 'in_progress' && newStatus !== 'in_progress';
  if (!enteringProgress && !leavingProgress) return;

  const tx = options.transaction ? { transaction: options.transaction } : undefined;

  try {
    const { FocusSession, User } = require('../models');
    const assigneeId = task.assignee_id;

    if (leavingProgress) {
      // in_progress 이탈 — focus_enabled 여부와 무관하게 떠도는 세션 정리 (배너 잔존 차단).
      // 운영 #38: paused 세션은 /stop 과 동일하게 진행 중이던 pause 갭을 먼저 정산해야
      //           computeActualSeconds 가 과대계상되지 않는다 (완료를 일시정지 중에 한 경우).
      const live = await FocusSession.findAll({
        where: { user_id: assigneeId, task_id: task.id, state: { [Op.in]: ['active', 'paused'] } },
        ...tx,
      });
      const now = new Date();
      for (const s of live) {
        let pauseTotal = s.pause_total_sec || 0;
        if (s.state === 'paused' && s.paused_at) {
          pauseTotal += Math.max(0, Math.floor((now.getTime() - new Date(s.paused_at).getTime()) / 1000));
        }
        await s.update(
          { state: 'stopped', ended_at: now, end_reason: 'status_change', pause_total_sec: pauseTotal, paused_at: null },
          tx
        );
      }
      // 측정 시간을 '실제'(actual_hours) 에 반영 — 완료/검토/대기 전이 시 누락되던 회귀(#38) 단일 차단.
      // 트랜잭션 안(미커밋)에서 호출되면 세션 stop 이 안 보여 부정확 → 커밋 후 호출 케이스만 즉시 반영.
      if (!options.transaction) {
        try {
          const { recomputeActualHoursFromHistory } = require('./taskActualHours');
          await recomputeActualHoursFromHistory(task.id);
          // recompute 는 별도 인스턴스를 갱신 → 호출부 broadcast(task.toJSON()) 가 stale 하지 않도록
          // 전달된 task 인스턴스도 새 actual_hours/actual_source 로 동기화 (§16 실시간 반영).
          if (typeof task.reload === 'function') await task.reload();
        } catch (e) { console.warn('[focusSync] recompute actual hours failed:', e.message); }
      }
      return;
    }

    // enteringProgress — focus_enabled 인 담당자만 새 세션 시작.
    const u = await User.findByPk(assigneeId, { attributes: ['focus_enabled'], ...tx });
    if (!u || !u.focus_enabled) return;

    await FocusSession.update(
      { state: 'stopped', ended_at: new Date(), end_reason: 'switch' },
      { where: { user_id: assigneeId, state: { [Op.in]: ['active', 'paused'] } }, ...tx }
    );
    await FocusSession.create({
      user_id: assigneeId,
      business_id: task.business_id,
      task_id: task.id,
      state: 'active',
      started_at: new Date(),
      last_activity_at: new Date(),
    }, tx);
  } catch (e) {
    console.warn('[focusSync] sync failed:', e.message);
  }
}

module.exports = { syncFocusOnTaskStatus };
