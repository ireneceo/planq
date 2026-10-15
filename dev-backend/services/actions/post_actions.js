// services/actions/post_actions.js — Q docs 문서(posts) 쓰기의 **행동 계층** (2026-10-05)
//
// 왜 생겼나: ChatGPT·Claude(AI 에이전트)가 문서를 만들고 고칠 수 있어야 한다(Irene: "문서도 작성할 수 있어야지").
//   그런데 문서 생성은 `routes/posts.js POST /` 안에만 있었다. AI 도구가 라우트를 HTTP 로 다시 부르거나
//   모델을 직접 쓰면 감사·실시간·거래 단계가 한쪽에서 빠진다 → 사람(라우트)과 AI(도구)가 **같은 함수**를 부른다.
//   (같은 이유로 업무는 task_actions, 일정은 event_actions 가 있다.)
//
//   ★ `document_actions.createDocument` 와 헷갈리지 말 것 — 그쪽은 `documents` 표(견적·계약 양식)다.
//     Q docs 화면의 «문서» 는 `posts` 표이고 여기가 그 문이다.
//
// 권한은 화면과 같은 술어를 쓴다 — 만들기는 워크스페이스 멤버(routes/posts.js assertMember), 고치기·연결은
// canEditPost, 서명이 걸린 문서는 blockIfSigned 와 같은 판정(isPostSignatureLocked)으로 막는다.
const { Post, Project } = require('../../models');
const { resolveSubject, fail, done } = require('./_subject');

function getIO() { return global.__planqIo || null; }
function postsRoute() { return require('../../routes/posts'); }

// 실시간 — 신호만(id·소속). 행 전체를 방에 뿌리지 않는다(CLAUDE.md «실시간 방송은 신호만»).
function signalPost(post, event) {
  const io = getIO();
  if (!io || !post) return;
  const data = { id: post.id, business_id: post.business_id, project_id: post.project_id || null };
  if (post.business_id) io.to(`business:${post.business_id}`).emit(event, data);
  if (post.project_id) require('../projectRoom').emitProject(io, post.project_id, event, data);
}

function audit(actor, action, post, extra) {
  require('../auditService').logAudit(actor.req || null, {
    userId: actor.userId,
    action,
    targetType: 'post',
    targetId: post.id,
    businessId: post.business_id,
    newValue: { title: post.title, project_id: post.project_id || null, ...extra, via: actor.channel?.kind === 'agent' ? `agent:${actor.channel.provider}` : (actor.kind === 'cue' ? 'cue' : 'user') },
  });
}

/**
 * 문서 만들기 — `POST /api/posts` 와 같은 규칙.
 * @param params { businessId, projectId?, conversationId?, parentPostId?, title, contentJson?, category?, status?, isPinned?, kind?, vlevel?, qRecordId? }
 *   qRecordId — 표 문서(kind='table')는 라우트가 표를 먼저 만들고 그 id 를 넘긴다(표 시드는 라우트의 일).
 */
