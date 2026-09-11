// 초안 종류 등록표 — docs/DRAFT_PERSISTENCE_DESIGN.md D-C1b
//
// 초안 키는 `planq:draft:{kind}:{userId}:{bizId}:{entityId}` 이고, kind 는 **여기 등록된 것만** 쓴다.
// 가드(`guard-invariants --category=draft`)가 등록 외 kind 를 막는다 — 민감 입력에 초안을 붙이는 실수를
// "새 kind 를 여기 적는" 리뷰 지점 하나로 모은다.
//   mode 'append' — 새로 쓰는 글(댓글·사유). 'edit' — 원문이 있는 글을 고치는 것(원문이 바뀌면 옛 초안을 버린다).

const DAY = 24 * 60 * 60 * 1000;

export interface DraftKindSpec {
  ttlMs: number;
  mode: 'append' | 'edit';
  /** 이 kind 를 쓰는 파일(dev-frontend/src 기준) — 가드가 대조한다 */
  owners: string[];
}

export const DRAFT_KINDS = {
  'task-comment': { ttlMs: 7 * DAY, mode: 'append', owners: ['components/QTask/TaskDetailDrawer.tsx'] },
  'task-comment-edit': { ttlMs: 7 * DAY, mode: 'edit', owners: ['components/QTask/TaskDetailDrawer.tsx'] },
  'task-revision-note': { ttlMs: 7 * DAY, mode: 'append', owners: ['components/QTask/TaskDetailDrawer.tsx'] },
  'task-approve-note': { ttlMs: 7 * DAY, mode: 'append', owners: ['components/QTask/TaskDetailDrawer.tsx'] },
  'task-submit-note': { ttlMs: 7 * DAY, mode: 'append', owners: ['components/QTask/TaskDetailDrawer.tsx'] },
  'task-hold-reason': { ttlMs: 7 * DAY, mode: 'append', owners: ['components/QTask/TaskDetailDrawer.tsx'] },
  // 업무 설명·결과물 — 서버로 못 보낸 채 떠난 값(반복 업무 설명 = 적용 범위를 물어야 함 · 창 닫기·새로고침 백업).
  //   원문(base)이 그 사이 바뀌면 버린다(D-C1d). 반복 업무 설명이 남아 있으면 로그아웃 전에 확인한다(LeaveDecisionGuard).
  'task-description': { ttlMs: 7 * DAY, mode: 'edit', owners: ['components/QTask/TaskDetailDrawer.tsx', 'services/draftStore.ts'] },
  'task-body': { ttlMs: 7 * DAY, mode: 'edit', owners: ['components/QTask/TaskDetailDrawer.tsx'] },
  // Q sale — 상담 기록 메모(전화·미팅 내용은 길다)와 종결 사유 메모. 둘 다 모달 안에서 쓰다 닫으면 사라지던 값이다.
  'sale-interaction-body': { ttlMs: 7 * DAY, mode: 'append', owners: ['pages/QSale/SaleDetailPage.tsx'] },
  'sale-lost-note': { ttlMs: 7 * DAY, mode: 'append', owners: ['pages/QSale/SaleDetailPage.tsx'] },
  'mail-issue': { ttlMs: 7 * DAY, mode: 'append', owners: ['components/Common/NoteThread.tsx', 'pages/QMail/MailContextPanel.tsx'] },
  'mail-note': { ttlMs: 7 * DAY, mode: 'append', owners: ['components/Common/NoteThread.tsx', 'pages/QMail/MailContextPanel.tsx'] },
  'qtalk-note': { ttlMs: 7 * DAY, mode: 'append', owners: ['components/Common/NoteThread.tsx', 'pages/QTalk/RightPanel.tsx'] },
  'mail-forward': { ttlMs: 7 * DAY, mode: 'append', owners: ['pages/QMail/MailPage.tsx'] },
  // 회의 시작 설정은 24시간 — 며칠 전 언어·번역 설정이 오늘 회의를 지배하지 않게(StartMeetingModal 의 옛 의도)
  'qnote-meeting-start': { ttlMs: 1 * DAY, mode: 'append', owners: ['pages/QNote/StartMeetingModal.tsx'] },
} as const satisfies Record<string, DraftKindSpec>;

export type DraftKind = keyof typeof DRAFT_KINDS;

export const DEFAULT_DRAFT_TTL_MS = 7 * DAY;

export function draftKindSpec(kind: string): DraftKindSpec | null {
  return (DRAFT_KINDS as Record<string, DraftKindSpec>)[kind] || null;
}
