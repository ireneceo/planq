// 표·설문 권한 판정 — routes/records.js 와 routes/survey_manage.js 가 **같은 함수**를 쓴다(베끼면 갈라진다).
//
// ★ 표의 공개 범위는 **연결된 문서(Post)** 가 정한다(records.js 머리 주석 — 2026-09-03 실측 유출).
// ★ 설문 관리(켜기·보내기·회차 보기) = 워크스페이스 멤버 이상(고객·AI·해제 멤버 제외) ∧ 그 문서를 고칠 수 있는 사람(canEditPost).
//   L1 개인 문서는 작성자만(#460 Fable 수정 4).
// ★ 설문(kind='survey')의 응답·통계는 **멤버 이상만** 본다 — 고객이 볼 수 있는 프로젝트 문서여도 다른 고객의 응답은 안 된다(v2 §7).
const { canAccessPostByLevel, getUserScope } = require('../middleware/access_scope');

/** 이 표를 볼 수 있는가 — 문서가 없는 고아 표는 닫는다(fail-closed). @returns {{ok, post}} */
async function canViewRecord(userId, record, isPlatformAdmin) {
  if (isPlatformAdmin) return { ok: true, post: null };
  const { Post } = require('../models');
  const post = await Post.findOne({
    where: { q_record_id: record.id },
    attributes: ['id', 'business_id', 'author_id', 'vlevel', 'project_id', 'target_member_ids', 'kind'],
  });
  if (!post) return { ok: false, post: null };
  const scope = await getUserScope(userId, post.business_id);
  return { ok: await canAccessPostByLevel(userId, post, scope), post };
}

async function isMemberUp(user, businessId) {
  const scope = await getUserScope(user.id, businessId, user.platform_role);
  const memberUp = scope.isPlatformAdmin || scope.isOwner || scope.isAdmin || scope.isMember;
  return !!memberUp && !scope.isClient && !scope.isAi;
}

/** 설문을 관리할 수 있는가. @returns {{ok, post}} post = 전체 Post 인스턴스 */
async function canManageSurvey(user, record) {
  if (!(await isMemberUp(user, record.business_id))) return { ok: false, post: null };
  const v = await canViewRecord(user.id, record, user.platform_role === 'platform_admin');
  const { Post } = require('../models');
  // 플랫폼 관리자는 canViewRecord 가 post 를 안 준다 — 문서를 따로 찾는다
  const post = v.post ? await Post.findByPk(v.post.id) : await Post.findOne({ where: { q_record_id: record.id } });
  if (!v.ok || !post) return { ok: false, post: null };
  const { canEditPost } = require('../routes/posts');
  if (!(await canEditPost(user.id, post, user.platform_role))) return { ok: false, post: null };
  return { ok: true, post };
}

/** 설문 응답(줄)·통계를 볼 수 있는가 — 표 읽기 술어 + (설문 문서면) 멤버 이상. */
async function canViewSurveyResponses(user, record) {
  const v = await canViewRecord(user.id, record, user.platform_role === 'platform_admin');
  if (!v.ok) return { ok: false, post: v.post };
  const kind = v.post ? v.post.kind : null;
  if (kind === 'survey' && !(await isMemberUp(user, record.business_id))) return { ok: false, post: v.post };
  return { ok: true, post: v.post };
}

module.exports = { canViewRecord, canManageSurvey, canViewSurveyResponses, isMemberUp };
