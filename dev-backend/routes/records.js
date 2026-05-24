// Q record — 동적 테이블 (Notion DB 패턴) CRUD.
// project_id NULL = 워크스페이스 전역, NOT NULL = 프로젝트 소속.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Op } = require('sequelize');
const { QRecord, QRecordRow, QRecordAudit, User, Project, BusinessMember } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { applyMemberDisplayName, applyMemberDisplayNameOne } = require('../services/displayName');

// ─── 권한 헬퍼 ───
async function assertMember(userId, businessId, isPlatformAdmin) {
  if (isPlatformAdmin) return true;
  const m = await BusinessMember.findOne({ where: { business_id: businessId, user_id: userId } });
  return !!m;
}
async function getRole(userId, businessId, isPlatformAdmin) {
  if (isPlatformAdmin) return 'platform_admin';
  const m = await BusinessMember.findOne({ where: { business_id: businessId, user_id: userId }, attributes: ['role'] });
  return m?.role || null;
}
function newColId() { return 'c' + crypto.randomBytes(4).toString('hex'); }

function maskSecret(value) {
  if (value == null || value === '') return '';
  return '••••••';
}

// 응답에서 secret 컬럼 마스킹 — 모든 행 처리.
// reveal 별도 endpoint 로만 평문 반환 (감사 로그 기록).
function maskRowsForSecrets(rows, columns) {
  const secretIds = (columns || []).filter(c => c.type === 'secret').map(c => c.id);
  if (secretIds.length === 0) return rows;
  return rows.map(r => {
    const v = { ...(r.values || {}) };
    for (const id of secretIds) {
      if (v[id] != null && v[id] !== '') v[id] = maskSecret(v[id]);
    }
    return { ...r.toJSON ? r.toJSON() : r, values: v };
  });
}

// ─── 목록 (워크스페이스 전체) ───
// GET /api/records?business_id=X&project_id=Y&category=Z
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    const isAdmin = req.user.platform_role === 'platform_admin';
    if (!(await assertMember(req.user.id, businessId, isAdmin))) return errorResponse(res, 'forbidden', 403);

    const where = { business_id: businessId };
    if (req.query.project_id) where.project_id = Number(req.query.project_id);
    if (req.query.category) where.category = req.query.category;

    // 사이클 N+50 — pagination. Q Records (Q info) 누적 가능 — default 200 / max 500
    const { parsePagination, paginatedResponse } = require('../middleware/errorHandler');
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows: records, count } = await QRecord.findAndCountAll({
      where,
      order: [['position', 'ASC'], ['created_at', 'DESC']],
      include: [
        { model: User, as: 'creator', attributes: ['id', 'name'] },
        { model: Project, attributes: ['id', 'name'] },
      ],
      limit, offset,
      distinct: true,
    });

    // 행 카운트도 같이
    const ids = records.map(r => r.id);
    const counts = ids.length > 0
      ? await QRecordRow.findAll({
          attributes: ['q_record_id', [require('sequelize').fn('COUNT', '*'), 'cnt']],
          where: { q_record_id: { [Op.in]: ids } },
          group: ['q_record_id'],
        })
      : [];
    const cmap = Object.fromEntries(counts.map(c => [c.q_record_id, Number(c.get('cnt'))]));

    const data = records.map(r => ({
      ...r.toJSON(),
      row_count: cmap[r.id] || 0,
    }));
    await applyMemberDisplayName(data, businessId, ['creator']);
    return paginatedResponse(res, data, count, { limit, page, offset });
  } catch (err) { next(err); }
});

// ─── 카테고리 목록 ───
// GET /api/records/categories?business_id=X
router.get('/categories', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    const isAdmin = req.user.platform_role === 'platform_admin';
    if (!(await assertMember(req.user.id, businessId, isAdmin))) return errorResponse(res, 'forbidden', 403);
    const rows = await QRecord.findAll({
      attributes: ['category'],
      where: { business_id: businessId, category: { [Op.ne]: null } },
      group: ['category'],
    });
    successResponse(res, rows.map(r => r.category).filter(Boolean));
  } catch (err) { next(err); }
});

