// 시연 영상 공방 — 관리자 API (docs/DEMO_VIDEO_DESIGN.md §20 · platform_admin 전용, business_id 없음).
//   D′1: 요청(계획표) 만들기·고치기·순서·보관·다시 넣기 · 일정 · 완성본 재생. 링크=발행(E′)·AI 제안·유튜브 메타(D′2)는 뒤에.
//   상태 전이는 services/video/videoTransition 으로만. 응답에 로컬 경로·토큰 없음(파일은 스트리밍 주소로만).
const express = require('express');
const fs = require('fs');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { VideoProject, VideoVersion, VideoJob, VideoSetting } = require('../models');
const T = require('../services/video/videoTransition');
const { scheduleAllows } = require('../services/video/videoClaim');
const { resolveVideoFile } = require('../services/video/videoUploads');
const { writeAudit } = require('../services/auditService');

const router = express.Router();
router.use(authenticateToken, requireRole('platform_admin'));

const MODES = ['instruction', 'brand'];            // recording(녹음) 은 소재 올리기와 함께 D′2
const ASPECTS = ['landscape', 'portrait'];
const EDITABLE = new Set(['planned', 'needs_review', 'failed']);
const fail = (res, e) => { const s = e.status || 500; if (s >= 500) console.error('[admin-videos]', e); return errorResponse(res, e.code || 'server_error', s); };

// 요청 입력 다듬기 — 모르는 칸은 버린다
function clean(body, partial = false) {
  const out = {};
  if (!partial || body.title !== undefined) { const v = String(body.title || '').trim().slice(0, 200); if (!v) throw Object.assign(new Error('x'), { code: 'title_required', status: 400 }); out.title = v; }
  if (!partial || body.mode !== undefined) { if (!MODES.includes(body.mode || 'instruction')) throw Object.assign(new Error('x'), { code: 'bad_mode', status: 400 }); out.mode = body.mode || 'instruction'; }
  if (!partial || body.brief !== undefined) { const v = String(body.brief || '').trim().slice(0, 4000); if (!v) throw Object.assign(new Error('x'), { code: 'brief_required', status: 400 }); out.brief = v; }
  if (body.target_seconds !== undefined) out.target_seconds = Math.max(10, Math.min(180, Math.round(+body.target_seconds) || 30));
  if (body.aspects !== undefined) { const a = (Array.isArray(body.aspects) ? body.aspects : []).filter((x) => ASPECTS.includes(x)); out.aspects = a.length ? [...new Set(a)] : ASPECTS; }
  if (body.template !== undefined) out.template = body.template ? String(body.template).replace(/[^a-z0-9-]/g, '').slice(0, 60) || null : null;
  if (body.music !== undefined) out.music = body.music ? String(body.music).replace(/[^A-Za-z0-9_\-. ]/g, '').slice(0, 120) || null : null;
  if (body.placement !== undefined) out.placement = body.placement ? String(body.placement).replace(/[^a-z0-9_]/g, '').slice(0, 40) || null : null;
  if (body.channels !== undefined) out.channels = (Array.isArray(body.channels) ? body.channels : []).map((x) => String(x).replace(/[^a-z]/g, '')).filter(Boolean).slice(0, 10);
  if (body.auto_approve !== undefined) out.auto_approve = !!body.auto_approve;
  return out;
}

// 화면에 내보낼 모양 — 출력은 파일 경로 대신 스트리밍 주소
function view(p, versions) {
  const j = p.toJSON();
  if (versions) {
    j.versions = versions.map((v) => ({
      id: v.id, version_no: v.version_no, source: v.source, status: v.status, change_note: v.change_note, approved_at: v.approved_at, created_at: v.created_at,
      ai_dropped: (v.ai_meta && v.ai_meta.dropped && v.ai_meta.dropped.length) || 0,
      outputs: (v.outputs || []).map((o) => ({ aspect: o.aspect, bytes: o.bytes, seconds: o.seconds, url: `/api/admin/videos/outputs/${v.id}/${o.aspect}`, in_drive: !!o.drive_file_id })),
    }));
  }
  return j;
}

