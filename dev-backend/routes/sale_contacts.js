// Q sale — 고객 담당자 · 받은 명함 → 고객. 설계 docs/NAME_CARD_V3_STRATEGY.md 9절 결정 1·2 (Fable 2026-10-22)
//   /api/sale 접두어를 sale·sale_interactions·sale_save·sale_summary 와 나눠 쓴다. 권한 체인은 services/saleCommon 한 벌
//   (고객 역할 blockClient · qsale read/write). 담당자 읽기·쓰기는 services/clientContacts 한 곳.
//   실시간은 client:updated 신호만(id) — 받는 화면이 다시 읽는다.
const express = require('express');
const router = express.Router();
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../services/auditService');
const { readChain, writeChain, broadcast, findClient } = require('../services/saleCommon');
const contacts = require('../services/clientContacts');
const multer = require('multer');
const { perUserDaily } = require('../middleware/costGuard');

// 명함 사진 — 이미지 한 장, 10MB. 서버가 sharp 로 다시 만들므로 형식만 거른다(HEIC 는 sharp 가 못 읽으면 image_unreadable).
const photoUpload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype || '')),
});
const readLimit = perUserDaily('card-read', { perMin: 5, perDay: 50, message: '명함 읽기가 너무 잦습니다. 잠시 후 다시 시도하세요.' });
const photoLimit = perUserDaily('card-photo-save', { perMin: 10, perDay: 200 });

function fail(res, next, err) {
  if (err instanceof contacts.ContactError) return errorResponse(res, err.code, err.status);
  const { CardReadError } = require('../services/cardRead');
  if (err instanceof CardReadError) return errorResponse(res, err.code, err.status);
  return next(err);
}
const signal = (req, businessId, clientId) => broadcast(req, businessId, 'client:updated', { id: clientId, business_id: businessId });

async function loadClient(req, res) {
  const businessId = Number(req.params.businessId);
  const client = await findClient(businessId, req.params.clientId);
  if (!client) { errorResponse(res, 'Client not found', 404); return null; }
  return { businessId, client };
}

// 받은 명함(내 계정의 명함첩) 한 장 — 내 것만. 이 워크스페이스에서 쓸 값과 판정(동료 명함·이미 있는 고객)을 같이 준다.
async function loadSavedCard(req, businessId, savedId) {
  const { SavedNameCard } = require('../models');
  const saved = await SavedNameCard.findOne({ where: { id: Number(savedId), user_id: req.user.id } });
  if (!saved) return null;
  return { saved, values: contacts.cardValues(saved.snapshot), colleague: await contacts.isColleagueCard(businessId, saved) };
}

// ─── 받은 명함 → 고객: 들이기 전 판정 ─────────────────────────────
//   화면은 이 응답으로 폼을 채우고(prefill), 이미 있는 고객이면 «담당자로 붙일까요?» 를 먼저 묻는다.
router.get('/:businessId/card-intake/:savedId', ...readChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const got = await loadSavedCard(req, businessId, req.params.savedId);
    if (!got) return errorResponse(res, 'saved_card_not_found', 404);
    let match = null;
    if (!got.colleague) {
      const { findExistingByContact } = require('../services/saleCommon');
      const hit = await findExistingByContact(businessId, { email: got.values.email, phone: got.values.mobile || got.values.phone });
      if (hit) match = { id: hit.id, name: hit.display_name || hit.company_name || null, suggested_role: contacts.suggestRole(hit, got.values.name) };
    }
    return successResponse(res, { values: got.values, colleague: got.colleague, match });
  } catch (err) { next(err); }
});

