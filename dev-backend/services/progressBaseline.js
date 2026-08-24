// 진척 그래프의 **업무별 기준선** — "그 주에 새로 생긴 진척·투입" 만 그리기 위한 단일 원천.
//
// 왜 필요한가 (#223 → #254):
//   task_daily_progress 의 한 행은 그 업무의 **일생 누적치**다. 그대로 합산하면 이월 업무가
//   지난주까지 쌓은 시간이 이번 주 월요일부터 통째로 라인에 실린다.
//   운영 실측(#254): 신고 시점 이번 주 투입은 0h 인데 그래프는 6.4h — 그 6.4 는 지난주에
//   다른 업무 두 건에 넣은 시간이었다. 사용자에게는 "리스트엔 없는 시간이 그래프에 있다" 로 보인다.
//
//   그래서 **기간 시작 이전의 최신 스냅샷**을 업무별 기준선으로 빼고 Δ 를 그린다.
//   부수 효과로 폐기된 자동누적 시절의 부풀린 과거 값도 기준선에 갇혀 상쇄된다 —
//   데이터를 고치지 않고 정의로 면역을 얻는다.
//
// ★ 이 파일이 정본이다. 보고서(reportUnitSnapshot)·라이브 그래프(routes/tasks daily-progress)·
//   개인 주간보고(weeklyReviewSnapshot) 가 **같은 함수**를 쓴다. 사본을 만들면 정의가 다시 갈라져
//   "화면 그래프 ≠ 보고서 그래프" 신고가 재발한다 (#254 판정: 정의가 3벌로 갈라져 있었다).
//
// ★ 클램프는 **업무별**로 한다. 집계 후 클램프는 오답이다 — 한 업무의 하향 정정(-3.2h)이 다른
//   업무의 진척(+4.6h)을 잡아먹어 합계가 과소·음수가 된다(운영 실측 반례).
const { sequelize } = require('../config/database');

/**
 * @param {number[]} taskIds  대상 업무
 * @param {string}   start    'YYYY-MM-DD' — 기간 시작 (이 날 **이전**의 최신 행이 기준선)
 * @returns {{ baseAct: Map, baseEst: Map, baseProg: Map, estNow: Map }}
 *   기준 행이 없는 업무(기간 중 생성)는 Map 에 없다 → 호출측에서 0 으로 읽으면 된다.
 *   "처음부터 쌓인 것" 이 맞으므로 기준 0 이 정답이다.
 *   baseProg = 기준 시점 진행률(0~1), estNow = 지금 예측시간. 아래 estDoneOf 와 짝이다.
 */
async function getProgressBaselines(taskIds, start) {
  const baseAct = new Map();
  const baseEst = new Map();
  const baseProg = new Map();
  const estNow = new Map();
  if (!taskIds || taskIds.length === 0) return { baseAct, baseEst, baseProg, estNow };

  // 기준선은 `start - 1일` 고정이 아니라 **`snapshot_date < start` 의 업무별 최신 행**이다.
  //   하루 고정이면 cron 이 그 하루를 걸렀을 때 그 업무의 일생 누적이 Δ 로 재유입된다(뒷문).
  const [rows] = await sequelize.query(
    `SELECT p.task_id, p.actual_hours, p.estimated_hours, p.progress_percent
       FROM task_daily_progress p
       JOIN (SELECT task_id, MAX(snapshot_date) md FROM task_daily_progress
              WHERE task_id IN (:ids) AND snapshot_date < :start GROUP BY task_id) m
         ON m.task_id = p.task_id AND m.md = p.snapshot_date`,
    { replacements: { ids: taskIds, start } },
  );
  // 지금 예측시간 — 기준선 환산과 Δ 계산이 **같은 예측**을 쓰게 하는 축.
  const [curRows] = await sequelize.query(
    'SELECT id, estimated_hours FROM tasks WHERE id IN (:ids)',
    { replacements: { ids: taskIds } },
  );
  for (const c of curRows) estNow.set(Number(c.id), Number(c.estimated_hours) || 0);

  for (const b of rows) {
    const id = Number(b.task_id);
    const p = (b.progress_percent || 0) / 100;
    baseAct.set(id, Number(b.actual_hours) || 0);
    baseProg.set(id, p);
    // ★ 예측은 도중에 정정된다(운영 실측: 스냅샷 보유 189건 중 48건이 예측 변경 이력 보유).
    //   옛 예측으로 만든 기준선을 새 예측 기준값에서 빼면 **같은 축의 두 수가 아니다.**
    //   실사례 #123 — 8/19 까지 16h×35%=5.6 이던 업무를 8/20 에 "예측 1h · 진행률 90%" 로 정정하자
    //   그 주 Δ 가 max(0, 1×0.9 − 5.6) = 0 이 되어, 55%p 올린 실제 진척이 그래프에서 사라졌다.
    //   반대로 예측을 올리면 일하지 않아도 Δ 가 부풀어 "리스트 2h인데 그래프 4.5h"(#300)가 된다.
    //   → 기준선도 **지금 예측**으로 환산한다. Δ = est_now × (p − p_base) 가 되어 예측 정정에 면역.
    baseEst.set(id, (estNow.has(id) ? estNow.get(id) : (Number(b.estimated_hours) || 0)) * p);
  }
  return { baseAct, baseEst, baseProg, estNow };
}

