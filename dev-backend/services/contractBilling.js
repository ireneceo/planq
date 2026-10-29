// cronalive-exempt: 청구 초안 전에 Business deleted_at:null 로 고른다
// 서명 완료 계약서 → 청구서 초안 자동 생성 (2026-10-23 · docs/CONTRACT_AUTO_INVOICE_DESIGN.md · Fable 설계 A+D, Irene «권고대로»)
//
//   Irene: «서명을 완료한 계약서 기반으로 청구서를 자동생성 해줘. 워크스페이스가 결제를 받을 내용이 있으면. 매번 ai가 살펴보지 않고»
//   - «결제 받을 내용» = 문서에 적어 둔 «청구 조건»(post_billing_terms). 본문을 읽지 않는다(AI 0회·추정 0회).
//   - 때 = 이 회차의 서명 요청(signRoundWhere)이 1건 이상이고 **전부 signed**. 거절·만료가 하나라도 남아 있으면 아니다.
//   - 만드는 것 = **초안(draft)** 하나. 고객에게 아무것도 나가지 않는다 — 발송은 사람이 청구서에서 한다.
//   - 문서당 평생 1건 — terms.invoice_id(UNIQUE) + 청구서 idempotency_key 'post-terms:<post_id>'(UNIQUE). 두 서명이 거의 같이 끝나 훅이 두 번 돌아도 1건.
//   - 제외 — 직원 계약서(employment_contracts.post_id) · 조건 없음.
//   - 실패 — terms.auto_error 에 까닭을 남기고(화면이 «청구서 만들기» 로 잇는다) 요청자에게 앱 알림. 매일 00시 재시도(runContractBillingRetry).
//   - 조건을 고칠 수 있는 때 = 본문과 같다(signatureCore.isPostSignatureLocked 가 아니면). 서명자가 본 조건 = 청구될 조건.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  PostBillingTerms, Post, Client, Business, BusinessMember, SignatureRequest, Invoice, ProjectClient, EmploymentContract,
} = require('../models');
const { insertDraftInvoice, itemsAmountsValid, installmentsError, computeAmounts, MAX_INSTALLMENTS } = require('./invoiceCreate');
const { ZERO_DECIMAL } = require('./money');
const { workspaceTaxDefaults, parseRateFraction, parseTaxMode } = require('./taxCalc');

const CURRENCIES = ['KRW', 'USD', 'EUR', 'JPY', 'CNY'];   // 청구서 발행 창과 같은 다섯
const MAX_ITEMS = 50;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const idemKeyOf = (postId) => `post-terms:${Number(postId)}`;

const fail = (code, http = 400) => ({ ok: false, code, http });

/**
 * 입력 정규화 — 저장 전에 한 번. 청구서 만들기(routes/invoices POST)와 같은 검증(itemsAmountsValid·installmentsError)을 쓴다.
 * @returns {{ok:true, value:object} | {ok:false, code, http}}
 */
