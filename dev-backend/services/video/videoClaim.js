// 작업자 claim — 일정 판정과 끊긴 작업 되돌리기를 한 자리에서 (docs/DEMO_VIDEO_DESIGN.md §20.3 · Fable 차단 1).
//   ① GET_LOCK('video_claim') 로 claim 을 직렬화(같은 순간 두 claim 이 둘 다 일정 판정을 통과하지 않게)
//   ② heartbeat 5분 끊긴 running → queued(attempts+1) · 3번째면 작업 failed + 요청은 전이 문으로
//   ③ queued 작업이 있으면 그것 · 없으면 일정이 허락할 때 계획표 맨 위 planned 1건 → producing + produce 작업
const { Op } = require('sequelize');
const { sequelize } = require('../../config/database');
const { VideoProject, VideoJob, VideoSetting } = require('../../models');
const T = require('./videoTransition');

const STALE_MS = 5 * 60 * 1000;
const KST = 9 * 3600 * 1000;

function kstParts(now = new Date()) {
  const k = new Date(now.getTime() + KST);
  const dow = k.getUTCDay() || 7; // 월=1 … 일=7
  const hm = `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
  const dayStartUtc = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST);
  return { dow, hm, dayStartUtc };
}

// 창 안인가 — from > to 면 자정을 넘는 창(22:00~03:00)
function inWindow(hm, w) {
  if (!w || !w.from || !w.to) return true;
  return w.from <= w.to ? hm >= w.from && hm < w.to : hm >= w.from || hm < w.to;
}

/** 일정이 지금 새 요청 하나를 시작하게 하는가 — 이유 코드를 같이 돌려준다(화면 «다음 실행» 설명에도 쓴다). */
async function scheduleAllows(t, now = new Date()) {
  const s = await VideoSetting.findByPk(1, { transaction: t });
  const sc = (s && s.schedule) || {};
  if (!sc.enabled) return { ok: false, why: 'disabled' };
  const { dow, hm, dayStartUtc } = kstParts(now);
  if (Array.isArray(sc.weekdays) && sc.weekdays.length && !sc.weekdays.includes(dow)) return { ok: false, why: 'weekday' };
  if (!inWindow(hm, sc.window)) return { ok: false, why: 'window' };
  const producing = await VideoProject.count({ where: { status: 'producing' }, transaction: t });
  if (producing > 0) return { ok: false, why: 'busy' };
  const today = await VideoProject.count({ where: { producing_started_at: { [Op.gte]: dayStartUtc } }, paranoid: false, transaction: t });
  if (today >= Math.max(1, Number(sc.per_day) || 1)) return { ok: false, why: 'quota' };
  return { ok: true };
}

async function recoverStale(t, now = new Date()) {
  const stale = await VideoJob.findAll({ where: { status: 'running', heartbeat_at: { [Op.lt]: new Date(now.getTime() - STALE_MS) } }, transaction: t, lock: t.LOCK.UPDATE });
  for (const job of stale) {
    if (job.attempts >= 3) {
      await job.update({ status: 'failed', error_code: 'worker_lost', error_message: '작업자 신호가 세 번 끊김', finished_at: now }, { transaction: t });
      const p = await T.lockProject(job.project_id, t);
      // 설계 §20.3(Fable 차단 1): 같은 작업이 세 번 끊기면 요청은 바로 failed — 다시 넣어 같은 밤에 또 돌지 않게(Fable 비차단 3)
      if (p.status === 'producing') await T.move(p, 'failed', { reason: 'worker_lost', patch: { review_reason: 'worker_lost', review_detail: '작업자 신호가 세 번 끊김' } }, t);
    } else {
      await job.update({ status: 'queued', claimed_by: null, stage: null }, { transaction: t });
    }
  }
  return stale.length;
}

/** claim 한 번 — {job, project} 또는 {job:null, why}. who = 작업자 이름(pid@host). */
async function claim(who, now = new Date()) {
  return sequelize.transaction(async (t) => {
    const [[row]] = await sequelize.query("SELECT GET_LOCK('video_claim', 5) AS got", { transaction: t });
    if (!row || Number(row.got) !== 1) return { job: null, why: 'locked' };
    try {
      await VideoSetting.update({ worker_seen_at: now, worker_name: String(who).slice(0, 120) }, { where: { id: 1 }, transaction: t });
      await recoverStale(t, now);
      let job = await VideoJob.findOne({ where: { status: 'queued' }, order: [['priority', 'DESC'], ['id', 'ASC']], transaction: t, lock: t.LOCK.UPDATE });
      if (!job) {
        const gate = await scheduleAllows(t, now);
        if (!gate.ok) return { job: null, why: gate.why };
        const next = await VideoProject.findOne({ where: { status: 'planned' }, order: [['plan_order', 'ASC'], ['id', 'ASC']], transaction: t, lock: t.LOCK.UPDATE });
        if (!next) return { job: null, why: 'empty' };
        job = await T.startProducing(next, t);
      }
      const [n] = await VideoJob.update({ status: 'running', claimed_by: String(who).slice(0, 120), claimed_at: now, heartbeat_at: now, attempts: sequelize.literal('attempts + 1'), stage: null, progress: 0 },
        { where: { id: job.id, status: 'queued' }, transaction: t });
      if (n !== 1) return { job: null, why: 'raced' };
      await job.reload({ transaction: t });
      const project = await VideoProject.findByPk(job.project_id, { transaction: t });
      return { job, project };
    } finally {
      await sequelize.query("SELECT RELEASE_LOCK('video_claim')", { transaction: t });
    }
  });
}

module.exports = { claim, scheduleAllows, recoverStale, inWindow, kstParts, STALE_MS };
