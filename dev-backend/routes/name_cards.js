// routes/name_cards.js — 내 명함(인증) `/api/name-cards`. 설계 docs/BUSINESS_CARD_DESIGN.md
//
// ★ 명함은 **계정의 것**이다 — 모든 조회는 `user_id: req.user.id` 로 찾는다(남의 것은 404, 존재를 흘리지 않는다).
// ★ 판정·정규화·응답 모양은 services/nameCard.js 한 곳. 여기는 입력·한도·저장만.
// ★ 감사: 명함 칸은 개인 표시 데이터라 AuditLog 생략(아바타 선례). 공개 켜기/끄기·링크 새로 만들기만 남긴다(공개 범위 변경).
// ★ 실시간(규칙 16): 개인 데이터라 `user:<나>` 방에 신호만 — 다른 기기의 같은 화면이 다시 읽는다.
// ★ 무인증 표면은 routes/name_cards_public.js(server.js 에서 이 라우터보다 앞에 붙는다).
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const { NameCard, SavedNameCard, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
const nc = require('../services/nameCard');

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
const PHOTO_MAX = 8 * 1024 * 1024;
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_MAX, files: 1 } });

router.use(authenticateToken);

const fail = (res, next, e) => ((e instanceof nc.CardError || e instanceof require('../services/brands').BrandError) ? errorResponse(res, e.code, e.status) : next(e));

function signal(req, kind) {
  try {
    const io = req.app.get('io');
    if (io) io.to(`user:${req.user.id}`).emit('namecard:changed', { kind });
  } catch { /* 신호 실패로 저장을 막지 않는다 */ }
}
function logAudit(req, action, card, extra) {
  require('../services/auditService').logAudit(req, {
    action, targetType: 'NameCard', targetId: card.id, businessId: null, newValue: extra || null,
  });
}

async function ownerRow(userId) {
  return User.findByPk(userId, { attributes: nc.OWNER_ATTRS });
}
function ownerView(card, owner, extra = {}) {
  return {
    ...nc.cardOwnerView(card, { linkOpen: !nc.closedReason(card, owner), brands: extra.brands || [] }),
    closed_reason: nc.closedReason(card, owner), url: `${APP_URL}/c/${card.public_token}`,
    brand_ids: extra.brand_ids || [],
    // 이 명함을 «기본 명함» 으로 건 워크스페이스(v2 결정 3) — [{business_id}]
    default_for: extra.default_for || [],
  };
}
/** 내 기본 명함 지정 — Map<cardId, business_id[]> (활성 멤버십만) */
async function defaultsOf(userId) {
  const { BusinessMember } = require('../models');
  const rows = await BusinessMember.findAll({ where: { user_id: userId, removed_at: null, role: ['owner', 'admin', 'member'] }, attributes: ['business_id', 'default_card_id'], raw: true });
  const m = new Map();
  for (const r of rows) if (r.default_card_id) { if (!m.has(r.default_card_id)) m.set(r.default_card_id, []); m.get(r.default_card_id).push(r.business_id); }
  return m;
}
/** 한 장 — 브랜드(공개 모양)·고른 브랜드 id·기본 지정까지 */
async function fullOwnerView(card, userId) {
  const brandsSvc = require('../services/brands');
  const [owner, brands, brandIds, defs] = await Promise.all([ownerRow(userId), brandsSvc.brandsForCard(card), brandsSvc.brandIdsForCard(card), defaultsOf(userId)]);
  return ownerView(card, owner, { brands, brand_ids: brandIds, default_for: defs.get(card.id) || [] });
}
async function myCard(req, id) {
  const card = await NameCard.findOne({ where: { id: Number(id) || 0, user_id: req.user.id } });
  if (!card) throw new nc.CardError('not_found', 404);
  return card;
}

