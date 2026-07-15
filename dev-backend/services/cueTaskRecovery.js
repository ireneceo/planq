// Cue 업무 자동실행 복구 스윕 — fire-and-forget 실행 유실로 갇힌 업무 재실행.
//
// 배경(실사례 task 785): createTask / PUT(담당자→Cue) 의 executeForTask 는 fire-and-forget 이다.
//   그 async 가 완료되기 전에 프로세스가 죽거나(배포·PM2 reload·crash) 일시 오류가 나면,
//   업무가 status=not_started + body 없음 + cue_kind null 로 감사로그조차 없이 영구히 갇힌다.
//   사용자 입장: "Cue 에게 맡겼는데 아무 일도 안 함". 복구·재시도 경로가 없었다.
//
// 정석: 주기적으로 '담당=Cue · 미처리(cue_kind null · body 없음)' 업무를 찾아 executeForTask 재호출.
//   executeForTask 는 성공 시 reviewing 전이 + cue_kind 세팅 → 다음 스윕에서 자동 제외(멱등).
//   무한 재시도 방지: 이미 cue.task_failed / denied / skipped_limit 감사가 있으면 skip
//     (진짜 실패는 사람이 개입 — resolvePrincipal 거부·usage 초과 등은 자동 재시도 대상 아님).
//   fresh 업무 제외: 생성 N분 이내는 정상 트리거가 아직 진행 중일 수 있어 건드리지 않는다.
const { sequelize } = require('../config/database');

async function runCueTaskRecovery(opts = {}) {
  const maxTasks = opts.maxTasks || 20;
  const minAgeMinutes = opts.minAgeMinutes || 10;

  const [rows] = await sequelize.query(`
    SELECT t.id
    FROM tasks t JOIN businesses b ON b.id = t.business_id
    WHERE t.assignee_id = b.cue_user_id
      AND t.status IN ('not_started','waiting')
      AND (t.body IS NULL OR LENGTH(t.body) = 0)
      AND t.cue_kind IS NULL
      AND t.created_at < (NOW() - INTERVAL ${Number(minAgeMinutes)} MINUTE)
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs a
        WHERE a.target_type = 'task' AND a.target_id = t.id
          AND a.action IN ('cue.task_failed','cue.task_denied','cue.task_skipped_limit','cue.task_transition_blocked')
      )
    ORDER BY t.created_at DESC
    LIMIT ${Number(maxTasks)}`);

  if (!rows.length) return { found: 0, ok: 0, skip: 0, fail: 0 };

  const { executeForTask } = require('./cue_task_executor');
  let ok = 0, skip = 0, fail = 0;
  for (const r of rows) {
    try {
      const res = await executeForTask(r.id, { triggeredBy: null });
      if (res && res.ok) ok++; else skip++;
    } catch (e) {
      fail++;
      console.error('[cue-recovery] task', r.id, 'crash', e.message);
    }
  }
  return { found: rows.length, ok, skip, fail };
}

module.exports = { runCueTaskRecovery };
