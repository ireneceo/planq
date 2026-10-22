// 고객 담당자 — 읽고 쓰는 문 한 곳. 설계 docs/NAME_CARD_V3_STRATEGY.md 9절 결정 1·2 (Fable 2026-10-22)
//
//   고객(clients 한 행) = 관계 + 대표 담당자(계정 주인). 그 아래 «추가 담당자» 주소록이 client_contacts 다.
//   ★ 담당자는 허브가 아니고 로그인하지 않는다 — 초대·계정 연결·고객 한도·accessKindOf 는 여기를 읽지 않는다.
//     메일→고객 연결(mailLink.matchClientByAddresses)만 담당자 이메일을 3순위로 본다(같은 회사 두 번째 사람의 메일이 그 고객에 붙게).
//   ★ 모든 쿼리에 business_id 를 건다(테넌트 키를 표에 중복으로 둔 이유).
//   응답 모양은 contactView 한 벌(화이트리스트) — 토큰류 없음.
const { Op } = require('sequelize');

const MAX_PER_CLIENT = 50;
const SOURCES = ['manual', 'name_card', 'photo', 'mail', 'chat'];
// 칸 이름 · 길이 — name_cards 와 같은 이름을 쓴다(명함 → 담당자 복사가 칸 대 칸이 되게)
const FIELDS = {
  name: 100, name_en: 100, job_title: 100, department: 100,
  email: 200, mobile: 40, phone: 40, fax: 40, address: 300, memo: 500,
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ContactError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

function trimOrNull(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}
const digits = (v) => String(v || '').replace(/\D/g, '');

/** 입력 → 저장할 칸. partial=true 면 들어온 칸만(PATCH). 이름은 비울 수 없다. */
function normalize(input, { partial = false } = {}) {
  const out = {};
  for (const [k, max] of Object.entries(FIELDS)) {
    if (partial && input[k] === undefined) continue;
    out[k] = trimOrNull(input[k], max);
  }
  if (out.email !== undefined && out.email) {
    out.email = out.email.toLowerCase();
    if (!EMAIL_RE.test(out.email)) throw new ContactError('invalid_email');
  }
  if ((!partial || input.name !== undefined) && !out.name) throw new ContactError('name_required');
  return out;
}

function contactView(c) {
  return {
    id: c.id,
    client_id: c.client_id,
    name: c.name,
    name_en: c.name_en || null,
    job_title: c.job_title || null,
    department: c.department || null,
    email: c.email || null,
    mobile: c.mobile || null,
    phone: c.phone || null,
    fax: c.fax || null,
    address: c.address || null,
    memo: c.memo || null,
    photo_file_id: c.photo_file_id || null,
    source: c.source,
    sort_order: c.sort_order,
    created_at: c.created_at || c.createdAt || null,
    updated_at: c.updated_at || c.updatedAt || null,
  };
}

async function listForClient(businessId, clientId) {
  const { ClientContact } = require('../models');
  const rows = await ClientContact.findAll({
    where: { business_id: businessId, client_id: clientId },
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
  });
  return rows.map(contactView);
}

async function findContact(businessId, clientId, contactId) {
  const { ClientContact } = require('../models');
  const c = await ClientContact.findOne({ where: { id: Number(contactId), business_id: businessId, client_id: clientId } });
  if (!c) throw new ContactError('contact_not_found', 404);
  return c;
}

async function createContact({ businessId, clientId, input, userId = null, source = 'manual', sourceCardId = null, transaction }) {
  const { ClientContact } = require('../models');
  const data = normalize(input || {});
  const count = await ClientContact.count({ where: { business_id: businessId, client_id: clientId }, transaction });
  if (count >= MAX_PER_CLIENT) throw new ContactError('too_many_contacts', 409);
  return ClientContact.create({
    ...data,
    business_id: businessId,
    client_id: clientId,
    source: SOURCES.includes(source) ? source : 'manual',
    source_card_id: sourceCardId || null,
    created_by: userId,
    sort_order: count,
  }, { transaction });
}

async function updateContact(contact, input) {
  const data = normalize(input || {}, { partial: true });
  if (Object.keys(data).length) await contact.update(data);
  return contact;
}

/**
 * 대표 담당자로 넣을지 — 고객 행이 **같은 사람이거나 비어 있을 때만** 대표(고객 행 칸을 채운다), 아니면 추가 담당자.
 *   대표 = 계정 없음 ∧ (display_name 없음 ∨ display_name == 명함 이름). 이름이 다른 사람이면 연락처가 비어 있어도
 *   추가 담당자다 — 대표 칸을 채우면 «이름은 원래 사람·연락처는 명함 사람» 으로 섞인다(Fable 2026-10-22 완료 검증 비차단 1).
 *   판정은 여기 한 곳(화면은 응답의 suggested_role 만 본다).
 */
function suggestRole(client, cardName) {
  if (client.user_id) return 'extra';
  const norm = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();
  if (!client.display_name) return 'primary';
  return cardName && norm(cardName) === norm(client.display_name) ? 'primary' : 'extra';
}

/**
 * 명함 값 → 고객의 대표 담당자 칸(고객 행). 비어 있는 칸만 채운다(사람이 이미 적은 값을 덮지 않는다).
 *   이메일은 emailEditable 참일 때만(초대 토큰과 묶인 주소를 바꾸지 않는다).
 */
function primaryPatch(client, card) {
  const { emailEditable } = require('./clientAccess');
  const patch = {};
  const fill = (col, v, max) => { const s = trimOrNull(v, max); if (s && !client[col]) patch[col] = s; };
  fill('display_name', card.name, 100);
  fill('company_name', card.company, 200);
  fill('job_title', card.job_title, 100);
  fill('department', card.department, 100);
  fill('phone', card.mobile || card.phone, 40);
  const email = trimOrNull(card.email, 200);
  if (email && !client.invite_email && emailEditable(client) && EMAIL_RE.test(email.toLowerCase())) patch.invite_email = email.toLowerCase();
  return patch;
}

/** 받은 명함 스냅샷(cardPublicView 출력) → 칸 값. 회사 칸이 비면 첫 브랜드 이름(명함 앞면에 회사 자리로 보이는 것) */
function cardValues(snap) {
  const s = snap || {};
  const firstBrand = Array.isArray(s.brands) && s.brands[0] ? s.brands[0].name : null;
  return {
    name: s.name || null, name_en: s.name_en || null, job_title: s.job_title || null, department: s.department || null,
    company: s.company || firstBrand || null, email: s.email || null, mobile: s.mobile || null, phone: s.phone || null,
    fax: s.fax || null, address: s.address || null,
  };
}

/**
 * 받은 명함의 주인이 이 워크스페이스의 활성 멤버인가 — 그렇다면 [고객으로] 를 그리지 않는다(«멤버가 이긴다»).
 *   원본이 남아 있으면 원본 주인으로, 없으면 명함 이메일 = 멤버 계정 이메일로 본다.
 */
async function isColleagueCard(businessId, saved) {
  const { NameCard, BusinessMember, User } = require('../models');
  const memberWhere = { business_id: businessId, removed_at: null, user_id: { [Op.ne]: null } };
  if (saved.source_card_id) {
    const src = await NameCard.findByPk(saved.source_card_id, { attributes: ['user_id'] });
    if (src) return !!(await BusinessMember.findOne({ where: { ...memberWhere, user_id: src.user_id }, attributes: ['id'] }));
  }
  const email = String((saved.snapshot && saved.snapshot.email) || '').trim().toLowerCase();
  if (!email) return false;
  return !!(await BusinessMember.findOne({
    where: memberWhere, attributes: ['id'],
    include: [{ model: User, as: 'user', attributes: ['id'], where: { email }, required: true }],
  }));
}

/** 명함 값 → 담당자 입력 칸(name_cards 칸 이름 그대로) */
function contactInputFromCard(card) {
  return {
    name: card.name, name_en: card.name_en, job_title: card.job_title, department: card.department,
    email: card.email, mobile: card.mobile, phone: card.phone, fax: card.fax, address: card.address,
  };
}

/** 메일 연결 3순위 — 담당자 이메일이 정확히 한 고객에만 걸릴 때 그 고객 id. 여럿이면 null(아무 쪽에나 붙이지 않는다). */
async function clientIdByContactEmails(businessId, addresses) {
  if (!addresses || !addresses.length) return null;
  const { ClientContact } = require('../models');
  const rows = await ClientContact.findAll({
    where: { business_id: businessId, email: { [Op.in]: addresses } },
    attributes: ['client_id'], raw: true, limit: 50,
  });
  const ids = [...new Set(rows.map((r) => Number(r.client_id)))];
  return ids.length === 1 ? ids[0] : null;
}

/** 중복 판정 보조 — 전화(휴대폰·전화) 숫자가 같은 담당자의 고객 id. 여럿이면 null */
async function clientIdByContactPhone(businessId, phone) {
  const d = digits(phone);
  if (d.length < 8) return null;
  const { ClientContact } = require('../models');
  const rows = await ClientContact.findAll({
    where: { business_id: businessId, [Op.or]: [{ mobile: { [Op.ne]: null } }, { phone: { [Op.ne]: null } }] },
    attributes: ['client_id', 'mobile', 'phone'], raw: true, limit: 5000,
  });
  const ids = [...new Set(rows.filter((r) => digits(r.mobile) === d || digits(r.phone) === d).map((r) => Number(r.client_id)))];
  return ids.length === 1 ? ids[0] : null;
}

module.exports = {
  MAX_PER_CLIENT, FIELDS, ContactError,
  normalize, contactView, listForClient, findContact, createContact, updateContact,
  suggestRole, primaryPatch, contactInputFromCard, cardValues, isColleagueCard,
  clientIdByContactEmails, clientIdByContactPhone,
};
