// 시연 영상 작업자 API — dev 작업자가 바깥으로 부르는 운영 쪽 문 (docs/DEMO_VIDEO_DESIGN.md §20.4 · Fable gate).
//   인증 = utils/workerAuth 한 벌(라우터 첫 줄). 사용자 토큰 없음 · 이 라우터 밖 표면 없음.
//   작업자가 보낸 값으로 상태를 직접 정하지 않는다 — 전이는 services/video/videoTransition 으로만.
//   점유하지 않은 작업·끝난 작업에 오는 호출은 409.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { sequelize } = require('../config/database');
const { VideoProject, VideoVersion, VideoJob } = require('../models');
const { workerAuth } = require('../utils/workerAuth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { claim } = require('../services/video/videoClaim');
const T = require('../services/video/videoTransition');
const uploads = require('../services/video/videoUploads');
const { writeAudit } = require('../services/auditService');

const router = express.Router();
router.use(workerAuth);
router.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));

const SCRIPT_MAX = 512 * 1024;
const fail = (res, e) => {
  const status = e.status || 500;
  if (status >= 500) console.error('[video-worker]', e);
  return errorResponse(res, e.code || 'server_error', status);
};

// 이 작업자가 점유한 running 작업만
const workerName = (req) => String(req.get('x-worker-name') || '').slice(0, 120);
async function ownJob(req, t, id = req.params.id) {
  const n = Number(id);
  const job = Number.isInteger(n) && n > 0 ? await VideoJob.findByPk(n, { transaction: t, lock: t ? t.LOCK.UPDATE : undefined }) : null; // 숫자가 아니면 404(WHERE id = NaN 500 방지 — Fable 비차단 2)
  if (!job) throw Object.assign(new Error('not_found'), { code: 'not_found', status: 404 });
  if (job.status !== 'running' || !workerName(req) || job.claimed_by !== workerName(req)) throw Object.assign(new Error('not_running'), { code: 'not_your_job', status: 409 });
  return job;
}

// audit-exempt: 상태 전이(planned→producing)는 videoTransition.move 가 같은 트랜잭션에서 writeAudit
router.post('/claim', async (req, res) => {
  try {
    const who = workerName(req);
    if (!who) return errorResponse(res, 'worker_name_required', 400);
    const r = await claim(who);
    if (!r.job) return successResponse(res, { job: null, why: r.why });
    const p = r.project;
    const version = r.job.payload && r.job.payload.approved_version_id ? await VideoVersion.findByPk(r.job.payload.approved_version_id) : null;
    return successResponse(res, {
      job: { id: r.job.id, kind: r.job.kind, attempts: r.job.attempts, payload: r.job.payload },
      project: { id: p.id, title: p.title, mode: p.mode, brief: p.brief, target_seconds: p.target_seconds, aspects: p.aspects || ['landscape', 'portrait'], template: p.template, music: p.music },
      version: version && version.project_id === p.id ? { id: version.id, version_no: version.version_no, script: version.script } : null,
    });
  } catch (e) { return fail(res, e); }
});

// audit-exempt: 작업자 진행 기록 — 작업 원장(video_jobs.stage·progress·log) 자체가 기록이다
router.post('/jobs/:id/heartbeat', async (req, res) => {
  try {
    const job = await ownJob(req);
    const patch = { heartbeat_at: new Date() };
    if (typeof req.body.stage === 'string') patch.stage = req.body.stage.slice(0, 20);
    if (Number.isFinite(+req.body.progress)) patch.progress = Math.max(0, Math.min(1, +req.body.progress));
    // 로그는 base64(log_b64) — ffmpeg·크롬 자유 문장이 전역 SQL 패턴 검사에 걸려 heartbeat 가 400 이 되지 않게(Fable 비차단 3)
    if (typeof req.body.log_b64 === 'string') patch.log = Buffer.from(req.body.log_b64.slice(-12000), 'base64').toString('utf8').slice(-4096);
    await job.update(patch);
    return successResponse(res, { ok: true, canceled: false });
  } catch (e) { return fail(res, e); }
});

// AI 가 쓴 대본(또는 자동 승인 판)을 새 판으로
// audit-exempt: 판 생성은 video_versions 원장 · 자동 승인은 아래에서 writeAudit
router.post('/jobs/:id/version', async (req, res) => {
  try {
    const raw = JSON.stringify(req.body.script || null);
    if (!req.body.script || typeof req.body.script !== 'object' || !Array.isArray(req.body.script.scenes)) return errorResponse(res, 'bad_script', 400);
    if (Buffer.byteLength(raw) > SCRIPT_MAX) return errorResponse(res, 'script_too_large', 413);
    const out = await sequelize.transaction(async (t) => {
      const job = await ownJob(req, t);
      const p = await T.lockProject(job.project_id, t);
      const last = await VideoVersion.max('version_no', { where: { project_id: p.id }, transaction: t });
      const approve = req.body.approve === true && p.auto_approve;
      const v = await VideoVersion.create({
        project_id: p.id, version_no: (last || 0) + 1, parent_version_id: p.current_version_id || null, script: raw,
        change_note: approve ? '자동 생성·자동 승인(검수 관문 통과)' : '자동 생성', source: approve ? 'auto' : 'ai',
        ai_meta: req.body.ai_meta && typeof req.body.ai_meta === 'object' ? req.body.ai_meta : null,
        status: approve ? 'approved' : 'draft', approved_at: approve ? new Date() : null,
      }, { transaction: t });
      await p.update({ current_version_id: v.id, ...(approve ? { approved_version_id: v.id } : {}) }, { transaction: t });
      if (approve) await writeAudit({ userId: null, businessId: null, action: 'video.auto_approve', targetType: 'video_version', targetId: v.id, newValue: { project_id: p.id, by: 'video-worker' } }, { transaction: t });
      await job.update({ version_id: v.id, heartbeat_at: new Date() }, { transaction: t });
      return { version_id: v.id, version_no: v.version_no, approved: approve };
    });
    return successResponse(res, out);
  } catch (e) { return fail(res, e); }
});

