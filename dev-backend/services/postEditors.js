// 문서 공동 편집자 — 넣기·빼기·보여 주기 한 벌 (2026-10-23, docs/DOC_COEDITORS_DESIGN.md · Fable DESIGN-OK).
//
//   편집 «판정» 은 여기 없다 — services/postAccess.canEditPost 한 곳. 여기는 행을 쓰고 읽고 알리는 문이다.
//   ★ 넣고 빼는 사람 = canManagePostEditors(작성자 ∨ owner ∨ admin ∨ platform_admin). 공동 편집자는 못 한다.
//   ★ 넣을 수 있는 사람 = 그 워크스페이스 활성 멤버 이상(고객·AI 제외) ∧ **지금 그 문서를 읽을 수 있음**.
//     못 읽는 사람은 409 widen_visibility_first — 읽기 술어를 넓히지 않는다(편집 ⊆ 읽기). 그래서 L1(나만 보기)엔 둘 수 없다.
//   ★ 알림 doc_editor(앱만, 메일 없음) — 넣은 사람에게 + 넣은 이가 작성자가 아니면 작성자에게도. 빼기·백필은 알림 없음.
//   ★ 실시간: 문서 신호(broadcastPost 와 같은 모양) + 뺀 사람의 user: 방에 post:editor_removed {id} — 그 사람의 같이 편집 자리도 뺀다.
'use strict';

const { Post, PostEditor, User } = require('../models');
const { canReadPost, canManagePostEditors, isActiveWorkspaceMember } = require('./postAccess');
const { getMemberDisplayName } = require('./displayName');

const fail = (code, http) => ({ ok: false, code, http });

async function nameOf(businessId, userId, fallback) {
  const r = await getMemberDisplayName(businessId, userId, fallback).catch(() => null);
  return (r && r.name) || fallback || '';
}

// 상세 응답에 싣는 목록 — 이름·id 만(이메일 없음). readable=false 면 범위가 좁아져 지금은 못 고친다(행은 남아 있다).
async function listFor(post) {
  const rows = await PostEditor.findAll({
    where: { post_id: post.id },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'platform_role'] }],
    order: [['created_at', 'ASC'], ['id', 'ASC']],
  });
  const out = [];
  for (const r of rows) {
    const u = r.user;
    if (!u) continue;
    const active = await isActiveWorkspaceMember(u.id, post.business_id);
    const readable = active && await canReadPost({ id: u.id, platform_role: u.platform_role }, post);
    out.push({
      user_id: u.id,
      name: await nameOf(post.business_id, u.id, u.name),
      added_by: r.added_by || null,
      created_at: r.created_at || r.createdAt,
      readable: !!readable,
    });
  }
  return out;
}

function signal(io, post, event = 'post:updated') {
  if (!io) return;
  const data = { id: post.id, business_id: post.business_id, project_id: post.project_id || null };
  if (post.business_id) io.to(`business:${post.business_id}`).emit(event, data);
  if (post.project_id) require('./projectRoom').emitProject(io, post.project_id, event, data);
}

async function notifyAdded({ post, userId, actorId, io }) {
  const { notifyMany } = require('../routes/notifications');
  const actor = await User.findByPk(actorId, { attributes: ['id', 'name'] });
  const actorName = await nameOf(post.business_id, actorId, actor?.name || '');
  const common = {
    businessId: post.business_id, link: `/docs?post=${post.id}`, ctaLabel: '문서 열기',
    skipChannels: ['email'], suppressEscalation: true,
    actorUserId: actorId, entityType: 'post', entityId: post.id, ioApp: io,
  };
  if (userId !== actorId) {
    notifyMany({ ...common, userIds: [userId], eventKind: 'doc_editor',
      titleSpec: { feature: 'docs', action: 'doc_editor_added', subject: `"${post.title}"` },
      body: `${actorName} 님이 이 문서의 공동 편집자로 지정했어요.` })
      .catch((e) => console.warn('[notify doc_editor]', e.message));
  }
  // 작성자가 아닌 사람(owner·admin)이 넣었으면 작성자도 안다 — 조용한 백도어가 아니게.
  if (actorId !== post.author_id && userId !== post.author_id) {
    const who = await nameOf(post.business_id, userId, (await User.findByPk(userId, { attributes: ['name'] }))?.name || '');
    notifyMany({ ...common, userIds: [post.author_id], eventKind: 'doc_editor',
      titleSpec: { feature: 'docs', action: 'doc_editor_added_by_other', subject: `"${post.title}"` },
      body: `${actorName} 님이 ${who} 님을 공동 편집자로 지정했어요.` })
      .catch((e) => console.warn('[notify doc_editor author]', e.message));
  }
}

