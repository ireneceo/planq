// AI 에이전트 도구 — 응답 모양 (#439, 설계 §5.8).
//
//   **화이트리스트로만** 내보낸다. 모델을 통째로(toJSON) 넘기면 컬럼이 늘 때마다 새 필드가 외부 AI 로 샌다
//   (2026-09-13 invite_token 이 고객 목록에 실려 나간 사고 — CLAUDE.md «응답에 자격증명을 싣지 않는다»).
//   모든 항목에 stable id + PlanQ 딥링크 url 을 싣는다 — 모델이 «두 번째 업무» 를 다음 호출에서 id 로 가리킨다.
const cfg = require('../agent_oauth/config');

const STATUS_LABEL = {
  not_started: { ko: '시작 전', en: 'Not started' },
  waiting: { ko: '대기', en: 'Waiting' },
  in_progress: { ko: '진행 중', en: 'In progress' },
  reviewing: { ko: '확인 중', en: 'In review' },
  revision_requested: { ko: '수정 요청', en: 'Revision requested' },
  done_feedback: { ko: '승인 완료(마무리 대기)', en: 'Approved — awaiting final completion' },
  completed: { ko: '완료', en: 'Completed' },
  canceled: { ko: '취소', en: 'Canceled' },
};

const dateOnly = (v) => (v ? String(v).slice(0, 10) : null);
const iso = (v) => (v ? new Date(v).toISOString() : null);
const person = (u) => (u ? { user_id: u.id, name: u.display_name || u.name || null } : null);

function taskItem(t) {
  const j = typeof t.toJSON === 'function' ? t.toJSON() : t;
  return {
    task_id: j.id,
    title: j.title,
    status: j.status,
    status_label: STATUS_LABEL[j.status] || { ko: j.status, en: j.status },
    due_date: dateOnly(j.due_date),
    start_date: dateOnly(j.start_date),
    priority: j.priority_level || null,
    assignee: person(j.assignee),
    requester: person(j.requester),
    project: j.Project ? { project_id: j.Project.id, name: j.Project.name } : null,
    client: j.Client ? { client_id: j.Client.id, name: j.Client.display_name || j.Client.company_name || null } : null,
    updated_at: iso(j.updated_at || j.updatedAt),
    url: `${cfg.APP_URL}/tasks?task=${j.id}`,
  };
}

function noteItem(c) {
  const j = typeof c.toJSON === 'function' ? c.toJSON() : c;
  return {
    note_id: j.id,
    author: person(j.author),
    visibility: j.visibility,
    content: j.content,
    created_at: iso(j.created_at || j.createdAt),
  };
}

module.exports = { taskItem, noteItem, STATUS_LABEL, dateOnly };
