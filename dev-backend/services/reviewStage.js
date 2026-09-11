// 컨펌 단계 술어 — **단일 원천** (2026-09-11)
//
// Irene: "확인요청 받은 거 외부컨펌 눌렀는데 이번 주 나의 업무리스트에서 아주 사라졌어. …
//         리스트에서 안 없어지게 하고 확인필요에도 그냥 안 없어지게 하고 단계만 표시해두자.
//         리스트업 조건은 확인요청 받은 상태나 내가 업무처리해야 하는 상태 그대로 두고."
//
// 외부컨펌(external_review)은 **단계 표시**다 — 누가 무엇을 해야 하는지(리스트업 조건)를 바꾸지 않는다.
// 외부컨펌에 들어갈 때 직전 상태가 hold_prev_status 에 남는다(routes/tasks.js · task_actions). 그래서
// "컨펌 단계에 있는가" 는 status 만이 아니라 **외부컨펌 직전 상태**까지 봐야 한다.
//
// 여태 `status IN ('reviewing','revision_requested')` 가 7곳에 손으로 복사돼 있었고, 외부컨펌을 누르는 순간
// 컨펌자의 이번 주 목록·확인필요·오늘 집중·승인 대기 수에서 **전부 사라졌다**(운영 task 352, 06:56).
// 복사본을 고치지 말고 이 함수를 부른다.
const { Op } = require('sequelize');

const REVIEW_STAGE = ['reviewing', 'revision_requested'];

/**
 * status 가 statuses 중 하나이거나, 그 단계에서 외부컨펌으로 넘어간 업무.
 * where 에 다른 [Op.or] 가 있을 수 있으므로 호출부는 `[Op.and]: [stageWhere(...)]` 로 끼운다.
 * @param {string|string[]} statuses 기본 컨펌 단계(reviewing·revision_requested)
 */
function stageWhere(statuses = REVIEW_STAGE) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  return {
    [Op.or]: [
      { status: { [Op.in]: list } },
      { status: 'external_review', hold_prev_status: { [Op.in]: list } },
    ],
  };
}

/** 인스턴스 판정 — 목록에 붙일 단계 표시용 */
function inStage(task, statuses = REVIEW_STAGE) {
  if (!task) return false;
  const list = Array.isArray(statuses) ? statuses : [statuses];
  if (list.includes(task.status)) return true;
  return task.status === 'external_review' && list.includes(task.hold_prev_status);
}

/** 확인필요·목록 항목에 붙이는 단계 — 외부컨펌이면 'external_review', 아니면 null */
function stageOf(task) {
  return task && task.status === 'external_review' ? 'external_review' : null;
}

module.exports = { REVIEW_STAGE, stageWhere, inStage, stageOf };
