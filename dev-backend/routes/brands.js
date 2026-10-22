// routes/brands.js — 브랜드 관리. 설계 docs/NAME_CARD_V2_DESIGN.md 6절 결정 1·2 (Fable 2026-10-22)
//
//   워크스페이스 브랜드 /api/businesses/:businessId/brands — 읽기 멤버 이상(명함 브랜드 고르기) · 쓰기 owner/admin · 고객 403(checkBusinessAccess).
//   개인 브랜드      /api/me/brands — 본인 것만(모든 조회 user_id: req.user.id).
//   ★ 쓰기·판정은 services/brands.js 한 곳 — 기본 브랜드는 businesses.brand_* 사본을 같이 쓴다(write-through).
//   ★ 로고: 받은 이미지를 sharp 로 PNG(최대 512px)로 다시 만들어 공개 심볼 폴더에 둔다(기존 /api/businesses/symbol/<uuid> 서빙 재사용).
//     SVG 는 받지 않는다 — 개인 브랜드는 누구나 만들 수 있어, 우리 출처로 서빙되는 SVG 는 스크립트 통로가 된다.
//   ★ 실시간: 신호만(brand:updated {id}) — 워크스페이스 brand 는 business 방, 개인 brand 는 user 방.
//   ★ /api/businesses 접두어를 businesses.js 와 나눈다 — 이 파일에는 «/:businessId/brands…» 꼬리만 둔다(server.js 에서 앞에 붙는다).
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Brand } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { isWorkspaceAdminReq } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
const svc = require('../services/brands');

const SYMBOL_DIR = path.join(__dirname, '..', 'uploads', 'business-symbols');   // routes/businesses.js 의 공개 심볼 폴더와 같은 곳
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });

const fail = (res, next, e) => (e instanceof svc.BrandError ? errorResponse(res, e.code, e.status) : next(e));

function signal(req, brand) {
  try {
    const io = req.app.get('io');
    if (!io) return;
    const room = brand.owner_kind === 'business' ? `business:${brand.business_id}` : `user:${brand.user_id}`;
    io.to(room).emit('brand:updated', { id: brand.id });
  } catch { /* 신호 실패로 저장을 막지 않는다 */ }
}
function audit(req, action, brand, extra) {
  require('../services/auditService').logAudit(req, {
    action, targetType: 'Brand', targetId: brand.id,
    businessId: brand.owner_kind === 'business' ? brand.business_id : null,
    newValue: extra || { name: brand.name },
  });
}

