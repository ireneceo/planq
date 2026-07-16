// 문서(Q docs) 행동 계층 — 사람도 Cue 도 **같은 문**을 지난다.
//
// 왜 있는가:
//   문서 생성이 routes/docs.js 에 인라인이었고, 메뉴 권한(qdocs)을 전혀 안 봤다 (none 인 멤버도 문서 생성).
//   #81 Cue 대화형 실행이 초안(견적·계약·회의록)을 만들려면 이 문이 있어야 한다.
//   재무(청구서·결제)는 이 카탈로그에 없다 — Cue 는 문서 초안까지만, 돈은 영구 봉쇄.
//
// 계약 (task_actions.js 와 동일):
//   actor  = { kind:'user'|'cue', userId, onBehalfOfUserId?, platformRole?, req? }
//   params = camelCase 필드 (라우트가 snake_case body 를 파싱해서 넘긴다)
//   반환   = { ok:true, data:{ document } } | { ok:false, code, http }

const {
  Document, DocumentTemplate, Business, Client, Project, ProjectClient,
} = require('../../models');
const { resolveSubject, assertMenuWrite, fail, done } = require('./_subject');
const { assertMemberOrAbove } = require('../../middleware/access_scope');

const KIND_VALUES = ['quote', 'invoice', 'tax_invoice', 'contract', 'nda',
                     'proposal', 'sow', 'meeting_note', 'sop', 'custom'];

// {{path.to.value}} 치환 — 단순 mustache-like.
// 미발견 placeholder 는 빈 문자열로 치환 (사용자가 직접 채울 수 있도록).
function renderTemplate(text, values) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
    const parts = p.split('.');
    let cur = values;
    for (const part of parts) {
      if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
      else return '';
    }
    return cur == null ? '' : String(cur);
  });
}

// createDocument 시 사용할 컨텍스트 빌드 — business + client + project + 기본 날짜.
//   projectId 가 주어지면 ctx.project 추가, project 의 primary client 가 있고 clientId 비어있으면 자동 fallback.
async function buildTemplateContext(businessId, clientId, title, projectId) {
  const ctx = {
    title: title || '',
    issued_at: new Date().toISOString().slice(0, 10),
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    effective_date: new Date().toISOString().slice(0, 10),
    duration_months: 24,
    business: {}, client: {}, project: {}, party_a: {}, party_b: {}, session: {},
  };
  if (businessId) {
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'name', 'brand_name', 'address', 'phone'] });
    if (biz) {
      const j = biz.toJSON();
      ctx.business = { ...j, name: j.brand_name || j.name || '' };
      ctx.party_a = { name: ctx.business.name };
    }
  }
  let resolvedClientId = clientId;
  if (projectId) {
    const proj = await Project.findByPk(projectId, {
      attributes: ['id', 'business_id', 'name', 'description', 'client_company', 'start_date', 'end_date', 'status'],
    });
    if (proj && proj.business_id === businessId) {
      ctx.project = proj.toJSON();
      if (!resolvedClientId) {
        const pc = await ProjectClient.findOne({ where: { project_id: projectId }, order: [['id', 'ASC']] });
        if (pc?.client_id) resolvedClientId = pc.client_id;
      }
    }
    // 워크스페이스 불일치는 무시
  }
  if (resolvedClientId) {
    const cli = await Client.findByPk(resolvedClientId, { attributes: ['id', 'display_name', 'company_name', 'invite_email', 'biz_name', 'biz_tax_id', 'biz_ceo', 'biz_address', 'tax_invoice_email', 'billing_contact_email'] });
    if (cli) {
      const j = cli.toJSON();
      ctx.client = {
        ...j,
        name: j.display_name || j.company_name || '',
        email: j.tax_invoice_email || j.billing_contact_email || j.invite_email || '',
      };
      ctx.party_b = { name: ctx.client.name };
    }
  }
  return ctx;
}

/** 새 문서를 만든다 (template/empty). 사람도 Cue 도 이 문을 지난다.
 *
 * @param actor   { kind, userId, onBehalfOfUserId?, platformRole?, req? }
 * @param params  { businessId, templateId?, kind, title, clientId?, projectId?, formData?, bodyJson? }
 */
async function createDocument(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const subjectId = subj.subjectId;

  const businessId = Number(params.businessId);
  const kind = params.kind;
  const title = params.title;
  if (!businessId || !kind || !title) return fail('invalid_payload');
  if (!KIND_VALUES.includes(kind)) return fail('invalid_kind');

  // 워크스페이스 접근권 — 멤버 이상 (문서 생성은 고객 불가)
  if (!(await assertMemberOrAbove(subjectId, businessId, subj.platformRole))) {
    return fail('forbidden', 403);
  }

  // 메뉴 권한 (신설 봉합) — 여태 라우트가 qdocs 쓰기 권한을 안 봤다 (none 인 멤버도 문서 생성).
  const menu = await assertMenuWrite(subjectId, businessId, 'qdocs', subj.platformRole);
  if (!menu.ok) return menu;

  // 멀티테넌트 격리 — project_id·client_id 는 반드시 이 워크스페이스 소속 (다른 워크스페이스 FK 첨부 차단).
  if (params.projectId) {
    const prj = await Project.findOne({ where: { id: params.projectId, business_id: businessId }, attributes: ['id'] });
    if (!prj) return fail('invalid_project', 400);
  }
  if (params.clientId) {
    const cl = await Client.findOne({ where: { id: params.clientId, business_id: businessId }, attributes: ['id'] });
    if (!cl) return fail('invalid_client', 400);
  }

  // 템플릿 기반 생성 시 — body_template(HTML) 을 placeholder 치환 후 body_html 에 저장.
  //   사용자가 명시적으로 body_json 을 넘기면 그 값 우선.
  const templateId = params.templateId || null;
  const bodyJson = params.bodyJson || null;
  let initialBodyHtml = null;
  if (templateId) {
    const tpl = await DocumentTemplate.findByPk(templateId);
    if (tpl?.body_template) {
      const ctx = await buildTemplateContext(businessId, params.clientId, title, params.projectId);
      initialBodyHtml = renderTemplate(tpl.body_template, ctx);
    }
  }

  const doc = await Document.create({
    business_id: businessId,
    template_id: templateId,
    kind,
    title,
    client_id: params.clientId || null,
    project_id: params.projectId || null,
    form_data: params.formData || null,
    body_json: bodyJson,
    body_html: bodyJson ? null : initialBodyHtml,
    created_by: subjectId,
    created_via: params.createdVia || null,   // provenance 표시 전용(예: 'cue')
  });

  if (templateId) {
    DocumentTemplate.increment('usage_count', { where: { id: templateId } }).catch(() => {});
  }

  // 감사 — 신규 문서(계약·견적·법적 콘텐츠 가능). 여태 3개 생성 경로 감사가 제각각이었다.
  require('../auditService').logAudit(actor.req || null, {
    userId: subjectId,
    action: 'document.create',
    targetType: 'document',
    targetId: doc.id,
    businessId: doc.business_id,
    newValue: { title: doc.title, kind: doc.kind, status: doc.status, template_id: templateId, via: actor.kind === 'cue' ? 'cue' : 'user' },
  });

  return done({ document: doc });
}

module.exports = { createDocument, KIND_VALUES, renderTemplate, buildTemplateContext };