/** 업무별 Δ — 음수는 0 으로 눕힌다(하향 정정은 *과거 기록의 수정*이지 음의 노동이 아니다). */
const deltaOf = (value, base) => Math.max(0, (Number(value) || 0) - (Number(base) || 0));

/**
 * 스냅샷 한 행의 "해낸 예측시간" — **지금 예측 × 그 날 진행률**.
 * 스냅샷에 박제된 옛 예측을 쓰면 기준선(지금 예측 환산)과 축이 어긋난다. 둘은 반드시 짝으로 쓴다.
 * estNow 에 없는 업무(삭제 등)만 스냅샷의 옛 예측으로 폴백한다.
 */
const estDoneOf = (estNow, taskId, progressPercent, snapshotEst) => {
  const id = Number(taskId);
  const est = (estNow && estNow.has(id)) ? estNow.get(id) : (Number(snapshotEst) || 0);
  return (Number(est) || 0) * ((Number(progressPercent) || 0) / 100);
};

/**
 * 스냅샷 한 행의 "해낸 실제시간" — **그 날 실제시간 × 그 날 진행률**.
 *
 * ★ 2026-08-24 (Irene 확정) — 두 선의 정의를 한 문장으로 못박는다:
 *     진척(예상시간) = 예측시간 × 진행률   ← 예측 기준으로 한 만큼
 *     실제 업무시간   = 실제시간 × 진행률   ← 실제 기록 기준으로 한 만큼
 *   즉 **두 선이 같은 축(진행률)** 위에 있고, 재는 자만 예측/실제로 다르다.
 *   옛 정의는 실제선만 raw 누적이라 축이 서로 달랐다.
 *
 * ★ 같은 개정에서 **기준선 차감(Δ)을 두 선에서 걷어냈다.** 아래 getProgressBaselines 의
 *   baseAct/baseEst 는 더 이상 선 계산에 쓰지 않는다(estNow 만 쓴다).
 *   이유(운영 실측 #385, lua/워프로랩): 실제시간을 **아래로 정정**하면 Δ = max(0, 1 − 5) = 0 이 되어
 *   진행률 100% 인 업무가 그 주 내내 실제선에 0 만 기여했다. 정정은 과거 기록의 수정이지
 *   노동의 취소가 아니다. 그래프가 리스트(절대값)와 같은 축을 갖게 되는 부수 효과도 있다.
 */
const actDoneOf = (actualHours, progressPercent) => (
  (Number(actualHours) || 0) * ((Number(progressPercent) || 0) / 100)
);

module.exports = { getProgressBaselines, deltaOf, estDoneOf, actDoneOf };