async function normalizeTerms(businessId, input) {
  const out = {};
  // 고객 — 필수. 없는 채로 서명이 끝나면 만들 수 없는 청구서가 된다(설계 (e) — 프로젝트 고객 추정 대신 적을 때 고른다).
  const cid = Number(input.client_id);
  if (!Number.isInteger(cid) || cid <= 0) return fail('client_required');
  const c = await Client.findOne({ where: { id: cid, business_id: Number(businessId) }, attributes: ['id', 'status'] });
  if (!c) return fail('client_not_in_workspace');
  out.client_id = c.id;
  out.title = input.title ? String(input.title).trim().slice(0, 200) || null : null;
  const cur = String(input.currency || 'KRW').toUpperCase();
  if (!CURRENCIES.includes(cur)) return fail('invalid_currency');
  out.currency = cur;
  // 세율을 비우면 워크스페이스 기본(세금 끔이면 0) — 옛날엔 0.1 고정(Fable 고칠 점 3)
  const vat = input.vat_rate === undefined || input.vat_rate === null || input.vat_rate === ''
    ? workspaceTaxDefaults(await Business.findByPk(Number(businessId), { attributes: ['default_vat_rate', 'tax_enabled', 'default_tax_mode'] })).rate
    : Number(input.vat_rate);
  if (parseRateFraction(vat) === null) return fail('invalid_vat_rate');   // 0~100%·소수 2자리 — 청구서와 같은 검사
  out.vat_rate = parseRateFraction(vat);
  // 금액 기준 — 서명자가 본 금액이 곧 청구 금액이어야 한다(Fable 결정 1). 안 보내면 세금 별도(옛 화면 기준)
  if (input.tax_mode !== undefined && input.tax_mode !== null && !parseTaxMode(input.tax_mode)) return fail('invalid_tax_mode');
  out.tax_mode = parseTaxMode(input.tax_mode) || 'exclusive';
  // 세금계산서 의향 — 원화만(발행 창 canTax 와 같은 판정)
  out.receipt_type = input.receipt_type === 'tax_invoice' && cur === 'KRW' ? 'tax_invoice' : 'none';
  // 항목 — 설명 있는 줄만, 1~50
  if (!Array.isArray(input.items)) return fail('items_required');
  const rows = input.items.filter((it) => it && String(it.description || '').trim());
  if (rows.length === 0) return fail('items_required');
  if (rows.length > MAX_ITEMS) return fail('too_many_items');
  if (!itemsAmountsValid(rows)) return fail('invalid_amount');
  const decimals = ZERO_DECIMAL.has(cur) ? 0 : 2;
  out.items = rows.map((it) => {
    const qty = it.quantity === undefined || it.quantity === null || it.quantity === '' ? 1 : Number(it.quantity);
    return {
      description: String(it.description).trim().slice(0, 300),
      detail: it.detail ? String(it.detail).trim().slice(0, 1000) || null : null,
      quantity: qty,
      unit_price: Number(Number(it.unit_price || 0).toFixed(decimals)),
    };
  });
  if (out.items.some((it) => !(it.quantity > 0))) return fail('invalid_amount');
  // 분할
  const mode = input.installment_mode === 'split' ? 'split' : 'single';
  out.installment_mode = mode;
  if (mode === 'split') {
    const insts = Array.isArray(input.installments) ? input.installments : [];
    if (insts.length < 2) return fail('installments_required');
    if (installmentsError(mode, insts)) return fail('invalid_installments');
    for (const x of insts) if (x.due_date && !DATE_RE.test(String(x.due_date))) return fail('invalid_due_date');
    out.installments = insts.slice(0, MAX_INSTALLMENTS).map((x) => ({
      label: String(x.label).trim().slice(0, 40),
      percent: Number(x.percent),
      due_date: x.due_date ? String(x.due_date) : null,
      milestone_ref: x.milestone_ref ? String(x.milestone_ref).trim().slice(0, 100) || null : null,
    }));
  } else out.installments = null;
  out.notes = input.notes ? String(input.notes).trim().slice(0, 2000) || null : null;
  return { ok: true, value: out };
}

/** 이 문서의 이번 회차 서명이 다 끝났나 — 회차 = signedDocument.signRoundWhere(서명본·진행 칩과 같은 술어) */
async function isRoundFullySigned(postId, { transaction } = {}) {
  const { signRoundWhere } = require('./signedDocument');
  const rows = await SignatureRequest.findAll({ where: signRoundWhere('post', Number(postId)), attributes: ['status'], transaction });
  return rows.length > 0 && rows.every((r) => r.status === 'signed');
}

async function isPayrollContract(postId) {
  return !!(await EmploymentContract.findOne({ where: { post_id: Number(postId) }, attributes: ['id'] }));
}

/** 금액 보기(서명 화면·문서 카드) — 저장한 조건을 청구서와 같은 함수로 계산한다 */
function amountsOf(terms) {
  const vat = Number(terms.vat_rate);
  const a = computeAmounts({
    items: terms.items || [], vatRate: vat, taxMode: terms.tax_mode, currency: terms.currency,
    installmentMode: terms.installment_mode, installments: terms.installments || [],
  });
  return {
    items: a.itemRows.map((r) => ({ description: r.description, detail: r.detail, quantity: Number(r.quantity), unit_price: r.unit_price, amount: r.amount })),
    subtotal: a.subtotal, tax_amount: a.taxAmount, grand_total: a.grandTotal,
    installments: a.installmentRows.map((r) => ({ label: r.label, percent: r.percent, amount: r.amount, due_date: r.due_date, milestone_ref: r.milestone_ref })),
  };
}

/** 서명자(공개 서명 화면)에게 보이는 모양 — 고객 이름·메모·만든 사람·청구서 번호 없음 */
function publicView(terms) {
  if (!terms) return null;
  const a = amountsOf(terms);
  return {
    currency: terms.currency, vat_rate: Number(terms.vat_rate), tax_mode: terms.tax_mode || 'exclusive', installment_mode: terms.installment_mode,
    items: a.items, subtotal: a.subtotal, tax_amount: a.tax_amount, grand_total: a.grand_total, installments: a.installments,
  };
}

