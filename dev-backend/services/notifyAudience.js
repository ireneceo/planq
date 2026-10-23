// 알림 받는 사람 — «그 알림을 눌러 할 수 있는 사람» (2026-10-23, docs/MEMBER_PERMISSION_GAPS_DESIGN.md D1 · Fable OK-WITH-CHANGES)
//
// Irene: *"서명 받았다 등은 어느 권한에서 나와? 그냥 멤버인데 알림이 온대."*
//   옛 서명 알림은 워크스페이스 활성 멤버 **전원**에게 갔다 — 메뉴 권한도 문서 읽기 판정도 안 봤고, 본문에 문서 제목이 실렸다
//   (dev 실측: 읽을 수 없는 문서 제목이 일반 멤버에게 간 4건). 받는 사람 판정을 화면마다 따로 쓰지 않고 여기 둔다.
//
// 공통 마지막 거름 `dropMenuNone` — 그 메뉴가 «숨김» 인 멤버는 그 메뉴 알림을 받지 않는다.
//   owner/admin 은 getMemberMenuLevels 가 전권으로 주므로 자동 통과(행을 손으로 읽지 않는다).

const { Op } = require('sequelize');

async function dropMenuNone(userIds, businessId, menu) {
  const { getMemberMenuLevels, getWorkspaceMemberDefaults } = require('../middleware/menu_permission');
  const { levels } = await getWorkspaceMemberDefaults(businessId);
  const out = [];
  for (const uid of [...new Set(userIds.filter(Boolean).map(Number))]) {
    const lv = await getMemberMenuLevels(businessId, uid, { defaults: levels });
    if (!lv || lv.role === 'ai') continue;
    if (lv.menus[menu] === 'none') continue;
    out.push(uid);
  }
  return out;
}

/**
 * 서명·확인 진행 알림 — 요청자 + 문서 작성자 + owner/admin, 각자 문서를 읽을 수 있고 Q docs 가 숨김이 아닐 때만.
 * 프로젝트 PM·멤버는 넣지 않는다(관련 없는 사람에게 오던 것이 이번 신고다. 우리 쪽 서명자는 notifyUsSigners 가 따로 받는다).
 */
async function signatureAudience(sr) {
  const { BusinessMember, Post, User } = require('../models');
  const ids = new Set();
  if (sr.requester_user_id) ids.add(Number(sr.requester_user_id));
  let post = null;
  if (sr.entity_type === 'post') {
    post = await Post.findByPk(sr.entity_id);
    if (post?.author_id) ids.add(Number(post.author_id));
  }
  const managers = await BusinessMember.findAll({
    where: { business_id: sr.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin'] } },
    attributes: ['user_id'],
  });
  for (const m of managers) if (m.user_id) ids.add(Number(m.user_id));

  let candidates = await dropMenuNone([...ids], sr.business_id, 'qdocs');
  if (post) {
    const { canReadPost } = require('./postAccess');
    const users = await User.findAll({ where: { id: candidates }, attributes: ['id', 'platform_role'] });
    const readable = [];
    for (const u of users) {
      // 판정 실패는 닫는다 — 제목이 실린 알림이다
      if (await canReadPost(u, post).catch(() => false)) readable.push(u.id);
    }
    candidates = readable;
  }
  return candidates;
}

module.exports = { dropMenuNone, signatureAudience };
