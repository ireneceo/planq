// services/projectIssueActions.js — 프로젝트 이슈(project_issues) 고치기·지우기 본체 (2026-11-20)
//   routes/projects.js 는 god-file 래칫이라 본체를 여기 둔다 — 라우트는 권한(loadProjectOrForbidden·고객 403)만 보고 부른다.
//   ★ 고치기·지우기도 신호를 쏜다 — 개요 이슈 카드·프로젝트 히스토리 탭이 다시 읽는다(그전엔 아무 신호도 없었다).
//     신호만({id, project_id}) · emitProject 한 문(CLIENT_VIEW 미등록 → 고객 방 안 감). docs/PROJECT_HISTORY_MAIL_ISSUE_DESIGN.md
const { logAudit } = require('./auditService');
const { emitProject } = require('./projectRoom');

const signal = (req, issue, event) => emitProject(req.app.get('io'), issue.project_id, event, { id: issue.id, project_id: issue.project_id });

async function updateIssueBody(req, issue, project, body) {
  const prev = issue.body;
  await issue.update({ body: String(body).trim() });
  if (prev !== issue.body) logAudit(req, { action: 'project_issue.update', targetType: 'project_issue', targetId: issue.id, businessId: project.business_id, newValue: { project_id: issue.project_id, changed: ['body'] } });
  signal(req, issue, 'issue:updated');
  return issue.toJSON();
}

async function deleteIssue(req, issue, project) {
  await issue.destroy();
  logAudit(req, { action: 'project_issue.delete', targetType: 'project_issue', targetId: issue.id, businessId: project.business_id, oldValue: { project_id: issue.project_id, conversation_id: issue.conversation_id } });
  signal(req, issue, 'issue:deleted');
}

module.exports = { updateIssueBody, deleteIssue };