/** 문서 카드(멤버) 모양 */
function memberView(terms) {
  if (!terms) return null;
  return {
    id: terms.id, client_id: terms.client_id, title: terms.title, currency: terms.currency,
    vat_rate: Number(terms.vat_rate), tax_mode: terms.tax_mode || 'exclusive', receipt_type: terms.receipt_type,
    installment_mode: terms.installment_mode, notes: terms.notes,
    raw_items: terms.items || [], raw_installments: terms.installments || [],
    ...amountsOf(terms),
    invoice_id: terms.invoice_id, auto_error: terms.auto_error, auto_attempted_at: terms.auto_attempted_at,
    updated_at: terms.updated_at || terms.updatedAt || null,
  };
}

/** 누가 만든 청구서로 남기나 — 이번 회차 서명 요청을 보낸 사람(지금 활성 멤버) → 조건 작성자 → 대표 */
async function pickActor(terms, post, transaction) {
  const { signRoundWhere } = require('./signedDocument');
  const reqs = await SignatureRequest.findAll({ where: signRoundWhere('post', post.id), attributes: ['requester_user_id'], order: [['id', 'ASC']], transaction });
  const candidates = [...reqs.map((r) => r.requester_user_id), terms.created_by].filter(Boolean);
  for (const uid of candidates) {
    const m = await BusinessMember.findOne({ where: { business_id: post.business_id, user_id: uid, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } }, attributes: ['id'], transaction });
    if (m) return uid;
  }
  const owner = await BusinessMember.findOne({ where: { business_id: post.business_id, role: 'owner', removed_at: null }, attributes: ['user_id'], transaction });
  return owner ? owner.user_id : null;
}

function todayPlusDays(tz, days) {
  const { todayInTz, addDaysStr } = require('../utils/datetime');
  return addDaysStr(todayInTz(tz || 'Asia/Seoul'), Number(days) || 0);
}

/** 실패 기록 — 까닭이 **새로 바뀌었을 때만** true(알림은 그때 한 번). 매일 재시도가 같은 알림을 되풀이하지 않게. */
async function markError(termsId, code) {
  const prev = await PostBillingTerms.findOne({ where: { id: termsId }, attributes: ['auto_error'] });
  await PostBillingTerms.update({ auto_error: code, auto_attempted_at: new Date() }, { where: { id: termsId, invoice_id: null } });
  return !prev || prev.auto_error !== code;
}

/**
 * 만들기 — 조건이 있고, 회차가 다 끝났고, 아직 안 만들었으면. 결과 코드를 돌려준다(검사·재시도·화면이 같은 값을 쓴다).
 * @returns {Promise<{created?:boolean, invoice_id?:number, skipped?:string, error?:string}>}
 */
