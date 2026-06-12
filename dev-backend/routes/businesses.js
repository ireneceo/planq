const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { Business, BusinessMember, User, CueUsage, Client } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');

// 워크스페이스 심볼 (brand symbol) 업로드 디렉토리 — 공개 서빙용
const SYMBOL_DIR = path.join(__dirname, '..', 'uploads', 'business-symbols');
if (!fs.existsSync(SYMBOL_DIR)) fs.mkdirSync(SYMBOL_DIR, { recursive: true });
const SYMBOL_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const symbolUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SYMBOL_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!SYMBOL_EXT.has(ext)) return cb(new Error('disallowed_extension'));
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 },  // 2 MB
});

// ─── 공통: 현재 월(YYYY-MM) ───
const currentYearMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ─── 공통: Cue 월 한도 (plan 별) ───
const PLAN_CUE_LIMITS = {
  free: 500,
  basic: 5000,
  pro: 25000,
  enterprise: 100000
};

const isAdmin = (req) =>
  req.user?.platform_role === 'platform_admin' || req.businessRole === 'owner';

// ─── List businesses for current user ───
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.platform_role === 'platform_admin') {
      const businesses = await Business.findAll({
        include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
        order: [['created_at', 'DESC']]
      });
      return successResponse(res, businesses);
    }

    const memberships = await BusinessMember.findAll({
      where: { user_id: req.user.id },
      include: [{
        model: Business,
        include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }]
      }]
    });
    const businesses = memberships.map(m => m.Business);
    successResponse(res, businesses);
  } catch (error) {
    next(error);
  }
});

// ─── Create business (platform admin 전용 or 수동 생성) ───
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { brand_name, name, slug, default_language } = req.body;
    const bName = brand_name || name;
    if (!bName || !slug) {
      return errorResponse(res, 'Brand name and slug required', 400);
    }

    const existing = await Business.findOne({ where: { slug } });
    if (existing) return errorResponse(res, 'Slug already taken', 409);

    const business = await Business.create({
      name: bName,
      brand_name: bName,
      slug,
      owner_id: req.user.id,
      default_language: default_language === 'en' ? 'en' : 'ko',
      cue_mode: 'smart'
    });

    await BusinessMember.create({
      business_id: business.id,
      user_id: req.user.id,
      role: 'owner',
      joined_at: new Date()
    });

    await createAuditLog({
      userId: req.user.id,
      businessId: business.id,
      action: 'workspace.create',
      targetType: 'business',
      targetId: business.id
    });

    successResponse(res, business, 'Workspace created', 201);
  } catch (error) {
    next(error);
  }
});

// ─── Get workspace detail (Cue 계정 포함 멤버) ───
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.businessId, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'cueUser', attributes: ['id', 'name', 'avatar_url', 'is_ai'] },
        {
          model: BusinessMember,
          as: 'members',
          include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'avatar_url', 'is_ai'] }]
        }
      ]
    });
    if (!business) return errorResponse(res, 'Workspace not found', 404);
    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// ─── Legacy PUT — 브랜드 갱신으로 매핑 ───
router.put('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const updates = {};
    const allowed = ['brand_name', 'brand_logo_url', 'brand_color', 'name', 'logo_url'];
    for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
    // name 이 오면 brand_name 에도 반영 (legacy 호환)
    if (updates.name && !updates.brand_name) updates.brand_name = updates.name;

    await business.update(updates);
    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// ─── 워크스페이스 심볼 업로드 (공개 서빙) ───
// POST /api/businesses/:businessId/symbol  (multipart 'file')
//   업로드 후 brand_logo_url 자동 갱신, 공개 URL 반환.
//   <img> 태그 직접 로드 가능 (인증 없이) — UUID 파일명으로 추측 불가.
router.post('/:businessId/symbol',
  authenticateToken, checkBusinessAccess,
  (req, res, next) => {
    symbolUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.message === 'disallowed_extension') return errorResponse(res, 'unsupported_file_type', 400);
      if (err.code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'file_too_large (max 2MB)', 400);
      return errorResponse(res, err.message || 'upload_failed', 400);
    });
  },
  async (req, res, next) => {
    try {
      if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
      if (!req.file) return errorResponse(res, 'no_file', 400);
      const business = await Business.findByPk(req.params.businessId);
      if (!business) return errorResponse(res, 'Workspace not found', 404);
      const url = `/api/businesses/symbol/${req.file.filename}`;
      // 이전 심볼 파일 정리 (기존 brand_logo_url 이 우리 심볼 디렉토리면 삭제)
      const prev = business.brand_logo_url;
      if (prev && prev.startsWith('/api/businesses/symbol/')) {
        const prevName = prev.split('/').pop();
        if (prevName && /^[0-9a-f-]+\.(png|jpe?g|gif|webp|svg)$/i.test(prevName)) {
          const prevPath = path.join(SYMBOL_DIR, prevName);
          fs.promises.unlink(prevPath).catch(() => null);
        }
      }
      await business.update({ brand_logo_url: url });
      await createAuditLog({
        userId: req.user.id, businessId: business.id,
        action: 'business.symbol_upload',
        targetType: 'Business', targetId: business.id,
        newValue: { brand_logo_url: url, file_size: req.file.size },
      });
      successResponse(res, { brand_logo_url: url, url });
    } catch (err) { next(err); }
  }
);

// 심볼 공개 서빙 — 인증 없이 (UUID 추측 불가)
router.get('/symbol/:filename', (req, res) => {
  const filename = String(req.params.filename || '');
  if (!/^[0-9a-f-]+\.(png|jpe?g|gif|webp|svg)$/i.test(filename)) {
    return errorResponse(res, 'invalid_filename', 400);
  }
  const fp = path.join(SYMBOL_DIR, filename);
  if (!fs.existsSync(fp)) return errorResponse(res, 'not_found', 404);
  res.sendFile(fp);
});

