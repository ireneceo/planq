// 워크스페이스 휴일·근무일 설정 (#424) — 설계 docs/WORKDAY_HOLIDAY_DESIGN.md §5
//
// 마운트: `/api/businesses` 접두어(businesses.js 와 공유). 이 파일에는 `/:businessId/holiday…` 꼬리 경로만 둔다.
// 권한: 읽기 = 워크스페이스 멤버(고객 제외) · 쓰기 = owner/admin(+platform_admin) — report-settings 와 같은 식.
// ★ 모든 쿼리에 business_id. 남의 워크스페이스 행 id 로 고치려 하면 404.
// ★ 쓰기 후 `holiday:updated` 는 **신호만** 보낸다(id 만). 받는 화면이 다시 읽는다(CLAUDE.md §16).
const express = require('express');
const { WorkspaceHoliday, Business } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');
const wh = require('../services/workspaceHolidays');
const { ymd, todayInTz } = require('../utils/datetime');

const router = express.Router();

const canWrite = (req) => req.user?.platform_role === 'platform_admin'
  || req.businessRole === 'owner' || req.businessRole === 'admin';
const blockClient = (req, res) => {
  if (req.businessRole === 'client') { errorResponse(res, 'forbidden', 403); return true; }
  return false;
};
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const validYmd = (v) => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const cleanName = (v, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function serialize(r, weekdays) {
  const d = ymd(r.date);
  return {
    id: r.id, date: d, name: r.name, name_en: r.name_en || null,
    source: r.source, is_off: !!r.is_off,
    on_workday: weekdays.has(new Date(`${d}T00:00:00Z`).getUTCDay()),
  };
}

function signal(req, businessId) {
  const io = req.app.get('io');
  if (io) io.to(`business:${businessId}`).emit('holiday:updated', { business_id: businessId });
}

// GET /api/businesses/:businessId/holidays?year=2026
router.get('/:businessId/holidays', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (blockClient(req, res)) return;
    const businessId = Number(req.params.businessId);
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'work_hours', 'timezone', 'holiday_country'] });
    if (!biz) return errorResponse(res, 'Workspace not found', 404);
    const today = todayInTz(biz.timezone || 'Asia/Seoul');
    const thisYear = Number(today.slice(0, 4));
    const y = Number(req.query.year) || thisYear;
    if (y < 2000 || y > 2100) return errorResponse(res, 'invalid_year', 400);
    // 관리자가 그 해를 열면 국가 행을 채운다(읽는 계산 경로는 쓰지 않는다 — 여기·국가 저장·cron 만).
    if (canWrite(req) && biz.holiday_country) await wh.ensureNationalRows(businessId, biz.holiday_country, y, { fromDate: today });
    const rows = await WorkspaceHoliday.findAll({
      where: { business_id: businessId, date: { [require('sequelize').Op.between]: [`${y}-01-01`, `${y}-12-31`] } },
      order: [['date', 'ASC']],
      limit: 400,   // 한 해 목록 — 날짜 UNIQUE 라 366 을 넘을 수 없다. 상한은 명시해 둔다.
    });
    const weekdays = wh.workWeekdaysOf(biz);
    return successResponse(res, {
      year: y,
      country: biz.holiday_country || null,
      supported_countries: wh.SUPPORTED_COUNTRIES,
      work_weekdays: [...weekdays].sort(),
      can_edit: canWrite(req),
      holidays: rows.map((r) => serialize(r, weekdays)),
    });
  } catch (err) { next(err); }
});

// PUT /api/businesses/:businessId/holiday-country { country: 'KR' | null }
router.put('/:businessId/holiday-country', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!canWrite(req)) return errorResponse(res, 'Admin permission required', 403);
    const businessId = Number(req.params.businessId);
    const raw = req.body?.country;
    const next_ = raw === null || raw === '' || raw === undefined ? null : String(raw).toUpperCase();
    if (next_ !== null && !wh.isSupportedCountry(next_)) return errorResponse(res, 'unsupported_country', 400);
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'timezone', 'holiday_country'] });
    if (!biz) return errorResponse(res, 'Workspace not found', 404);
    const prev = biz.holiday_country || null;
    let result = { removed: 0, added: 0 };
    if (prev !== next_) {
      // 국가 값과 휴일 행 교체를 한 트랜잭션으로 — 중간에 실패하면 «국가는 바뀌었는데 행은 옛 나라» 가 남는다.
      const { sequelize } = require('../config/database');
      result = await sequelize.transaction(async (transaction) => {
        await biz.update({ holiday_country: next_ }, { transaction });
        return wh.applyCountryChange(businessId, next_, { transaction, tz: biz.timezone, prevCc: prev });
      });
      logAudit(req, {
        action: 'business.holiday_country_update', targetType: 'business', targetId: businessId, businessId,
        oldValue: { holiday_country: prev }, newValue: { holiday_country: next_, ...result },
      });
      signal(req, businessId);
    }
    return successResponse(res, { country: next_, ...result });
  } catch (err) { next(err); }
});

