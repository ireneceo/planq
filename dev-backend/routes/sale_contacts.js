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

function fail(res, next, err) {
  if (err instanceof contacts.ContactError) return errorResponse(res, err.code, err.status);
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
      if (hit) match = { id: hit.id, name: hit.display_name || hit.company_name || null, suggested_role: contacts.suggestRole(hit) };
    }
    return successResponse(res, { values: got.values, colleague: got.colleague, match });
  } catch (err) { next(err); }
});

// ─── 받은 명함 → 기존 고객에 붙이기 ─────────────────────────────
//   as: 'primary'(고객 행의 빈 칸을 채운다) | 'extra'(담당자 추가) | 생략 = 서버 판정(suggestRole)
router.post('/:businessId/clients/:clientId/attach-card', ...writeChain, async (req, res, next) => {
  try {
    const ctx = await loadClient(req, res); if (!ctx) return;
    const { businessId, client } = ctx;
    const got = await loadSavedCard(req, businessId, (req.body || {}).saved_card_id);
    if (!got) return errorResponse(res, 'saved_card_not_found', 404);
    if (got.colleague) return errorResponse(res, 'already_member', 409);
    const want = (req.body || {}).as;
    const role = want === 'primary' || want === 'extra' ? want : contacts.suggestRole(client);
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
      input: contacts.contactInputFromCard(got.values), source: 'name_card', sourceCardId: got.saved.source_card_id,
    });
    createAuditLog({ userId: req.user.id, businessId, action: 'client.contact_created', targetType: 'client', targetId: client.id, newValue: { contact_id: c.id, name: c.name, source: 'name_card' } });
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