async function createPost(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const userId = subj.subjectId;
  const businessId = Number(params.businessId);
  const title = String(params.title || '').trim();
  if (!businessId || !title) return fail('business_id/title required', 400);
  // 멤버 이상 — routes/posts.js assertMember 가 감싸는 것과 같은 함수(고객·비소속은 못 만든다)
  const { assertMemberOrAbove } = require('../../middleware/access_scope');
  if (!(await assertMemberOrAbove(userId, businessId, subj.platformRole === 'platform_admin' ? 'platform_admin' : null))) return fail('forbidden', 403);
  const projectId = params.projectId ? Number(params.projectId) : null;
  if (projectId) {
    const p = await Project.findOne({ where: { id: projectId, business_id: businessId }, attributes: ['id'] });
    if (!p) return fail('invalid project_id', 400);
  }
  if (params.conversationId) {
    const { Conversation } = require('../../models');
    const conv = await Conversation.findOne({ where: { id: params.conversationId, business_id: businessId }, attributes: ['id', 'business_id', 'project_id', 'client_id', 'channel_type'] });
    // 볼 수 있는 방에만 붙인다 — 사적 대화방은 참여자만(2026-10-09 D3).
    if (!conv || !(await require('../../middleware/access_scope').canAccessConversation(userId, conv))) return fail('invalid conversation_id', 400);
  }
  if (params.parentPostId) {
    const parent = await Post.findOne({ where: { id: params.parentPostId, business_id: businessId }, attributes: ['id'] });
    if (!parent) return fail('invalid parent_post_id', 400);
  }
  const status = params.status === 'draft' ? 'draft' : (params.status || 'published');
  const kind = ['doc', 'table', 'brief', 'template', 'survey'].includes(params.kind) ? params.kind : 'doc';
  const { extractText } = postsRoute();
  const post = await Post.create({
    business_id: businessId,
    project_id: projectId,
    conversation_id: params.conversationId || null,
    title: title.slice(0, 200),
    content_json: params.contentJson ? JSON.stringify(params.contentJson) : null,
    content_text: extractText(params.contentJson || null),
    category: params.category || null,
    author_id: userId,
    status,
    is_pinned: !!params.isPinned,
    parent_post_id: params.parentPostId || null,
    kind,
    q_record_id: params.qRecordId || null,
    // 기본 공개 범위 — 화면과 같다: 임시저장 = L1(작성자만) / 프로젝트 = L2 / 그 외 = L3. (routes/posts.js N+72·#252)
    vlevel: status === 'draft' ? 'L1' : (params.vlevel || (projectId ? 'L2' : 'L3')),
  });
  // #252 — 임시저장은 부수효과 없음(타이핑 중이다). 명시 저장(승격 PUT)에서 발화한다.
  if (post.status !== 'draft') {
    if (post.project_id) require('../projectStageEngine').onPostChanged(post.id).catch(() => null);
    audit(actor, 'post.create', post, { category: post.category, status: post.status });
    signalPost(post, 'post:new');
  }
  // 업무 «결과물 액션» 에서 왔으면 그 액션에 건다 — 판정(담당자·같은 워크스페이스)은 taskActionItems.fulfill 한 곳.
  //   실패해도 문서는 이미 만들어졌다 — 조용히 삼키지 않고 warnings 로 화면에 알린다.
  const warnings = [];
  if (params.fromActionId) {
    const r = await require('../taskActionItems').fulfill(
      { userId, platformRole: subj.platformRole, req: actor.req },
      { actionId: params.fromActionId, businessId, entityType: 'post', entityId: post.id, source: 'create' },
    ).catch((e) => { console.warn('[post_actions.fromAction]', e.message); return { ok: false, code: 'error' }; });
    if (!r.ok) warnings.push('action_link_failed');
  }
  return done({ post, warnings });
}

/** 고칠 수 있는 문서를 읽는다 — 워크스페이스 안 · 편집 권한 · 서명 잠금. 실패 code 는 화면 라우트와 같은 말. */
async function loadEditable(actor, subj, postId, businessId) {
  const post = await Post.findOne({ where: { id: postId, business_id: businessId } });
  if (!post) return { fail: fail('not_found', 404) };
  const { canEditPost } = postsRoute();
  if (!(await canEditPost(subj.subjectId, post, subj.platformRole))) return { fail: fail('post_edit_forbidden', 403) };
  const { isPostSignatureLocked } = require('../signatureCore');
  if (await isPostSignatureLocked(post.id)) return { fail: fail('post_locked_by_signature', 409) };
  return { post };
}

/**
 * 본문·제목 고치기. mode='append' 면 기존 본문 뒤에 이어 붙인다(덮어쓰지 않는다).
 * 버전 기록은 사람 저장과 같은 서비스(postRevisions)가 남긴다 — «되돌리기» 가 AI 수정에도 그대로 된다.
 */