// ─── Brand 정보 수정 ───
router.put('/:businessId/brand', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const { brand_name, brand_name_en, brand_tagline, brand_tagline_en,
            brand_logo_url, brand_color } = req.body;

    const oldValue = {
      brand_name: business.brand_name,
      brand_name_en: business.brand_name_en,
      brand_color: business.brand_color
    };

    const updates = {};
    if (brand_name !== undefined) {
      if (!brand_name || String(brand_name).trim().length === 0) {
        return errorResponse(res, 'Brand name cannot be empty', 400);
      }
      updates.brand_name = String(brand_name).trim().slice(0, 200);
      updates.name = updates.brand_name; // legacy 동기
    }
    if (brand_name_en !== undefined) {
      updates.brand_name_en = brand_name_en ? String(brand_name_en).trim().slice(0, 200) : null;
    }
    if (brand_tagline !== undefined) {
      updates.brand_tagline = brand_tagline ? String(brand_tagline).slice(0, 500) : null;
    }
    if (brand_tagline_en !== undefined) {
      updates.brand_tagline_en = brand_tagline_en ? String(brand_tagline_en).slice(0, 500) : null;
    }
    if (brand_logo_url !== undefined) {
      updates.brand_logo_url = brand_logo_url ? String(brand_logo_url).slice(0, 500) : null;
    }
    if (brand_color !== undefined) {
      if (brand_color && !/^#[0-9A-Fa-f]{3,8}$/.test(brand_color)) {
        return errorResponse(res, 'Invalid color hex', 400);
      }
      updates.brand_color = brand_color || null;
    }

    await business.update(updates);

    await createAuditLog({
      userId: req.user.id,
      businessId: business.id,
      action: 'workspace.brand_update',
      targetType: 'business',
      targetId: business.id,
      oldValue,
      newValue: updates
    });

    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// ─── Q Bill 청구서 설정 (입금 계좌 + 기본값) ───
// ─── 메일 설정 (Phase E2/E3) ───
// GET 응답: 발신/회신 + 시스템 SMTP 연결 상태
router.get('/:businessId/mail', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.businessId, {
      attributes: ['id', 'name', 'brand_name', 'mail_from_name', 'mail_reply_to'],
    });
    if (!business) return errorResponse(res, 'Workspace not found', 404);
    return successResponse(res, {
      mail_from_name: business.mail_from_name,
      mail_reply_to: business.mail_reply_to,
      brand_name: business.brand_name,
      name: business.name,
      smtp_configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
    });
  } catch (err) { next(err); }
});

// PUT — 발신 표시이름 / 회신 주소 업데이트 (owner 만)
router.put('/:businessId/mail', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const { mail_from_name, mail_reply_to } = req.body || {};
    const updates = {};
    if (mail_from_name !== undefined) {
      updates.mail_from_name = mail_from_name ? String(mail_from_name).trim().slice(0, 100) : null;
    }
    if (mail_reply_to !== undefined) {
      const v = mail_reply_to ? String(mail_reply_to).trim().slice(0, 200) : null;
      if (v && !/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(v)) {
        return errorResponse(res, '유효한 이메일 주소가 아닙니다', 400);
      }
      updates.mail_reply_to = v;
    }
    await business.update(updates);
    return successResponse(res, {
      mail_from_name: business.mail_from_name,
      mail_reply_to: business.mail_reply_to,
      brand_name: business.brand_name,
      name: business.name,
      smtp_configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
    });
  } catch (err) { next(err); }
});

// ─── 독립 서버(S3 호환) 파일 저장 설정 (운영 #29, owner 만) ───
function serializeStorageConfig(business, cfg) {
  return {
    default_storage_provider: business.default_storage_provider || 'planq',
    s3: cfg ? {
      endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket,
      path_prefix: cfg.path_prefix, public_base_url: cfg.public_base_url,
      is_active: cfg.is_active, verified_at: cfg.verified_at,
      has_credentials: !!(cfg.access_key_enc && cfg.secret_key_enc), // 시크릿 자체는 절대 반환 X
    } : null,
  };
}

// GET — 현재 저장소 설정 (시크릿 마스킹)
router.get('/:businessId/storage', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') return errorResponse(res, 'owner_only', 403);
    const { WorkspaceStorageConfig } = require('../models');
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);
    const cfg = await WorkspaceStorageConfig.findOne({ where: { business_id: business.id } });
    return successResponse(res, serializeStorageConfig(business, cfg));
  } catch (err) { next(err); }
});

// PUT — S3 설정 저장(암호화) + 저장소 선택. (provider 전환은 default_storage_provider 로)
router.put('/:businessId/storage', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') return errorResponse(res, 'owner_only', 403);
    const { WorkspaceStorageConfig } = require('../models');
    const { encrypt } = require('../services/encryption');
    const s3svc = require('../services/s3Storage');
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const { default_storage_provider, s3 } = req.body || {};

    // S3 설정 upsert
    if (s3 && typeof s3 === 'object') {
      const { endpoint, region, bucket, path_prefix, public_base_url, access_key, secret_key } = s3;
      if (!endpoint || !bucket) return errorResponse(res, 'endpoint_and_bucket_required', 400);
      try { s3svc.assertSafeEndpoint(endpoint); } catch (e) { return errorResponse(res, e.message, 400); }
      let cfg = await WorkspaceStorageConfig.findOne({ where: { business_id: business.id } });
      const patch = {
        business_id: business.id, provider: 's3',
        endpoint: String(endpoint).trim().slice(0, 300),
        region: region ? String(region).trim().slice(0, 60) : 'us-east-1',
        bucket: String(bucket).trim().slice(0, 200),
        path_prefix: path_prefix ? String(path_prefix).trim().slice(0, 200) : null,
        public_base_url: public_base_url ? String(public_base_url).trim().slice(0, 300) : null,
        created_by: req.user.id,
      };
      if (access_key) patch.access_key_enc = encrypt(String(access_key));
      if (secret_key) patch.secret_key_enc = encrypt(String(secret_key));
      // 자격 변경 시 재검증 필요 → verified 해제
      if (access_key || secret_key || (cfg && (cfg.endpoint !== patch.endpoint || cfg.bucket !== patch.bucket))) {
        patch.verified_at = null; patch.is_active = false;
      }
      if (cfg) await cfg.update(patch);
      else {
        if (!patch.access_key_enc || !patch.secret_key_enc) return errorResponse(res, 'credentials_required', 400);
        cfg = await WorkspaceStorageConfig.create(patch);
      }
    }

    // 저장소 선택 — s3 선택 시 활성·검증된 설정 있어야 허용
    if (default_storage_provider && ['planq', 'gdrive', 's3'].includes(default_storage_provider)) {
      if (default_storage_provider === 's3') {
        const cfg = await WorkspaceStorageConfig.findOne({ where: { business_id: business.id } });
        if (!cfg || !cfg.is_active || !cfg.verified_at) return errorResponse(res, 's3_not_verified — 먼저 연결 테스트를 통과하세요', 400);
      }
      await business.update({ default_storage_provider });
    }

    const fresh = await Business.findByPk(business.id);
    const cfg = await WorkspaceStorageConfig.findOne({ where: { business_id: business.id } });
    return successResponse(res, serializeStorageConfig(fresh, cfg));
  } catch (err) { next(err); }
});

