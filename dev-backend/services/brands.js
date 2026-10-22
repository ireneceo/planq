// services/brands.js — 브랜드 한 곳. 설계 docs/NAME_CARD_V2_DESIGN.md 6절 결정 1·2 (Fable 2026-10-22)
//
//   ① 판정 canUseBrand — 명함에 고를 때와 명함을 그릴 때 **같은 함수**. 개인 브랜드 = 내 것 / 워크스페이스 브랜드 = 지금 그 워크스페이스 활성 멤버.
//   ② brandsForCard(s) — 읽을 때 거른다(fail-closed). 멤버가 나가거나 브랜드가 지워지면 저절로 빠진다(훅 불필요).
//   ③ 쓰기 — 만들기·고치기·기본 바꾸기·지우기. **워크스페이스 기본 브랜드는 businesses.brand_* 로 같은 트랜잭션에서 사본을 쓴다**
//      (write-through). 옛 칸을 읽는 곳(268곳)은 고치지 않는다. 옛 칸 쓰기는 이 파일 밖에서 금지 — 가드 --category=brandwrite.
//   ④ 공개 모양 publicBrandView — id·business_id·user_id 없음(명함 공개 응답·보관 스냅샷이 이것을 싣는다).
const { Op } = require('sequelize');
const nc = require('./nameCard');

const LIMIT_BUSINESS = 20;
const LIMIT_USER = 10;
const MAX_LINKS = 8;
const MAX_PER_CARD = 4;
const LINK_KINDS = ['website', 'instagram', 'facebook', 'x', 'youtube', 'linkedin', 'threads', 'tiktok', 'blog', 'kakao', 'other'];
const MEMBER_ROLES = ['owner', 'admin', 'member'];

class BrandError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

// ─── 입력 정규화 ───────────────────────────────────────────────────────────
function normLinks(v) {
  if (v == null) return null;
  if (!Array.isArray(v)) throw new BrandError('invalid_links');
  const out = [];
  for (const it of v) {
    if (!it || typeof it !== 'object') continue;
    let url;
    try { url = nc.normUrl(it.url); } catch { throw new BrandError('invalid_url'); }
    if (!url) continue;
    const kind = LINK_KINDS.includes(it.kind) ? it.kind : 'other';
    out.push({ kind, label: nc.oneLine(it.label, 40) || '', url });
    if (out.length > MAX_LINKS) throw new BrandError('too_many_links');
  }
  return out.length ? out : null;
}

const RULES = {
  name: (v) => nc.oneLine(v, 100),
  name_en: (v) => nc.oneLine(v, 100),
  tagline: (v) => nc.oneLine(v, 200),
  tagline_en: (v) => nc.oneLine(v, 200),
  links: normLinks,
};

function normalizeBrandInput(input, { requireName = false } = {}) {
  const out = {};
  for (const [k, rule] of Object.entries(RULES)) {
    if (input && Object.prototype.hasOwnProperty.call(input, k)) out[k] = rule(input[k]);
  }
  if ((requireName || Object.prototype.hasOwnProperty.call(out, 'name')) && !out.name) throw new BrandError('name_required');
  return out;
}

// ─── 모양 ──────────────────────────────────────────────────────────────────
function publicBrandView(b) {
  const r = b.get ? b.get({ plain: true }) : b;
  return {
    name: r.name,
    name_en: r.name_en || null,
    tagline: r.tagline || null,
    tagline_en: r.tagline_en || null,
    logo_url: r.logo_url || null,
    links: Array.isArray(r.links) ? r.links.map((l) => ({ kind: l.kind || 'other', label: l.label || '', url: l.url })) : [],
  };
}

/** 관리 화면 모양 — 공개 모양 + id·종류·기본·순서(쓰는 사람만 본다) */
function manageBrandView(b, extra = {}) {
  const r = b.get ? b.get({ plain: true }) : b;
  return { id: r.id, owner_kind: r.owner_kind, is_default: !!r.is_default, sort_order: r.sort_order, ...publicBrandView(r), ...extra };
}

// ─── ① 판정 ────────────────────────────────────────────────────────────────
async function activeBusinessIdsOf(userId) {
  const { BusinessMember } = require('../models');
  const rows = await BusinessMember.findAll({ where: { user_id: userId, removed_at: null, role: MEMBER_ROLES }, attributes: ['business_id'], raw: true });
  return new Set(rows.map((r) => r.business_id));
}

async function canUseBrand(userId, brand) {
  if (!brand || !userId) return false;
  if (brand.owner_kind === 'user') return Number(brand.user_id) === Number(userId);
  if (brand.owner_kind === 'business') return (await activeBusinessIdsOf(userId)).has(Number(brand.business_id));
  return false;
}

