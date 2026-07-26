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
  'on_hold', 'external_review',   // #206
] as const;

export type StatusCode = typeof STATUS_CODES[number];

// 받은 요청(internal/qtalk) + 담당자 미확인 + not_started → task_requested (가상)
// not_started + 기간 도래 → waiting
// 그 외 → DB status 그대로
export function displayStatus(task: TaskForDisplay, todayStr: string): StatusCode {
  // 종료 상태는 즉시 반환 — task_requested 같은 가상 상태로 가지 않도록 (우측 패널/리스트 sync)
  // #206 R2 — 보류/외부컨펌도 같은 이유로 조기 반환한다. 아래 ack 분기를 타면
  //   "보류된 미확인 요청" 이 task_requested 로 둔갑해 보류 표시가 사라진다.
  if (task.status === 'completed' || task.status === 'canceled'
    || task.status === 'on_hold' || task.status === 'external_review') {
    return task.status as StatusCode;
  }
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
  // #206 — orange(프로젝트 'hold' 계열과 통일, reviewing amber 와 구분) / sky("밖에 나가 있음")
  on_hold:            { bg: '#FFEDD5', fg: '#9A3412' },
  external_review:    { bg: '#E0F2FE', fg: '#075985' },
};

// 상태 드롭다운 옵션 — QTaskPage / TaskDetailDrawer / ProjectTaskList 3곳의 단일 원천.
//   (세 곳에 같은 코드가 복제돼 있어 한 곳만 고치면 화면마다 옵션이 어긋나던 것을 #206 에서 통합)
//
//   · waiting(진행대기) 은 DB ENUM 정식 값 — 리스트/뱃지에 노출되므로 드롭다운도 일관 포함
//   · reviewing/revision_requested 는 컨펌자 0명이면 제외 (사이클 N+6, 백엔드 no_reviewers_assigned 400 과 미러)
//   · #206 on_hold 는 항상 포함 (어느 단계에서든 보류 가능)
//   · #206 external_review 는 in_progress 계열에서만 (백엔드 canEnterStatus 진입 매트릭스와 미러)
//   최종 방어는 언제나 백엔드 — 여기는 UI 노출 정책일 뿐이다.
export function statusOptionsFor(
  task: { source?: string; status?: string; reviewers?: Array<{ user_id: number }> }
): string[] {
  const hasReviewers = (task.reviewers || []).length > 0;
  let opts: string[] = [
    'not_started', 'waiting', 'in_progress', 'external_review',
    'reviewing', 'revision_requested', 'on_hold', 'completed', 'canceled',
  ];
  if (!hasReviewers) opts = opts.filter(s => s !== 'reviewing' && s !== 'revision_requested');
  if (!['in_progress', 'external_review'].includes(task.status || '')) {
    opts = opts.filter(s => s !== 'external_review');
  }
  // 종료된 업무는 보류 대상이 아니다 (백엔드 cannot_hold_closed_task 400 과 미러 —
  //   옵션에 남겨두면 사용자가 고른 뒤 거절당하는 헛클릭이 된다)
  if (['completed', 'canceled'].includes(task.status || '')) {
    opts = opts.filter(s => s !== 'on_hold');
  }
  return opts;
}