// ─── 명함 사진 읽기 (v3 결정 3) ─────────────────────────────────
//   사진 → AI 가 칸을 읽는다(저장 없음). 화면은 이 값으로 고객 추가 폼을 채우고 사람이 확인해 저장한다.
//   이미 있는 고객(이메일·전화)이면 match 를 같이 준다. 사진 자체는 저장을 누른 뒤 card-photo 로 따로 남긴다.
// audit-exempt: 읽기만 한다 — 사진을 AI 로 읽어 값을 돌려줄 뿐 저장·변경이 없다(저장은 고객 추가·card-photo 가 감사)
router.post('/:businessId/card-read', ...writeChain, ...readLimit, photoUpload.single('file'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!req.file) return errorResponse(res, 'image_required', 400);
    const { readCardImage } = require('../services/cardRead');
    const { values, found } = await readCardImage(businessId, req.file.buffer);
    let match = null;
    if (found) {
      const { findExistingByContact } = require('../services/saleCommon');
      const hit = await findExistingByContact(businessId, { email: values.email, phone: values.mobile || values.phone });
      if (hit) match = { id: hit.id, name: hit.display_name || hit.company_name || null, suggested_role: contacts.suggestRole(hit, values.name) };
    }
    return successResponse(res, { values, found, match });
  } catch (err) { return fail(res, next, err); }
});

// 명함 사진을 그 고객의 파일로 남긴다 — contact_id 가 있으면 그 담당자의 사진으로 건다(없으면 고객 파일로만)
router.post('/:businessId/clients/:clientId/card-photo', ...writeChain, ...photoLimit, photoUpload.single('file'), async (req, res, next) => {
  try {
    const ctx = await loadClient(req, res); if (!ctx) return;
    const { businessId, client } = ctx;
    if (!req.file) return errorResponse(res, 'image_required', 400);
    const contactId = Number((req.body || {}).contact_id) || null;
    const contact = contactId ? await contacts.findContact(businessId, client.id, contactId) : null;
    const { saveCardPhoto } = require('../services/cardRead');
    const file = await saveCardPhoto({ businessId, uploaderId: req.user.id, clientId: client.id, buf: req.file.buffer, label: contact ? contact.name : (client.display_name || client.company_name) });
    if (contact) await contact.update({ photo_file_id: file.id });
    createAuditLog({ userId: req.user.id, businessId, action: 'client.card_photo_saved', targetType: 'client', targetId: client.id, newValue: { file_id: file.id, contact_id: contact ? contact.id : null } });
    signal(req, businessId, client.id);
    return successResponse(res, { file_id: file.id }, 'saved', 201);
  } catch (err) { return fail(res, next, err); }
});

// ─── 받은 명함 → 기존 고객에 붙이기 ─────────────────────────────
//   as: 'primary'(고객 행의 빈 칸을 채운다) | 'extra'(담당자 추가) | 생략 = 서버 판정(suggestRole)
//   saved_card_id(받은 명함) 또는 values(사진에서 읽고 사람이 확인한 값 — source 'photo') 중 하나
router.post('/:businessId/clients/:clientId/attach-card', ...writeChain, async (req, res, next) => {
  try {
    const ctx = await loadClient(req, res); if (!ctx) return;
    const { businessId, client } = ctx;
    const b = req.body || {};
    let got;
    if (b.saved_card_id) {
      got = await loadSavedCard(req, businessId, b.saved_card_id);
      if (!got) return errorResponse(res, 'saved_card_not_found', 404);
      if (got.colleague) return errorResponse(res, 'already_member', 409);
    } else if (b.values && typeof b.values === 'object') {
      got = { saved: null, values: contacts.cardValues(b.values), colleague: false, source: 'photo' };
    } else return errorResponse(res, 'saved_card_not_found', 404);
    const want = (req.body || {}).as;
    const role = want === 'primary' || want === 'extra' ? want : contacts.suggestRole(client, got.values.name);
    if (role === 'primary') {
      const patch = contacts.primaryPatch(client, got.values);
      if (Object.keys(patch).length) {
        const before = {};
        for (const k of Object.keys(patch)) before[k] = client[k];
        await client.update(patch);
        createAuditLog({ userId: req.user.id, businessId, action: 'client.updated', targetType: 'client', targetId: client.id, oldValue: before, newValue: { ...patch, via: 'name_card' } });
      }
      signal(req, businessId, client.id);
      return successResponse(res, { role, filled: Object.keys(patch) });
    }
    const c = await contacts.createContact({
      businessId, clientId: client.id, userId: req.user.id,
      input: contacts.contactInputFromCard(got.values), source: got.source || 'name_card', sourceCardId: got.saved ? got.saved.source_card_id : null,
    });
    createAuditLog({ userId: req.user.id, businessId, action: 'client.contact_created', targetType: 'client', targetId: client.id, newValue: { contact_id: c.id, name: c.name, source: c.source } });
    signal(req, businessId, client.id);
    return successResponse(res, { role, contact: contacts.contactView(c) }, 'created', 201);
  } catch (err) { return fail(res, next, err); }
});

