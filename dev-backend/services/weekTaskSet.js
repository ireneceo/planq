// 주간 업무 집합 — **정본 단일 원천** (Fable 설계 게이트 2026-07-31, 피드백 #223)
//
// 왜 이 파일이 생겼나:
//   "이번 주 내 업무" 의 정의가 세 곳에 따로 적혀 있었다 —
//     ① routes/tasks.js `/my-week` (WORK_FLOW §5 정본, QTaskPage weekSet 과 미러)
//     ② services/weeklyReviewSnapshot.js buildSnapshot (개인 주간보고)
//     ③ services/reportUnitSnapshot.js buildMemberSnapshot (실제 화면인 보고서)
//   ②는 "날짜가 하나도 없는 미완료 업무는 무조건 포함" 이라는 catch-all 을 갖고 있어,
//   **오늘 만든 날짜 없는 업무가 모든 과거 주 보고서에 소급 포함**됐다(운영 실측: 한 사용자의
//   25건 전부가 주 종료 후 생성분). ③은 아예 주 스코프가 없어 그 사용자의 **전체 업무**를 넘겼다.
//   task_daily_progress 행은 업무별 *일생 누적치*라, 스코프가 없으면 Σ 가 포트폴리오 총합(~200h)이 되어
//   주간 진척(수 h)이 y축에 묻힌다 — 그게 #223 "진척 그래프가 제대로 표시되지 않음" 의 실체다.
//   (같은 병리를 routes/tasks.js:1855 가 한 번 잡았었다: "안 좁히면 전체 업무를 합산해 153h 로 박힌다".
//    /daily-progress 만 고쳐졌고 보고서 빌더는 그 교훈을 못 받았다.)
//
// 규칙은 §5 하나로 통일한다. 사본을 늘리지 말고 여기서 조립해 쓸 것.
const { Op, literal } = require('sequelize');

/**
 * 담당자 관점 "그 주 무대에 오르는 업무" where 조각.
 *
 *   완료/취소 — completed_at 이 그 주
 *   미착수    — 계획 주간 · 그 주 마감 · 지연(마감 지남). **마감 없는 backlog 는 제외**(flood 차단)
 *   착수한 것 — in_progress·reviewing·revision_requested·waiting·external_review 는 날짜 무관
 *               (on_hold 는 의도적 제외 — 보류는 이번 주 무대에서 퇴장)
 *
 * @param uid    사용자 id (정수 강제 — literal 삽입 전 인젝션 차단)
 * @param monday 'YYYY-MM-DD'
 * @param sunday 'YYYY-MM-DD'
 * @param opts.createdBefore  이 시각까지 존재했던 업무만 (과거 주 재구성 시 phantom 봉쇄).
 *                            지나간 주를 뒤늦게 스냅샷할 때 필수 — 없으면 오늘 만든 업무가 섞인다.
 */
// ★ 2026-08-24 — `completed_at` 은 **서버(UTC) 시각**으로 저장되는데 주간 경계(monday~sunday)는
//   **워크스페이스 tz** 로 계산된다. 두 축을 그대로 비교하면 KST 00:00~09:00 에 완료한 업무가
//   UTC 로는 전날이라 **한 주 밀려 사라진다**.
//   운영 실측(2026-08-24): 사용자가 방금 완료한 #123·#220·#121 의 completed_at 이 UTC 8/23 이라
//   이번 주(8/24~8/30) 집합에서 빠졌다 — "완료한 게 안 나온다" 의 정체.
//   → 비교 시 completed_at 을 워크스페이스 tz 로 환산한다. tzOffset 미지정이면 옛 동작 유지(무해).
function completedInWeek(monday, sunday, tzOffset) {
  if (!tzOffset) return { completed_at: { [Op.between]: [`${monday} 00:00:00`, `${sunday} 23:59:59`] } };
  const off = String(tzOffset).replace(/'/g, '');   // '+09:00' 형태만 허용(인젝션 차단)
  if (!/^[+-]\d{2}:\d{2}$/.test(off)) return { completed_at: { [Op.between]: [`${monday} 00:00:00`, `${sunday} 23:59:59`] } };
  return {
    [Op.and]: literal(
      `DATE(CONVERT_TZ(\`completed_at\`, '+00:00', '${off}')) BETWEEN '${monday}' AND '${sunday}'`,
    ),
  };
}

function myAssignedWeekWhere(uid, monday, sunday, opts = {}) {
  const id = Number(uid);
  const branch = {
    assignee_id: id,
    [Op.or]: [
      {
        status: { [Op.in]: ['completed', 'canceled'] },
        ...completedInWeek(monday, sunday, opts.tzOffset),
      },
      {
        status: 'not_started',
        [Op.or]: [
          { planned_week_start: monday },
          { due_date: { [Op.between]: [monday, sunday] } },
          // ★ 지연(마감 지난 미착수)도 포함 — Irene 2026-07-05.
          //   null 마감은 NULL 비교로 자동 제외 (backlog flood 차단 유지)
          { due_date: { [Op.lt]: monday } },
        ],
      },
      // #206 external_review 는 이번 주에 남긴다 (외부를 채근할 책임이 담당자에게 있다).
      { status: { [Op.in]: ['in_progress', 'reviewing', 'revision_requested', 'waiting', 'external_review'] } },
    ],
  };
  if (opts.createdBefore) branch.created_at = { [Op.lte]: opts.createdBefore };
  return branch;
}

/**
 * `/my-week` 풀셋 — 담당자 분기 + 내가 pending 컨펌자인 활성 업무 + 내가 관여한 그 주 완료.
 * QTaskPage 의 weekSet memo 와 **미러**다. 한쪽만 고치면 두 화면의 우선순위 번호가 갈린다
 * (2026-07-28 실사고: reviewer·관여완료 분기 누락으로 팝아웃 번호가 메인과 어긋남).
 */
function myWeekWhere(uid, businessId, monday, sunday, opts = {}) {
  const id = Number(uid);
  return {
    business_id: businessId,
    [Op.or]: [
      myAssignedWeekWhere(id, monday, sunday, opts),
      // 내가 pending 컨펌자인 활성 업무 — 날짜 무관 (메인 filtered 의 myRev pending 분기 미러).
      //   담당자가 아니어도 "내가 행동해야 하는 것"이라 이번 주 무대에 오른다.
      {
        status: { [Op.in]: ['reviewing', 'revision_requested'] },
        id: { [Op.in]: literal(`(SELECT task_id FROM task_reviewers WHERE user_id = ${id} AND state = 'pending')`) },
      },
      // 내가 관여한 이번 주 완료 — 의뢰자/작성자/리뷰어(state 무관). 메인의 involved 분기 미러.
      {
        status: { [Op.in]: ['completed', 'canceled'] },
        ...completedInWeek(monday, sunday, opts.tzOffset),
        [Op.or]: [
          { request_by_user_id: id },
          { created_by: id },
          { id: { [Op.in]: literal(`(SELECT task_id FROM task_reviewers WHERE user_id = ${id})`) } },
        ],
      },
    ],
  };
}

module.exports = { myAssignedWeekWhere, myWeekWhere, completedInWeek };