async function updatePostContent(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const { post, fail: f } = await loadEditable(actor, subj, Number(params.postId), Number(params.businessId));
  if (f) return f;
  const patch = { editor_id: subj.subjectId };
  if (params.title !== undefined && String(params.title).trim()) patch.title = String(params.title).trim().slice(0, 200);
  if (params.contentJson !== undefined) {
    let doc = params.contentJson;
    if (params.mode === 'append') {
      let cur = post.content_json;
      try { cur = typeof cur === 'string' ? JSON.parse(cur) : cur; } catch { cur = null; }
      const before = cur && Array.isArray(cur.content) ? cur.content : [];
      doc = { type: 'doc', content: [...before, ...((doc && doc.content) || [])] };
    }
    const { extractText } = postsRoute();
    patch.content_json = JSON.stringify(doc);
    patch.content_text = extractText(doc);
  }
  const old = { title: post.title };
  if (post.status !== 'draft') {
    try { await require('../postRevisions').ensureBaselineRevision(post); }
    catch (e) { console.warn('[postRevisions] baseline', e.message); }
  }
  await post.update(patch);
  try {
    await require('../postRevisions').recordRevision({ post, editorUserId: subj.subjectId, source: 'manual' });
  } catch (e) { console.warn('[postRevisions]', e.message); }
  audit(actor, 'post.update', post, { old_title: old.title, mode: params.mode || 'replace' });
  if (post.status !== 'draft') signalPost(post, 'post:updated');
  return done({ post });
}

/** 문서끼리 연결/해제 — 양방향(services/postLinks). 고치는 쪽 문서에 편집 권한이 있어야 한다(화면 PUT 과 같다). */
async function setPostLinks(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const { post, fail: f } = await loadEditable(actor, subj, Number(params.postId), Number(params.businessId));
  if (f) return f;
  const postLinks = require('../postLinks');
  const { canReadPost } = postsRoute();
  const current = await postLinks.effectiveLinkIds(post);
  const add = (params.add || []).map(Number);
  const remove = new Set((params.remove || []).map(Number));
  const requested = [...current.filter((id) => !remove.has(id)), ...add];
  const change = await postLinks.resolveLinkChange({
    post, user: { id: subj.subjectId, platform_role: subj.platformRole }, requested, base: current, canRead: canReadPost, Post,
  });
  await post.update({ linked_post_ids: change.next }, { silent: true });
  const mirrored = await postLinks.mirrorLinkChange(post, change, Post);
  for (const other of mirrored) if (other.status !== 'draft') signalPost(other, 'post:updated');
  if (post.status !== 'draft') signalPost(post, 'post:updated');
  audit(actor, 'post.links', post, { added: change.added.map((x) => x.id), removed: change.removed.map((x) => x.id) });
  return done({ post, added: change.added.map((x) => x.id), removed: change.removed.map((x) => x.id) });
}

/** 문서를 프로젝트에 붙이기(또는 떼기). 공개 범위(vlevel)는 바꾸지 않는다 — 화면 PUT project_id 와 같다. */
async function movePostToProject(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const businessId = Number(params.businessId);
  const { post, fail: f } = await loadEditable(actor, subj, Number(params.postId), businessId);
  if (f) return f;
  let projectId = null;
  if (params.projectId) {
    const p = await Project.findOne({ where: { id: Number(params.projectId), business_id: businessId }, attributes: ['id'] });
    if (!p) return fail('invalid project_id', 400);
    projectId = p.id;
  }
  const oldProjectId = post.project_id || null;
  await post.update({ project_id: projectId, editor_id: subj.subjectId });
  if (post.project_id) require('../projectStageEngine').onPostChanged(post.id).catch(() => null);
  audit(actor, 'post.update', post, { old_project_id: oldProjectId });
  if (post.status !== 'draft') {
    signalPost(post, 'post:updated');
    // 떠난 프로젝트 방에도 알린다 — 그 목록에서 빠져야 한다
    if (oldProjectId && oldProjectId !== projectId) { const io = getIO(); if (io) require('../projectRoom').emitProject(io, oldProjectId, 'post:updated', { id: post.id, business_id: post.business_id, project_id: projectId }); }
  }
  return done({ post, old_project_id: oldProjectId });
}

/** 미리보기(AI 의 확인 2단계 1단계)가 실행과 **같은 판정**을 먼저 본다 — 거절될 요청에 확인 토큰을 내주지 않는다. */
async function checkEditable(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const { post, fail: f } = await loadEditable(actor, subj, Number(params.postId), Number(params.businessId));
  if (f) return f;
  return done({ post });
}