/** 명함 여러 장의 브랜드(공개 모양) — 한 번에 읽고 지금 쓸 수 있는 것만. Map<cardId, view[]> */
async function brandsForCards(cards) {
  const { NameCardBrand, Brand } = require('../models');
  const out = new Map();
  const list = (cards || []).filter(Boolean);
  for (const c of list) out.set(c.id, []);
  if (!list.length) return out;
  const links = await NameCardBrand.findAll({
    where: { card_id: list.map((c) => c.id) },
    include: [{ model: Brand, as: 'brand', required: true }],
    order: [['card_id', 'ASC'], ['sort_order', 'ASC']],
  });
  const memberships = new Map();
  for (const c of list) {
    if (!memberships.has(c.user_id)) memberships.set(c.user_id, await activeBusinessIdsOf(c.user_id));
  }
  const ownerOf = new Map(list.map((c) => [c.id, c.user_id]));
  for (const l of links) {
    const b = l.brand;
    const owner = ownerOf.get(l.card_id);
    const ok = b.owner_kind === 'user' ? Number(b.user_id) === Number(owner)
      : memberships.get(owner).has(Number(b.business_id));
    if (ok) out.get(l.card_id).push(publicBrandView(b));
  }
  return out;
}

async function brandsForCard(card) {
  if (!card) return [];
  return (await brandsForCards([card])).get(card.id) || [];
}

/** 명함에 고른 브랜드 id(순서대로) — 주인 편집 화면용(지금 못 쓰는 것은 빠진다) */
async function brandIdsForCard(card) {
  const { NameCardBrand, Brand } = require('../models');
  const links = await NameCardBrand.findAll({ where: { card_id: card.id }, include: [{ model: Brand, as: 'brand', required: true }], order: [['sort_order', 'ASC']] });
  const ids = [];
  for (const l of links) if (await canUseBrand(card.user_id, l.brand)) ids.push(l.brand.id);
  return ids;
}

