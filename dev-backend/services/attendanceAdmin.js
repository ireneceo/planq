// 근태 관리 설정(휴일·휴가 종류)의 권한 술어 — 한 곳 (2026-10-22, docs/LEAVE_TYPES_DESIGN.md §2.5)
//   읽기 = 워크스페이스 멤버(고객 제외) · 쓰기 = owner/admin(+platform_admin).
//   checkBusinessAccess 뒤에서 쓴다(req.businessRole). 두 라우트가 각자 적으면 한쪽만 고쳐진다.
const { errorResponse } = require('../middleware/errorHandler');

const canWrite = (req) => req.user?.platform_role === 'platform_admin'
  || req.businessRole === 'owner' || req.businessRole === 'admin';

const blockClient = (req, res) => {
  if (req.businessRole === 'client') { errorResponse(res, 'forbidden', 403); return true; }
  return false;
};

module.exports = { canWrite, blockClient };