/**
 * 이미 있는 파일을 문서 첨부로 붙인다 — 화면 `POST /api/posts/:id/attachments` 와 같은 판정:
 *   서명 잠금 · 워크스페이스 멤버 · **읽을 수 있는 문서** · **볼 수 있는 파일**만(남의 L1 이 첨부로 퍼지지 않게).
 */
async function attachFiles(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const { PostAttachment, File } = require('../../models');
  const { isPostSignatureLocked } = require('../signatureCore');
  const post = await Post.findOne({ where: { id: Number(params.postId), ...(params.businessId ? { business_id: Number(params.businessId) } : {}) } });
  if (!post) return fail('not_found', 404);
  if (await isPostSignatureLocked(post.id)) return fail('post_locked_by_signature', 409);
  const { assertMemberOrAbove } = require('../../middleware/access_scope');
  if (!(await assertMemberOrAbove(subj.subjectId, post.business_id, subj.platformRole === 'platform_admin' ? 'platform_admin' : null))) return fail('forbidden', 403);
  const { canReadPost } = postsRoute();
  if (!(await canReadPost({ id: subj.subjectId, platform_role: subj.platformRole }, post))) return fail('forbidden', 403);
  const fileIds = (params.fileIds || []).map(Number).filter(Boolean);
  if (!fileIds.length) return fail('file_ids required', 400);
  const files = await File.findAll({ where: { id: fileIds, business_id: post.business_id, deleted_at: null } });
  const { canUserSeeFile } = require('../../middleware/imageViewer');
  for (const f of files) if (!(await canUserSeeFile(subj.subjectId, subj.platformRole, f))) return fail('file_not_found', 404);
  const existing = await PostAttachment.count({ where: { post_id: post.id } });
  const created = [];
  for (let i = 0; i < files.length; i++) {
    const a = await PostAttachment.create({ post_id: post.id, file_id: files[i].id, sort_order: existing + i });
    created.push({ id: a.id, file_id: files[i].id, sort_order: a.sort_order });
  }
  if (created.length) {
    require('../auditService').logAudit(actor.req || null, { userId: subj.subjectId, action: 'post.attachment_add', targetType: 'post', targetId: post.id, businessId: post.business_id, newValue: { file_ids: created.slice(0, 50).map((c) => c.file_id), count: created.length, via: actor.channel?.kind === 'agent' ? `agent:${actor.channel.provider}` : 'user' } });
  }
  signalPost(post, 'post:updated');
  return done({ post, created });
}

/**
 * AI 수정의 대상 — 본문 칸 + (표 문서면) 표 칸. 제안과 반영이 **이 함수 하나**로 칸을 뽑는다(id 가 어긋나지 않게).
 * 표는 문서와 같은 워크스페이스의 것만 — 다른 곳 표를 가리키는 옛 행은 대상에서 뺀다.
 * @returns {{ doc, docBlocks, record, rows, recordBlocks, blocks } | null}  doc 이 형식 밖(HTML 문자열)이면 null
 */
async function aiEditTarget(post) {
  const ai = require('../docAiEdit');
  const doc = ai.parseDoc(post.content_json);
  if (!doc) return null;
  const docBlocks = ai.extractBlocks(doc).map((b) => ({ ...b, src: 'doc' }));
  let record = null; let rows = []; let recordBlocks = [];
  if (post.kind === 'table' && post.q_record_id) {
    const { QRecord, QRecordRow } = require('../../models');
    record = await QRecord.findOne({ where: { id: post.q_record_id, business_id: post.business_id } });
    if (record) {
      rows = await QRecordRow.findAll({ where: { q_record_id: record.id }, order: [['position', 'ASC'], ['id', 'ASC']] });
      recordBlocks = ai.extractRecordBlocks(record, rows, docBlocks.length + 1);
    }
  }
  return { doc, docBlocks, record, rows, recordBlocks, blocks: [...docBlocks, ...recordBlocks] };
}

