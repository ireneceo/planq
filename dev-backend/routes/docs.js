// Q docs — 문서/템플릿 통합 시스템 라우트
// 설계: docs/DOCS_TEMPLATE_SYSTEM_DESIGN.md
//
// 권한:
//   템플릿 — 워크스페이스 멤버 R, owner/admin W (시스템 템플릿은 platform_admin 만 W)
//   문서   — 워크스페이스 멤버 R/W (자기 client_id 만 R 인 client 케이스 추후)
//   공개   — share_token 기반 (인증 없음)

const express = require('express');
const crypto = require('crypto');
const { Op } = require('sequelize');
const router = express.Router();
const {
  DocumentTemplate, Document, DocumentRevision, DocumentShare,
  Business, BusinessMember, Client, Project, User, Quote, Invoice,
} = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const cue = require('../services/cue_orchestrator');

async function assertBusinessAccess(userId, businessId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  const m = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  return !!m;
}

function isOwnerOrAdmin(member) {
  return member && (member.role === 'owner' || member.role === 'admin');
}

const KIND_VALUES = ['quote', 'invoice', 'tax_invoice', 'contract', 'nda',
                     'proposal', 'sow', 'meeting_note', 'sop', 'custom'];

// {{path.to.value}} 치환 — 단순 mustache-like.
// values 객체에서 path 따라 lookup. 미발견 placeholder 는 빈 문자열로 치환 (사용자가 직접 채울 수 있도록).
function renderTemplate(text, values) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const parts = path.split('.');
    let cur = values;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else return '';
    }
    return cur == null ? '' : String(cur);
  });
}

// createDocument 시 사용할 컨텍스트 빌드 — business + client + 기본 날짜
async function buildTemplateContext(businessId, clientId, title) {
  const ctx = {
    title: title || '',
    issued_at: new Date().toISOString().slice(0, 10),
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    effective_date: new Date().toISOString().slice(0, 10),
    duration_months: 24,
    business: {}, client: {}, party_a: {}, party_b: {}, session: {},
  };
  if (businessId) {
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'name', 'brand_name', 'address', 'phone'] });
    if (biz) {
      const j = biz.toJSON();
      ctx.business = { ...j, name: j.brand_name || j.name || '' };
      ctx.party_a = { name: ctx.business.name };
    }
  }
  if (clientId) {
    const cli = await Client.findByPk(clientId, { attributes: ['id', 'display_name', 'company_name', 'invite_email'] });
    if (cli) {
      const j = cli.toJSON();
      ctx.client = { ...j, name: j.display_name || j.company_name || '', email: j.invite_email || '' };
      ctx.party_b = { name: ctx.client.name };
    }
  }
  return ctx;
}

// ============================================
// Templates
// ============================================

// GET /api/docs/templates?business_id=&kind=
// 시스템 템플릿(business_id=NULL) + 워크스페이스 템플릿 합쳐서 반환
router.get('/templates', authenticateToken, async (req, res, next) => {
  try {
    const businessId = parseInt(req.query.business_id, 10);
    if (Number.isFinite(businessId)) {
      if (!(await assertBusinessAccess(req.user.id, businessId, req.user.platform_role))) {
        return errorResponse(res, 'forbidden', 403);
      }
    }
    const where = { is_active: true };
    if (req.query.kind && KIND_VALUES.includes(req.query.kind)) where.kind = req.query.kind;
    // 시스템 + 해당 워크스페이스 만
    where[Op.or] = [
      { is_system: true },
      ...(Number.isFinite(businessId) ? [{ business_id: businessId }] : []),
    ];
    const list = await DocumentTemplate.findAll({
      where,
      order: [['is_system', 'DESC'], ['usage_count', 'DESC'], ['name', 'ASC']],
    });
    return successResponse(res, list.map(t => t.toJSON()));
  } catch (e) { next(e); }
});