/** 명함에 고를 수 있는 브랜드 전부 — 개인 + 내가 멤버인 워크스페이스 것(워크스페이스 이름과 함께) */
async function usableBrandsFor(userId) {
  const { Brand, Business } = require('../models');
  const bizIds = [...(await activeBusinessIdsOf(userId))];
  const [mine, biz, names] = await Promise.all([
    Brand.findAll({ where: { owner_kind: 'user', user_id: userId }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
    bizIds.length ? Brand.findAll({ where: { owner_kind: 'business', business_id: bizIds }, order: [['business_id', 'ASC'], ['is_default', 'DESC'], ['sort_order', 'ASC'], ['id', 'ASC']] }) : [],
    bizIds.length ? Business.findAll({ where: { id: bizIds }, attributes: ['id', 'name', 'brand_name'], raw: true }) : [],
  ]);
  const nameOf = new Map(names.map((b) => [b.id, b.brand_name || b.name || '']));
  return [
    ...mine.map((b) => manageBrandView(b)),
    ...biz.map((b) => manageBrandView(b, { business_id: b.business_id, business_name: nameOf.get(b.business_id) || '' })),
  ];
}

/** 명함의 브랜드 고르기 — 순서 = 표시 순서. 하나라도 못 쓰는 brand_id 면 전체 400(남의 워크스페이스 brand 를 붙이지 못한다) */
async function setCardBrands(card, brandIds) {
  const { Brand, NameCardBrand } = require('../models');
  const { sequelize } = require('../config/database');
  if (!Array.isArray(brandIds)) throw new BrandError('invalid_brand_ids');
  const ids = [...new Set(brandIds.map(Number).filter((x) => Number.isInteger(x) && x > 0))];
  if (ids.length > MAX_PER_CARD) throw new BrandError('too_many_brands');
  const rows = ids.length ? await Brand.findAll({ where: { id: ids } }) : [];
  if (rows.length !== ids.length) throw new BrandError('invalid_brand_ids');
  for (const b of rows) if (!(await canUseBrand(card.user_id, b))) throw new BrandError('invalid_brand_ids');
  await sequelize.transaction(async (t) => {
    await NameCardBrand.destroy({ where: { card_id: card.id }, transaction: t });
    if (ids.length) await NameCardBrand.bulkCreate(ids.map((id, i) => ({ card_id: card.id, brand_id: id, sort_order: i })), { transaction: t });
  });
  // 보관한 사람의 «바뀜» 은 공개 모양(브랜드 포함) 지문 비교라 시각을 올리지 않아도 잡힌다(routes/name_cards.js fingerprint)
  return ids;
}

// ─── ③ 쓰기 ────────────────────────────────────────────────────────────────
/** 기본 브랜드 → businesses 옛 칸(사본). ★ 옛 칸 쓰기는 이 함수 한 곳(가드 brandwrite). name 도 같이 — 옛 PUT /brand 의 legacy 동기 그대로 */
async function writeThrough(brand, transaction) {
  if (!brand || brand.owner_kind !== 'business' || !brand.is_default) return;
  const { Business } = require('../models');
  // name 은 «보이는 이름(brand_name||name)이 실제로 바뀔 때»만 따라간다 — 옛 PUT /brand 가 brand_name 이 올 때만 맞추던 것과 같다.
  //   소개·로고만 고쳤는데 name≠brand_name 인 워크스페이스의 name 이 덮이면 안 된다(Fable 2026-10-22 비차단 1).
  const biz = await Business.findByPk(brand.business_id, { attributes: ['name', 'brand_name'], transaction });
  const nameChanged = !!biz && (biz.brand_name || biz.name) !== brand.name;
  await Business.update({
    brand_name: brand.name,
    ...(nameChanged ? { name: brand.name } : {}),
    brand_name_en: brand.name_en || null,
    brand_tagline: brand.tagline || null,
    brand_tagline_en: brand.tagline_en || null,
    brand_logo_url: brand.logo_url || null,
  }, { where: { id: brand.business_id }, transaction });
}

async function countFor(where) {
  const { Brand } = require('../models');
  return Brand.count({ where });
}

async function createBrand({ ownerKind, businessId = null, userId = null, actorId = null, input }) {
  const { Brand } = require('../models');
  const { sequelize } = require('../config/database');
  const data = normalizeBrandInput(input || {}, { requireName: true });
  if (ownerKind === 'business') {
    if (!businessId) throw new BrandError('invalid_owner');
    if ((await countFor({ owner_kind: 'business', business_id: businessId })) >= LIMIT_BUSINESS) throw new BrandError('too_many_brands', 409);
  } else if (ownerKind === 'user') {
    if (!userId) throw new BrandError('invalid_owner');
    if ((await countFor({ owner_kind: 'user', user_id: userId })) >= LIMIT_USER) throw new BrandError('too_many_brands', 409);
  } else throw new BrandError('invalid_owner');
  return sequelize.transaction(async (t) => {
    const where = ownerKind === 'business' ? { owner_kind: 'business', business_id: businessId } : { owner_kind: 'user', user_id: userId };
    const maxOrder = await Brand.max('sort_order', { where, transaction: t });
    const isFirstBiz = ownerKind === 'business' && !(await Brand.count({ where, transaction: t }));
    const b = await Brand.create({
      ...data, owner_kind: ownerKind,
      business_id: ownerKind === 'business' ? businessId : null,
      user_id: ownerKind === 'user' ? userId : null,
      is_default: isFirstBiz, sort_order: (Number.isFinite(maxOrder) ? maxOrder : -1) + 1, created_by: actorId,
    }, { transaction: t });
    await writeThrough(b, t);
    return b;
  });
}

async function updateBrand(brand, input) {
  const { sequelize } = require('../config/database');
  const data = normalizeBrandInput(input || {});
  return sequelize.transaction(async (t) => {
    if (Object.keys(data).length) await brand.update(data, { transaction: t });
    await writeThrough(brand, t);
    return brand;
  });
}

async function setLogo(brand, logoUrl) {
  const { sequelize } = require('../config/database');
  return sequelize.transaction(async (t) => {
    await brand.update({ logo_url: logoUrl || null }, { transaction: t });
    await writeThrough(brand, t);
    return brand;
  });
}

async function setDefault(brand) {
  if (brand.owner_kind !== 'business') throw new BrandError('not_business_brand');
  const { Brand } = require('../models');
  const { sequelize } = require('../config/database');
  return sequelize.transaction(async (t) => {
    await Brand.update({ is_default: false }, { where: { owner_kind: 'business', business_id: brand.business_id }, transaction: t });
    await brand.update({ is_default: true }, { transaction: t });
    await writeThrough(brand, t);
    return brand;
  });
}

async function reorder(where, ids) {
  const { Brand } = require('../models');
  const list = Array.isArray(ids) ? ids.map(Number).filter(Boolean) : [];
  if (!list.length || new Set(list).size !== list.length) throw new BrandError('invalid_ids');
  const n = await Brand.count({ where: { ...where, id: list } });
  if (n !== list.length) throw new BrandError('invalid_ids');
  await Promise.all(list.map((id, i) => Brand.update({ sort_order: i }, { where: { ...where, id } })));
  return list;
}

/** 지우기 — 워크스페이스의 마지막 브랜드는 못 지운다(워크스페이스 이름의 정본이다). 기본을 지우면 다음 것이 기본이 된다. */
async function deleteBrand(brand) {
  const { Brand, NameCardBrand } = require('../models');
  const { sequelize } = require('../config/database');
  const cardCount = await NameCardBrand.count({ where: { brand_id: brand.id } });
  if (brand.owner_kind === 'business') {
    const total = await countFor({ owner_kind: 'business', business_id: brand.business_id });
    if (total <= 1) throw new BrandError('last_brand', 409);
  }
  await sequelize.transaction(async (t) => {
    const wasDefault = brand.owner_kind === 'business' && brand.is_default;
    const bizId = brand.business_id;
    await brand.destroy({ transaction: t });
    if (wasDefault) {
      const next = await Brand.findOne({ where: { owner_kind: 'business', business_id: bizId }, order: [['sort_order', 'ASC'], ['id', 'ASC']], transaction: t });
      if (next) { await next.update({ is_default: true }, { transaction: t }); await writeThrough(next, t); }
    }
  });
  return { card_count: cardCount };
}

/** 이 브랜드를 쓰는 명함 수(삭제 확인창) */
async function cardCountOf(brandId) {
  const { NameCardBrand } = require('../models');
  return NameCardBrand.count({ where: { brand_id: brandId } });
}

// ─── 옛 문 → 서비스 (설정 «워크스페이스» 칸·심볼 업로드·PUT /:biz 의 이름) ────────────────
/** 옛 칸 이름(brand_name·brand_tagline…)으로 온 수정을 기본 브랜드에 반영하고 사본을 쓴다. 기본 브랜드가 없으면 만든다. */
async function updateDefaultFromLegacy(businessId, legacy, { actorId = null } = {}) {
  const { Brand, Business } = require('../models');
  const { sequelize } = require('../config/database');
  const map = { brand_name: 'name', brand_name_en: 'name_en', brand_tagline: 'tagline', brand_tagline_en: 'tagline_en' };
  const input = {};
  for (const [k, v] of Object.entries(map)) if (Object.prototype.hasOwnProperty.call(legacy, k)) input[v] = legacy[k];
  const data = normalizeBrandInput(input);
  const hasLogo = Object.prototype.hasOwnProperty.call(legacy, 'brand_logo_url');
  return sequelize.transaction(async (t) => {
    let brand = await Brand.findOne({ where: { owner_kind: 'business', business_id: businessId, is_default: true }, transaction: t });
    if (!brand) {
      const biz = await Business.findByPk(businessId, { transaction: t });
      if (!biz) throw new BrandError('not_found', 404);
      brand = await Brand.create({
        owner_kind: 'business', business_id: businessId, is_default: true, sort_order: 0, created_by: actorId,
        name: nc.oneLine(biz.brand_name || biz.name, 100) || '—', name_en: biz.brand_name_en || null,
        tagline: biz.brand_tagline || null, tagline_en: biz.brand_tagline_en || null, logo_url: biz.brand_logo_url || null,
      }, { transaction: t });
    }
    const patch = { ...data };
    if (hasLogo) patch.logo_url = legacy.brand_logo_url ? String(legacy.brand_logo_url).slice(0, 500) : null;
    if (Object.keys(patch).length) await brand.update(patch, { transaction: t });
    await writeThrough(brand, t);
    return brand;
  });
}

/** 새 워크스페이스 — Business afterCreate 훅이 부른다(생성 문 셋 공통, 같은 트랜잭션). 옛 칸에서 기본 브랜드 1행. */
async function seedDefaultBrand(biz, { transaction } = {}) {
  const { Brand } = require('../models');
  const exists = await Brand.count({ where: { owner_kind: 'business', business_id: biz.id }, transaction });
  if (exists) return null;
  return Brand.create({
    owner_kind: 'business', business_id: biz.id, is_default: true, sort_order: 0, created_by: biz.owner_id || null,
    name: nc.oneLine(biz.brand_name || biz.name, 100) || '—', name_en: nc.oneLine(biz.brand_name_en, 100),
    tagline: nc.oneLine(biz.brand_tagline, 200), tagline_en: nc.oneLine(biz.brand_tagline_en, 200), logo_url: biz.brand_logo_url || null,
  }, { transaction });
}

module.exports = {
  LIMIT_BUSINESS, LIMIT_USER, MAX_LINKS, MAX_PER_CARD, LINK_KINDS,
  BrandError, normalizeBrandInput, publicBrandView, manageBrandView,
  canUseBrand, brandsForCard, brandsForCards, brandIdsForCard, usableBrandsFor, setCardBrands,
  createBrand, updateBrand, setLogo, setDefault, reorder, deleteBrand, cardCountOf,
  updateDefaultFromLegacy, seedDefaultBrand,
};
