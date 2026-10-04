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

// ── 메일 (M3-a, 설계 docs/AI_AGENT_M3_DESIGN.md §4.2.2) — 사람 화면용 mailSerialize 와 모양이 달라 따로 둔다.
//   body_html·share_token·vlevel·rule_id·spam_score 같은 내부 칸은 고르지 않는다. 개인 계정 표시(is_personal)는 **항상** 싣는다 —
//   모델이 요약할 때 «내 개인 메일에서» 라고 말할 수 있어야 한다.
const MAIL_PREVIEW_MAX = 200;

function mailThreadItem(t, { counterpart = null, hasAttachments = false, folder = null } = {}) {
  const j = typeof t.toJSON === 'function' ? t.toJSON() : t;
  const acc = j.EmailAccount || null;
  return {
    thread_id: j.id,
    account: acc ? { account_id: acc.id, email: acc.email, is_personal: !!acc.owner_user_id } : { account_id: j.account_id, email: null, is_personal: null },
    subject: j.subject || null,
    counterpart,
    last_message_at: iso(j.last_message_at),
    last_message_direction: j.last_message_direction || null,
    preview: j.last_message_preview ? String(j.last_message_preview).slice(0, MAIL_PREVIEW_MAX) : null,
    unread_count: Number(j.unread_count || 0),
    message_count: Number(j.message_count || 0),
    has_attachments: !!hasAttachments,
    folder,
    labels: Array.isArray(j.labels) ? j.labels : [],
    client: j.Client ? { client_id: j.Client.id, name: j.Client.display_name || j.Client.company_name || null } : null,
    project: j.Project ? { project_id: j.Project.id, name: j.Project.name } : null,
    match: null,
    url: `${cfg.APP_URL}/mail?thread=${j.id}`,
  };
}

const addrList = (v) => {
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { arr = [v]; } }
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => (typeof x === 'string' ? { name: null, email: x } : { name: x?.name || null, email: x?.email || x?.address || null }));
};

/** 메시지 한 통 — text 는 부르는 쪽이 만든 평문(같은 함수로 만들어야 이어 읽기가 맞는다). */
function mailMessageItem(m, { text = '', maxChars = 3000, attachments = [], senderName = null } = {}) {
  const j = typeof m.toJSON === 'function' ? m.toJSON() : m;
  const s = String(text || '');
  const cut = s.length > maxChars;
  return {
    message_id: j.id,
    direction: j.direction,
    from: { name: j.from_name || null, email: j.from_email || null },
    to: addrList(j.to_emails),
    cc: addrList(j.cc_emails),
    sent_at: iso(j.sent_at),
    sent_by: j.direction === 'outbound' && j.sent_by_user_id ? { user_id: j.sent_by_user_id, name: senderName } : null,
    is_read: !!j.is_read,
    body_text: cut ? s.slice(0, maxChars) : s,
    body_total_chars: s.length,
    truncated_fields: cut ? ['body_text'] : [],
    attachments,
  };
}

module.exports = { taskItem, noteItem, mailThreadItem, mailMessageItem, STATUS_LABEL, dateOnly, iso, person };