async function add({ req, postId, userId }) {
  const post = await Post.findByPk(postId);   // paranoid — 휴지통 문서는 없음
  if (!post) return fail('not_found', 404);
  if (!(await canReadPost(req.user, post))) return fail('not_found', 404);
  if (!(await canManagePostEditors(req.user.id, post, req.user.platform_role))) return fail('editors_manage_forbidden', 403);
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return fail('user_id required', 400);
  if (uid === post.author_id) return fail('already_author', 400);
  if (!(await isActiveWorkspaceMember(uid, post.business_id))) return fail('not_workspace_member', 400);
  const target = await User.findByPk(uid, { attributes: ['id', 'platform_role'] });
  if (post.vlevel === 'L1' || !(await canReadPost({ id: uid, platform_role: target.platform_role }, post))) {
    return fail('widen_visibility_first', 409);
  }
  const before = (await PostEditor.findAll({ where: { post_id: post.id }, attributes: ['user_id'], raw: true })).map((r) => r.user_id);
  const [, created] = await PostEditor.findOrCreate({ where: { post_id: post.id, user_id: uid }, defaults: { added_by: req.user.id } });
  if (created) {
    require('./auditService').logAudit(req, {
      action: 'post.editors_update', targetType: 'post', targetId: post.id, businessId: post.business_id,
      oldValue: { editor_ids: before }, newValue: { editor_ids: [...before, uid], added: uid, by_author: req.user.id === post.author_id },
    });
    const io = req.app.get('io');
    signal(io, post);
    await notifyAdded({ post, userId: uid, actorId: req.user.id, io });
  }
  return { ok: true, data: await listFor(post) };
}

async function remove({ req, postId, userId }) {
  const post = await Post.findByPk(postId);
  if (!post) return fail('not_found', 404);
  if (!(await canReadPost(req.user, post))) return fail('not_found', 404);
  if (!(await canManagePostEditors(req.user.id, post, req.user.platform_role))) return fail('editors_manage_forbidden', 403);
  const uid = Number(userId);
  const before = (await PostEditor.findAll({ where: { post_id: post.id }, attributes: ['user_id'], raw: true })).map((r) => r.user_id);
  const n = await PostEditor.destroy({ where: { post_id: post.id, user_id: uid } });
  if (n) {
    require('./auditService').logAudit(req, {
      action: 'post.editors_update', targetType: 'post', targetId: post.id, businessId: post.business_id,
      oldValue: { editor_ids: before }, newValue: { editor_ids: before.filter((x) => x !== uid), removed: uid, by_author: req.user.id === post.author_id },
    });
    const io = req.app.get('io');
    signal(io, post);
    if (io) {
      io.to(`user:${uid}`).emit('post:editor_removed', { id: post.id });
      await require('./postPresence').dropUserFromPost(io, uid, post.id).catch(() => null);
    }
  }
  return { ok: true, data: await listFor(post) };
}

// 멤버 내보내기 — 그 워크스페이스 문서의 공동 편집자 행을 지운다(재초대해도 자동으로 돌아오지 않는다).
async function removeUserFromBusiness(userId, businessId, transaction) {
  const { sequelize } = require('../config/database');
  await sequelize.query(
    'DELETE pe FROM post_editors pe JOIN posts p ON p.id = pe.post_id WHERE pe.user_id = ? AND p.business_id = ?',
    { replacements: [Number(userId), Number(businessId)], transaction },
  );
}

module.exports = { listFor, add, remove, removeUserFromBusiness };