async function createFromTerms(postId, { reason = 'signature' } = {}) {
  const post = await Post.findByPk(Number(postId), { attributes: ['id', 'business_id', 'project_id', 'title', 'status'] });
  if (!post) return { skipped: 'no_post' };
  const terms = await PostBillingTerms.findOne({ where: { post_id: post.id } });
  if (!terms) return { skipped: 'no_terms' };
  if (terms.invoice_id) return { skipped: 'already_created', invoice_id: terms.invoice_id };
  if (!(await isRoundFullySigned(post.id))) return { skipped: 'not_fully_signed' };
  if (await isPayrollContract(post.id)) return { skipped: 'payroll_contract' };
  const biz = await Business.findOne({ where: { id: post.business_id, deleted_at: null }, attributes: ['id', 'name', 'brand_name', 'timezone', 'default_due_days'] });
  if (!biz) return { skipped: 'workspace_deleted' };
  // 이미 같은 열쇠의 청구서가 있으면(앞선 시도가 청구서는 만들고 연결 전에 죽었다) 연결만 한다
  const prior = await Invoice.findOne({ where: { idempotency_key: idemKeyOf(post.id) }, attributes: ['id'] });
  if (prior) {
    await PostBillingTerms.update({ invoice_id: prior.id, auto_error: null, auto_attempted_at: new Date() }, { where: { id: terms.id, invoice_id: null } });
    return { skipped: 'already_created', invoice_id: prior.id };
  }
  const client = terms.client_id
    ? await Client.findOne({ where: { id: terms.client_id, business_id: post.business_id } })
    : null;
  if (!client) {
    if (await markError(terms.id, 'no_client')) notifyFailure(terms, post, 'no_client').catch(() => null);
    return { error: 'no_client' };
  }

  const t = await sequelize.transaction();
  let invoice;
  let actor;
  try {
    // 조건 행을 잠근다 — 동시 두 번째 시도는 여기서 기다렸다가 invoice_id 를 보고 빠진다
    const locked = await PostBillingTerms.findOne({ where: { id: terms.id }, transaction: t, lock: t.LOCK.UPDATE });
    if (!locked || locked.invoice_id) { await t.rollback(); return { skipped: 'already_created', invoice_id: locked?.invoice_id || null }; }
    actor = await pickActor(locked, post, t);
    if (!actor) { await t.rollback(); await markError(terms.id, 'no_actor'); return { error: 'no_actor' }; }
    // 프로젝트 — 문서가 프로젝트 문서이고 그 고객이 그 프로젝트에 연결돼 있을 때만(손으로 만드는 길의 derivedProjectId 와 같은 규칙)
    const { isClientInProject } = require('./tenantRef');
    const projectId = post.project_id && await isClientInProject(client.id, post.project_id, post.business_id, { transaction: t }) ? post.project_id : null;
    invoice = await insertDraftInvoice({
      businessId: post.business_id, actorUserId: actor,
      title: locked.title || post.title,
      clientId: client.id, projectId, sourcePostId: post.id,
      dueDate: todayPlusDays(biz.timezone, biz.default_due_days ?? 14),
      // 받는 쪽 — 발행 창이 고객에서 채우는 것과 같은 순서
      recipientEmail: client.tax_invoice_email || client.billing_contact_email || client.invite_email || null,
      recipientBusinessName: client.biz_name || null,
      recipientBusinessNumber: client.biz_tax_id || null,
      notes: locked.notes, vatRate: Number(locked.vat_rate), taxMode: locked.tax_mode, currency: locked.currency, receiptType: locked.receipt_type,
      installmentMode: locked.installment_mode, installments: locked.installments || [], items: locked.items,
      idempotencyKey: idemKeyOf(post.id),
    }, { transaction: t });
    await locked.update({ invoice_id: invoice.id, auto_error: null, auto_attempted_at: new Date() }, { transaction: t });
    await t.commit();
  } catch (e) {
    try { await t.rollback(); } catch { /* 이미 끝남 */ }
    if (e && e.name === 'SequelizeUniqueConstraintError') {
      // 같은 열쇠로 다른 시도가 먼저 만들었다 — 그 청구서에 연결만
      const dup = await Invoice.findOne({ where: { idempotency_key: idemKeyOf(post.id) }, attributes: ['id'] });
      if (dup) {
        await PostBillingTerms.update({ invoice_id: dup.id, auto_error: null }, { where: { id: terms.id, invoice_id: null } });
        return { skipped: 'already_created', invoice_id: dup.id };
      }
    }
    console.warn('[contractBilling] create failed post', post.id, e && e.message);
    const fresh = await markError(terms.id, 'create_failed').catch(() => false);
    if (fresh) notifyFailure(terms, post, 'create_failed').catch(() => null);
    return { error: 'create_failed' };
  }
  afterCreated(invoice, post, actor, reason).catch((e) => console.warn('[contractBilling] after', e && e.message));
  return { created: true, invoice_id: invoice.id };
}

/** 만든 뒤 — 수동 생성과 같은 뒤처리(거래 단계·실시간·감사·타임라인) + 청구 담당에게 앱 알림 */
async function afterCreated(invoice, post, actor, reason) {
  const full = await Invoice.findByPk(invoice.id);
  if (full.project_id) require('./projectStageEngine').onInvoiceChanged(full.id).catch(() => null);
  const io = global.__planqIo || null;
  // 신호만(id·소속·상태) — routes/invoices broadcastInvoice 와 같은 모양
  if (io) {
    io.to(`business:${full.business_id}`).emit('invoice:new', { id: full.id, business_id: full.business_id, status: full.status ?? null });
    io.to(`business:${full.business_id}`).emit('post:billing_terms', { post_id: post.id, business_id: post.business_id });
  }
  require('./auditService').logAudit(null, {
    action: 'invoice.auto_create', targetType: 'invoice', targetId: full.id, businessId: full.business_id, userId: actor,
    newValue: {
      invoice_number: full.invoice_number, title: full.title, client_id: full.client_id, project_id: full.project_id,
      currency: full.currency, grand_total: full.grand_total, installment_mode: full.installment_mode,
      source_post_id: post.id, reason,
    },
  });
  await require('./billEvents').logBillEvent('invoice', full.id, 'created', { actorUserId: actor, detail: { invoice_number: full.invoice_number, grand_total: full.grand_total, currency: full.currency, from_post_id: post.id, auto: true } });
  const { userIds, workspaceName } = await require('./billingRecipients').resolveBillingRecipients(full);
  const { notifyMany } = require('../routes/notifications');
  const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
  await notifyMany({
    userIds,
    businessId: full.business_id,
    eventKind: 'invoice',
    titleSpec: { feature: 'bill', action: 'bill_contract_draft', subject: full.title },
    title: (lang) => (lang === 'en' ? 'Draft invoice from signed contract' : '서명 완료 계약 — 청구서 초안'),
    body: (lang) => (lang === 'en'
      ? `«${post.title}» is fully signed. A draft invoice ${full.invoice_number} was created from its billing terms — review and send it.`
      : `«${post.title}» 서명이 모두 끝나 청구 조건대로 청구서 초안 ${full.invoice_number} 를 만들었습니다. 확인 후 발송하세요.`),
    link: `${APP_URL}/bills?tab=invoices&invoice=${full.id}`,
    ctaLabel: (lang) => (lang === 'en' ? 'Review' : '검토하기'),
    workspaceName,
    entityType: 'invoice', entityId: full.id,
    // 우리 쪽 사람에게 가는 앱 알림이다 — 메일 알림·미읽음 재알림 메일은 끈다(외부 발송 0, 설계 (g))
    skipChannels: ['email'], suppressEscalation: true,
  });
}