router.get('/projects', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = String(req.query.status).split(',').filter(Boolean);
    const rows = await VideoProject.findAll({ where, order: [['plan_order', 'ASC'], ['id', 'ASC']], limit: 500 });
    return successResponse(res, rows.map((p) => view(p)));
  } catch (e) { return fail(res, e); }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const p = await VideoProject.findByPk(Number(req.params.id));
    if (!p) return errorResponse(res, 'not_found', 404);
    const versions = await VideoVersion.findAll({ where: { project_id: p.id }, order: [['version_no', 'DESC']] });
    const jobs = await VideoJob.findAll({ where: { project_id: p.id }, order: [['id', 'DESC']], limit: 20, attributes: ['id', 'kind', 'status', 'attempts', 'stage', 'progress', 'error_code', 'error_message', 'claimed_at', 'heartbeat_at', 'finished_at'] });
    return successResponse(res, { ...view(p, versions), jobs });
  } catch (e) { return fail(res, e); }
});

// 대본 한 판 — 확인 필요에서 고칠 때
router.get('/versions/:id', async (req, res) => {
  try {
    const v = await VideoVersion.findByPk(Number(req.params.id));
    if (!v) return errorResponse(res, 'not_found', 404);
    return successResponse(res, { id: v.id, project_id: v.project_id, version_no: v.version_no, status: v.status, source: v.source, script: v.script, ai_meta: v.ai_meta });
  } catch (e) { return fail(res, e); }
});

router.post('/projects', async (req, res) => {
  try {
    const data = clean(req.body);
    const p = await sequelize.transaction(async (t) => {
      const max = await VideoProject.max('plan_order', { where: { status: 'planned' }, transaction: t });
      const row = await VideoProject.create({ aspects: ASPECTS, ...data, status: 'planned', plan_order: (Number.isFinite(max) ? max : 0) + 1, created_by: req.user.id }, { transaction: t });
      await writeAudit({ userId: req.user.id, businessId: null, action: 'video.create', targetType: 'video_project', targetId: row.id, newValue: { title: row.title, mode: row.mode } }, { transaction: t });
      return row;
    });
    return successResponse(res, view(p), 'Created', 201);
  } catch (e) { return fail(res, e); }
});

router.patch('/projects/:id', async (req, res) => {
  try {
    const p = await sequelize.transaction(async (t) => {
      const row = await T.lockProject(Number(req.params.id), t);
      if (!EDITABLE.has(row.status)) throw Object.assign(new Error('x'), { code: `not_editable_${row.status}`, status: 409 });
      const data = clean(req.body, true);
      const old = {}; for (const k of Object.keys(data)) old[k] = row[k];
      await row.update(data, { transaction: t });
      await writeAudit({ userId: req.user.id, businessId: null, action: 'video.edit', targetType: 'video_project', targetId: row.id, oldValue: old, newValue: data }, { transaction: t });
      return row;
    });
    return successResponse(res, view(p));
  } catch (e) { return fail(res, e); }
});

// 계획표 순서 — ids 순서대로 1,2,3… (planned 만)
// deadroute-exempt: D′2 계획표 화면(끌어서 순서 바꾸기)이 부른다 — 화면을 붙이면 이 줄을 지운다
router.post('/projects/reorder', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
    if (!ids.length) return errorResponse(res, 'ids_required', 400);
    await sequelize.transaction(async (t) => {
      for (let i = 0; i < ids.length; i++) await VideoProject.update({ plan_order: i + 1 }, { where: { id: ids[i], status: 'planned' }, transaction: t });
      await writeAudit({ userId: req.user.id, businessId: null, action: 'video.reorder', targetType: 'video_project', targetId: null, newValue: { ids } }, { transaction: t });
    });
    return successResponse(res, { ok: true });
  } catch (e) { return fail(res, e); }
});

// audit-exempt: 보관 전이는 videoTransition.move 가 같은 트랜잭션에서 writeAudit
router.post('/projects/:id/archive', async (req, res) => {
  try {
    const p = await sequelize.transaction(async (t) => {
      const row = await T.lockProject(Number(req.params.id), t);
      if (row.status === 'published') throw Object.assign(new Error('x'), { code: 'use_unpublish', status: 409 }); // 발행 취소(미발송 SNS 취소)는 E′ 문으로
      if (row.status === 'producing') await VideoJob.update({ status: 'canceled', finished_at: new Date() }, { where: { project_id: row.id, status: ['queued', 'running'] }, transaction: t });
      return T.move(row, 'archived', { userId: req.user.id, reason: 'archive' }, t);
    });
    return successResponse(res, view(p));
  } catch (e) { return fail(res, e); }
});

