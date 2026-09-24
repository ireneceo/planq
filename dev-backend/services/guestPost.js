// services/guestPost.js — 게스트(프로젝트 링크)가 **어떤 문서 본문을 열 수 있는가** 한 술어.
//   `GET /api/guest/:token/posts/:postId` 와 이미지 문맥 판정(services/imageCtx)이 같이 부른다.
//   베껴 두면 한쪽만 좁혀진다(게스트가 못 여는 문서의 이미지가 문맥으로 열리는 식).
const GUEST_VLEVELS = ['L2', 'L3', 'L4'];

/** 링크가 가리키는 프로젝트 — 프로젝트 범위 링크가 아니거나 테넌트가 어긋나면 null. */
async function guestProjectOf(link) {
  if (!link || link.scope !== 'project' || !link.project_id) return null;
  const { Project } = require('../models');
  const project = await Project.findByPk(link.project_id, { attributes: ['id', 'business_id'] });
  // 테넌트 이중 검증 — 링크의 워크스페이스와 프로젝트가 어긋나면 없는 것으로 친다.
  if (!project || project.business_id !== link.business_id) return null;
  return project;
}

/** 게스트가 여는 문서 한 건 — 잠긴(general 아님) 문서·미발행·L1 은 null. */
async function findGuestPost(link, projectId, postId, attributes) {
  const { Post } = require('../models');
  const post = await Post.findOne({
    where: {
      id: Number(postId) || 0,
      project_id: projectId, business_id: link.business_id,
      status: 'published', vlevel: GUEST_VLEVELS,
    },
    attributes,
  });
  if (!post) return null;
  if ((post.security_level || 'general') !== 'general') return null;
  return post;
}

module.exports = { GUEST_VLEVELS, guestProjectOf, findGuestPost };