// ═══ 받은 명함(명함첩) — /:id 보다 앞 ═══════════════════════════════════════
// 바뀜 판정 — 수정 시각이 아니라 «보이는 내용» 으로(링크 새로 만들기·순서 바꾸기는 바뀐 것이 아니다).
//   ★ MySQL JSON 은 키 순서를 바꿔 저장한다 — 키를 정렬해 비교한다. 원본은 openSources 가 이미 읽어 둔 것(추가 조회 없음).
function fingerprint(view) {
  const v = { ...(view || {}) };
  delete v.updated_at;
  // v2 이전 보관본에는 brands 칸이 없다 — 빈 목록과 같게 본다(안 그러면 옛 보관본이 전부 «바뀜» 으로 뜬다)
  if (!Array.isArray(v.brands)) v.brands = [];
  const norm = (x) => (Array.isArray(x) ? x.map(norm)
    : (x && typeof x === 'object') ? Object.keys(x).sort().reduce((o, k) => { o[k] = norm(x[k]); return o; }, {}) : x);
  return JSON.stringify(norm(v));
}
/** source = 원본의 지금 공개 모양(브랜드 포함, 열려 있을 때만) — openSources·cardPublicViewWithBrands */
function savedView(row, source) {
  const r = row.get ? row.get({ plain: true }) : row;
  const alive = !!source;
  return {
    id: r.id,
    card: r.snapshot,
    has_photo: !!r.has_photo,
    memo: r.memo || '',
    saved_at: r.created_at || r.createdAt,
    updated_at: r.updated_at || r.updatedAt,
    // 원본이 지금 열려 있는가 · 보관한 뒤 바뀌었는가 — 토큰은 싣지 않는다(Fable 차단2)
    source_alive: alive,
    source_changed: alive && fingerprint(source) !== fingerprint(r.snapshot),
  };
}
/** 보관 행들의 원본 중 지금 열린 것만 — 한 번에 읽는다(목록에서 N번 판정하지 않는다) */
async function openSources(rows) {
  const ids = [...new Set(rows.map((r) => r.source_card_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const cards = await NameCard.findAll({ where: { id: ids } });
  const owners = await User.findAll({ where: { id: [...new Set(cards.map((c) => c.user_id))] }, attributes: nc.OWNER_ATTRS });
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const out = new Map();
  const openCards = cards.filter((c) => !nc.closedReason(c, ownerById.get(c.user_id)));
  const brandMap = await require('../services/brands').brandsForCards(openCards);
  for (const c of openCards) out.set(c.id, nc.cardPublicView(c, brandMap.get(c.id) || []));
  return out;
}
async function writeSavedPhoto(savedId, sourceCard) {
  nc.ensureDirs();
  const dst = nc.savedPhotoPath(savedId);
  if (sourceCard && sourceCard.has_photo) {
    const buf = nc.readIfExists(nc.cardPhotoPath(sourceCard.id));
    if (buf) { fs.writeFileSync(dst, buf); return true; }
  }
  nc.unlinkQuiet(dst);
  return false;
}

router.get('/saved', async (req, res, next) => {
  try {
    const rows = await SavedNameCard.findAll({ where: { user_id: req.user.id }, order: [['created_at', 'DESC']], limit: nc.MAX_SAVED });
    const open = await openSources(rows);
    return successResponse(res, rows.map((r) => savedView(r, open.get(r.source_card_id))));
  } catch (e) { return fail(res, next, e); }
});

// 보관 — 공개 판정을 통과한 명함만. 같은 명함을 다시 보관하면 새 행이 아니라 스냅샷 갱신.
// audit-exempt: 개인 명함첩 — 내 계정 안의 기록
router.post('/saved', ...perUserDaily('card-save', { perMin: 30, perDay: 500 }), async (req, res, next) => {
  try {
    const card = await nc.resolvePublicCard(req.body && req.body.token);
    if (!card) return errorResponse(res, 'not_found', 404);
    if (card.user_id === req.user.id) return errorResponse(res, 'own_card', 400);
    let row = await SavedNameCard.findOne({ where: { user_id: req.user.id, source_card_id: card.id } });
    const snapshot = await nc.cardPublicViewWithBrands(card);
    if (row) {
      await row.update({ snapshot, source_updated_at: card.updatedAt });
    } else {
      const count = await SavedNameCard.count({ where: { user_id: req.user.id } });
      if (count >= nc.MAX_SAVED) return errorResponse(res, 'too_many_saved', 400);
      row = await SavedNameCard.create({ user_id: req.user.id, source_card_id: card.id, snapshot, source_updated_at: card.updatedAt });
    }
    const hasPhoto = await writeSavedPhoto(row.id, card);
    if (hasPhoto !== !!row.has_photo) await row.update({ has_photo: hasPhoto });
    signal(req, 'saved');
    return successResponse(res, savedView(row, snapshot));
  } catch (e) { return fail(res, next, e); }
});

async function mySaved(req) {
  const row = await SavedNameCard.findOne({ where: { id: Number(req.params.sid) || 0, user_id: req.user.id } });
  if (!row) throw new nc.CardError('not_found', 404);
  return row;
}

// audit-exempt: 개인 명함첩 메모
router.patch('/saved/:sid', async (req, res, next) => {
  try {
    const row = await mySaved(req);
    const memo = req.body && typeof req.body.memo === 'string' ? req.body.memo.replace(/\r\n?/g, '\n').slice(0, 500) : null;
    await row.update({ memo: memo && memo.trim() ? memo : null });
    signal(req, 'saved');
    const open = await openSources([row]);
    return successResponse(res, savedView(row, open.get(row.source_card_id)));
  } catch (e) { return fail(res, next, e); }
});

// 새로 받기 — 원본이 지금 열려 있을 때만(주인이 링크를 껐으면 내가 받은 것을 그대로 둔다)
// audit-exempt: 개인 명함첩
router.post('/saved/:sid/refresh', async (req, res, next) => {
  try {
    const row = await mySaved(req);
    const card = await nc.resolveOpenById(row.source_card_id);
    if (!card) return errorResponse(res, 'source_closed', 409);
    const hasPhoto = await writeSavedPhoto(row.id, card);
    const view = await nc.cardPublicViewWithBrands(card);
    await row.update({ snapshot: view, source_updated_at: card.updatedAt, has_photo: hasPhoto });
    signal(req, 'saved');
    return successResponse(res, savedView(row, view));
  } catch (e) { return fail(res, next, e); }
});

// 원본 주소 — 열려 있을 때만, 누를 때 한 번 판정한다(목록 응답에는 토큰을 싣지 않는다 — Fable 차단2).
//   302 대신 주소를 돌려주는 이유: 인증이 Bearer 헤더라 새 탭 이동에는 실을 수 없다. 판정 시점·결과는 302 와 같다.
router.get('/saved/:sid/open-link', async (req, res, next) => {
  try {
    const row = await mySaved(req);
    const card = await nc.resolveOpenById(row.source_card_id);
    if (!card) return errorResponse(res, 'source_closed', 409);
    return successResponse(res, { url: `${APP_URL}/c/${card.public_token}` });
  } catch (e) { return fail(res, next, e); }
});

router.get('/saved/:sid/photo', async (req, res, next) => {
  try {
    const row = await mySaved(req);
    const buf = row.has_photo ? nc.readIfExists(nc.savedPhotoPath(row.id)) : null;
    if (!buf) return errorResponse(res, 'photo_not_found', 404);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    return res.send(buf);
  } catch (e) { return fail(res, next, e); }
});

router.get('/saved/:sid/vcf', async (req, res, next) => {
  try {
    const row = await mySaved(req);
    const photo = row.has_photo ? nc.readIfExists(nc.savedPhotoPath(row.id)) : null;
    res.set({ 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': nc.vcardFilename(row.snapshot), 'Cache-Control': 'no-store' });
    return res.send(nc.toVcard(row.snapshot, { photo }));
  } catch (e) { return fail(res, next, e); }
});

// audit-exempt: 개인 명함첩
router.delete('/saved/:sid', async (req, res, next) => {
  try {
    const row = await mySaved(req);
    const id = row.id;
    await row.destroy();
    nc.unlinkQuiet(nc.savedPhotoPath(id));
    signal(req, 'saved');
    return successResponse(res, { id });
  } catch (e) { return fail(res, next, e); }
});

// ═══ 채우기 ═══════════════════════════════════════════════════════════════
router.get('/prefill-sources', async (req, res, next) => {
  try { return successResponse(res, await nc.prefillSources(req.user.id)); } catch (e) { return fail(res, next, e); }
});
router.get('/prefill', async (req, res, next) => {
  try {
    const bizId = req.query.business_id ? Number(req.query.business_id) : null;
    return successResponse(res, await nc.prefillValues(req.user.id, bizId));
  } catch (e) { return fail(res, next, e); }
});

// ═══ 내 명함 ═══════════════════════════════════════════════════════════════
router.get('/', async (req, res, next) => {
  try {
    const [cards, owner] = await Promise.all([
      NameCard.findAll({ where: { user_id: req.user.id }, order: [['sort_order', 'ASC'], ['id', 'ASC']] }),
      ownerRow(req.user.id),
    ]);
    const brandsSvc = require('../services/brands');
    const [brandMap, defs, idLists] = await Promise.all([
      brandsSvc.brandsForCards(cards), defaultsOf(req.user.id), Promise.all(cards.map((c) => brandsSvc.brandIdsForCard(c))),
    ]);
    return successResponse(res, cards.map((c, i) => ownerView(c, owner, { brands: brandMap.get(c.id) || [], brand_ids: idLists[i], default_for: defs.get(c.id) || [] })));
  } catch (e) { return fail(res, next, e); }
});

// 순서 — 보낸 id 가 전부 내 것일 때만
// audit-exempt: 개인 표시 순서
router.post('/reorder', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (!ids.length || new Set(ids).size !== ids.length) return errorResponse(res, 'invalid_ids', 400);
    const mine = await NameCard.count({ where: { id: ids, user_id: req.user.id } });
    if (mine !== ids.length) return errorResponse(res, 'invalid_ids', 400);
    await Promise.all(ids.map((id, i) => NameCard.update({ sort_order: i }, { where: { id, user_id: req.user.id } })));
    signal(req, 'cards');
    return successResponse(res, { ids });
  } catch (e) { return fail(res, next, e); }
});

// 만들기 — 출처 워크스페이스가 있으면 내가 멤버인지 본 뒤 채운다(없으면 계정 정보만)
// audit-exempt: 개인 명함 만들기(공개 범위 변경 아님 — 미리보기·주인 확인 전에는 이름이 없으면 닫혀 있다)
router.post('/', ...perUserDaily('card-create', { perMin: 20, perDay: 100 }), async (req, res, next) => {
  try {
    const count = await NameCard.count({ where: { user_id: req.user.id } });
    if (count >= nc.MAX_CARDS) return errorResponse(res, 'too_many_cards', 400);
    const { label } = nc.normalizeFields({ label: req.body && req.body.label });
    const bizId = req.body && req.body.source_business_id ? Number(req.body.source_business_id) : null;
    const values = await nc.prefillValues(req.user.id, bizId);
    const maxOrder = await NameCard.max('sort_order', { where: { user_id: req.user.id } });
    const card = await NameCard.create({
      ...values, label, user_id: req.user.id, source_business_id: bizId,
      public_token: nc.newToken(), is_public: true, sort_order: (Number.isFinite(maxOrder) ? maxOrder : -1) + 1,
    });
    signal(req, 'cards');
    return successResponse(res, await fullOwnerView(card, req.user.id));
  } catch (e) { return fail(res, next, e); }
});

// 명함에 고를 수 있는 브랜드 — 개인 + 내가 멤버인 워크스페이스 것(v2 결정 1)
router.get('/brand-options', async (req, res, next) => {
  try { return successResponse(res, await require('../services/brands').usableBrandsFor(req.user.id)); } catch (e) { return fail(res, next, e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const card = await myCard(req, req.params.id);
    return successResponse(res, await fullOwnerView(card, req.user.id));
  } catch (e) { return fail(res, next, e); }
});

// 칸 저장(자동저장 — 칸 하나씩) + 공개 켜기/끄기
// audit-exempt: 칸 값은 개인 표시 데이터. is_public 변경만 아래에서 감사.
router.patch('/:id', async (req, res, next) => {
  try {
    const card = await myCard(req, req.params.id);
    const patch = nc.normalizeFields(req.body || {});
    let publishChanged = false;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'is_public')) {
      const v = req.body.is_public === true;
      if (v !== !!card.is_public) { patch.is_public = v; publishChanged = true; }
    }
    if (Object.keys(patch).length) await card.update(patch);
    // 브랜드 고르기(v2 결정 1) — 순서 = 표시 순서. 남의 워크스페이스 brand_id 는 400(services/brands.canUseBrand)
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'brand_ids')) await require('../services/brands').setCardBrands(card, req.body.brand_ids);
    if (publishChanged) logAudit(req, card.is_public ? 'card.publish' : 'card.unpublish', card);
    signal(req, 'cards');
    return successResponse(res, await fullOwnerView(card, req.user.id));
  } catch (e) { return fail(res, next, e); }
});

