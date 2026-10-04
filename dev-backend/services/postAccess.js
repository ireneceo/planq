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

module.exports = { canReadPost };
