// 문서 댓글 — 읽기 쪽 공용(직렬화·보는 사람 기준 범위·메타). 설계 docs/DOC_COMMENTS_DESIGN.md.
//
//   쓰기(만들기·지우기·알림·감사·실시간)는 행동 계층 services/actions/post_actions.js 한 곳이다.
//   여기는 «누가 무엇을 보는가» 만 — 목록·상세 댓글 수가 같은 함수를 쓴다(공식 두 벌 금지).
'use strict';

const { getUserScope, isMemberOrAbove } = require('../middleware/access_scope');

/** 보는 사람의 종류 — 멤버 이상 / 고객. canReadPost 를 통과한 뒤에만 부른다. */
async function viewerOf(user, post) {
  const scope = await getUserScope(user.id, post.business_id, user.platform_role);
  return { scope, isMember: isMemberOrAbove(scope), isClient: !!scope.isClient };
}

/** 보는 사람이 볼 수 있는 댓글 조건 — 고객은 shared 만. */
function visibleWhere(postId, viewer) {
  const where = { post_id: postId };
  if (!viewer.isMember) where.visibility = 'shared';
  return where;
}

/** «고객도 봄» 을 고를 수 있는가 — 문서가 프로젝트에 붙어 있고 그 프로젝트에 고객이 있을 때만(서버 판정). */
async function canShareWithClients(post) {
  if (!post.project_id) return false;
  const { ProjectClient } = require('../models');
  const n = await ProjectClient.count({ where: { project_id: post.project_id } });
  return n > 0;
}

/**
 * 응답 한 건의 모양 — toJSON 통째로 내보내지 않는다(화이트리스트).
 * @param row PostComment 인스턴스(author include)
 */
function serializeComment(row, { viewerId, canModerate, authors }) {
  const r = row.get ? row.get({ plain: true }) : row;
  const m = authors.names.get(r.user_id);
  return {
    id: Number(r.id),
    post_id: r.post_id,
    content: r.content,
    visibility: r.visibility,
    user_id: r.user_id,
    author_name: m?.name || r.author?.name || null,
    author_kind: authors.memberIds.has(r.user_id) ? 'member' : 'client',
    created_at: r.createdAt || r.created_at || null,
    can_delete: r.user_id === viewerId || !!canModerate,
  };
}

/** 작성자 — 워크스페이스 표시명 + 멤버인가(아니면 고객 칩). 멤버가 아니면 User 이름 폴백. */
async function authorsFor(businessId, userIds) {
  const { getMemberNameMap } = require('./displayName');
  const { BusinessMember } = require('../models');
  const ids = [...new Set(userIds.filter(Boolean).map(Number))];
  if (!ids.length) return { names: new Map(), memberIds: new Set() };
  const [names, rows] = await Promise.all([
    getMemberNameMap(businessId, ids),
    BusinessMember.findAll({ where: { business_id: businessId, user_id: ids }, attributes: ['user_id'], raw: true }),
  ]);
  return { names, memberIds: new Set(rows.map((r) => r.user_id)) };
}

/** owner/admin — 남의 댓글도 지울 수 있다(관리 행위, 업무 삭제와 같은 선). */
function canModerate(scope) {
  return !!(scope && (scope.isOwner || scope.isAdmin));
}

module.exports = { viewerOf, visibleWhere, canShareWithClients, serializeComment, authorsFor, canModerate };