/**
 * AI 수정 반영 — 사용자가 고른 칸만 바꾼다(설계 docs/DOC_AI_EDIT_DESIGN.md).
 *   ① 제안 뒤 누가 고쳤으면 409 — 본문은 updated_at, 표 칸은 칸 글 대조로 본다
 *   ② 본문이 바뀌면 «반영 전» 을 버전으로 확정하고 반영본은 합치지 않는 새 버전
 *   ③ 되돌리기는 화면이 같은 문을 전/후를 뒤집어 부른다(표 칸은 버전 기록이 없으므로 그 길 하나로 맞춘다)
 * @param params { businessId, postId, baseUpdatedAt, changes:[{id,before,after}], instruction, undo? }
 */
async function applyAiEdit(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const { post, fail: f } = await loadEditable(actor, subj, Number(params.postId), Number(params.businessId));
  if (f) return f;
  const base = new Date(params.baseUpdatedAt || 0).getTime();
  const cur = new Date(post.updated_at || post.updatedAt).getTime();
  if (!Number.isFinite(base) || base !== cur) return fail('stale_edit', 409);
  const ai = require('../docAiEdit');
  const target = await aiEditTarget(post);
  if (!target) return fail('doc_not_structured', 409);
  const docIds = new Set(target.docBlocks.map((b) => b.id));
  const recIds = new Set(target.recordBlocks.map((b) => b.id));
  const changes = params.changes || [];
  if (changes.some((c) => !docIds.has(Number(c.id)) && !recIds.has(Number(c.id)))) return fail('stale_edit', 409);
  let docResult = { applied: 0 }; let recResult = { applied: 0, rowValues: new Map() };
  try {
    const docChanges = changes.filter((c) => docIds.has(Number(c.id)));
    if (docChanges.length) docResult = ai.applyChanges(target.doc, docChanges);
    const recChanges = changes.filter((c) => recIds.has(Number(c.id)));
    if (recChanges.length) recResult = ai.applyRecordChanges(target.recordBlocks, target.rows, recChanges);
  } catch (e) { return fail(e.message === 'stale_block' ? 'stale_edit' : 'invalid_change', 409); }
  const applied = docResult.applied + recResult.applied;
  if (!applied) return fail('no_changes', 400);

  const revs = require('../postRevisions');
  const { PostRevision, QRecordAudit } = require('../../models');
  const { sequelize } = require('../../config/database');
  let beforeRev = null;
  if (docResult.applied) {
    // 반영 전 상태 — 마지막 버전이 이미 같은 내용이면 새로 안 만든다(skipped). 그 버전이 «전» 이다.
    await revs.recordRevision({ post, editorUserId: subj.subjectId, source: 'manual' });
    beforeRev = await PostRevision.findOne({
      where: { post_id: post.id, business_id: post.business_id },
      order: [['revision_number', 'DESC']], attributes: ['id', 'revision_number'],
    });
  }
  const { extractText } = postsRoute();
  await sequelize.transaction(async (transaction) => {
    for (const [rowId, values] of recResult.rowValues) {
      const row = target.rows.find((r) => r.id === rowId);
      await row.update({ values, updated_by: subj.subjectId }, { transaction });
      await QRecordAudit.create({ q_record_id: target.record.id, q_record_row_id: row.id, user_id: subj.subjectId, action: 'row.update' }, { transaction });
    }
    // 본문을 안 고쳐도 updated_at 은 올린다 — 표 칸만 바뀐 반영도 «그 사이 바뀜» 판정(409)에 걸려야 낡은 제안이 덮지 못한다.
    const patch = { editor_id: subj.subjectId };
    if (docResult.applied) { patch.content_json = JSON.stringify(docResult.doc); patch.content_text = extractText(docResult.doc); }
    post.changed('updated_at', true);
    await post.update(patch, { transaction });
  });
  if (docResult.applied) {
    try { await revs.recordRevision({ post, editorUserId: subj.subjectId, source: 'manual', noCoalesce: true }); }
    catch (e) { console.warn('[postRevisions]', e.message); }
  }
  audit(actor, params.undo ? 'post.ai_edit_undo' : 'post.ai_edit', post, {
    instruction: String(params.instruction || '').slice(0, 300), changed_blocks: docResult.applied, changed_cells: recResult.applied,
  });
  if (post.status !== 'draft') signalPost(post, 'post:updated');
  return done({ post, applied, beforeRevisionId: beforeRev ? beforeRev.id : null });
}