// 확인 필요·실패를 다시 넣기 — approve_version_id(그 판으로 렌더, AI 건너뜀) · accept([{shot, beat}] 그대로 쓰기)
// audit-exempt: videoTransition.requeue 가 writeAudit(video.requeue + video.planned)
router.post('/projects/:id/requeue', async (req, res) => {
  try {
    const p = await sequelize.transaction(async (t) => {
      const row = await T.lockProject(Number(req.params.id), t);
      if (!['needs_review', 'failed'].includes(row.status)) throw Object.assign(new Error('x'), { code: `not_requeueable_${row.status}`, status: 409 });
      let approvedVersionId = null;
      if (req.body.approve_version_id) {
        const v = await VideoVersion.findByPk(Number(req.body.approve_version_id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!v || v.project_id !== row.id) throw Object.assign(new Error('x'), { code: 'version_not_found', status: 404 });
        if (v.status === 'draft') await v.update({ status: 'approved', approved_by: req.user.id, approved_at: new Date() }, { transaction: t });
        approvedVersionId = v.id;
      }
      const accept = Array.isArray(req.body.accept) ? req.body.accept.filter((a) => a && a.shot && a.beat).map((a) => ({ shot: String(a.shot).slice(0, 60), beat: String(a.beat).slice(0, 60) })).slice(0, 50) : null;
      // 같은 장면을 두 번 받아들여도 한 번만(Fable 비차단 8)
      const merged = accept ? [...new Map([...(row.gate_overrides || []), ...accept].map((a) => [`${a.shot}|${a.beat}`, a])).values()] : null;
      return T.requeue(row, { userId: req.user.id, approvedVersionId, gateOverrides: merged }, t);
    });
    return successResponse(res, view(p));
  } catch (e) { return fail(res, e); }
});

// 일정 · 작업자 상태
router.get('/settings', async (req, res) => {
  try {
    const s = await VideoSetting.findByPk(1);
    const allow = await sequelize.transaction((t) => scheduleAllows(t));
    const counts = {};
    for (const r of await VideoProject.findAll({ attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['status'], raw: true })) counts[r.status] = Number(r.n);
    return successResponse(res, { schedule: (s && s.schedule) || null, worker_seen_at: s && s.worker_seen_at, worker_name: s && s.worker_name, now_allows: allow, counts });
  } catch (e) { return fail(res, e); }
});

router.put('/settings', async (req, res) => {
  try {
    const b = req.body || {};
    const hm = (x, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || '')) ? String(x) : d);
    const schedule = {
      enabled: !!b.enabled,
      per_day: Math.max(1, Math.min(10, Math.round(+b.per_day) || 1)),
      window: { from: hm(b.window && b.window.from, '01:00'), to: hm(b.window && b.window.to, '06:00') },
      weekdays: (Array.isArray(b.weekdays) ? b.weekdays : [1, 2, 3, 4, 5, 6, 7]).map(Number).filter((d) => d >= 1 && d <= 7),
      publish_spread: b.publish_spread === 'daily' ? 'daily' : 'all',
    };
    if (!schedule.weekdays.length) return errorResponse(res, 'weekdays_required', 400);
    const s = await VideoSetting.findByPk(1);
    if (!s) return errorResponse(res, 'not_migrated', 500);
    const old = s.schedule;
    await s.update({ schedule });
    await writeAudit({ userId: req.user.id, businessId: null, action: 'video.schedule', targetType: 'video_settings', targetId: 1, oldValue: old, newValue: schedule });
    return successResponse(res, { schedule });
  } catch (e) { return fail(res, e); }
});

// 완성본 재생·받기 — 관리자만 · Range
router.get('/outputs/:versionId/:aspect', async (req, res) => {
  try {
    const v = await VideoVersion.findByPk(Number(req.params.versionId));
    const o = v && (v.outputs || []).find((x) => x.aspect === req.params.aspect);
    const abs = o && resolveVideoFile(o.file);
    if (!abs) return errorResponse(res, 'not_found', 404);
    const size = fs.statSync(abs).size;
    res.set({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=300' });
    if (req.query.download === '1') res.set('Content-Disposition', `attachment; filename="planq-video-${v.project_id}-v${v.version_no}-${o.aspect}.mp4"`);
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
    if (m) {
      const start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
      const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (!(start <= end && start < size)) return res.status(416).set('Content-Range', `bytes */${size}`).end();
      res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(abs, { start, end }).pipe(res);
    }
    res.set('Content-Length', size);
    return fs.createReadStream(abs).pipe(res);
  } catch (e) { return fail(res, e); }
});

module.exports = router;
