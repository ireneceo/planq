// 대화방 메시지 «읽기» 판정 한 벌 — 메시지 목록(GET …/messages)과 대화 안 검색(GET …/messages/search)이 같이 쓴다.
//   두 라우트에 술어를 인라인 복제하면 다음에 한쪽만 고쳐져 갈라진다(검색이 목록보다 넓으면 곧 누수다).
//   반환: null = 읽어도 됨 · { message, code } = 거절.
const { loadProjectOrForbidden } = require('./projectAccess');
const { canAccessConversation } = require('../middleware/access_scope');

async function convReadDenied(conv, userId) {
  if (conv.project_id) {
    const { error, role } = await loadProjectOrForbidden(conv.project_id, userId);
    if (error) return { message: error.message, code: error.code };
    if (role === 'client' && conv.channel_type !== 'customer') return { message: 'forbidden_channel', code: 403 };
    // 고객 채널이어도 **자기 회사 채널**이어야 한다 — 목록과 같은 술어(canAccessConversation).
    if (!(await canAccessConversation(userId, conv))) return { message: 'forbidden_channel', code: 403 };
    return null;
  }
  // 독립 대화(standalone, project_id 없음) — 접근 검사 (cross-tenant/IDOR 차단).
  //   워크스페이스 멤버 이상 또는 참여 client 만. 옛 코드는 standalone 에 검사 없어 conv id 열거로
  //   타 워크스페이스 메시지 조회 가능했던 갭. (검증 사이클 발견 fix)
  if (!(await canAccessConversation(userId, conv))) return { message: 'forbidden', code: 403 };
  return null;
}

module.exports = { convReadDenied };
