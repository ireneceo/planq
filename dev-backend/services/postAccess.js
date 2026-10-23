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

// 문서 편집 권한 — **공개 범위와 같은 축** (2026-08-21, routes/posts.js 에서 옮겼다 · 동작 무변경 2026-10-23).
//   문서 PUT·상세 can_edit·받은 서명의 [문서에서 수정] 이 같은 함수를 쓴다.
//   규칙: **볼 수 있으면 고칠 수 있다.** 단
//     · L1(개인) 문서 — 작성자만. 공개하지 않은 글을 남이 고치면 안 된다.
//     · 고객(Client) — 호출부의 assertMember 에서 이미 막힌다. 읽기·컨펌만.
//     · 삭제 — 편집과 다른 축이다. 파괴적이고 되돌릴 수 없어 작성자·owner 로 유지한다.
async function canEditPost(userId, post, platformRole) {
  if (platformRole === 'platform_admin') return true;
  if (post.author_id === userId) return true;
  // L1 = 개인 문서. 작성자 외에는 owner/admin 도 편집하지 않는다(읽기도 안 되는 등급이다).
  //   ★ 2026-10-07 — 이 분기가 주석과 반대로 owner/admin 에게 true 를 줘서, **읽으면 403 인 남의 L1 문서를
  //   PUT 으로는 고칠 수 있었다**(Fable 행 5 D3 실측). 이 함수의 규칙은 «볼 수 있으면 고칠 수 있다»(1cf7eb0d).
  if (post.vlevel === 'L1') return false;
  const scope = await getUserScope(userId, post.business_id, platformRole);
  return canAccessPostByLevel(userId, post, scope);
}

module.exports = { canReadPost, canEditPost };
