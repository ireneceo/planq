// services/actions/kb_actions.js — Q info(kb_documents) **만들기**의 행동 계층 (2026-10-07, Fable B 판정 3)
//
// 왜 생겼나: AI 에이전트가 Q info 항목을 만들 수 있어야 한다(create_knowledge_item). 생성 규칙은
//   `routes/kb.js POST /businesses/:businessId/kb/documents` 안에만 있었다. AI 도구가 모델을 직접 쓰면 원본 읽기 검사·
//   비밀 칸 색인 제외·임베딩·태그 추출(cue_usage)·감사·실시간이 한쪽에서 빠진다 → 화면과 AI 가 **같은 함수**를 부른다.
//
// 규칙은 옛 라우트 본문 그대로 옮겼다(동작 무변경). 고객(client) 차단은 라우트·도구 각자가 먼저 본다(라우트는 req.businessRole).
const fs = require('fs');
const path = require('path');
const { KbDocument, File: FileModel, Post } = require('../../models');
const { resolveSubject, fail, done } = require('./_subject');
const {
  sanitizeCategories, pickLegacyCategoryEnum, synthesizeBodyFromColumns, upsertKbCategories, resolveVisibility,
} = require('../kbFields');

function getIO() { return global.__planqIo || null; }

// 실시간 — 신호만(id·소속). 행 전체를 뿌리면 «나만 보기» 본문이 멤버 전원·프로젝트 고객에게 간다(2026-09-27 점검).
function signalKb(doc, event) {
  const io = getIO();
  if (!io || !doc) return;
  const data = { id: doc.id, business_id: doc.business_id, project_id: doc.project_id || null };
  if (doc.business_id) io.to(`business:${doc.business_id}`).emit(event, data);
  if (doc.project_id) io.to(`project:${doc.project_id}`).emit(event, data);
}

const TEXT_EXT = ['.txt', '.md', '.markdown', '.html', '.htm', '.json', '.csv', '.log'];
const stripHtml = (h) => String(h).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Q info 항목 만들기 — 옛 `POST /api/businesses/:businessId/kb/documents` 본문.
 * @param actor  { kind, userId, platformRole?, req?, channel? }
 * @param params { businessId, input }  input = 화면 요청 본문과 같은 snake_case 칸
 *   (title, body, source_type, category, categories, scope, project_id, client_id, attached_file_ids, attached_post_ids,
 *    custom_columns, custom_values, read_policy, client_ids, vlevel, target_member_ids)
 * @returns {ok:true, data: KbDocument} | {ok:false, code, http}
 */