// POST /api/docs/templates  — 워크스페이스 템플릿 생성 (owner/admin)
router.post('/templates', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, kind, name, description, mode, schema_json, body_template,
            variables_json, ai_prompt_template, visibility, locale } = req.body;
    if (!business_id || !kind || !name) return errorResponse(res, 'invalid_payload', 400);
    if (!KIND_VALUES.includes(kind)) return errorResponse(res, 'invalid_kind', 400);
    if (!(await assertBusinessAccess(req.user.id, business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // 사용자 본인 템플릿 저장 — 워크스페이스 멤버 누구나 가능 (visibility 로 제어)
    const tpl = await DocumentTemplate.create({
      business_id, kind, name, description: description || null,
      mode: mode || 'form', schema_json: schema_json || null,
      body_template: body_template || null, variables_json: variables_json || null,
      ai_prompt_template: ai_prompt_template || null,
      visibility: visibility || 'workspace_only', locale: locale || 'ko',
      is_system: false, created_by: req.user.id,
    });
    return successResponse(res, tpl.toJSON(), 201);
  } catch (e) { next(e); }
});

// GET /api/docs/templates/:id
router.get('/templates/:id', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await DocumentTemplate.findByPk(req.params.id);
    if (!tpl) return errorResponse(res, 'not_found', 404);
    if (!tpl.is_system && tpl.business_id) {
      if (!(await assertBusinessAccess(req.user.id, tpl.business_id, req.user.platform_role))) {
        return errorResponse(res, 'forbidden', 403);
      }
    }
    return successResponse(res, tpl.toJSON());
  } catch (e) { next(e); }
});

// PUT /api/docs/templates/:id (owner/admin only, system 은 platform_admin)
router.put('/templates/:id', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await DocumentTemplate.findByPk(req.params.id);
    if (!tpl) return errorResponse(res, 'not_found', 404);
    if (tpl.is_system) {
      if (req.user.platform_role !== 'platform_admin') return errorResponse(res, 'forbidden', 403);
    } else {
      if (!(await assertBusinessAccess(req.user.id, tpl.business_id, req.user.platform_role))) {
        return errorResponse(res, 'forbidden', 403);
      }
      const m = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: tpl.business_id } });
      if (!isOwnerOrAdmin(m) && req.user.platform_role !== 'platform_admin') {
        return errorResponse(res, 'forbidden_role', 403);
      }
    }
    const allowed = ['name', 'description', 'mode', 'schema_json', 'body_template',
                     'variables_json', 'ai_prompt_template', 'visibility', 'locale', 'is_active'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    await tpl.update(updates);
    return successResponse(res, tpl.toJSON());
  } catch (e) { next(e); }
});

// DELETE /api/docs/templates/:id  → soft (is_active=false)
router.delete('/templates/:id', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await DocumentTemplate.findByPk(req.params.id);
    if (!tpl) return errorResponse(res, 'not_found', 404);
    if (tpl.is_system) return errorResponse(res, 'cannot_delete_system', 400);
    if (!(await assertBusinessAccess(req.user.id, tpl.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // 사용자 본인이 만든 템플릿이거나 owner/admin 만 삭제 가능
    const m = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: tpl.business_id } });
    const isCreator = tpl.created_by === req.user.id;
    if (!isCreator && !isOwnerOrAdmin(m) && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'forbidden_role', 403);
    }
    await tpl.update({ is_active: false });
    return successResponse(res, { id: tpl.id, archived: true });
  } catch (e) { next(e); }
});

// ============================================
// Documents
// ============================================

