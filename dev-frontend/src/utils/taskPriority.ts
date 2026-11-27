// 업무 중요도(priority_level) 값 한 벌 — 업무 추가 폼 «중요도» 칸·Cue 카드 [자세히 편집] 씨앗이 같이 쓴다.
//   서버 PRIORITY_LEVELS(services/actions/task_actions.js)와 같은 값. 화면 순서 = 업무 상세 «중요도» 옵션 순서.
export type TaskPriorityLevel = 'urgent' | 'high' | 'normal' | 'low';
export const PRIORITY_LEVELS: TaskPriorityLevel[] = ['urgent', 'high', 'normal', 'low'];
export const asPriorityLevel = (v: unknown): TaskPriorityLevel | null =>
  PRIORITY_LEVELS.find((k) => k === v) ?? null;