// ─── 생성 ───
// POST /api/records  body: { business_id, project_id?, name, category?, description?, columns? }
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, project_id = null, name, category = null, description = null, columns = null } = req.body || {};
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (!name || !String(name).trim()) return errorResponse(res, 'name required', 400);
    const isAdmin = req.user.platform_role === 'platform_admin';
    if (!(await assertMember(req.user.id, Number(business_id), isAdmin))) return errorResponse(res, 'forbidden', 403);

    if (project_id) {
      const p = await Project.findOne({ where: { id: project_id, business_id } });
      if (!p) return errorResponse(res, 'invalid project_id', 400);
    }
    // 기본 컬럼 — 비어있으면 단순 1 컬럼 (이름)
    const defaultCols = [{ id: newColId(), name: '제목', type: 'text', order: 0 }];
    const cols = Array.isArray(columns) && columns.length > 0
      ? columns.map((c, i) => ({ id: c.id || newColId(), name: String(c.name || `컬럼 ${i+1}`), type: c.type || 'text', options: c.options, order: i }))
      : defaultCols;

    const r = await QRecord.create({
      business_id, project_id: project_id || null, name: String(name).trim(),
      category: category ? String(category).slice(0, 80) : null,
      description: description ? String(description).slice(0, 500) : null,
      columns: cols, created_by: req.user.id,
    });
    await QRecordAudit.create({ q_record_id: r.id, user_id: req.user.id, action: 'record.create' });
    successResponse(res, r.toJSON(), 'record created', 201);
  } catch (err) { next(err); }
});

// ─── 상세 + 행 ───
// GET /api/records/:id
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const r = await QRecord.findByPk(req.params.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'name'] },
        { model: Project, attributes: ['id', 'name'] },
      ],
    });
    if (!r) return errorResponse(res, 'not_found', 404);
    const isAdmin = req.user.platform_role === 'platform_admin';
    if (!(await assertMember(req.user.id, r.business_id, isAdmin))) return errorResponse(res, 'forbidden', 403);
    const rBusinessId = r.business_id;

    // read_policy=owner 면 owner+admin 만
    if (r.read_policy === 'owner') {
      const role = await getRole(req.user.id, r.business_id, isAdmin);
      if (!['owner', 'platform_admin'].includes(role)) return errorResponse(res, 'forbidden', 403);
    }

    const rows = await QRecordRow.findAll({
      where: { q_record_id: r.id },
      order: [['position', 'ASC'], ['id', 'ASC']],
    });
    const masked = maskRowsForSecrets(rows, r.columns);
    const json = { ...r.toJSON(), rows: masked };
    await applyMemberDisplayNameOne(json, rBusinessId, ['creator']);
    successResponse(res, json);
  } catch (err) { next(err); }
});

// ─── 메타 수정 (이름·카테고리·설명·read_policy·columns) ───
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const r = await QRecord.findByPk(req.params.id);
    if (!r) return errorResponse(res, 'not_found', 404);
    const isAdmin = req.user.platform_role === 'platform_admin';
    if (!(await assertMember(req.user.id, r.business_id, isAdmin))) return errorResponse(res, 'forbidden', 403);

    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name).slice(0, 200);
    if (req.body.category !== undefined) patch.category = req.body.category ? String(req.body.category).slice(0, 80) : null;
    if (req.body.description !== undefined) patch.description = req.body.description ? String(req.body.description).slice(0, 500) : null;
    if (req.body.read_policy !== undefined && ['all', 'owner'].includes(req.body.read_policy)) patch.read_policy = req.body.read_policy;
    if (Array.isArray(req.body.columns)) {
      patch.columns = req.body.columns.map((c, i) => ({
        id: c.id || newColId(),
        name: String(c.name || `컬럼 ${i+1}`),
        type: c.type || 'text',
        options: c.options,
        aggregate: c.aggregate || undefined,  // footer 집계 (sum/avg/count 등) — 누락 시 보존 안 됨 회귀 fix
        order: i,
      }));
    }
    await r.update(patch);
    await QRecordAudit.create({ q_record_id: r.id, user_id: req.user.id, action: 'record.update', meta: { fields: Object.keys(patch) } });
    successResponse(res, r.toJSON());
  } catch (err) { next(err); }
});

// ─── 삭제 ───
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const r = await QRecord.findByPk(req.params.id);
    if (!r) return errorResponse(res, 'not_found', 404);
    const isAdmin = req.user.platform_role === 'platform_admin';
    if (!(await assertMember(req.user.id, r.business_id, isAdmin))) return errorResponse(res, 'forbidden', 403);
    const role = await getRole(req.user.id, r.business_id, isAdmin);
    if (!['owner', 'platform_admin'].includes(role) && r.created_by !== req.user.id) {
      return errorResponse(res, '오너 또는 작성자만 삭제할 수 있습니다', 403);
    }
    await QRecordAudit.create({ q_record_id: r.id, user_id: req.user.id, action: 'record.delete' });
    await QRecordRow.destroy({ where: { q_record_id: r.id } });
    await r.destroy();
    successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

