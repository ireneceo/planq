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
const { getUserScope, isMemberOrAbove } = require('../middleware/access_scope');
const cue = require('../services/cue_orchestrator');

// member 이상 (쓰기 액션)
async function assertBusinessAccess(userId, businessId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  const m = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  return !!m;
}

// 조회용 — client 도 통과 (자기 client_id 의 document)
async function assertReadAccess(userId, businessId, platformRole) {
  const scope = await getUserScope(userId, businessId, platformRole);
  if (scope.isPlatformAdmin || scope.isOwner || scope.isMember || scope.isClient) return { ok: true, scope };
  return { ok: false, scope: null };
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

// createDocument 시 사용할 컨텍스트 빌드 — business + client + project + 기본 날짜
// projectId 가 주어지면 ctx.project 추가, project 의 primary client 가 있고 clientId 가 비어있으면 자동 fallback.
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
  // 프로젝트 컨텍스트 — primary client 자동 매핑
  let resolvedClientId = clientId;
  if (projectId) {
    const proj = await Project.findByPk(projectId, {
      attributes: ['id', 'business_id', 'name', 'description', 'client_company', 'start_date', 'end_date', 'status'],
    });
    if (proj && proj.business_id === businessId) {
      ctx.project = proj.toJSON();
      // project 에서 primary client 추적 — ProjectClient association 통해
      if (!resolvedClientId) {
        const { ProjectClient } = require('../models');
        const pc = await ProjectClient.findOne({
          where: { project_id: projectId },
          order: [['id', 'ASC']],
        });
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

// GET /api/docs/templates/:id/context — 사이클 I (Phase F 슬롯)
//   ?business_id=X&project_id=Y&client_id=Z 로 컨텍스트 자동 채움 후 반환
//   응답: { schema, default_values, body_template, context }
router.get('/templates/:id/context', authenticateToken, async (req, res, next) => {
  try {
    const { getTemplateContext, renderTemplate } = require('../services/template_filler');
    const businessId = parseInt(req.query.business_id, 10) || null;
    if (businessId && !(await assertBusinessAccess(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const result = await getTemplateContext({
      templateId: req.params.id,
      businessId,
      projectId: parseInt(req.query.project_id, 10) || null,
      clientId: parseInt(req.query.client_id, 10) || null,
      userId: req.user.id,
    });
    if (!result) return errorResponse(res, 'not_found', 404);
    // body_template 미리보기 (default_values 로 치환된 형태) — 사용자 확인용
    result.preview = renderTemplate(result.body_template, result.default_values);
    return successResponse(res, result);
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
    const auth = await assertReadAccess(req.user.id, businessId, req.user.platform_role);
    if (!auth.ok) return errorResponse(res, 'forbidden', 403);
    const where = { business_id: businessId, archived_at: null };
    // Client 면 본인 client_id 또는 본인 참여 프로젝트의 document 만 (PERMISSION_MATRIX §6.5)
    if (auth.scope?.isClient) {
      const orConds = [];
      if (auth.scope.clientIds.length > 0) orConds.push({ client_id: { [Op.in]: auth.scope.clientIds } });
      if (auth.scope.projectClientProjectIds.length > 0) orConds.push({ project_id: { [Op.in]: auth.scope.projectClientProjectIds } });
      if (orConds.length === 0) return successResponse(res, []);
      where[Op.or] = orConds;
    }
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
        { model: User, as: 'creator', attributes: ['id', 'name', 'name_localized'] },
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
        const ctx = await buildTemplateContext(business_id, client_id, title, project_id);
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
// AI 자동 문서 초안 생성 — Cue gpt-4o-mini.
// 시스템 템플릿(is_system=true) 의 body_template 을 참고 구조로 주입해 표·섹션 포맷을 강제함.
// body: { business_id, kind, title, user_input, client_id?, project_id?, template_id? }
// project_id 만 있으면 그 프로젝트의 primary client 자동 매핑.
// 회의록(meeting_note) / SOP / custom 외에는 client 컨텍스트 필수 — 빈 채로 생성하면 "—" placeholder 만 남음.
// 응답: { body_html, usage } / 한도 초과 시 429
router.post('/ai-generate', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, kind, title, user_input, client_id, project_id, template_id } = req.body;
    if (!business_id || !kind || !title) return errorResponse(res, 'invalid_payload', 400);
    if (!KIND_VALUES.includes(kind)) return errorResponse(res, 'invalid_kind', 400);
    if (!(await assertBusinessAccess(req.user.id, business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    const ctx = await buildTemplateContext(business_id, client_id, title, project_id);
    // client/project 연결은 선택 — 없으면 LLM 이 placeholder 그대로 두고 사용자가 나중에 채움.
    // 템플릿별 필수 필드는 슬롯 시스템 (Phase F) 에서 처리.

    // 1) kind 별 시스템 템플릿 — 사용자가 template_id 주면 그것, 없으면 같은 kind 의 시스템 템플릿
    let referenceTpl = null;
    if (template_id) {
      referenceTpl = await DocumentTemplate.findByPk(template_id, { attributes: ['body_template', 'ai_prompt_template', 'name'] });
    }
    if (!referenceTpl) {
      referenceTpl = await DocumentTemplate.findOne({
        where: { kind, is_system: true },
        attributes: ['body_template', 'ai_prompt_template', 'name'],
      });
    }

    // 2) kind 별 디테일 가이드 — 정적 템플릿 수준 강제
    const KIND_GUIDANCE = {
      quote: `[견적서 표준]
- 8 column 품목표 (No · 품목/작업 · 규격/산출물 · 단위 · 수량 · 단가 · 금액 · 비고) — 5행 기본
- 추가비용 표 (출장·외주·예비비)
- 합계 표 (공급가액·할인·부가세 10%·총액)
- 결제 분할 표 (선금 30% 계약 시 / 중도금 40% 중간 검수 / 잔금 30% 최종 검수 후 14일)
- 인도/AS 표 (착수일·완료일·인도 방법·무상 A/S 3개월)
- 가정/제외 사항 ul
- 양사 서명 표
필요 섹션: 1.공급자 2.공급받는자 3.제안 요약 4.견적 항목 5.추가 비용 6.금액 합계 7.결제 조건 8.납기/인도 9.가정/제외 10.서명`,

      invoice: `[청구서 표준]
- 청구번호·발행일·결제기한·통화 헤더 표
- 참조 표 (견적번호·계약번호·고객 PO·프로젝트명)
- 공급자 정보 표 (사업자번호·업태/종목 포함)
- 청구처 정보 표
- 청구 항목 표 (No·내역·기간·수량·단가·금액)
- 합계 표 (공급가액·부가세 10%·총 청구액)
- 국내 결제 정보 표 (계좌·예금주·가상계좌)
- 해외 결제 정보 표 (Beneficiary·Bank·SWIFT·Account)
- 세금계산서 발행 안내 (수신 정보 회신 요청)
- 연체/지연 손해금 (연 12%) 조항
- 결제 안내 박스 (강조)`,

      nda: `[NDA 표준 — 10조 양식]
- 제1조 목적 / 제2조 비밀정보 정의 및 분류표 (1급 극비·2급 대외비·3급 내부 × 구분/예시/접근권한)
- 제3조 유효 기간 (24개월 + 종료 후 추가 3년 존속)
- 제4조 의무 (목적 외 사용 금지·제3자 공개 금지·임직원 동등 의무·물리/전자 보안)
- 제5조 예외 (공지·기존 인지·법령 명령·서면 동의)
- 제6조 반환 및 파기 (14일 이내·물리 파쇄/소각·전자 영구 삭제·서면 확인)
- 제7조 위반 시 책임 (부정경쟁방지법·영업비밀보호법 형사·민사)
- 제8조 분쟁 해결 (협의 → 법원 / 대한상사중재원 중재 옵션)
- 제9조 효력 및 수정 (서면 합의)
- 제10조 연락 담당자 표 (갑·을 × 이름/이메일/전화)
- 서명 표 (구분/회사명/대표자/서명/일자) — 양사`,

      proposal: `[B2B 제안서 표준 — 11섹션]
필수 구조:
1. Executive Summary (배경색 박스로 강조) — 3~5줄로 핵심 가치·차별화·기대 효과
2. 회사 소개 표 (회사명·설립·대표·주요 사업·인원·인증)
3. 제안 배경 (현황 분석) — 데이터/관찰 근거 ul + 핵심 과제(Problem Statement)
4. 솔루션 제안 — 핵심 가치 1줄 + 표 (핵심 기능·고객 이익·우선순위·관련 산출물) 5행
5. 차별화 포인트 표 (경쟁사 대비·우리의 강점·증명)
6. 일정/마일스톤 표 (마일스톤·기간·산출물·검수 기준·고객 참여) 5행
7. 팀 구성 표 (역할·인원·경력·주요 업무) — PM/리드 개발/개발/디자이너/QA
8. 레퍼런스/유사 사례 표 (고객사·프로젝트·기간·주요 성과)
9. 리스크 및 완화 방안 표 (리스크·가능성·영향·완화 방안)
10. 견적 요약 표 (구분·내용·금액)
11. SLA/유지보수 표 (장애대응·가용성·지원시간·지원채널·유지보수 기간)
12. 다음 단계 ol + 회신 기한 강조 박스`,

      meeting_note: `[회의록 표준]
- 회의 정보 표 (일시·장소·주관·회의 시간)
- 참석자 표 (이름·소속·역할·이메일)
- 결석자 표 (이름·사유·사전 의견)
- 안건 ol (시간 배분 표시)
- 이전 회의 액션 점검 표 (담당·내용·약속 마감·진행 상태·비고)
- 핵심 발언/논점 ul
- 결정 사항 표 (안건·결정·근거·의사결정자)
- 액션 아이템 표 (No·담당·내용·마감·우선순위·상태)
- 미해결 안건 (Parking Lot) ul
- 첨부 자료 ul (PPT·문서·녹음/트랜스크립트)
- 다음 회의 표 (일시·장소·주요 안건·사전 준비)
- 배포 대상 명시`,

      contract: `[용역 계약서 표준 — 12조]
- 제1조 계약의 목적
- 제2조 당사자 정보 표 (갑/을 × 회사명·대표자·사업자번호·주소)
- 제3조 용역 범위 (별첨 SOW/제안서 참조 + ul 요약)
- 제4조 계약 기간 표 (발효일·착수일·완료일·유지보수 기간)
- 제5조 계약 대금 및 지급 — 총액 + 분할 표 (선금 30%/중도금 40%/잔금 30%)
- 제6조 산출물 및 검수 (인도일~10영업일 검수·자동 검수 간주·5영업일 시정)
- 제7조 지적재산권 (잔금 완납 시 을 귀속·Pre-existing IP 갑 유지·오픈소스 라이선스)
- 제8조 비밀유지 (NDA 별도 또는 종료 후 3년)
- 제9조 손해배상 및 면책 (직접 손해 한정·불가항력 면책·갑 손해배상 한도 = 계약 총액)
- 제10조 계약의 해제·해지 (중대 위반 14일 시정·기수행분 정산·미수행 선금 반환)
- 제11조 분쟁 해결 (협의 → 법원)
- 제12조 기타 (상관습·서면 변경·정본 2통)
- 서명 표 (구분/회사명/대표자/서명/일자)`,

      sow: `[작업 명세서 (SOW) 표준]
- 헤더 표 (SOW 번호·버전·작성일·유효기간·관련 계약)
- 1. 프로젝트 개요 표 (프로젝트명·발주사·수행사·총 기간·총 견적)
- 2. 목적 (Why) + 목표 (KPI 측정 가능한 ul)
- 3. 작업 범위 표 (포함/제외)
- 4. 산출물 명세 표 6행 (No·산출물·형태·제출 시점·책임자)
- 5. 일정/마일스톤 표 (주차·마일스톤·주요 작업·완료 기준)
- 6. 인력/리소스 표 (역할·인원·투입률·주요 업무)
- 7. 가정/제약 사항 ul (자료 제공·의사결정자·외부 시스템·인프라)
- 8. 검수 기준 표 (기능/성능/보안/품질/문서 5항목)
- 9. 변경 관리 절차 ul (CR 양식·영향 분석 3영업일·승인 절차·경미 변경)
- 10. 견적 요약 표 (설계·개발·QA·배포 + 합계)
- 승인 표 (양사 서명)`,

      tax_invoice: `[세금계산서] 사업자번호/공급가액/세액 명확. 표준 6 column.`,
      sop: `[표준 운영 절차 SOP] 목적·범위·책임·절차(단계별)·체크리스트·관련 문서.`,
      custom: `[자유 양식] 제목 의미에 맞춰 적절한 5~8 섹션. 비즈니스 일반 관행 유지.`,
    };

    const guidance = KIND_GUIDANCE[kind] || KIND_GUIDANCE.custom;

    const systemPrompt = `당신은 한국어 비즈니스 문서 작성 전문가입니다. 30년 경력 컨설팅 펌 수준의 결과물을 만듭니다.

[출력 규칙]
- 의미적 HTML 만 사용: h1, h2, h3, p, ul, ol, li, table > tbody > tr > th/td.
- table 은 항상 <table><tbody><tr>... 구조로. <thead> 사용 금지.
- 첫 행은 <th> 헤더로 시작. 데이터 행은 <td>.
- 인라인 스타일은 최소화 (강조 박스만 허용: 안내 / 핵심 가치 등 1~2 곳).
- '—' 또는 placeholder ({{client.name}} 같은 mustache) 는 그대로 두지 말고 컨텍스트의 실제 값을 채워 작성. 정보가 없으면 '—' 또는 합리적 기본값.

[톤·길이]
- 정중하고 명료한 비즈니스 톤. 두루뭉술 표현 금지 (구체적 수치·기한·산출물).
- 섹션 제목은 가이드의 순서·이름 그대로. 길이는 가이드의 표 행 수·ul 항목 수를 따름.

[참고 구조 (이 형식·표 구조를 그대로 따라 작성)]
${referenceTpl?.body_template || '(참고 구조 없음 — 가이드만 따라)'}

[종류별 디테일 가이드]
${guidance}`;

    const ctxLines = [];
    ctxLines.push(`문서 종류: ${kind}`);
    ctxLines.push(`문서 제목: ${title}`);
    if (ctx.business?.name) ctxLines.push(`작성 워크스페이스: ${ctx.business.name}`);
    if (ctx.business?.biz_number) ctxLines.push(`사업자번호: ${ctx.business.biz_number}`);
    if (ctx.business?.ceo) ctxLines.push(`대표자: ${ctx.business.ceo}`);
    if (ctx.business?.address) ctxLines.push(`주소: ${ctx.business.address}`);
    if (ctx.business?.phone) ctxLines.push(`전화: ${ctx.business.phone}`);
    if (ctx.business?.email) ctxLines.push(`이메일: ${ctx.business.email}`);
    if (ctx.client?.name) ctxLines.push(`수신 고객사: ${ctx.client.name}`);
    if (ctx.client?.biz_name) ctxLines.push(`고객사 법인명(사업자등록증): ${ctx.client.biz_name}`);
    if (ctx.client?.biz_ceo) ctxLines.push(`고객사 대표자: ${ctx.client.biz_ceo}`);
    if (ctx.client?.biz_tax_id) ctxLines.push(`고객사 사업자번호: ${ctx.client.biz_tax_id}`);
    if (ctx.client?.biz_address) ctxLines.push(`고객사 주소: ${ctx.client.biz_address}`);
    if (ctx.client?.email) ctxLines.push(`고객 이메일: ${ctx.client.email}`);
    if (ctx.project?.name) ctxLines.push(`연결 프로젝트: ${ctx.project.name}`);
    if (ctx.project?.description) ctxLines.push(`프로젝트 설명: ${ctx.project.description}`);
    if (ctx.project?.start_date) ctxLines.push(`프로젝트 시작: ${ctx.project.start_date}`);
    if (ctx.project?.end_date) ctxLines.push(`프로젝트 종료: ${ctx.project.end_date}`);
    ctxLines.push(`발행일: ${ctx.issued_at}`);
    if (['quote', 'proposal', 'contract', 'sow'].includes(kind)) ctxLines.push(`유효일/완료 목표: ${ctx.valid_until}`);

    const aiPromptTpl = referenceTpl?.ai_prompt_template || '';
    const userPrompt = `[컨텍스트]
${ctxLines.join('\n')}

[사용자 추가 요구사항]
${user_input || '(없음 — 가이드의 표준 양식으로 작성)'}` + (aiPromptTpl ? `\n\n[참고 프롬프트]\n${aiPromptTpl}` : '');

    // 무거운 종류는 더 많은 토큰
    const HEAVY_KINDS = ['proposal', 'contract', 'sow'];
    const maxTokens = HEAVY_KINDS.includes(kind) ? 4000 : 2500;

    const r = await cue.generateDocumentDraft(business_id, { systemPrompt, userPrompt, maxTokens });
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
        { model: User, as: 'creator', attributes: ['id', 'name', 'name_localized'] },
        { model: DocumentTemplate, attributes: ['id', 'name', 'mode', 'schema_json', 'body_template'] },
      ],
    });
    if (!doc) return errorResponse(res, 'not_found', 404);
    const auth = await assertReadAccess(req.user.id, doc.business_id, req.user.platform_role);
    if (!auth.ok) return errorResponse(res, 'forbidden', 403);
    if (auth.scope?.isClient) {
      const okClient = doc.client_id && auth.scope.clientIds.includes(doc.client_id);
      const okProject = doc.project_id && auth.scope.projectClientProjectIds.includes(doc.project_id);
      if (!okClient && !okProject) return errorResponse(res, 'forbidden', 403);
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
