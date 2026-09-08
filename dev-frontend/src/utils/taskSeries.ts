// 반복 업무(시리즈)가 **공유하는 필드** 단일 정의 (#403).
//
// ★ Irene 2026-09-03: "반복 업무 설정을 바꾸면 모두 적용할지, 지금부터만 적용할지,
//   이 업무만 적용할지 물어보고 적용해야지. 지금 각각 저장되는 것 같아."
//   2026-08-31 에 업무 상세(TaskDetailDrawer)에는 이 물음을 붙였는데, **목록에서 바로 고치는
//   경로**(Q Task 리스트의 담당자 셀렉트, 프로젝트 업무 목록의 인라인 편집)에는 없었다.
//   같은 값을 고치는데 어디서 고쳤느냐로 규칙이 갈렸다 — 그래서 "각각 저장" 으로 보인다.
//
//   목록을 각자 고치면 또 갈라지므로 **판정을 여기 한 벌만 둔다.** 새 편집 진입점을 만들 때는
//   반드시 `needsSeriesScope()` 를 통과시킨다.

/** 시리즈의 모든 회차가 같이 쓰는 값 — 한 회차에서 바꾸면 "어디까지" 를 물어야 한다.
 *  날짜(start_date/due_date)는 회차마다 다른 것이 정상이라 여기 없다. */
export const TASK_SERIES_FIELDS = [
  'title', 'description', 'category', 'assignee_id', 'estimated_hours', 'priority_level',
  // ★ 2026-09-08 — 백엔드는 이 둘도 전파하는데 여기 없어서 화면이 묻지 않고 단건 저장했다.
  //   "백엔드에만 넣고 여기 빠뜨리면 도달할 수 없다" 는 #353 과 같은 계열이다.
  //   두 목록이 어긋나지 않는지는 `--suite seriesscope` 가 대조한다.
  'workstream_id', 'is_milestone',
];

/** 업무 본문 필드가 아니라 **별도 엔드포인트**로 저장되는 시리즈 공유 내용.
 *  태그·컨펌자·컨펌정책이 여기다 — 사용자에게는 이것도 똑같은 "내용" 이라
 *  같은 물음(어디까지 반영할까요)을 지나야 한다. */
export const TASK_SERIES_SIDE_CHANNELS = ['tags', 'reviewers', 'review_policy'] as const;

/** 이 업무가 반복 시리즈에 속하는가 (부모이거나 회차이거나). */
export function isSeriesTask(task: { recurrence_rule?: string | null; recurrence_parent_id?: number | null } | null | undefined): boolean {
  return !!(task && (task.recurrence_rule || task.recurrence_parent_id));
}

/** 이 저장이 적용 범위를 물어야 하는가. */
export function needsSeriesScope(
  task: { recurrence_rule?: string | null; recurrence_parent_id?: number | null } | null | undefined,
  patch: Record<string, unknown>,
): boolean {
  if (!isSeriesTask(task)) return false;
  if (Object.prototype.hasOwnProperty.call(patch, 'recurrence_rule')) return true;
  return Object.keys(patch).some((k) => TASK_SERIES_FIELDS.includes(k));
}