// 워크스페이스 기본 명함(v2 결정 3) — 내 명함 ∧ 그 워크스페이스 활성 멤버(owner/admin/member)일 때만.
//   기본 명함은 공개 스위치와 관계없이 그 워크스페이스 멤버에게 보인다(링크·QR 은 공개를 켠 명함만 열린다).
async function myMembership(userId, businessId) {
  const { BusinessMember } = require('../models');
  const m = await BusinessMember.findOne({ where: { user_id: userId, business_id: Number(businessId) || 0, removed_at: null, role: ['owner', 'admin', 'member'] } });
  if (!m) throw new nc.CardError('not_member', 403);
  return m;
}
router.put('/:id/default', async (req, res, next) => {
  try {
    const card = await myCard(req, req.params.id);
    const m = await myMembership(req.user.id, req.body && req.body.business_id);
    await m.update({ default_card_id: card.id });
    logAudit(req, 'card.set_default', card, { business_id: m.business_id });
    signal(req, 'cards');
    return successResponse(res, await fullOwnerView(card, req.user.id));
  } catch (e) { return fail(res, next, e); }
});
router.delete('/:id/default', async (req, res, next) => {
  try {
    const card = await myCard(req, req.params.id);
    const m = await myMembership(req.user.id, req.query.business_id);
    if (Number(m.default_card_id) === card.id) await m.update({ default_card_id: null });
    logAudit(req, 'card.unset_default', card, { business_id: m.business_id });
    signal(req, 'cards');
    return successResponse(res, await fullOwnerView(card, req.user.id));
  } catch (e) { return fail(res, next, e); }
});