// ─────────────────────────────────────────────
// 문서 댓글 (2026-10-15, docs/DOC_COMMENTS_DESIGN.md — Fable 설계)
//   만들기·지우기·알림·감사·실시간이 여기 한 곳이다. 화면 라우트(routes/post_comments.js)가 부르고,
//   뒤에 AI 도구가 생겨도 같은 문을 지난다. 읽기 판정은 문서 본문과 같은 canReadPost 하나.
// ─────────────────────────────────────────────
const COMMENT_MAX = 5000;

function signalComment(post, commentId) {
  const io = getIO();
  if (!io || !post) return;
  // 신호만 — 본문·작성자 없음. 받는 화면은 자기 권한으로 다시 읽는다(고객은 shared 만 받는다).
  const data = { id: post.id, business_id: post.business_id, project_id: post.project_id || null, comment_id: commentId };
  if (post.business_id) io.to(`business:${post.business_id}`).emit('post:comment', data);
  if (post.project_id) require('../projectRoom').emitProject(io, post.project_id, 'post:comment', data);
}

function auditComment(actor, action, post, comment) {
  // 본문은 싣지 않는다 — 누가·어디에·어떤 범위로 만.
  const payload = { comment_id: Number(comment.id), post_id: post.id, visibility: comment.visibility, author_id: comment.user_id };
  require('../auditService').logAudit(actor.req || null, {
    userId: actor.userId,
    action,
    targetType: 'post_comment',
    targetId: Number(comment.id),
    businessId: post.business_id,
    ...(action === 'post.comment_delete' ? { oldValue: payload } : { newValue: payload }),
  });
}

/**
 * 댓글 쓰기 — 문서를 읽을 수 있는 사람(멤버·고객). 고객은 서버가 shared 로 강제.
 * @returns {ok, data: PostComment 인스턴스} | fail
 */
async function createComment(actor, post, { content, visibility } = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const userId = subj.subjectId;
  if (!post) return fail('not_found', 404);
  const text = String(content || '').trim();
  if (!text) return fail('content_required', 400);
  if (text.length > COMMENT_MAX) return fail('content_too_long', 400);

  const user = { id: userId, platform_role: subj.platformRole };
  const { canReadPost } = require('../postAccess');
  // 못 읽으면 없는 것과 같다(존재를 말하지 않는다 — 문서 상세와 같은 응답).
  if (!(await canReadPost(user, post))) return fail('not_found', 404);
  const { viewerOf, canShareWithClients } = require('../postComments');
  const viewer = await viewerOf(user, post);
  if (!viewer.isMember && !viewer.isClient) return fail('not_found', 404);

  let vis = visibility === 'shared' ? 'shared' : 'internal';
  if (!viewer.isMember) vis = 'shared';                                   // 고객은 shared 만
  else if (vis === 'shared' && !(await canShareWithClients(post))) vis = 'internal';  // 볼 고객이 없으면 뜻이 없다

  const { PostComment } = require('../../models');
  const row = await PostComment.create({ post_id: post.id, business_id: post.business_id, user_id: userId, content: text, visibility: vis });

  auditComment(actor, 'post.comment_create', post, row);
  signalComment(post, row.id);
  await notifyComment({ post, comment: row, subjectId: userId, actor }).catch((e) => console.warn('[post comment notify]', e.message));
  return done(row);
}

/** 댓글 지우기 — 작성자 또는 owner/admin, 둘 다 지금 그 문서를 읽을 수 있어야 한다. 하드 삭제. */
async function deleteComment(actor, post, commentId) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const userId = subj.subjectId;
  if (!post) return fail('not_found', 404);
  const user = { id: userId, platform_role: subj.platformRole };
  const { canReadPost } = require('../postAccess');
  if (!(await canReadPost(user, post))) return fail('not_found', 404);
  const { PostComment } = require('../../models');
  const row = await PostComment.findOne({ where: { id: commentId, post_id: post.id, business_id: post.business_id } });
  if (!row) return fail('comment_not_found', 404);
  const { viewerOf, canModerate } = require('../postComments');
  const viewer = await viewerOf(user, post);
  // 고객은 internal 댓글이 «없는 것» 이다 — 지울 수 없다고 말하지 않고 없다고 답한다.
  if (!viewer.isMember && row.visibility !== 'shared') return fail('comment_not_found', 404);
  if (row.user_id !== userId && !canModerate(viewer.scope)) return fail('only_author_can_delete', 403);
  await row.destroy();
  auditComment(actor, 'post.comment_delete', post, row);
  signalComment(post, row.id);
  return done({ deleted: true });
}