// POST /api/businesses/:businessId/holidays { date, name, name_en? } — 직접 추가
router.post('/:businessId/holidays', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!canWrite(req)) return errorResponse(res, 'Admin permission required', 403);
    const businessId = Number(req.params.businessId);
    const date = req.body?.date;
    const name = cleanName(req.body?.name);
    const nameEn = cleanName(req.body?.name_en) || null;
    if (!validYmd(date)) return errorResponse(res, 'invalid_date', 400);
    if (!name) return errorResponse(res, 'name_required', 400);
    const exists = await WorkspaceHoliday.findOne({ where: { business_id: businessId, date } });
    if (exists) return errorResponse(res, 'holiday_exists', 409);
    const row = await WorkspaceHoliday.create({
      business_id: businessId, date, name, name_en: nameEn, source: 'custom', is_off: true, created_by: req.user.id,
    });
    logAudit(req, {
      action: 'holiday.create', targetType: 'workspace_holiday', targetId: row.id, businessId,
      newValue: { date, name, name_en: nameEn },
    });
    signal(req, businessId);
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'work_hours'] });
    return successResponse(res, serialize(row, wh.workWeekdaysOf(biz)), null, 201);
  } catch (err) {
    if (err?.name === 'SequelizeUniqueConstraintError') return errorResponse(res, 'holiday_exists', 409);
    next(err);
  }
});

// PATCH /api/businesses/:businessId/holidays/:holidayId { is_off?, name?, name_en? } — 국가 행은 is_off 만
router.patch('/:businessId/holidays/:holidayId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!canWrite(req)) return errorResponse(res, 'Admin permission required', 403);
    const businessId = Number(req.params.businessId);
    const row = await WorkspaceHoliday.findOne({ where: { id: Number(req.params.holidayId), business_id: businessId } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const updates = {};
    if (req.body?.is_off !== undefined) updates.is_off = !!req.body.is_off;
    if (row.source === 'custom') {
      if (req.body?.name !== undefined) {
        const n = cleanName(req.body.name);
        if (!n) return errorResponse(res, 'name_required', 400);
        updates.name = n;
      }
      if (req.body?.name_en !== undefined) updates.name_en = cleanName(req.body.name_en) || null;
    }
    if (!Object.keys(updates).length) return errorResponse(res, 'nothing_to_update', 400);
    const before = { is_off: !!row.is_off, name: row.name, name_en: row.name_en };
    await row.update(updates);
    logAudit(req, {
      action: 'holiday.update', targetType: 'workspace_holiday', targetId: row.id, businessId,
      oldValue: before, newValue: updates,
    });
    signal(req, businessId);
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'work_hours'] });
    return successResponse(res, serialize(row, wh.workWeekdaysOf(biz)));
  } catch (err) { next(err); }
});

// DELETE /api/businesses/:businessId/holidays/:holidayId — 직접 추가한 것만. 국가 행은 끈다(툼스톤).
router.delete('/:businessId/holidays/:holidayId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!canWrite(req)) return errorResponse(res, 'Admin permission required', 403);
    const businessId = Number(req.params.businessId);
    const row = await WorkspaceHoliday.findOne({ where: { id: Number(req.params.holidayId), business_id: businessId } });
    if (!row) return errorResponse(res, 'not_found', 404);
    if (row.source !== 'custom') return errorResponse(res, 'use_toggle', 400);
    const before = { date: ymd(row.date), name: row.name, name_en: row.name_en };
    await row.destroy();
    logAudit(req, {
      action: 'holiday.delete', targetType: 'workspace_holiday', targetId: row.id, businessId, oldValue: before,
    });
    signal(req, businessId);
    return successResponse(res, { id: row.id });
  } catch (err) { next(err); }
});

module.exports = router;
