// 문서(Q docs post) 읽기 판정 — **한 벌** (2026-10-04, routes/posts.js 에서 옮겼다 · 동작 무변경).
//
//   설계 docs/AI_AGENT_M3_DESIGN.md §1.2 — 라우트 파일 안의 함수라 AI 앱(get_document)이 쓰려면 라우트를 require 해야 했다.
//   사람의 본문 조회·서명본·복사·공유 발급·업무 첨부 연결·Q info 가져오기와 AI 앱이 **같은 함수**를 부른다.
const { getUserScope, canAccessPostByLevel } = require('../middleware/access_scope');

/**
 * 문서를 **읽을 수 있는가** — 본문 조회와 서명본이 **같은 판정**을 쓴다 (2026-09-22).
 *
 * ★ 서명본(`/signed-html`)을 처음엔 `assertMember` 로 막았는데, 본문은 고객(Client)에게도 열린다.
 *   그러면 고객이 자기 계약서를 앱에서 열었을 때 **본문은 보이는데 서명 칸만 «서명 전»** 으로 남는다 —
 *   사용자에게는 "내가 서명했는데 안 들어갔다" 로 읽힌다(memory feedback_predicate_must_match_both_sides).
 *   판정을 두 벌로 두지 않는다.
 */
async function canReadPost(user, post) {
  const scope = await getUserScope(user.id, post.business_id, user.platform_role);
  // 사이클 N+9: 옵션 A — vlevel 단계별 권한.
  // Client 는 옛 헬퍼 사용 (project-client 자기 프로젝트 post 만).
  if (scope.isClient) {
    const { canAccessPost } = require('../middleware/access_scope');
    return await canAccessPost(user.id, post, scope);
  }
  return await canAccessPostByLevel(user.id, post, scope);
}

// 문서 편집 권한 — **작성자 + 작성자가 지정한 공동 편집자** (2026-10-23, docs/DOC_COEDITORS_DESIGN.md · Fable DESIGN-OK).
//   Irene: *"모두 서로 서로 막 작성자 본인 아닌데 편집되는 건 아니지?"* → «작성자가 공동 편집자를 지정(구글 문서처럼)».
//   문서 PUT·상세 can_edit·이력 복원·서명 요청·설문 관리·같이 편집(presence)·AI 앱 쓰기·첨부 추가/삭제가 **이 함수 하나**를 쓴다.
//   호출부에 작성자/공동 편집자 분기를 새로 쓰지 않는다 — 그것이 두 벌의 시작이다.
//   규칙:
//     · platform_admin → 예.  · 작성자 → 예.
//     · 공동 편집자(post_editors) ∧ 그 워크스페이스 **활성 멤버 이상**(고객·AI·정지·내보냄 제외) ∧ **지금 읽을 수 있음** → 예.
//       (범위를 좁혀 못 읽게 되면 행은 두고 여기서만 막는다 — 다시 넓히면 되살아난다. 편집 ⊆ 읽기.)
//     · 그 외 → 아니오. **owner/admin 도 예외가 아니다**(업무 description/body 선례) — 필요하면 자기를 지정한다(명시·감사·알림).
//   ★ 이전(2026-08-21~10-22)은 «볼 수 있으면 고칠 수 있다» 였다. 옛 문서는 migrate-post-editors --apply 가 실제로 고친 사람만 백필한다.
//   ★ 표 문서의 **행 입력**(routes/records.js)은 이 판정 밖이다 — 댓글·설문 응답 같은 «데이터 입력» 축. 제목·본문·칸 구조(posts PUT)만 여기.
//   ★ 삭제·공개 범위·보안등급·프로젝트 옮기기·공동 편집자 지정은 편집과 다른 축(canManagePostEditors 등) — 공동 편집자에게 주지 않는다.
async function isActiveWorkspaceMember(userId, businessId) {
  const { BusinessMember, User } = require('../models');
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId }, attributes: ['role'] });
  if (!bm || !['owner', 'admin', 'member'].includes(bm.role)) return false;
  const u = await User.findByPk(userId, { attributes: ['id', 'status', 'is_ai'] });
  return !!u && (u.status || 'active') === 'active' && !u.is_ai;
}

async function canEditPost(userId, post, platformRole) {
  if (!post || !userId) return false;
  if (platformRole === 'platform_admin') return true;
  if (post.author_id === userId) return true;
  const { PostEditor } = require('../models');
  const row = await PostEditor.findOne({ where: { post_id: post.id, user_id: userId }, attributes: ['id'] });
  if (!row) return false;
  if (!(await isActiveWorkspaceMember(userId, post.business_id))) return false;
  return canReadPost({ id: userId, platform_role: platformRole || null }, post);
}

// 공동 편집자를 넣고 빼는 사람 = 작성자 ∨ owner ∨ admin ∨ platform_admin (보안등급 축과 같은 관리 행위). 공동 편집자는 아니다.
async function canManagePostEditors(userId, post, platformRole) {
  if (!post || !userId) return false;
  if (platformRole === 'platform_admin') return true;
  if (post.author_id === userId) return true;
  const scope = await getUserScope(userId, post.business_id, platformRole);
  return !!(scope.isOwner || scope.isAdmin);
}

// 프로젝트 옮기기·공개 범위 바꾸기(PUT 본문 vlevel) — 공개 범위 축(PUT /:id/visibility 와 같은 사람): 작성자 ∨ owner ∨ platform_admin.
//   옮기면 그 프로젝트 고객·멤버에게 보이므로 편집자에게 주지 않는다.
async function canMovePostProject(userId, post, platformRole) {
  if (!post || !userId) return false;
  if (platformRole === 'platform_admin') return true;
  if (post.author_id === userId) return true;
  const scope = await getUserScope(userId, post.business_id, platformRole);
  return !!(scope.isOwner || scope.isPlatformAdmin);
}

module.exports = { canReadPost, canEditPost, canManagePostEditors, canMovePostProject, isActiveWorkspaceMember };