async function notifyComment({ post, comment, subjectId, actor }) {
  const { resolveMentions } = require('../mention_parser');
  const { notifyMany } = require('../../routes/notifications');
  const { canReadPost } = require('../postAccess');
  const { getUserScope, isMemberOrAbove } = require('../../middleware/access_scope');
  const { PostComment, Business, User } = require('../../models');

  // 받을 수 있는가 — 지금 그 문서를 읽을 수 있고, internal 댓글이면 멤버 이상만.
  //   못 읽는 사람에게 «문서에 댓글이 달렸다» 가 가면 그 제목 자체가 누수다.
  const cache = new Map();
  const canReceive = async (uid) => {
    if (cache.has(uid)) return cache.get(uid);
    let ok = false;
    try {
      const u = await User.findByPk(uid, { attributes: ['id', 'platform_role'] });
      if (u && await canReadPost({ id: u.id, platform_role: u.platform_role }, post)) {
        if (comment.visibility === 'shared') ok = true;
        else ok = isMemberOrAbove(await getUserScope(u.id, post.business_id, u.platform_role));
      }
    } catch { ok = false; }
    cache.set(uid, ok);
    return ok;
  };

  const mentionedAll = await resolveMentions(comment.content, post.business_id, subjectId);
  const mentioned = [];
  for (const uid of mentionedAll) if (uid !== subjectId && await canReceive(uid)) mentioned.push(uid);
  const mentionedSet = new Set(mentioned);

  const prior = await PostComment.findAll({ where: { post_id: post.id }, attributes: ['user_id'], raw: true });
  const others = new Set([post.author_id, ...prior.map((r) => r.user_id)].filter(Boolean));
  others.delete(subjectId);
  for (const m of mentionedSet) others.delete(m);
  const general = [];
  for (const uid of others) if (await canReceive(uid)) general.push(uid);
  if (!mentioned.length && !general.length) return;

  const biz = await Business.findByPk(post.business_id, { attributes: ['name', 'brand_name'] });
  const wsName = biz?.brand_name || biz?.name || null;
  const text = String(comment.content);
  const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
  const link = `/docs?post=${post.id}&comment=${comment.id}`;
  const common = {
    businessId: post.business_id, body: preview, link, ctaLabel: '댓글 보기', workspaceName: wsName,
    // 사람이 쓴 글 — 밖(푸시 미리보기·재알림 메일)으로는 앞부분만. 메일은 보내지 않는다(앱 안 협업).
    previewPolicy: 'excerpt', skipChannels: ['email'], suppressEscalation: true,
    actorUserId: actor.userId, entityType: 'post', entityId: post.id, ioApp: getIO(),
  };
  if (mentioned.length) {
    notifyMany({ ...common, userIds: mentioned, eventKind: 'comment_mention', titleSpec: { feature: 'docs', action: 'doc_comment_mention', subject: `"${post.title}"` } })
      .catch((e) => console.warn('[notify doc comment_mention]', e.message));
  }
  if (general.length) {
    const author = await User.findByPk(subjectId, { attributes: ['id', 'name'] });
    const { getMemberDisplayName } = require('../displayName');
    const authorName = await getMemberDisplayName(post.business_id, subjectId, author?.name || null).catch(() => author?.name || null);
    const nm = (typeof authorName === 'string' ? authorName : authorName?.name) || author?.name || '';
    notifyMany({ ...common, userIds: general, eventKind: 'doc_comment', titleSpec: { feature: 'docs', action: 'doc_comment', subject: `${nm} · "${post.title}"` } })
      .catch((e) => console.warn('[notify doc_comment]', e.message));
  }
}

module.exports = { createComment, deleteComment, applyAiEdit, aiEditTarget, createPost, updatePostContent, setPostLinks, movePostToProject, checkEditable, attachFiles };
