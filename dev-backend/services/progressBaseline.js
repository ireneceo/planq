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
 * @returns {{ baseAct: Map<number,number>, baseEst: Map<number,number> }}
 *   기준 행이 없는 업무(기간 중 생성)는 Map 에 없다 → 호출측에서 0 으로 읽으면 된다.
 *   "처음부터 쌓인 것" 이 맞으므로 기준 0 이 정답이다.
 */
async function getProgressBaselines(taskIds, start) {
  const baseAct = new Map();
  const baseEst = new Map();
  if (!taskIds || taskIds.length === 0) return { baseAct, baseEst };

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
  for (const b of rows) {
    baseAct.set(Number(b.task_id), Number(b.actual_hours) || 0);
    baseEst.set(Number(b.task_id), (Number(b.estimated_hours) || 0) * ((b.progress_percent || 0) / 100));
  }
  return { baseAct, baseEst };
}

/** 업무별 Δ — 음수는 0 으로 눕힌다(하향 정정은 *과거 기록의 수정*이지 음의 노동이 아니다). */
const deltaOf = (value, base) => Math.max(0, (Number(value) || 0) - (Number(base) || 0));

module.exports = { getProgressBaselines, deltaOf };