// POST — 연결 테스트 (저장된 자격 또는 요청 자격으로 headBucket). 성공 시 verified.
router.post('/:businessId/storage/test', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') return errorResponse(res, 'owner_only', 403);
    const { WorkspaceStorageConfig } = require('../models');
    const s3svc = require('../services/s3Storage');
    const cfg = await WorkspaceStorageConfig.findOne({ where: { business_id: Number(req.params.businessId) } });
    if (!cfg || !cfg.access_key_enc) return errorResponse(res, 'no_config — 먼저 S3 설정을 저장하세요', 400);
    try {
      await s3svc.testConnection(cfg);
      await cfg.update({ verified_at: new Date(), is_active: true });
      return successResponse(res, { ok: true, verified_at: cfg.verified_at });
    } catch (e) {
      await cfg.update({ verified_at: null, is_active: false });
      return errorResponse(res, 'connection_failed: ' + String(e.message || e).slice(0, 120), 400);
    }
  } catch (err) { next(err); }
});

// ─── 주간 보고 자동 확정 설정 (사이클 N+26) ───
// 워크스페이스 단위 — 매주 N요일 H시에 지난 주 보고서 자동 확정
router.get('/:businessId/weekly-finalize', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.businessId, {
      attributes: ['id', 'timezone', 'weekly_finalize_dow', 'weekly_finalize_hour', 'weekly_finalize_enabled'],
    });
    if (!business) return errorResponse(res, 'Workspace not found', 404);
    return successResponse(res, {
      timezone: business.timezone,
      weekly_finalize_dow: business.weekly_finalize_dow,
      weekly_finalize_hour: business.weekly_finalize_hour,
      weekly_finalize_enabled: business.weekly_finalize_enabled,
    });
  } catch (err) { next(err); }
});

router.put('/:businessId/weekly-finalize', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole !== 'owner' && req.businessRole !== 'admin' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_or_admin_only', 403);
    }
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);
    const { weekly_finalize_dow, weekly_finalize_hour, weekly_finalize_enabled } = req.body || {};
    const updates = {};
    if (weekly_finalize_dow !== undefined) {
      const v = Number(weekly_finalize_dow);
      if (!Number.isFinite(v) || v < 0 || v > 6) return errorResponse(res, 'invalid_dow', 400, { message: 'dow must be 0-6' });
      updates.weekly_finalize_dow = v;
    }
    if (weekly_finalize_hour !== undefined) {
      const v = Number(weekly_finalize_hour);
      if (!Number.isFinite(v) || v < 0 || v > 23) return errorResponse(res, 'invalid_hour', 400, { message: 'hour must be 0-23' });
      updates.weekly_finalize_hour = v;
    }
    if (typeof weekly_finalize_enabled === 'boolean') updates.weekly_finalize_enabled = weekly_finalize_enabled;
    await business.update(updates);
    try {
      await createAuditLog({
        userId: req.user.id, businessId: business.id,
        action: 'business.weekly_finalize_update',
        targetType: 'business', targetId: business.id,
        newValue: updates,
      });
    } catch { /* audit silent */ }
    return successResponse(res, {
      timezone: business.timezone,
      weekly_finalize_dow: business.weekly_finalize_dow,
      weekly_finalize_hour: business.weekly_finalize_hour,
      weekly_finalize_enabled: business.weekly_finalize_enabled,
    });
  } catch (err) { next(err); }
});

router.put('/:businessId/billing', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const { bank_name, bank_account_name, bank_account_number,
            swift_code, bank_name_en, bank_account_name_en,
            default_due_days, default_vat_rate, default_currency,
            auto_invoice_default_mode, auto_invoice_default_billing_day, overdue_grace_days } = req.body;
    const updates = {};
    if (bank_name !== undefined) updates.bank_name = bank_name ? String(bank_name).trim().slice(0, 100) : null;
    if (bank_account_name !== undefined) updates.bank_account_name = bank_account_name ? String(bank_account_name).trim().slice(0, 100) : null;
    if (bank_account_number !== undefined) updates.bank_account_number = bank_account_number ? String(bank_account_number).trim().slice(0, 50) : null;
    // 해외 송금용
    if (swift_code !== undefined) updates.swift_code = swift_code ? String(swift_code).trim().toUpperCase().slice(0, 20) : null;
    if (bank_name_en !== undefined) updates.bank_name_en = bank_name_en ? String(bank_name_en).trim().slice(0, 200) : null;
    if (bank_account_name_en !== undefined) updates.bank_account_name_en = bank_account_name_en ? String(bank_account_name_en).trim().slice(0, 200) : null;
    if (default_due_days !== undefined) {
      const d = Number(default_due_days);
      if (!Number.isFinite(d) || d < 0 || d > 365) return errorResponse(res, '결제 기한은 0~365일 범위', 400);
      updates.default_due_days = d;
    }
    if (default_vat_rate !== undefined) {
      const v = Number(default_vat_rate);
      if (!Number.isFinite(v) || v < 0 || v > 1) return errorResponse(res, 'VAT 은 0~1 범위 (10% = 0.1)', 400);
      updates.default_vat_rate = v;
    }
    if (default_currency !== undefined) {
      const c = String(default_currency || '').toUpperCase();
      if (!['KRW', 'USD', 'EUR', 'JPY', 'CNY'].includes(c)) return errorResponse(res, '지원되지 않는 통화', 400);
      updates.default_currency = c;
    }
    if (auto_invoice_default_mode !== undefined) {
      const m = String(auto_invoice_default_mode || '');
      if (!['auto', 'draft_review'].includes(m)) return errorResponse(res, '정기청구 모드 값 오류', 400);
      updates.auto_invoice_default_mode = m;
    }
    if (auto_invoice_default_billing_day !== undefined) {
      const d = Number(auto_invoice_default_billing_day);
      if (!Number.isFinite(d) || d < 1 || d > 31) return errorResponse(res, '청구일은 1~31', 400);
      updates.auto_invoice_default_billing_day = d;
    }
    if (overdue_grace_days !== undefined) {
      const g = Number(overdue_grace_days);
      if (!Number.isFinite(g) || g < 1 || g > 60) return errorResponse(res, '연체 정지 기간은 1~60일', 400);
      updates.overdue_grace_days = g;
    }

    await business.update(updates);
    successResponse(res, business);
  } catch (error) { next(error); }
});

