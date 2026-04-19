// 업무 상태 라벨 — 관점(assignee/reviewer/requester/observer) 별로 다른 문구.
// DB status + source + ack 를 조합해서 UI 가상 상태 코드(displayStatus)를 만들고,
// 그 코드와 관점을 조합해 i18n 키 `status.<code>.<perspective>` 로 조회한다.

import type { TaskRole } from './taskRoles';

export interface TaskForDisplay {
  status: string;
  source?: string;
  request_ack_at?: string | null;
  planned_week_start?: string | null;
  due_date?: string | null;
  start_date?: string | null;
}

// UI 상태 코드 목록 (task_requested 는 가상)
export const STATUS_CODES = [
  'not_started', 'task_requested', 'waiting', 'in_progress',
  'reviewing', 'revision_requested', 'done_feedback',
  'completed', 'canceled',
] as const;

export type StatusCode = typeof STATUS_CODES[number];

// 받은 요청(internal/qtalk) + 담당자 미확인 + not_started → task_requested (가상)
// not_started + 기간 도래 → waiting
// 그 외 → DB status 그대로
export function displayStatus(task: TaskForDisplay, todayStr: string): StatusCode {
  if (!task.request_ack_at && (task.source === 'internal_request' || task.source === 'qtalk_extract')) {
    return 'task_requested';
  }
  if (task.status === 'not_started') {
    const pw = task.planned_week_start;
    const due = task.due_date?.slice(0, 10);
    const start = task.start_date?.slice(0, 10);
    const inWindow =
      (pw && pw <= todayStr) ||
      (start && start <= todayStr) ||
      (due && due >= todayStr);
    if (inWindow) return 'waiting';
  }
  return task.status as StatusCode;
}

type TFn = (key: string, fallback?: string) => string;

// 라벨 — 코드 × 관점. i18n 에 없으면 관찰자 라벨 fallback, 그것도 없으면 코드.
export function getStatusLabel(
  task: TaskForDisplay,
  myRole: TaskRole,
  todayStr: string,
  t: TFn
): string {
  const code = displayStatus(task, todayStr);
  const primary = t(`status.${code}.${myRole}`, '');
  if (primary) return primary;
  const observer = t(`status.${code}.observer`, '');
  if (observer) return observer;
  return t(`status.${code}`, code);
}

// 색상은 코드 기반 (관점 무관)
export const STATUS_COLOR: Record<StatusCode, { bg: string; fg: string }> = {
  not_started:        { bg: '#F1F5F9', fg: '#475569' },
  task_requested:     { bg: '#FFE4E6', fg: '#BE123C' },  // rose (요청 신규)
  waiting:            { bg: '#E0E7FF', fg: '#3730A3' },
  in_progress:        { bg: '#CCFBF1', fg: '#0F766E' },
  reviewing:          { bg: '#FEF3C7', fg: '#92400E' },
  revision_requested: { bg: '#FCE7F3', fg: '#9F1239' },
  done_feedback:      { bg: '#DBEAFE', fg: '#1E40AF' },
  completed:          { bg: '#E2E8F0', fg: '#475569' },
  canceled:           { bg: '#F1F5F9', fg: '#94A3B8' },
};
