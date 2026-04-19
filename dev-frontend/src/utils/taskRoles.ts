// 한 업무에서 현재 사용자의 역할 판정 + 라벨 관점 결정.
// 각 업무에서 한 사용자는 동시에 여러 역할을 가질 수 있다 (담당자+요청자 등).
// 라벨·액션에는 "가장 행동 주체가 되는 역할"을 우선한다.

export type TaskRole = 'assignee' | 'reviewer' | 'requester' | 'observer';

export interface TaskForRole {
  assignee_id: number | null;
  created_by?: number;
  request_by_user_id?: number | null;
  reviewers?: Array<{ user_id: number }>;
}

export function getRoles(task: TaskForRole, myId: number): TaskRole[] {
  const roles: TaskRole[] = [];
  if (task.assignee_id === myId) roles.push('assignee');
  if ((task.reviewers || []).some((r) => r.user_id === myId)) roles.push('reviewer');
  if (task.request_by_user_id === myId || task.created_by === myId) roles.push('requester');
  if (roles.length === 0) roles.push('observer');
  return roles;
}

// 관점 우선순위: 일하는 주체 > 행동 주체 > 요청자 > 관찰자
export function primaryPerspective(roles: TaskRole[]): TaskRole {
  if (roles.includes('assignee')) return 'assignee';
  if (roles.includes('reviewer')) return 'reviewer';
  if (roles.includes('requester')) return 'requester';
  return 'observer';
}