// ─── Legal 정보 수정 ───
router.put('/:businessId/legal', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const fields = [
      'legal_name', 'legal_name_en', 'legal_entity_type', 'tax_id',
      'representative', 'representative_en', 'address', 'address_en',
      'biz_type', 'biz_item',  // 세금계산서 공급자 업태/종목 (운영 #32)
      'phone', 'email', 'website'
    ];

    const validEntityTypes = ['corporation', 'individual', 'llc', 'other'];
    const updates = {};
    const oldValue = {};

    for (const k of fields) {
      if (k in req.body) {
        let v = req.body[k];
        if (v === '' || v === null || v === undefined) {
          v = null;
        } else {
          v = String(v).trim();
          if (k === 'legal_entity_type' && !validEntityTypes.includes(v)) {
            return errorResponse(res, 'Invalid entity type', 400);
          }
          if (k === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
            return errorResponse(res, 'Invalid email format', 400);
          }
          if (k === 'website' && v && !/^https?:\/\//i.test(v)) {
            v = 'https://' + v;
          }
        }
        oldValue[k] = business[k];
        updates[k] = v;
      }
    }

    await business.update(updates);

    await createAuditLog({
      userId: req.user.id,
      businessId: business.id,
      action: 'workspace.legal_update',
      targetType: 'business',
      targetId: business.id,
      oldValue,
      newValue: updates
    });

    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// ─── Settings (언어·타임존·근무시간) ───
router.put('/:businessId/settings', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const { default_language, timezone, reference_timezones, work_hours } = req.body;
    const updates = {};

    if (default_language !== undefined) {
      if (!['ko', 'en'].includes(default_language)) {
        return errorResponse(res, 'Supported languages: ko, en', 400);
      }
      updates.default_language = default_language;
    }
    const TZ_RE = /^[A-Za-z_+\-0-9]+(\/[A-Za-z_+\-0-9]+){0,2}$/;
    if (timezone !== undefined) {
      if (timezone && !TZ_RE.test(timezone)) {
        return errorResponse(res, 'Invalid timezone', 400);
      }
      updates.timezone = timezone || 'Asia/Seoul';
    }
    if (reference_timezones !== undefined) {
      if (reference_timezones !== null && !Array.isArray(reference_timezones)) {
        return errorResponse(res, 'Invalid reference_timezones', 400);
      }
      const cleaned = (reference_timezones || [])
        .filter((t) => typeof t === 'string' && TZ_RE.test(t))
        .slice(0, 20);
      updates.reference_timezones = cleaned.length ? cleaned : null;
    }
    if (work_hours !== undefined) updates.work_hours = work_hours || null;

    await business.update(updates);
    successResponse(res, business);
  } catch (error) {
    next(error);
  }
});

// ─── 멤버 초대 (이메일 기반) ───
// owner 만 초대 가능. 초대 토큰 발급 + 이메일 발송. accept 시 user_id/joined_at 채움.
router.post('/:businessId/members/invite', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const myMember = await BusinessMember.findOne({ where: { business_id: businessId, user_id: req.user.id } });
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    if (!isPlatformAdmin && (!myMember || myMember.role !== 'owner')) {
      return errorResponse(res, 'forbidden', 403);
    }
    const { email, default_role } = req.body || {};
    if (!email?.trim()) return errorResponse(res, 'email is required', 400);

    const crypto = require('crypto');
    const existingUser = await User.findOne({ where: { email: email.trim() } });

    // 이미 멤버인지 확인
    if (existingUser) {
      const dup = await BusinessMember.findOne({ where: { business_id: businessId, user_id: existingUser.id } });
      if (dup) return errorResponse(res, 'already_member', 409);
    }
    const dupByEmail = await BusinessMember.findOne({ where: { business_id: businessId, invite_email: email.trim() } });
    if (dupByEmail) return errorResponse(res, 'already_invited', 409);

    // 플랜 쿼터 — 멤버 수 한도 (초대 발행 시점에 검사)
    const planEngine = require('../services/plan');
    const planCan = await planEngine.can(businessId, 'add_member');
    if (!planCan.ok) {
      return res.status(422).json(planEngine.buildQuotaError(planCan, businessId));
    }

    const token = crypto.randomBytes(24).toString('hex');
    const created = await BusinessMember.create({
      business_id: businessId,
      user_id: existingUser?.id || null,
      role: 'member',
      default_role: default_role ? String(default_role).trim().slice(0, 50) : null,
      invited_by: req.user.id,
      invited_at: new Date(),
      invite_token: token,
      invite_email: email.trim(),
    });

    // 초대 이메일 발송
    try {
      const { sendInviteEmail } = require('../services/emailService');
      const biz = await Business.findByPk(businessId, { attributes: ['brand_name', 'name'] });
      const inviter = await User.findByPk(req.user.id, { attributes: ['name'] });
      await sendInviteEmail({
        to: email.trim(),
        workspaceName: biz?.brand_name || biz?.name || 'PlanQ',
        inviterName: inviter?.name || '',
        kind: 'workspace_member',
        token,
      });
    } catch (e) { console.warn('member invite email failed:', e.message); }

    // 사이클 N+21 — 인사 변경 audit log
    require('../services/auditService').logAudit(req, {
      action: 'business_member.invite',
      targetType: 'business_member',
      targetId: created.id,
      newValue: { email: email.trim(), default_role: created.default_role || null },
    });
    successResponse(res, created, 'Member invited', 201);
  } catch (error) { next(error); }
});

// ─── 멤버 목록 (Cue 포함) ───
router.get('/:businessId/members', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const members = await BusinessMember.findAll({
      where: { business_id: req.params.businessId, removed_at: null },
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'email', 'avatar_url', 'is_ai', 'last_login_at',
          'phone', 'job_title', 'organization', 'bio', 'expertise', 'timezone']
      }],
      order: [
        ['role', 'ASC'], // 'ai' → 'member' → 'owner' (역순정렬은 수동 처리)
        ['created_at', 'ASC']
      ]
    });
    successResponse(res, members);
  } catch (error) {
    next(error);
  }
});