// audit-exempt: 파일 조각 받기 — 판에 묶이는 complete 에서 전이·감사
router.post('/uploads', async (req, res) => {
  try {
    const job = await ownJob(req, undefined, req.get('x-job-id'));
    return successResponse(res, uploads.start({ jobId: job.id, aspect: req.body.aspect, bytes: req.body.bytes, md5: req.body.md5 }));
  } catch (e) { return fail(res, e); }
});

// audit-exempt: 파일 조각 받기 — 판에 묶이는 complete 에서 전이·감사
router.put('/uploads/:uid/parts/:n', express.raw({ type: 'application/octet-stream', limit: '41mb' }), async (req, res) => {
  try {
    const job = await ownJob(req, undefined, req.get('x-job-id'));
    return successResponse(res, uploads.putPart(req.params.uid, job.id, Number(req.params.n), req.body));
  } catch (e) { return fail(res, e); }
});

// audit-exempt: md5 확인만 — 판에 묶이는 complete 에서 전이·감사
router.post('/uploads/:uid/finish', async (req, res) => {
  try {
    const job = await ownJob(req, undefined, req.body.job_id);
    const m = uploads.finish(req.params.uid, job.id);
    return successResponse(res, { upload_id: req.params.uid, aspect: m.aspect, bytes: m.bytes, seconds: m.seconds });
  } catch (e) { return fail(res, e); }
});

// 끝 — 올린 파일을 판에 묶고 awaiting_link 로
// audit-exempt: 상태 전이(producing→awaiting_link)는 videoTransition.move 가 writeAudit
router.post('/jobs/:id/complete', async (req, res) => {
  try {
    const list = Array.isArray(req.body.outputs) ? req.body.outputs : [];
    const out = await sequelize.transaction(async (t) => {
      const job = await ownJob(req, t);
      const p = await T.lockProject(job.project_id, t);
      if (p.status !== 'producing') throw Object.assign(new Error('x'), { code: `project_${p.status}`, status: 409 });
      const v = await VideoVersion.findByPk(job.version_id || p.approved_version_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!v || v.project_id !== p.id || !['approved', 'rendering', 'rendered'].includes(v.status)) throw Object.assign(new Error('x'), { code: 'version_not_approved', status: 409 });
      const outputs = [];
      for (const o of list) {
        const m = uploads.readMeta(o.upload_id);
        if (m.job_id !== job.id || !m.file) throw Object.assign(new Error('x'), { code: 'upload_not_finished', status: 409 });
        outputs.push({ aspect: m.aspect, file: m.file, bytes: m.bytes, md5: m.md5, seconds: m.seconds || (Number(o.seconds) || null), drive_file_id: o.drive_file_id || null });
      }
      if (!outputs.length) throw Object.assign(new Error('x'), { code: 'no_outputs', status: 400 });
      await v.update({ status: 'rendered', outputs }, { transaction: t });
      await job.update({ status: 'done', progress: 1, finished_at: new Date(), result: { outputs: outputs.map((x) => ({ aspect: x.aspect, bytes: x.bytes })) } }, { transaction: t });
      await T.move(p, 'awaiting_link', { reason: 'rendered', patch: { attempts: 0, review_reason: null, review_detail: null, drive_folder_id: req.body.drive && req.body.drive.folder_id ? String(req.body.drive.folder_id).slice(0, 120) : p.drive_folder_id } }, t);
      return { project_id: p.id, status: 'awaiting_link' };
    });
    return successResponse(res, out);
  } catch (e) { return fail(res, e); }
});

// audit-exempt: 상태 전이(needs_review·planned·failed)는 videoTransition.onJobFailed→move 가 writeAudit
router.post('/jobs/:id/fail', async (req, res) => {
  try {
    const out = await sequelize.transaction(async (t) => {
      const job = await ownJob(req, t);
      const code = String(req.body.code || 'failed').slice(0, 40);
      const message = String(req.body.message || '').slice(0, 2000);
      const review = req.body.review && typeof req.body.review === 'object' && req.body.review.reason ? { reason: String(req.body.review.reason), detail: req.body.review.detail || null } : null;
      await job.update({ status: 'failed', error_code: code, error_message: message, finished_at: new Date() }, { transaction: t });
      const p = await T.lockProject(job.project_id, t);
      if (p.status === 'producing') await T.onJobFailed(p, { code, message, review }, t);
      return { project_id: p.id, status: p.status };
    });
    return successResponse(res, out);
  } catch (e) { return fail(res, e); }
});

module.exports = router;