// 다시 불러오기 — mode 'empty'(빈 칸만) | 'all'(덮어쓰기)
// audit-exempt: 개인 표시 데이터
router.post('/:id/refill', async (req, res, next) => {
  try {
    const card = await myCard(req, req.params.id);
    const bizId = req.body && req.body.business_id ? Number(req.body.business_id) : null;
    const values = await nc.prefillValues(req.user.id, bizId);
    const all = req.body && req.body.mode === 'all';
    const patch = {};
    for (const [k, v] of Object.entries(values)) if (all || !card[k]) patch[k] = v;
    patch.source_business_id = bizId;
    await card.update(patch);
    signal(req, 'cards');
    return successResponse(res, await fullOwnerView(card, req.user.id));
  } catch (e) { return fail(res, next, e); }
});

// 링크 새로 만들기 — 옛 링크·인쇄된 QR 은 죽는다(확인창이 말한다). 이미 보관한 사람의 보관본은 남는다.
router.post('/:id/rotate-token', async (req, res, next) => {
  try {
    const card = await myCard(req, req.params.id);
    await card.update({ public_token: nc.newToken() });
    logAudit(req, 'card.rotate_token', card);
    signal(req, 'cards');
    return successResponse(res, await fullOwnerView(card, req.user.id));
  } catch (e) { return fail(res, next, e); }
});