// GET /api/docs/documents?business_id=&kind=&status=&client_id=&project_id=&q=&limit=&offset=
router.get('/documents', authenticateToken, async (req, res, next) => {
  try {
    const businessId = parseInt(req.query.business_id, 10);
    if (!Number.isFinite(businessId)) return errorResponse(res, 'business_id_required', 400);
    if (!(await assertBusinessAccess(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const where = { business_id: businessId, archived_at: null };
    if (req.query.kind && KIND_VALUES.includes(req.query.kind)) where.kind = req.query.kind;
    if (req.query.status) where.status = req.query.status;
    if (req.query.client_id) where.client_id = parseInt(req.query.client_id, 10);
    if (req.query.project_id) where.project_id = parseInt(req.query.project_id, 10);
    if (req.query.q) where.title = { [Op.like]: `%${req.query.q}%` };
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const list = await Document.findAll({
      where,
      include: [
        { model: Client, attributes: ['id', 'display_name', 'company_name'] },
        { model: Project, attributes: ['id', 'name'] },
        { model: User, as: 'creator', attributes: ['id', 'name'] },
      ],
      order: [['updated_at', 'DESC']],
      limit, offset,
    });
    const total = await Document.count({ where });
    return successResponse(res, list.map(d => d.toJSON()));
    // pagination 정보 추후 successResponse에 옵셔널로
    void total;
  } catch (e) { next(e); }
});

// POST /api/docs/documents — 신규 문서 생성 (template/empty/ai)
router.post('/documents', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, template_id, kind, title, client_id, project_id,
            form_data, body_json } = req.body;
    if (!business_id || !kind || !title) return errorResponse(res, 'invalid_payload', 400);
    if (!KIND_VALUES.includes(kind)) return errorResponse(res, 'invalid_kind', 400);
    if (!(await assertBusinessAccess(req.user.id, business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // 템플릿 기반 생성 시 — body_template (HTML) 을 placeholder 치환 후 body_html 에 저장.
    // 사용자가 명시적으로 body_json 을 넘기면 그 값 우선.
    let initialBodyHtml = null;
    if (template_id) {
      const tpl = await DocumentTemplate.findByPk(template_id);
      if (tpl?.body_template) {
        const ctx = await buildTemplateContext(business_id, client_id, title);
        initialBodyHtml = renderTemplate(tpl.body_template, ctx);
      }
    }
    const doc = await Document.create({
      business_id, template_id: template_id || null, kind, title,
      client_id: client_id || null, project_id: project_id || null,
      form_data: form_data || null,
      body_json: body_json || null,
      body_html: body_json ? null : initialBodyHtml,
      created_by: req.user.id,
    });
    if (template_id) {
      DocumentTemplate.increment('usage_count', { where: { id: template_id } }).catch(() => {});
    }
    return successResponse(res, doc.toJSON(), 201);
  } catch (e) { next(e); }
});

// POST /api/docs/ai-generate
// AI 자동 문서 초안 생성 — Cue gpt-4o-mini 사용.
// body: { business_id, kind, title, user_input, client_id?, template_id? }
// 응답: { body_html, usage } / 한도 초과 시 429
router.post('/ai-generate', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, kind, title, user_input, client_id, template_id } = req.body;
    if (!business_id || !kind || !title) return errorResponse(res, 'invalid_payload', 400);
    if (!KIND_VALUES.includes(kind)) return errorResponse(res, 'invalid_kind', 400);
    if (!(await assertBusinessAccess(req.user.id, business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    const ctx = await buildTemplateContext(business_id, client_id, title);
    let aiPromptTpl = '';
    if (template_id) {
      const tpl = await DocumentTemplate.findByPk(template_id, { attributes: ['ai_prompt_template'] });
      aiPromptTpl = tpl?.ai_prompt_template || '';
    }

    const systemPrompt = `당신은 한국어 비즈니스 문서 작성 전문가입니다. 다음 원칙을 지키세요.
- 출력은 의미적인 HTML (h1/h2/p/ul/li/table) 만 사용. CSS 인라인 스타일 최소화.
- 톤: 정중하고 명료. 핵심을 먼저 (TLDR 첫 줄).
- 길이: 5~8개 섹션, 각 섹션 2~5문장.
- 클라이언트 이름·워크스페이스 이름·날짜는 컨텍스트의 실제 값을 사용.
- 사용자 추가 요구사항을 우선 반영하되, 비즈니스 일반 관행도 유지.`;

    const ctxLines = [];
    ctxLines.push(`문서 종류: ${kind}`);
    ctxLines.push(`문서 제목: ${title}`);
    if (ctx.business?.name) ctxLines.push(`작성 워크스페이스: ${ctx.business.name}`);
    if (ctx.client?.name) ctxLines.push(`수신 고객: ${ctx.client.name}`);
    ctxLines.push(`발행일: ${ctx.issued_at}`);
    if (kind === 'quote' || kind === 'proposal') ctxLines.push(`유효일: ${ctx.valid_until}`);
    const userPrompt = `${ctxLines.join('\n')}\n\n사용자 추가 요구사항:\n${user_input || '(없음 — 표준 양식으로 작성)'}` +
      (aiPromptTpl ? `\n\n참고 가이드:\n${aiPromptTpl}` : '');

    const r = await cue.generateDocumentDraft(business_id, { systemPrompt, userPrompt, maxTokens: 2500 });
    if (r.error === 'usage_limit_exceeded') {
      return res.status(429).json({ success: false, message: 'cue_limit_exceeded', usage: r.usage });
    }
    if (r.error === 'llm_unavailable') {
      return errorResponse(res, 'llm_unavailable', 503);
    }
    return successResponse(res, {
      body_html: r.content,
      usage: r.usage,
    });
  } catch (e) { next(e); }
});

// GET /api/docs/documents/:id
router.get('/documents/:id', authenticateToken, async (req, res, next) => {
  try {
    const doc = await Document.findByPk(req.params.id, {
      include: [
        { model: Client, attributes: ['id', 'display_name', 'company_name'] },
        { model: Project, attributes: ['id', 'name'] },
        { model: User, as: 'creator', attributes: ['id', 'name'] },
        { model: DocumentTemplate, attributes: ['id', 'name', 'mode', 'schema_json', 'body_template'] },
      ],
    });
    if (!doc) return errorResponse(res, 'not_found', 404);
    if (!(await assertBusinessAccess(req.user.id, doc.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    return successResponse(res, doc.toJSON());
  } catch (e) { next(e); }
});

// PUT /api/docs/documents/:id — 폼/본문 업데이트 + revision 기록
router.put('/documents/:id', authenticateToken, async (req, res, next) => {
  try {
    const doc = await Document.findByPk(req.params.id);
    if (!doc) return errorResponse(res, 'not_found', 404);
    if (!(await assertBusinessAccess(req.user.id, doc.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const allowed = ['title', 'status', 'form_data', 'body_json', 'body_html',
                     'client_id', 'project_id', 'pdf_url'];
    const updates = {};
    const changes = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined && JSON.stringify(req.body[k]) !== JSON.stringify(doc[k])) {
        updates[k] = req.body[k];
        changes[k] = { from: doc[k], to: req.body[k] };
      }
    }
    if (Object.keys(updates).length === 0) return successResponse(res, doc.toJSON());
    updates.updated_by = req.user.id;
    // 변경 전 스냅샷 저장 (form_data + body_json)
    const lastRev = await DocumentRevision.findOne({ where: { document_id: doc.id }, order: [['revision_number', 'DESC']] });
    await DocumentRevision.create({
      document_id: doc.id,
      revision_number: (lastRev?.revision_number || 0) + 1,
      body_snapshot: { form_data: doc.form_data, body_json: doc.body_json },
      changed_fields: changes,
      changed_by: req.user.id,
    });
    await doc.update(updates);
    return successResponse(res, doc.toJSON());
  } catch (e) { next(e); }
});

// DELETE /api/docs/documents/:id  → archive
router.delete('/documents/:id', authenticateToken, async (req, res, next) => {
  try {
    const doc = await Document.findByPk(req.params.id);
    if (!doc) return errorResponse(res, 'not_found', 404);
    if (!(await assertBusinessAccess(req.user.id, doc.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    await doc.update({ archived_at: new Date(), status: 'archived' });
    return successResponse(res, { id: doc.id, archived: true });
  } catch (e) { next(e); }
});

// POST /api/docs/documents/:id/share  — share_token 발급 + 발송 로그
router.post('/documents/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const { method, recipient_email, recipient_name, expires_in_days } = req.body;
    const doc = await Document.findByPk(req.params.id);
    if (!doc) return errorResponse(res, 'not_found', 404);
    if (!(await assertBusinessAccess(req.user.id, doc.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const token = crypto.randomBytes(32).toString('hex');
    if (!doc.share_token) {
      await doc.update({ share_token: token, shared_at: new Date(), status: 'sent' });
    }
    const expiresAt = expires_in_days
      ? new Date(Date.now() + Number(expires_in_days) * 86400 * 1000)
      : null;
    const share = await DocumentShare.create({
      document_id: doc.id,
      share_method: method || 'link',
      recipient_email: recipient_email || null,
      recipient_name: recipient_name || null,
      share_token: doc.share_token || token,
      expires_at: expiresAt,
      shared_by: req.user.id,
    });
    return successResponse(res, { share: share.toJSON(), share_url: `/public/docs/${doc.share_token || token}` });
  } catch (e) { next(e); }
});

// GET /api/docs/documents/:id/revisions
router.get('/documents/:id/revisions', authenticateToken, async (req, res, next) => {
  try {
    const doc = await Document.findByPk(req.params.id, { attributes: ['id', 'business_id'] });
    if (!doc) return errorResponse(res, 'not_found', 404);
    if (!(await assertBusinessAccess(req.user.id, doc.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const list = await DocumentRevision.findAll({
      where: { document_id: doc.id },
      include: [{ model: User, as: 'changer', attributes: ['id', 'name'] }],
      order: [['revision_number', 'DESC']],
      limit: 100,
    });
    return successResponse(res, list.map(r => r.toJSON()));
  } catch (e) { next(e); }
});

// ============================================
// AI 생성 (D-3 본 구현 시 OpenAI/Claude 연결)
// 지금은 stub — 향후 Cue 통합
// ============================================
router.post('/ai/generate', authenticateToken, async (req, res) => {
  return errorResponse(res, 'ai_generation_pending_d3', 501);
});

// ============================================
// Public — share_token 기반 (인증 없음)
// ============================================
router.get('/public/:token', async (req, res, next) => {
  try {
    const doc = await Document.findOne({
      where: { share_token: req.params.token, archived_at: null },
      include: [{ model: DocumentTemplate, attributes: ['id', 'name', 'mode', 'schema_json'] }],
    });
    if (!doc) return errorResponse(res, 'not_found', 404);
    if (!doc.viewed_at) await doc.update({ viewed_at: new Date(), status: 'viewed' });
    const safe = doc.toJSON();
    delete safe.created_by;
    delete safe.updated_by;
    return successResponse(res, safe);
  } catch (e) { next(e); }
});

// ============================================
// Public sign — 고객이 동의·서명 (인증 없음, share_token 기반)
// body: { signer_name, signer_email, accept: true|false, note?, signature_image_b64? }
// 정책: 한 문서당 1회 서명 (재서명 차단). signed_at 이미 있으면 409.
// ============================================
router.post('/public/:token/sign', async (req, res, next) => {
  try {
    const { signer_name, signer_email, accept, note, signature_image_b64 } = req.body;
    if (!signer_name || typeof accept !== 'boolean') {
      return errorResponse(res, 'invalid_payload', 400);
    }
    const doc = await Document.findOne({
      where: { share_token: req.params.token, archived_at: null },
    });
    if (!doc) return errorResponse(res, 'not_found', 404);
    if (doc.signed_at) return errorResponse(res, 'already_signed', 409);

    const sig = {
      signer_name: String(signer_name).trim().slice(0, 100),
      signer_email: signer_email ? String(signer_email).trim().slice(0, 200) : null,
      accept: !!accept,
      note: note ? String(note).trim().slice(0, 500) : null,
      signature_image: signature_image_b64 ? String(signature_image_b64).slice(0, 200000) : null,
      signed_ip: req.ip || req.headers['x-forwarded-for'] || null,
      signed_at: new Date().toISOString(),
    };
    const newStatus = accept ? 'signed' : 'rejected';
    await doc.update({
      signed_at: new Date(),
      signature_data: sig,
      status: newStatus,
    });

    // Revision 기록 (감사 로그)
    try {
      await DocumentRevision.create({
        document_id: doc.id,
        revision_number: 1,
        author_user_id: null,
        change_summary: `[public sign] ${sig.signer_name} → ${newStatus}`,
        body_html_snapshot: null,
        form_data_snapshot: null,
        body_json_snapshot: null,
      });
    } catch { /* revision 실패해도 서명 성공 */ }

    return successResponse(res, { status: newStatus, signed_at: sig.signed_at });
  } catch (e) { next(e); }
});

module.exports = router;