/** 받은 이미지 → PNG(최대 512px, 비율 유지, 메타데이터 제거) → 공개 심볼 경로 */
async function storeLogo(buf) {
  const sharp = require('sharp');
  let meta;
  try { meta = await sharp(buf).metadata(); } catch { throw new svc.BrandError('image_unreadable'); }
  if (!meta || !['jpeg', 'png', 'webp', 'gif'].includes(meta.format)) throw new svc.BrandError('image_unreadable');
  let png;
  try { png = await sharp(buf, { failOn: 'error' }).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).png().toBuffer(); }
  catch { throw new svc.BrandError('image_unreadable'); }
  if (!fs.existsSync(SYMBOL_DIR)) fs.mkdirSync(SYMBOL_DIR, { recursive: true });
  const name = `${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(SYMBOL_DIR, name), png);
  return `/api/businesses/symbol/${name}`;
}

const uploadMw = (req, res, next) => logoUpload.single('file')(req, res, (err) => {
  if (err) return errorResponse(res, err.code === 'LIMIT_FILE_SIZE' ? 'logo_too_large' : 'upload_failed', 400);
  if (!req.file) return errorResponse(res, 'image_only', 400);
  return next();
});

// ═══ 워크스페이스 브랜드 ═══════════════════════════════════════════════════
const biz = express.Router();

async function bizBrand(req) {
  const b = await Brand.findOne({ where: { id: Number(req.params.brandId) || 0, owner_kind: 'business', business_id: Number(req.params.businessId) } });
  if (!b) throw new svc.BrandError('not_found', 404);
  return b;
}
function requireAdmin(req, res) {
  if (isWorkspaceAdminReq(req)) return true;
  errorResponse(res, 'admin_required', 403);
  return false;
}

biz.get('/:businessId/brands', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const rows = await Brand.findAll({ where: { owner_kind: 'business', business_id: Number(req.params.businessId) }, order: [['is_default', 'DESC'], ['sort_order', 'ASC'], ['id', 'ASC']] });
    const counts = await Promise.all(rows.map((b) => svc.cardCountOf(b.id)));
    return successResponse(res, rows.map((b, i) => svc.manageBrandView(b, { card_count: counts[i] })));
  } catch (e) { return fail(res, next, e); }
});

biz.post('/:businessId/brands', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const b = await svc.createBrand({ ownerKind: 'business', businessId: Number(req.params.businessId), actorId: req.user.id, input: req.body || {} });
    audit(req, 'brand.create', b);
    signal(req, b);
    return successResponse(res, svc.manageBrandView(b, { card_count: 0 }));
  } catch (e) { return fail(res, next, e); }
});

biz.post('/:businessId/brands/reorder', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    // audit-exempt: 표시 순서
    const ids = await svc.reorder({ owner_kind: 'business', business_id: Number(req.params.businessId) }, req.body && req.body.ids);
    signal(req, { owner_kind: 'business', business_id: Number(req.params.businessId), id: null });
    return successResponse(res, { ids });
  } catch (e) { return fail(res, next, e); }
});

biz.put('/:businessId/brands/:brandId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const b = await bizBrand(req);
    await svc.updateBrand(b, req.body || {});
    audit(req, 'brand.update', b);
    signal(req, b);
    return successResponse(res, svc.manageBrandView(b, { card_count: await svc.cardCountOf(b.id) }));
  } catch (e) { return fail(res, next, e); }
});

biz.post('/:businessId/brands/:brandId/default', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const b = await bizBrand(req);
    await svc.setDefault(b);
    audit(req, 'brand.set_default', b);
    signal(req, b);
    return successResponse(res, svc.manageBrandView(b, { card_count: await svc.cardCountOf(b.id) }));
  } catch (e) { return fail(res, next, e); }
});

biz.post('/:businessId/brands/:brandId/logo', authenticateToken, checkBusinessAccess, ...perUserDaily('brand-logo', { perMin: 10, perDay: 100 }), uploadMw,
  async (req, res, next) => {
    try {
      if (!requireAdmin(req, res)) return undefined;
      const b = await bizBrand(req);
      await svc.setLogo(b, await storeLogo(req.file.buffer));
      audit(req, 'brand.logo', b, { logo_url: b.logo_url });
      signal(req, b);
      return successResponse(res, svc.manageBrandView(b, { card_count: await svc.cardCountOf(b.id) }));
    } catch (e) { return fail(res, next, e); }
  });

biz.delete('/:businessId/brands/:brandId/logo', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const b = await bizBrand(req);
    await svc.setLogo(b, null);
    audit(req, 'brand.logo', b, { logo_url: null });
    signal(req, b);
    return successResponse(res, svc.manageBrandView(b, { card_count: await svc.cardCountOf(b.id) }));
  } catch (e) { return fail(res, next, e); }
});

biz.delete('/:businessId/brands/:brandId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return undefined;
    const b = await bizBrand(req);
    const { card_count } = await svc.deleteBrand(b);
    audit(req, 'brand.delete', b, { name: b.name, card_count });
    signal(req, b);
    return successResponse(res, { id: b.id, card_count });
  } catch (e) { return fail(res, next, e); }
});

// ═══ 개인 브랜드 ═══════════════════════════════════════════════════════════
const me = express.Router();
me.use(authenticateToken);

async function myBrand(req) {
  const b = await Brand.findOne({ where: { id: Number(req.params.brandId) || 0, owner_kind: 'user', user_id: req.user.id } });
  if (!b) throw new svc.BrandError('not_found', 404);
  return b;
}

me.get('/', async (req, res, next) => {
  try {
    const rows = await Brand.findAll({ where: { owner_kind: 'user', user_id: req.user.id }, order: [['sort_order', 'ASC'], ['id', 'ASC']] });
    const counts = await Promise.all(rows.map((b) => svc.cardCountOf(b.id)));
    return successResponse(res, rows.map((b, i) => svc.manageBrandView(b, { card_count: counts[i] })));
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 개인 표시 데이터(내 명함용 브랜드) — 아래 개인 브랜드 쓰기 전부
me.post('/', ...perUserDaily('brand-create', { perMin: 20, perDay: 100 }), async (req, res, next) => {
  try {
    const b = await svc.createBrand({ ownerKind: 'user', userId: req.user.id, actorId: req.user.id, input: req.body || {} });
    signal(req, b);
    return successResponse(res, svc.manageBrandView(b, { card_count: 0 }));
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 개인 표시 순서
me.post('/reorder', async (req, res, next) => {
  try {
    const ids = await svc.reorder({ owner_kind: 'user', user_id: req.user.id }, req.body && req.body.ids);
    signal(req, { owner_kind: 'user', user_id: req.user.id, id: null });
    return successResponse(res, { ids });
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 개인 표시 데이터
me.put('/:brandId', async (req, res, next) => {
  try {
    const b = await myBrand(req);
    await svc.updateBrand(b, req.body || {});
    signal(req, b);
    return successResponse(res, svc.manageBrandView(b, { card_count: await svc.cardCountOf(b.id) }));
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 개인 표시 데이터(로고)
me.post('/:brandId/logo', ...perUserDaily('brand-logo', { perMin: 10, perDay: 100 }), uploadMw, async (req, res, next) => {
  try {
    const b = await myBrand(req);
    await svc.setLogo(b, await storeLogo(req.file.buffer));
    signal(req, b);
    return successResponse(res, svc.manageBrandView(b, { card_count: await svc.cardCountOf(b.id) }));
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 개인 표시 데이터(로고)
me.delete('/:brandId/logo', async (req, res, next) => {
  try {
    const b = await myBrand(req);
    await svc.setLogo(b, null);
    signal(req, b);
    return successResponse(res, svc.manageBrandView(b, { card_count: await svc.cardCountOf(b.id) }));
  } catch (e) { return fail(res, next, e); }
});
// audit-exempt: 개인 표시 데이터
me.delete('/:brandId', async (req, res, next) => {
  try {
    const b = await myBrand(req);
    const { card_count } = await svc.deleteBrand(b);
    signal(req, b);
    return successResponse(res, { id: b.id, card_count });
  } catch (e) { return fail(res, next, e); }
});

module.exports = { businessBrands: biz, myBrands: me };
