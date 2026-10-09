// 프로젝트 접근 판정 — **단일 술어.**
//
// ★ 왜 서비스로 나왔나 (2026-09-10): 이 함수는 `routes/projects.js` 안 지역 선언이었고
//   그 파일에서만 64곳이 부른다. 새 라우트(일정 일괄 수정)가 같은 판정을 필요로 하는데
//   export 가 없어 **손으로 다시 쓸 수밖에 없는** 상태였다 — 그렇게 하면 소유권·권한 검사가
//   새 문에만 빠지거나 갈라진다(memory feedback_new_door_must_reuse_sibling_checks).
//   함수를 여기로 옮기고 routes/projects.js 는 import 만 한다. 호출부 64곳은 무변경.
//
// 반환: `{ project, role }` 또는 `{ error: { code, message } }`
//   role — 'owner' | 'admin' | 'member' | 'client'
//   ★ 'client'(프로젝트 참여 고객)는 **읽기만** 하는 자리다. 쓰기 라우트는 반드시
//     `if (role === 'client') return 403` 을 따로 건다 — 이 함수는 "들어올 수 있는가" 만 답한다.
const { Project, BusinessMember, ProjectClient } = require('../models');

async function requireBusinessMember(userId, businessId) {
  return BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
}

async function loadProjectOrForbidden(projectId, userId) {
  const project = await Project.findByPk(projectId);
  if (!project) return { error: { code: 404, message: 'project_not_found' } };
  // 워크스페이스 멤버 여부 (owner/admin/member)
  const bm = await requireBusinessMember(userId, project.business_id);
  if (bm) return { project, role: bm.role };
  // 또는 프로젝트 참여 고객
  const pc = await ProjectClient.findOne({
    where: { project_id: project.id, contact_user_id: userId },
  });
  if (pc) return { project, role: 'client' };
  return { error: { code: 403, message: 'not_project_member' } };
}

// 고객에게 보내는 프로젝트 — 내부 운영 칸(계약 금액·청구 설정·전략·성과지표·드라이브 폴더)과
//   다른 사람의 연락처를 뺀다(2026-10-09 보안점검: 상세·목록이 행을 통째로 보냈다. 캔버스 라우트는 이미
//   member_only 였는데 같은 값이 여기로 나가고 있었다). 화이트리스트가 아니라 블랙리스트인 이유:
//   고객 화면이 쓰는 칸(이름·기간·상태·색·종류·탭 이름…)이 많고 계속 는다 — 대신 **새 내부 칸은 여기에 같이 적는다.**
const PROJECT_CLIENT_HIDDEN = [
  'contract_amount', 'billing_type', 'monthly_fee', 'auto_invoice_enabled', 'auto_invoice_mode',
  'invoice_billing_day', 'last_auto_invoice_at', 'gdrive_folder_id',
  'strategy_context', 'strategy_key_question', 'strategy_goal', 'strategy_governing_thought',
  'strategy_approach', 'success_metrics', 'strategy_sources',
];
function projectForClient(json, viewerUserId) {
  if (!json || typeof json !== 'object') return json;
  const out = { ...json };
  for (const k of PROJECT_CLIENT_HIDDEN) delete out[k];
  if (Array.isArray(out.projectMembers)) {
    out.projectMembers = out.projectMembers.map((m) => {
      const mm = { ...m };
      if (mm.User) { mm.User = { ...mm.User }; delete mm.User.email; }
      return mm;
    });
  }
  if (Array.isArray(out.projectClients)) {
    out.projectClients = out.projectClients.map((pc) => {
      if (Number(pc.contact_user_id) === Number(viewerUserId)) return pc;
      const c = { ...pc };
      delete c.contact_email; delete c.contact_phone;
      return c;
    });
  }
  return out;
}

module.exports = { loadProjectOrForbidden, requireBusinessMember, projectForClient, PROJECT_CLIENT_HIDDEN };