/** 자동 생성 실패 — 이번 회차 요청자(없으면 조건 작성자)에게 앱 알림. 같은 까닭으로는 한 번만(markError 가 «새 까닭» 일 때만 부른다) */
async function notifyFailure(terms, post, code) {
  const { signRoundWhere } = require('./signedDocument');
  const r = await SignatureRequest.findOne({ where: signRoundWhere('post', post.id), attributes: ['requester_user_id'], order: [['id', 'ASC']] });
  const uid = (r && r.requester_user_id) || terms.created_by;
  if (!uid) return;
  const { notify } = require('../routes/notifications');
  const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
  await notify({
    userId: uid, businessId: post.business_id, eventKind: 'invoice',
    titleSpec: { feature: 'bill', action: 'bill_contract_draft_failed', subject: post.title },
    title: (lang) => (lang === 'en' ? 'Could not create invoice draft' : '청구서 초안을 못 만들었습니다'),
    body: (lang) => (code === 'no_client'
      ? (lang === 'en' ? `«${post.title}» is signed, but its billing terms have no client. Create the invoice from the document.` : `«${post.title}» 서명은 끝났지만 청구 조건의 고객이 없어 초안을 못 만들었습니다. 문서에서 [청구서 만들기] 로 이어 주세요.`)
      : (lang === 'en' ? `«${post.title}» is signed, but creating the invoice draft failed. It will retry tonight, or create it from the document.` : `«${post.title}» 서명은 끝났지만 청구서 초안 만들기에 실패했습니다. 오늘 밤 다시 시도하며, 문서에서 바로 만들 수도 있습니다.`)),
    link: `${APP_URL}/docs?post=${post.id}`,
    entityType: 'post', entityId: post.id,
    skipChannels: ['email'], suppressEscalation: true,
  });
}

/** 서명 훅 — services/signatureHooks.afterSignatureChange 가 부른다(실패해도 서명은 그대로) */
async function onSignatureChanged(signatureRequestId) {
  const sr = await SignatureRequest.findByPk(signatureRequestId, { attributes: ['id', 'entity_type', 'entity_id', 'kind', 'status'] });
  if (!sr || sr.entity_type !== 'post' || sr.kind === 'confirm' || sr.status !== 'signed') return null;
  return createFromTerms(sr.entity_id, { reason: 'signature' });
}

/** 매일 00시 — 회차가 다 끝났는데 아직 청구서가 없는 조건(실패·서버 재시작으로 훅을 놓친 것). 멱등. */
async function runContractBillingRetry() {
  const rows = await PostBillingTerms.findAll({ where: { invoice_id: null }, attributes: ['post_id', 'auto_error'], limit: 500 });
  const out = { checked: rows.length, created: 0, errors: 0 };
  for (const r of rows) {
    if (r.auto_error === 'no_client') continue;   // 사람이 손대야 풀린다 — 매일 같은 알림을 보내지 않는다
    try {
      const res = await createFromTerms(r.post_id, { reason: 'retry' });
      if (res.created) out.created += 1;
      if (res.error) out.errors += 1;
    } catch (e) { out.errors += 1; console.warn('[contract-billing retry]', r.post_id, e.message); }
  }
  return out;
}

module.exports = {
  normalizeTerms, isRoundFullySigned, isPayrollContract, publicView, memberView, amountsOf,
  createFromTerms, onSignatureChanged, runContractBillingRetry, idemKeyOf, CURRENCIES,
};