// 복제 — 새 토큰 · 사진 파일 복사 · 이름 꼬리 ' (복사)'(저장소 공통 글자)
// audit-exempt: 개인 명함 복제
router.post('/:id/duplicate', ...perUserDaily('card-create', { perMin: 20, perDay: 100 }), async (req, res, next) => {
  try {
    const src = await myCard(req, req.params.id);
    const count = await NameCard.count({ where: { user_id: req.user.id } });
    if (count >= nc.MAX_CARDS) return errorResponse(res, 'too_many_cards', 400);
    const plain = src.get({ plain: true });
    const copy = {};
    for (const k of nc.CONTENT_FIELDS) copy[k] = plain[k];
    const maxOrder = await NameCard.max('sort_order', { where: { user_id: req.user.id } });
    const card = await NameCard.create({
      ...copy,
      label: `${plain.label} (복사)`.slice(0, 60),
      user_id: req.user.id, source_business_id: plain.source_business_id,
      public_token: nc.newToken(), is_public: plain.is_public,
      sort_order: (Number.isFinite(maxOrder) ? maxOrder : 0) + 1,
      has_photo: false, photo_ver: 0,
    });
    if (plain.has_photo) {
      const buf = nc.readIfExists(nc.cardPhotoPath(plain.id));
      if (buf) { nc.ensureDirs(); fs.writeFileSync(nc.cardPhotoPath(card.id), buf); await card.update({ has_photo: true, photo_ver: 1 }); }
    }
    // 고른 브랜드도 따라온다(지금 쓸 수 있는 것만 — 같은 판정)
    const srcBrandIds = await require('../services/brands').brandIdsForCard(src);
    if (srcBrandIds.length) await require('../services/brands').setCardBrands(card, srcBrandIds);
    signal(req, 'cards');
    return successResponse(res, await fullOwnerView(card, req.user.id));
  } catch (e) { return fail(res, next, e); }
});