// ═════════════════════════════════════════════════════════════
// 멤버 권한 (사이클 N+21) — admin role + 9 메뉴 × 3 레벨
// PERMISSION_MATRIX §5 Layer 3
// ═════════════════════════════════════════════════════════════

const { BusinessMemberPermission } = require('../models');
const { getMemberMenuLevels, VALID_MENUS, VALID_LEVELS, READ_ONLY_MENUS } = require('../middleware/menu_permission');

// 권한 변경은 owner/admin 만
async function assertWorkspaceAdmin(userId, businessId) {
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId, removed_at: null },
    attributes: ['role'],
  });
  if (!bm) return { ok: false, code: 'not_member' };
  if (!['owner', 'admin'].includes(bm.role)) return { ok: false, code: 'workspace_admin_required' };
  return { ok: true, role: bm.role };
}

// GET — 워크스페이스 전체 멤버의 메뉴 권한 매트릭스 + role
router.get('/:businessId/members-permissions', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const members = await BusinessMember.findAll({
      where: { business_id: businessId, removed_at: null, role: { [require('sequelize').Op.ne]: 'ai' } },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
    });
    const out = await Promise.all(members.map(async (m) => {
      const ml = await getMemberMenuLevels(businessId, m.user_id);
      return {
        user_id: m.user_id,
        name: m.user?.name || '',
        email: m.user?.email || '',
        role: m.role,
        menus: ml?.menus || {},
      };
    }));
    return successResponse(res, { members: out, valid_menus: VALID_MENUS, valid_levels: VALID_LEVELS });
  } catch (e) { next(e); }
});

// PUT — 멤버 메뉴 권한 한 건 업데이트
router.put('/:businessId/members/:userId/permissions', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const targetUserId = Number(req.params.userId);
    const { menu_key, level } = req.body;

    const adm = await assertWorkspaceAdmin(req.user.id, businessId);
    if (!adm.ok) return errorResponse(res, adm.code, 403);

    if (!VALID_MENUS.includes(menu_key)) return errorResponse(res, 'invalid_menu_key', 400);
    if (!VALID_LEVELS.includes(level)) return errorResponse(res, 'invalid_level', 400);

    // 사이클 N+21-fix — insights 등 read-only 메뉴는 write 강제 차단 → read 로 hint.
    const effectiveLevel = (READ_ONLY_MENUS.includes(menu_key) && level === 'write') ? 'read' : level;

    // 대상 멤버 존재 확인
    const targetMember = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: targetUserId, removed_at: null },
      attributes: ['role'],
    });
    if (!targetMember) return errorResponse(res, 'target_not_member', 404);
    // owner/admin 의 권한은 row 무관 (항상 write). 변경 의미 없으므로 차단.
    if (['owner', 'admin', 'ai'].includes(targetMember.role)) {
      return errorResponse(res, 'role_has_implicit_full_access', 400);
    }

    // upsert
    const [row, created] = await BusinessMemberPermission.findOrCreate({
      where: { business_id: businessId, user_id: targetUserId, menu_key },
      defaults: { level: effectiveLevel, updated_by: req.user.id },
    });
    const old_level = row.level;
    if (!created) {
      await row.update({ level: effectiveLevel, updated_by: req.user.id });
    }
    require('../services/auditService').logAudit(req, {
      action: 'member_permission.update',
      targetType: 'business_member_permission',
      targetId: row.id,
      oldValue: { menu_key, level: old_level },
      newValue: { menu_key, level: effectiveLevel },
    });
    return successResponse(res, { id: row.id, business_id: businessId, user_id: targetUserId, menu_key, level: effectiveLevel });
  } catch (e) { next(e); }
});

// PUT — 멤버 role 변경 (member ↔ admin). owner 변경은 별도 라우트 (인사 권한).
router.put('/:businessId/members/:userId/role', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const targetUserId = Number(req.params.userId);
    const { role } = req.body;

    const adm = await assertWorkspaceAdmin(req.user.id, businessId);
    if (!adm.ok) return errorResponse(res, adm.code, 403);

    // role 전이 정책: member ↔ admin 만. owner 임명/해제는 owner 만 (별도 라우트).
    if (!['member', 'admin'].includes(role)) {
      return errorResponse(res, 'role_must_be_member_or_admin', 400);
    }
    const targetMember = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: targetUserId, removed_at: null },
    });
    if (!targetMember) return errorResponse(res, 'target_not_member', 404);
    if (targetMember.role === 'owner' || targetMember.role === 'ai') {
      return errorResponse(res, 'cannot_change_owner_or_ai_role', 400);
    }
    if (targetMember.role === role) {
      return successResponse(res, { user_id: targetUserId, role, unchanged: true });
    }
    const oldRole = targetMember.role;
    await targetMember.update({ role });
    require('../services/auditService').logAudit(req, {
      action: 'member_role.change',
      targetType: 'business_member',
      targetId: targetMember.id,
      oldValue: { role: oldRole },
      newValue: { role },
    });
    return successResponse(res, { user_id: targetUserId, role });
  } catch (e) { next(e); }
});

// GET — Q Bill 청구서 owner 후보 (write 권한 가진 멤버만)
router.get('/:businessId/billing-owner-candidates', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const members = await BusinessMember.findAll({
      where: { business_id: businessId, removed_at: null, role: { [require('sequelize').Op.ne]: 'ai' } },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
    });
    const candidates = [];
    for (const m of members) {
      // owner/admin = 무조건 후보
      if (m.role === 'owner' || m.role === 'admin') {
        candidates.push({ user_id: m.user_id, name: m.user?.name || '', email: m.user?.email || '', role: m.role, level: 'write' });
        continue;
      }
      // member — qbill level 평가
      const perm = await BusinessMemberPermission.findOne({
        where: { business_id: businessId, user_id: m.user_id, menu_key: 'qbill' },
        attributes: ['level'],
      });
      const level = perm?.level || 'write';
      if (level === 'write') {
        candidates.push({ user_id: m.user_id, name: m.user?.name || '', email: m.user?.email || '', role: m.role, level });
      }
    }
    return successResponse(res, candidates);
  } catch (e) { next(e); }
});

