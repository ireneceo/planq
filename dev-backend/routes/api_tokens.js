// API 토큰 관리 — 외부 에이전트(MCP 읽기 서버)용 워크스페이스 스코프 토큰 (#D-4).
//   발급: 멤버 이상만, 본인×워크스페이스 단위. 평문은 발급 응답에 1회만 — 이후 해시만 저장.
//   회수: 소유자 본인. MCP 서버는 이 토큰을 getUserScope 로 교환해 읽기만 수행(쓰기 스코프 없음).
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { ApiToken, Business } = require('../models');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { getUserScope, isMemberOrAbove } = require('../middleware/access_scope');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function serialize(t) {
  return {
    id: t.id,
    business_id: t.business_id,
    name: t.name,
    scopes: t.scopes || ['read'],
    last_used_at: t.last_used_at,
    expires_at: t.expires_at,
    revoked_at: t.revoked_at,
    created_at: t.created_at,
  };
}

async function assertMember(req, businessId) {
  const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
  return isMemberOrAbove(scope);
}

// GET /api/api-tokens?business_id= — 내 토큰 목록 (평문 없음)
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertMember(req, businessId))) return errorResponse(res, 'forbidden', 403);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 100, maxLimit: 200 });
    const { rows, count } = await ApiToken.findAndCountAll({
      where: { user_id: req.user.id, business_id: businessId },
      order: [['created_at', 'DESC']],
      limit, offset,
    });
    return paginatedResponse(res, rows.map(serialize), count, { limit, page, offset });
  } catch (err) { next(err); }
});

// POST /api/api-tokens — 발급. 응답에 평문 token 1회 노출 (이후 조회 불가)
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.body?.business_id);
    const name = (req.body?.name || '').toString().trim().slice(0, 120) || null;
    const expiresDays = Number(req.body?.expires_days);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertMember(req, businessId))) return errorResponse(res, 'forbidden', 403);

    const biz = await Business.findByPk(businessId, { attributes: ['id'] });
    if (!biz) return errorResponse(res, 'invalid_business', 400);

    // 평문 = planq_mcp_<43자 base64url> — 추측 불가. DB 엔 sha256 만.
    const plaintext = `planq_mcp_${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAt = Number.isFinite(expiresDays) && expiresDays > 0
      ? new Date(Date.now() + Math.min(expiresDays, 365) * 86400000) : null;

    const row = await ApiToken.create({
      user_id: req.user.id, business_id: businessId, name,
      token_hash: sha256(plaintext),
      scopes: ['read'],   // 읽기 전용 고정 (쓰기 스코프는 이 표면에 없다)
      expires_at: expiresAt,
    });

    require('../services/auditService').logAudit(req, {
      action: 'api_token.create', targetType: 'api_token', targetId: row.id, businessId,
      newValue: { name, expires_at: expiresAt },
    });

    // token 은 여기서만 — 다시 볼 수 없다
    return successResponse(res, { ...serialize(row), token: plaintext }, 'created', 201);
  } catch (err) { next(err); }
});

// DELETE /api/api-tokens/:id — 회수 (소유자 본인)
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const row = await ApiToken.findByPk(Number(req.params.id));
    if (!row) return errorResponse(res, 'not_found', 404);
    if (row.user_id !== req.user.id) return errorResponse(res, 'forbidden', 403);
    if (!row.revoked_at) await row.update({ revoked_at: new Date() });
    require('../services/auditService').logAudit(req, {
      action: 'api_token.revoke', targetType: 'api_token', targetId: row.id, businessId: row.business_id,
    });
    return successResponse(res, { revoked: true, id: row.id });
  } catch (err) { next(err); }
});

module.exports = router;