// 지우기 — 행 + 사진(하드). 링크·QR 은 죽고, 이미 보관한 사람의 보관본은 남는다(source_card_id SET NULL).
// audit-exempt: 개인 명함 삭제
router.delete('/:id', async (req, res, next) => {
  try {
    const card = await myCard(req, req.params.id);
    const id = card.id;
    await card.destroy();
    nc.unlinkQuiet(nc.cardPhotoPath(id));
    signal(req, 'cards');
    return successResponse(res, { id });
  } catch (e) { return fail(res, next, e); }
});

// ─── 사진 ──────────────────────────────────────────────────────────────────
// audit-exempt: 개인 표시(명함 사진)
router.post('/:id/photo', ...perUserDaily('card-photo', { perMin: 10, perDay: 100 }),
  (req, res, next) => {
    photoUpload.single('file')(req, res, (err) => {
      if (err) return errorResponse(res, err.code === 'LIMIT_FILE_SIZE' ? 'photo_too_large' : 'upload_failed', 400);
      if (!req.file) return errorResponse(res, 'image_only', 400);
      return next();
    });
  },
  async (req, res, next) => {
    try {
      const card = await myCard(req, req.params.id);
      const jpg = await nc.processPhoto(req.file.buffer);
      nc.ensureDirs();
      fs.writeFileSync(nc.cardPhotoPath(card.id), jpg);
      await card.update({ has_photo: true, photo_ver: (card.photo_ver || 0) + 1 });
      signal(req, 'cards');
      return successResponse(res, await fullOwnerView(card, req.user.id));
    } catch (e) { return fail(res, next, e); }
  });

// audit-exempt: 개인 표시(명함 사진)
router.delete('/:id/photo', async (req, res, next) => {
  try {
    const card = await myCard(req, req.params.id);
    nc.unlinkQuiet(nc.cardPhotoPath(card.id));
    await card.update({ has_photo: false, photo_ver: (card.photo_ver || 0) + 1 });
    signal(req, 'cards');
    return successResponse(res, await fullOwnerView(card, req.user.id));
  } catch (e) { return fail(res, next, e); }
});

router.get('/:id/photo', async (req, res, next) => {
  try {
    const card = await myCard(req, req.params.id);
    const buf = card.has_photo ? nc.readIfExists(nc.cardPhotoPath(card.id)) : null;
    if (!buf) return errorResponse(res, 'photo_not_found', 404);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' });
    return res.send(buf);
  } catch (e) { return fail(res, next, e); }
});

module.exports = router;