// PUT — workspace default_billing_owner 변경
router.put('/:businessId/default-billing-owner', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const { user_id } = req.body;

    const adm = await assertWorkspaceAdmin(req.user.id, businessId);
    if (!adm.ok) return errorResponse(res, adm.code, 403);

    const biz = await Business.findByPk(businessId);
    if (!biz) return errorResponse(res, 'not_found', 404);
    const oldValue = biz.default_billing_owner_id;

    if (user_id != null) {
      // 후보 검증 — write 권한자만 OK
      const targetMember = await BusinessMember.findOne({
        where: { business_id: businessId, user_id: Number(user_id), removed_at: null },
        attributes: ['role'],
      });
      if (!targetMember) return errorResponse(res, 'target_not_member', 404);
      if (!['owner', 'admin'].includes(targetMember.role)) {
        const perm = await BusinessMemberPermission.findOne({
          where: { business_id: businessId, user_id: Number(user_id), menu_key: 'qbill' },
        });
        const level = perm?.level || 'write';
        if (level !== 'write') return errorResponse(res, 'target_lacks_qbill_write', 400);
      }
    }
    await biz.update({ default_billing_owner_id: user_id || null });
    require('../services/auditService').logAudit(req, {
      action: 'business.default_billing_owner.update',
      targetType: 'business',
      targetId: businessId,
      oldValue: { default_billing_owner_id: oldValue },
      newValue: { default_billing_owner_id: user_id || null },
    });
    return successResponse(res, { default_billing_owner_id: user_id || null });
  } catch (e) { next(e); }
});

// ─── Cue 설정·사용량 조회 ───
router.get('/:businessId/cue', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const business = await Business.findByPk(req.params.businessId, {
      include: [{ model: User, as: 'cueUser', attributes: ['id', 'name', 'avatar_url'] }]
    });
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const ym = currentYearMonth();
    const rows = await CueUsage.findAll({
      where: { business_id: business.id, year_month: ym }
    });

    const totalCount = rows.reduce((sum, r) => sum + (r.action_count || 0), 0);
    const totalCost = rows.reduce((sum, r) => sum + Number(r.cost_usd || 0), 0);
    const byType = {};
    rows.forEach(r => { byType[r.action_type] = r.action_count; });

    const limit = PLAN_CUE_LIMITS[business.plan] || PLAN_CUE_LIMITS.free;

    successResponse(res, {
      cue_user_id: business.cue_user_id,
      cue_user: business.cueUser,
      mode: business.cue_mode,
      paused: business.cue_paused,
      usage: {
        year_month: ym,
        action_count: totalCount,
        limit,
        remaining: Math.max(0, limit - totalCount),
        cost_usd: Number(totalCost.toFixed(6)),
        by_type: byType
      }
    });
  } catch (error) {
    next(error);
  }
});

// ─── Cue 모드·일시정지 설정 ───
router.put('/:businessId/cue', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const business = await Business.findByPk(req.params.businessId);
    if (!business) return errorResponse(res, 'Workspace not found', 404);

    const { mode, paused } = req.body;
    const updates = {};
    if (mode !== undefined) {
      if (!['smart', 'auto', 'draft'].includes(mode)) {
        return errorResponse(res, 'Invalid mode', 400);
      }
      updates.cue_mode = mode;
    }
    if (paused !== undefined) updates.cue_paused = !!paused;

    await business.update(updates);

    await createAuditLog({
      userId: req.user.id,
      businessId: business.id,
      action: updates.paused ? 'cue.pause' : (updates.cue_mode ? 'cue.mode_change' : 'cue.resume'),
      targetType: 'business',
      targetId: business.id,
      newValue: updates
    });

    successResponse(res, {
      mode: business.cue_mode,
      paused: business.cue_paused
    });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/businesses/:id/members/:memberId/work-hours ───
router.patch('/:id/members/:memberId/work-hours', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.id);
    // 본인 또는 admin만
    const member = await BusinessMember.findOne({ where: { id: req.params.memberId, business_id: businessId } });
    if (!member) return errorResponse(res, 'member_not_found', 404);
    if (member.user_id !== req.user.id) {
      const reqMember = await BusinessMember.findOne({ where: { business_id: businessId, user_id: req.user.id } });
      if (!reqMember || (reqMember.role !== 'owner' && req.user.platform_role !== 'platform_admin')) {
        return errorResponse(res, 'forbidden', 403);
      }
    }
    const updates = {};
    if (req.body.daily_work_hours !== undefined) updates.daily_work_hours = Math.max(0, Math.min(24, Number(req.body.daily_work_hours) || 0));
    if (req.body.weekly_work_days !== undefined) updates.weekly_work_days = Math.max(1, Math.min(7, Number(req.body.weekly_work_days) || 5));
    if (req.body.participation_rate !== undefined) updates.participation_rate = Math.max(0, Math.min(1, Number(req.body.participation_rate) || 1));
    await member.update(updates);
    return successResponse(res, member.toJSON());
  } catch (err) { next(err); }
});

// ─── PATCH /api/businesses/:id/members/:memberId/default-role ───
router.patch('/:id/members/:memberId/default-role', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.id);
    // 권한 확인: owner만
    const reqMember = await BusinessMember.findOne({ where: { business_id: businessId, user_id: req.user.id } });
    if (!reqMember || (reqMember.role !== 'owner' && req.user.platform_role !== 'platform_admin')) {
      return errorResponse(res, 'admin_only', 403);
    }
    const member = await BusinessMember.findOne({
      where: { id: req.params.memberId, business_id: businessId },
    });
    if (!member) return errorResponse(res, 'member_not_found', 404);
    const { default_role } = req.body || {};
    await member.update({ default_role: default_role ? String(default_role).trim().slice(0, 50) : null });
    return successResponse(res, member.toJSON());
  } catch (err) { next(err); }
});