async function createDocument(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const userId = subj.subjectId;
  const user = { id: userId, platform_role: subj.platformRole || null };
  const businessId = Number(params.businessId);
  const input = params.input || {};
  const {
    title, body, source_type, category, categories, scope, project_id, client_id,
    attached_file_ids, attached_post_ids, custom_columns, custom_values, read_policy, client_ids,
  } = input;
  if (!businessId) return fail('business_id required', 400);
  if (!title) return fail('title required', 400);

  // 원본 읽기 권한 — 첨부·본문 복사는 원본을 읽을 수 있는 사람만(2026-09-27 점검)
  const fileIds = Array.isArray(attached_file_ids) ? attached_file_ids.map(Number).filter(Boolean) : [];
  const postIds = Array.isArray(attached_post_ids) ? attached_post_ids.map(Number).filter(Boolean) : [];
  const { canUserSeeFile } = require('../../middleware/imageViewer');
  const { canReadPost } = require('../postAccess');
  for (const f of (fileIds.length ? await FileModel.findAll({ where: { id: fileIds, business_id: businessId } }) : [])) {
    if (!(await canUserSeeFile(user.id, user.platform_role, f))) return fail('file_not_found', 404);
  }
  for (const p of (postIds.length ? await Post.findAll({ where: { id: postIds, business_id: businessId } }) : [])) {
    if (!(await canReadPost(user, p))) return fail('post_not_found', 404);
  }
  // 본문 · 첨부 · 항목(custom_values) 중 하나는 있어야 한다(#332 — 항목 위주 자료가 Q info 의 핵심 용도)
  const hasCustomValues = custom_values && typeof custom_values === 'object'
    && Object.values(custom_values).some((v) => v != null && String(v).trim() !== '');
  if (!body && fileIds.length === 0 && postIds.length === 0 && !hasCustomValues) return fail('body_or_attachments_required', 400);

  // 자유 카테고리(40자 cap) — categories 우선, 옛 category ENUM 은 호환
  const sanitized = sanitizeCategories(categories) ?? (category ? [String(category).trim().slice(0, 40)] : ['manual']);
  const finalCategories = sanitized.length > 0 ? sanitized : ['manual'];
  const finalCategory = pickLegacyCategoryEnum(finalCategories);

  // vlevel 우선, 없으면 legacy scope
  const v = resolveVisibility(input);
  const allowedScopes = ['private', 'workspace', 'project', 'client'];
  let finalScope; let finalProjectId; let finalClientId; let finalReadPolicy; let finalClientIds; let finalVlevel; let finalTargetMembers;
  if (v) {
    finalScope = v.scope; finalProjectId = v.project_id; finalClientId = v.client_id;
    finalReadPolicy = v.read_policy; finalClientIds = v.client_ids;
    finalVlevel = v.vlevel; finalTargetMembers = v.target_member_ids;
  } else {
    finalScope = allowedScopes.includes(scope) ? scope : ((project_id ? 'project' : (client_id ? 'client' : 'private')));
    finalProjectId = null; finalClientId = null;
    finalReadPolicy = ['all', 'owner'].includes(read_policy) ? read_policy : 'all';
    finalClientIds = Array.isArray(client_ids) ? client_ids.map(Number).filter(Boolean) : null;
    finalVlevel = null;   // hook 가 채움
    finalTargetMembers = null;
    if (finalScope === 'project') {
      finalProjectId = parseInt(project_id, 10) || null;
      if (!finalProjectId) return fail('project_id_required_for_project_scope', 400);
    }
    if (finalScope === 'client') {
      finalClientId = parseInt(client_id, 10) || null;
      if (!finalClientId) return fail('client_id_required_for_client_scope', 400);
    }
  }
  if (finalVlevel === 'L2' && finalScope === 'project' && !finalProjectId) return fail('project_id_required_for_L2_project', 400);
  if (finalVlevel === 'L4' && !finalClientId) return fail('client_id_required_for_L4', 400);

  // 첨부 텍스트 합치기(txt/md/html/json/csv) + 문서 본문
  let mergedBody = String(body || '');
  if (fileIds.length > 0) {
    const files = await FileModel.findAll({ where: { id: fileIds, business_id: businessId } });
    for (const f of files) {
      const ext = path.extname(f.file_name || '').toLowerCase();
      if (!TEXT_EXT.includes(ext)) continue;
      if (f.storage_provider !== 'planq') continue;
      try {
        const absPath = path.isAbsolute(f.file_path) ? f.file_path : path.join(__dirname, '..', '..', f.file_path);
        let text = await fs.promises.readFile(absPath, 'utf8');
        if (ext === '.html' || ext === '.htm') text = stripHtml(text);
        if (text.trim()) mergedBody += `\n\n--- ${f.file_name} ---\n${text}`;
      } catch (e) { console.error('[kb] file read for merge failed', e.message); }
    }
  }
  if (postIds.length > 0) {
    const posts = await Post.findAll({ where: { id: postIds, business_id: businessId } });
    for (const p of posts) {
      let text = p.body_text || '';
      if (!text && p.body_html) text = stripHtml(p.body_html);
      if (text.trim()) mergedBody += `\n\n--- ${p.title} ---\n${text}`;
    }
  }
  // 항목만 있는 정보 — 색인 본문을 항목에서 합성(secret 값은 넣지 않는다 — 임베딩·번역 API 로 나간다)
  if (!mergedBody.trim() && custom_values && typeof custom_values === 'object') {
    mergedBody = synthesizeBodyFromColumns(title, custom_columns, custom_values) || mergedBody;
  }
  if (!mergedBody.trim()) return fail('no_indexable_content', 400);

  const doc = await KbDocument.create({
    business_id: businessId,
    title: String(title).slice(0, 300),
    body: mergedBody,
    source_type: ['manual', 'faq', 'policy', 'pricing', 'other', 'file', 'post'].includes(source_type) ? source_type : 'manual',
    category: finalCategory,
    categories: finalCategories,
    scope: finalScope,
    project_id: finalProjectId,
    client_id: finalClientId,
    attached_file_ids: fileIds.length > 0 ? fileIds : null,
    attached_post_ids: postIds.length > 0 ? postIds : null,
    custom_columns: Array.isArray(custom_columns) ? custom_columns : null,
    custom_values: (custom_values && typeof custom_values === 'object') ? custom_values : null,
    read_policy: finalReadPolicy,
    client_ids: finalClientIds,
    vlevel: finalVlevel,
    target_member_ids: finalTargetMembers,
    uploaded_by: userId,
    status: 'pending',
  });
  upsertKbCategories(businessId, finalCategories).catch(() => {});

  // 비동기 인덱싱(임베딩) + LLM 태그 추출 — 사용량(cue_usage)은 kb_service 가 기록한다
  const kbService = require('../kb_service');
  kbService.indexDocument(doc.id).catch((e) => console.error('[kb] indexing failed', e.message));
  kbService.extractTags(doc.id).catch((e) => console.error('[kb] tag extraction failed', e.message));

  require('../auditService').createAuditLog({
    userId,
    businessId,
    action: 'kb.document_create',
    targetType: 'KbDocument',
    targetId: doc.id,
    newValue: {
      title: doc.title, size: mergedBody.length, files: fileIds.length, posts: postIds.length,
      via: actor.channel?.kind === 'agent' ? `agent:${actor.channel.provider}` : (actor.kind === 'cue' ? 'cue' : 'user'),
    },
  });
  signalKb(doc, 'kb:new');
  return done(doc);
}

module.exports = { createDocument };