// ─── 행 추가 ───
router.post('/:id/rows', authenticateToken, async (req, res, next) => {
  try {
    const r = await QRecord.findByPk(req.params.id);
    if (!r) return errorResponse(res, 'not_found', 404);
    const isAdmin = req.user.platform_role === 'platform_admin';
    if (!(await assertMember(req.user.id, r.business_id, isAdmin))) return errorResponse(res, 'forbidden', 403);

    const last = await QRecordRow.max('position', { where: { q_record_id: r.id } });
    const row = await QRecordRow.create({
      q_record_id: r.id,
      values: req.body.values || {},
      position: (last || 0) + 1,
      created_by: req.user.id,
    });
    await QRecordAudit.create({ q_record_id: r.id, q_record_row_id: row.id, user_id: req.user.id, action: 'row.create' });
    // 응답에서 secret 마스킹
    const masked = maskRowsForSecrets([row], r.columns)[0];
    successResponse(res, masked, 'row created', 201);
  } catch (err) { next(err); }
});

// ─── 행 수정 ───
router.put('/:id/rows/:rowId', authenticateToken, async (req, res, next) => {
  try {
    const r = await QRecord.findByPk(req.params.id);
    if (!r) return errorResponse(res, 'not_found', 404);
    const isAdmin = req.user.platform_role === 'platform_admin';
    if (!(await assertMember(req.user.id, r.business_id, isAdmin))) return errorResponse(res, 'forbidden', 403);
    const row = await QRecordRow.findOne({ where: { id: req.params.rowId, q_record_id: r.id } });
    if (!row) return errorResponse(res, 'row not_found', 404);

    const patch = {};
    if (req.body.values !== undefined) {
      // 마스킹된 값 ('••••••') 은 무시 — 실제 값만 업데이트
      const newValues = { ...(row.values || {}) };
      for (const [k, v] of Object.entries(req.body.values)) {
        if (v === '••••••') continue;
        newValues[k] = v;
      }
      patch.values = newValues;
    }
    if (req.body.position !== undefined) patch.position = Number(req.body.position);
    patch.updated_by = req.user.id;
    await row.update(patch);
    await QRecordAudit.create({ q_record_id: r.id, q_record_row_id: row.id, user_id: req.user.id, action: 'row.update' });
    const masked = maskRowsForSecrets([row], r.columns)[0];
    successResponse(res, masked);
  } catch (err) { next(err); }
});

// ─── 행 삭제 ───
router.delete('/:id/rows/:rowId', authenticateToken, async (req, res, next) => {
  try {
    const r = await QRecord.findByPk(req.params.id);
    if (!r) return errorResponse(res, 'not_found', 404);
    const isAdmin = req.user.platform_role === 'platform_admin';
    if (!(await assertMember(req.user.id, r.business_id, isAdmin))) return errorResponse(res, 'forbidden', 403);
    const row = await QRecordRow.findOne({ where: { id: req.params.rowId, q_record_id: r.id } });
    if (!row) return errorResponse(res, 'row not_found', 404);
    await QRecordAudit.create({ q_record_id: r.id, q_record_row_id: row.id, user_id: req.user.id, action: 'row.delete' });
    await row.destroy();
    successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

// ─── 시크릿 reveal ───
// GET /api/records/:id/rows/:rowId/secret/:colId  →  { value }
router.get('/:id/rows/:rowId/secret/:colId', authenticateToken, async (req, res, next) => {
  try {
    const r = await QRecord.findByPk(req.params.id);
    if (!r) return errorResponse(res, 'not_found', 404);
    const isAdmin = req.user.platform_role === 'platform_admin';
    if (!(await assertMember(req.user.id, r.business_id, isAdmin))) return errorResponse(res, 'forbidden', 403);
    const row = await QRecordRow.findOne({ where: { id: req.params.rowId, q_record_id: r.id } });
    if (!row) return errorResponse(res, 'row not_found', 404);
    const col = (r.columns || []).find(c => c.id === req.params.colId);
    if (!col || col.type !== 'secret') return errorResponse(res, 'not a secret column', 400);
    const value = (row.values || {})[col.id] || '';
    await QRecordAudit.create({
      q_record_id: r.id, q_record_row_id: row.id,
      user_id: req.user.id, action: 'secret.reveal', field: col.id,
    });
    successResponse(res, { value });
  } catch (err) { next(err); }
});

module.exports = router;