// ─── PATCH /api/businesses/:id/members/:memberId/role — 역할 변경 (owner ↔ member) ───
router.patch('/:id/members/:memberId/role', authenticateToken, async (req, res, next) => {
  const { sequelize } = require('../config/database');
  const t = await sequelize.transaction();
  try {
    const businessId = Number(req.params.id);
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    const reqMember = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: req.user.id }, transaction: t,
    });
    if (!isPlatformAdmin && (!reqMember || reqMember.role !== 'owner')) {
      await t.rollback();
      return errorResponse(res, 'admin_only', 403);
    }
    const member = await BusinessMember.findOne({
      where: { id: req.params.memberId, business_id: businessId },
      transaction: t, lock: t.LOCK.UPDATE,
    });
    if (!member) { await t.rollback(); return errorResponse(res, 'member_not_found', 404); }
    if (member.role === 'ai') { await t.rollback(); return errorResponse(res, 'ai_role_locked', 400); }

    const nextRole = req.body?.role;
    if (!['owner', 'member'].includes(nextRole)) { await t.rollback(); return errorResponse(res, 'invalid_role', 400); }
    if (member.role === nextRole) { await t.rollback(); return successResponse(res, member.toJSON()); }

    // 마지막 오너 강등 방지 (FOR UPDATE 잠금으로 race 방어)
    if (member.role === 'owner' && nextRole === 'member') {
      const otherOwners = await BusinessMember.count({
        where: { business_id: businessId, role: 'owner', id: { [require('sequelize').Op.ne]: member.id } },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (otherOwners === 0) { await t.rollback(); return errorResponse(res, 'last_owner_protection', 409); }
    }

    await member.update({ role: nextRole }, { transaction: t });
    await t.commit();
    return successResponse(res, member.toJSON());
  } catch (err) { await t.rollback().catch(() => {}); next(err); }
});

// ─── DELETE /api/businesses/:id/members/:memberId — 멤버 제거 (soft) ───
// 오너 또는 본인 자신이 나갈 때 허용. 마지막 오너 제거 금지.
router.delete('/:id/members/:memberId', authenticateToken, async (req, res, next) => {
  const { sequelize } = require('../config/database');
  const t = await sequelize.transaction();
  try {
    const businessId = Number(req.params.id);
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    const member = await BusinessMember.findOne({
      where: { id: req.params.memberId, business_id: businessId },
      transaction: t, lock: t.LOCK.UPDATE,
    });
    if (!member) { await t.rollback(); return errorResponse(res, 'member_not_found', 404); }
    if (member.role === 'ai') { await t.rollback(); return errorResponse(res, 'ai_role_locked', 400); }

    const reqMember = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: req.user.id }, transaction: t,
    });
    const isOwner = reqMember && reqMember.role === 'owner';
    const isSelf = member.user_id && member.user_id === req.user.id;
    if (!isPlatformAdmin && !isOwner && !isSelf) {
      await t.rollback();
      return errorResponse(res, 'forbidden', 403);
    }

    // 마지막 오너 제거 금지 (FOR UPDATE 로 동시 강등/제거 race 방어)
    if (member.role === 'owner') {
      const otherOwners = await BusinessMember.count({
        where: { business_id: businessId, role: 'owner', id: { [require('sequelize').Op.ne]: member.id } },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (otherOwners === 0) { await t.rollback(); return errorResponse(res, 'last_owner_protection', 409); }
    }

    await member.update({ removed_at: new Date(), removed_by: req.user.id }, { transaction: t });
    await t.commit();
    // 사이클 N+21 — 인사 변경 audit log (가장 중요한 영역)
    require('../services/auditService').logAudit(req, {
      action: 'business_member.remove',
      targetType: 'business_member',
      targetId: member.id,
      oldValue: { user_id: member.user_id, role: member.role },
      newValue: { removed_at: 'now' },
    });
    return successResponse(res, { id: member.id, removed: true });
  } catch (err) { await t.rollback().catch(() => {}); next(err); }
});

// ─────────────────────────────────────────────
// 권한 정책 (PERMISSION_MATRIX §4) — financial/schedule/client_info 3축.
// 조회: member+ (투명성 원칙). 편집: owner/platform_admin.
// ─────────────────────────────────────────────
const VALID_TOGGLES = ['financial', 'schedule', 'client_info'];
const VALID_VALUES = ['all', 'pm'];

router.get('/:businessId/permissions', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const biz = await Business.findByPk(businessId, { attributes: ['permissions'] });
    if (!biz) return errorResponse(res, 'business_not_found', 404);

    // 현재 값 (NULL 이면 기본값)
    const permissions = biz.permissions && typeof biz.permissions === 'object'
      ? {
          financial: biz.permissions.financial === 'pm' ? 'pm' : 'all',
          schedule: biz.permissions.schedule === 'pm' ? 'pm' : 'all',
          client_info: biz.permissions.client_info === 'pm' ? 'pm' : 'all',
        }
      : { financial: 'all', schedule: 'all', client_info: 'all' };

    // 프리뷰용 카운트
    // memberTotal = 활성 owner + member (ai 제외, removed_at 자동 필터)
    const memberTotal = await BusinessMember.count({
      where: { business_id: businessId, role: { [require('sequelize').Op.in]: ['owner', 'member'] } },
    });

    // pmTotal = 이 워크스페이스 프로젝트들에서 PM 으로 배정된 고유 user 수
    const { ProjectMember, Project } = require('../models');
    const projects = await Project.findAll({ where: { business_id: businessId }, attributes: ['id'] });
    const projIds = projects.map(p => p.id);
    let pmTotal = 0;
    if (projIds.length > 0) {
      const pms = await ProjectMember.findAll({
        where: { project_id: { [require('sequelize').Op.in]: projIds }, is_pm: true },
        attributes: ['user_id'],
      });
      pmTotal = new Set(pms.map(p => p.user_id)).size;
    }

    return successResponse(res, {
      permissions,
      stats: { memberTotal, pmTotal },
    });
  } catch (err) { next(err); }
});

router.put('/:businessId/permissions', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'owner_only', 403);

    const businessId = Number(req.params.businessId);
    const biz = await Business.findByPk(businessId);
    if (!biz) return errorResponse(res, 'business_not_found', 404);

    const input = req.body?.permissions;
    if (!input || typeof input !== 'object') return errorResponse(res, 'permissions_required', 400);

    // sanitize — 알려진 키/값만 수용
    const next = {
      financial: biz.permissions?.financial || 'all',
      schedule: biz.permissions?.schedule || 'all',
      client_info: biz.permissions?.client_info || 'all',
    };
    for (const k of VALID_TOGGLES) {
      if (input[k] !== undefined) {
        if (!VALID_VALUES.includes(input[k])) return errorResponse(res, `invalid value for ${k}`, 400);
        next[k] = input[k];
      }
    }

    const before = { ...next, ...(biz.permissions || {}) };
    await biz.update({ permissions: next });

    await createAuditLog({
      userId: req.user.id, businessId,
      action: 'business.permissions_updated',
      targetType: 'business', targetId: businessId,
      oldValue: before, newValue: next,
    }).catch(() => { /* 감사 실패는 swallow */ });

    return successResponse(res, { permissions: next });
  } catch (err) { next(err); }
});