// ─── 담당자 CRUD ───────────────────────────────────────────────
router.get('/:businessId/clients/:clientId/contacts', ...readChain, async (req, res, next) => {
  try {
    const ctx = await loadClient(req, res); if (!ctx) return;
    return successResponse(res, await contacts.listForClient(ctx.businessId, ctx.client.id));
  } catch (err) { next(err); }
});

router.post('/:businessId/clients/:clientId/contacts', ...writeChain, async (req, res, next) => {
  try {
    const ctx = await loadClient(req, res); if (!ctx) return;
    const { businessId, client } = ctx;
    const c = await contacts.createContact({ businessId, clientId: client.id, userId: req.user.id, input: req.body || {}, source: 'manual' });
    createAuditLog({ userId: req.user.id, businessId, action: 'client.contact_created', targetType: 'client', targetId: client.id, newValue: { contact_id: c.id, name: c.name } });
    signal(req, businessId, client.id);
    return successResponse(res, contacts.contactView(c), 'created', 201);
  } catch (err) { return fail(res, next, err); }
});

router.patch('/:businessId/clients/:clientId/contacts/:contactId', ...writeChain, async (req, res, next) => {
  try {
    const ctx = await loadClient(req, res); if (!ctx) return;
    const { businessId, client } = ctx;
    const c = await contacts.findContact(businessId, client.id, req.params.contactId);
    const before = contacts.contactView(c);
    await contacts.updateContact(c, req.body || {});
    const after = contacts.contactView(c);
    const changed = Object.keys(contacts.FIELDS).filter((k) => before[k] !== after[k]);
    if (changed.length) {
      createAuditLog({
        userId: req.user.id, businessId, action: 'client.contact_updated', targetType: 'client', targetId: client.id,
        oldValue: Object.fromEntries(changed.map((k) => [k, before[k]])), newValue: { contact_id: c.id, ...Object.fromEntries(changed.map((k) => [k, after[k]])) },
      });
      signal(req, businessId, client.id);
    }
    return successResponse(res, after);
  } catch (err) { return fail(res, next, err); }
});

router.delete('/:businessId/clients/:clientId/contacts/:contactId', ...writeChain, async (req, res, next) => {
  try {
    const ctx = await loadClient(req, res); if (!ctx) return;
    const { businessId, client } = ctx;
    const c = await contacts.findContact(businessId, client.id, req.params.contactId);
    const gone = contacts.contactView(c);
    await c.destroy();
    createAuditLog({ userId: req.user.id, businessId, action: 'client.contact_deleted', targetType: 'client', targetId: client.id, oldValue: { contact_id: gone.id, name: gone.name, email: gone.email } });
    signal(req, businessId, client.id);
    return successResponse(res, { id: gone.id });
  } catch (err) { return fail(res, next, err); }
});

// 이 담당자를 청구 담당자로 — 칸을 **복사**한다(청구 쪽 판정·화면은 그대로 billing_contact_* 를 본다)
router.post('/:businessId/clients/:clientId/contacts/:contactId/make-billing', ...writeChain, async (req, res, next) => {
  try {
    const ctx = await loadClient(req, res); if (!ctx) return;
    const { businessId, client } = ctx;
    const c = await contacts.findContact(businessId, client.id, req.params.contactId);
    const patch = {
      billing_contact_name: c.name,
      billing_contact_email: c.email || null,
      billing_contact_phone: c.mobile || c.phone || null,
    };
    const before = { billing_contact_name: client.billing_contact_name, billing_contact_email: client.billing_contact_email, billing_contact_phone: client.billing_contact_phone };
    await client.update(patch);
    createAuditLog({ userId: req.user.id, businessId, action: 'client.updated', targetType: 'client', targetId: client.id, oldValue: before, newValue: { ...patch, via: 'contact', contact_id: c.id } });
    signal(req, businessId, client.id);
    return successResponse(res, patch);
  } catch (err) { return fail(res, next, err); }
});

module.exports = router;