// ============================================
// GET /api/businesses/:businessId/me/profile
// 현재 워크스페이스의 자기 BusinessMember (또는 Client) 표시명 조회
// ============================================
router.get('/:businessId/me/profile', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (req.businessRole === 'client') {
      const cl = await Client.findOne({ where: { user_id: req.user.id, business_id: businessId } });
      if (!cl) return errorResponse(res, 'forbidden', 403);
      return successResponse(res, {
        scope: 'client',
        name: cl.display_name,
        name_localized: cl.display_name_localized,
      });
    }
    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: businessId } });
    if (!bm) return errorResponse(res, 'forbidden', 403);
    return successResponse(res, {
      scope: 'member',
      name: bm.name,
      name_localized: bm.name_localized,
      role: bm.role,
      // Q Note 답변 생성용 (워크스페이스 단위)
      bio: bm.bio,
      expertise: bm.expertise,
      organization: bm.organization,
      job_title: bm.job_title,
      expertise_level: bm.expertise_level,
      language_levels: bm.language_levels,
      answer_style_default: bm.answer_style_default,
      answer_length_default: bm.answer_length_default,
    });
  } catch (err) { next(err); }
});

// ============================================
// PUT /api/businesses/:businessId/me/profile
// 워크스페이스별 멤버 표시명 (BusinessMember 또는 Client) 수정
// body: { name?, name_localized? } — name_localized 는 { ko, en, ja, zh, es } 객체 또는 null
// ============================================
router.put('/:businessId/me/profile', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const {
      name, name_localized,
      bio, expertise, organization, job_title,
      expertise_level, language_levels,
      answer_style_default, answer_length_default,
    } = req.body || {};

    let cleanName;
    if (name !== undefined) {
      if (name === null || name === '') {
        cleanName = null;
      } else if (typeof name !== 'string' || name.length > 100) {
        return errorResponse(res, 'invalid_name', 400);
      } else {
        cleanName = name.trim();
      }
    }

    let cleanLoc;
    if (name_localized !== undefined) {
      if (name_localized === null) {
        cleanLoc = null;
      } else if (typeof name_localized !== 'object' || Array.isArray(name_localized)) {
        return errorResponse(res, 'invalid_name_localized', 400);
      } else {
        const allowed = ['ko', 'en', 'ja', 'zh', 'es'];
        const cleaned = {};
        for (const [k, v] of Object.entries(name_localized)) {
          if (!allowed.includes(k)) continue;
          if (v == null || v === '') continue;
          if (typeof v !== 'string' || v.length > 100) {
            return errorResponse(res, `name_localized_${k}_invalid`, 400);
          }
          cleaned[k] = v.trim();
        }
        cleanLoc = Object.keys(cleaned).length ? cleaned : null;
      }
    }

    const updates = {};
    if (cleanName !== undefined) updates.name = cleanName;
    if (cleanLoc !== undefined) updates.name_localized = cleanLoc;

    // Q Note 프로필 (멤버만)
    if (bio !== undefined) {
      if (bio !== null && typeof bio !== 'string') return errorResponse(res, 'invalid_bio', 400);
      if (bio && bio.length > 2000) return errorResponse(res, 'bio_too_long', 400);
      updates.bio = bio || null;
    }
    if (expertise !== undefined) {
      if (expertise !== null && typeof expertise !== 'string') return errorResponse(res, 'invalid_expertise', 400);
      if (expertise && expertise.length > 500) return errorResponse(res, 'expertise_too_long', 400);
      updates.expertise = expertise || null;
    }
    if (organization !== undefined) {
      if (organization !== null && typeof organization !== 'string') return errorResponse(res, 'invalid_organization', 400);
      if (organization && organization.length > 200) return errorResponse(res, 'organization_too_long', 400);
      updates.organization = organization || null;
    }
    if (job_title !== undefined) {
      if (job_title !== null && typeof job_title !== 'string') return errorResponse(res, 'invalid_job_title', 400);
      if (job_title && job_title.length > 100) return errorResponse(res, 'job_title_too_long', 400);
      updates.job_title = job_title || null;
    }
    if (expertise_level !== undefined) {
      const allowed = ['novice', 'beginner', 'intermediate', 'advanced', 'expert',
                       // 호환: 기존 3단계 값도 허용
                       'layman', 'practitioner'];
      if (expertise_level !== null && !allowed.includes(expertise_level)) {
        return errorResponse(res, 'invalid_expertise_level', 400);
      }
      updates.expertise_level = expertise_level || null;
    }
    if (language_levels !== undefined) {
      if (language_levels !== null && (typeof language_levels !== 'object' || Array.isArray(language_levels))) {
        return errorResponse(res, 'invalid_language_levels', 400);
      }
      updates.language_levels = language_levels;
    }
    if (answer_style_default !== undefined) {
      if (answer_style_default !== null && typeof answer_style_default !== 'string') return errorResponse(res, 'invalid_answer_style', 400);
      if (answer_style_default && answer_style_default.length > 2000) return errorResponse(res, 'answer_style_too_long', 400);
      updates.answer_style_default = answer_style_default || null;
    }
    if (answer_length_default !== undefined) {
      if (answer_length_default !== null && !['short', 'medium', 'long'].includes(answer_length_default)) {
        return errorResponse(res, 'invalid_answer_length', 400);
      }
      updates.answer_length_default = answer_length_default || 'medium';
    }

    if (req.businessRole === 'client') {
      const cl = await Client.findOne({ where: { user_id: req.user.id, business_id: businessId } });
      if (!cl) return errorResponse(res, 'forbidden', 403);
      const clUpdates = {};
      if ('name' in updates) clUpdates.display_name = updates.name;
      if ('name_localized' in updates) clUpdates.display_name_localized = updates.name_localized;
      await cl.update(clUpdates);
      return successResponse(res, {
        scope: 'client',
        name: cl.display_name,
        name_localized: cl.display_name_localized,
      });
    }

    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: businessId } });
    if (!bm) return errorResponse(res, 'forbidden', 403);
    await bm.update(updates);
    return successResponse(res, {
      scope: 'member',
      name: bm.name,
      name_localized: bm.name_localized,
    });
  } catch (err) { next(err); }
});

module.exports = router;
