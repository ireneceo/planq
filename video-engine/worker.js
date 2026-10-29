// 영상 대기열 작업자 — 설계 §5. 한 번에 한 작업 · 렌더 전 메모리 게이트(render.js waitGate) · 하트비트 · 끊긴 작업은 다시 대기열로.
//   C단계는 파일 대기열(data/jobs/*.json), D단계에서 같은 runJob 을 DB(video_jobs) 대기열에 붙인다 — 작업 내용은 그대로.
//   실행: node worker.js            (계속 돈다 — D 에서 PM2 planq-video-worker)
//         node worker.js --once     (대기열이 빌 때까지 하고 끝)
//         node worker.js --enqueue <kind> '<payload json>'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const JOBS = path.join(ROOT, 'data', 'jobs');
const HEARTBEAT_MS = 15000, STALE_MS = 5 * 60 * 1000;
const LIMIT_MS = { render: 90 * 60e3, prep_voice: 10 * 60e3, script: 2 * 60e3, revise: 2 * 60e3, analyze_asset: 3 * 60e3, capture: 20 * 60e3, build: 2 * 60e3 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WHO = `${process.pid}@${require('os').hostname()}`;

// ── 작업 내용(대기열 종류와 무관) ──
async function runJob(job, { progress = () => {}, log = () => {} } = {}) {
  const p = job.payload || {};
  switch (job.kind) {
    case 'prep_voice': { const { prepVoice } = require('./prep-voice'); const r = await prepVoice(p); return { report: r.report, sentences: r.sentences.length, stt_seconds: r.sttSeconds, face: !!r.faceOut }; }
    case 'analyze_asset': { const { analyze } = require('./lib/assets'); const r = await analyze(path.join(ROOT, 'data', 'assets', p.asset)); return { type: r.type, description: r.description, usable: r.usable }; }
    case 'revise': { const { revise } = require('./ai/revise'); const r = await revise(p.id, p.request); return { version: r.rec.version, summary: r.summary, changes: r.changes }; }
    case 'build': {
      // 장면 목록 만들기 — 검수 관문에 걸리면 실패(사람이 accept 하거나 다시 녹화)
      const { execFileSync } = require('child_process');
      try { execFileSync('node', [path.join(ROOT, 'build', 'storyboard.js'), path.join(ROOT, 'storyboards', `${p.id}.json`)], { stdio: 'pipe' }); }
      catch (e) { throw Object.assign(new Error(String(e.stderr || e.message).slice(0, 2000)), { code: e.status === 2 ? 'asset_unusable' : 'build_failed' }); }
      return { ok: true };
    }
    case 'render': {
      const { renderAll } = require('./render');
      const r = await renderAll({ arg0: p.id, only: p.only || null, log: (m) => { log(m); const k = /조각 (\d+)\/(\d+)/.exec(m); if (k) progress(+k[1] / +k[2]); } });
      return { outputs: r.map((x) => ({ aspect: x.aspect, file: path.relative(ROOT, x.out), bytes: x.bytes, seconds: x.seconds, ms: x.ms, rendered: x.rendered, reused: x.reused })) };
    }
    default: throw Object.assign(new Error(`모르는 작업 ${job.kind}`), { code: 'unknown_kind' });
  }
}

// ── 파일 대기열 ──
const file = (id) => path.join(JOBS, `${id}.json`);
const read = (id) => JSON.parse(fs.readFileSync(file(id), 'utf8'));
const write = (j) => { const tmp = file(j.id) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(j, null, 1)); fs.renameSync(tmp, file(j.id)); };

function enqueue(kind, payload, { priority = 0 } = {}) {
  fs.mkdirSync(JOBS, { recursive: true });
  const j = { id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, kind, payload, status: 'queued', priority, attempts: 0, created_at: new Date().toISOString() };
  write(j); return j;
}

// 점유 — 잠금 파일을 O_EXCL 로 만든 쪽만 가진다(DB 판의 «UPDATE … WHERE status='queued'» 영향 1행과 같은 뜻)
function claim() {
  if (!fs.existsSync(JOBS)) return null;
  const queued = fs.readdirSync(JOBS).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(JOBS, f), 'utf8')); } catch { return null; } })
    .filter((j) => j && j.status === 'queued').sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at));
  for (const j of queued) {
    try { fs.writeFileSync(file(j.id) + '.lock', WHO, { flag: 'wx' }); } catch { continue; }
    const cur = read(j.id);
    if (cur.status !== 'queued') { fs.unlinkSync(file(j.id) + '.lock'); continue; }
    Object.assign(cur, { status: 'running', claimed_by: WHO, claimed_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), attempts: cur.attempts + 1 });
    write(cur); return cur;
  }
  return null;
}

// 하트비트가 5분 끊긴 running → 다시 queued(렌더·분석은 같은 입력이면 같은 결과라 다시 해도 안전). 두 번 끊기면 failed.
function recoverStale() {
  if (!fs.existsSync(JOBS)) return;
  for (const f of fs.readdirSync(JOBS).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(JOBS, f), 'utf8'));
    if (j.status !== 'running' || Date.now() - Date.parse(j.heartbeat_at) < STALE_MS) continue;
    Object.assign(j, j.attempts >= 2 ? { status: 'failed', error_code: 'worker_lost', error_message: '작업자가 두 번 끊김' } : { status: 'queued' });
    write(j); try { fs.unlinkSync(file(j.id) + '.lock'); } catch { /* 없음 */ }
  }
}

async function runOne() {
  const job = claim();
  if (!job) return false;
  const hb = setInterval(() => { try { const j = read(job.id); j.heartbeat_at = new Date().toISOString(); write(j); } catch { /* 다음에 */ } }, HEARTBEAT_MS);
  const logs = [];
  const log = (m) => { logs.push(m); const j = read(job.id); j.log = logs.join('\n').slice(-4096); write(j); console.log(`[${job.kind}] ${m}`); };
  const progress = (x) => { const j = read(job.id); j.progress = +x.toFixed(3); write(j); };
  try {
    const limit = LIMIT_MS[job.kind] || 10 * 60e3;
    const result = await Promise.race([runJob(job, { progress, log }), sleep(limit).then(() => { throw Object.assign(new Error(`작업 시간 상한 ${limit / 60e3}분`), { code: 'timeout' }); })]);
    const j = read(job.id); Object.assign(j, { status: 'done', progress: 1, result, finished_at: new Date().toISOString() }); write(j);
  } catch (e) {
    const j = read(job.id); Object.assign(j, { status: 'failed', error_code: e.code || 'failed', error_message: String(e.message).slice(0, 2000), finished_at: new Date().toISOString() }); write(j);
    console.error(`[${job.kind}] 실패 ${e.code || ''} ${e.message}`);
  } finally { clearInterval(hb); try { fs.unlinkSync(file(job.id) + '.lock'); } catch { /* 없음 */ } }
  return true;
}

async function loop({ once = false } = {}) {
  recoverStale();
  for (;;) {
    const did = await runOne();
    if (!did) { if (once) return; await sleep(10000); recoverStale(); }
  }
}

if (require.main === module) {
  const i = process.argv.indexOf('--enqueue');
  if (i > 0) { const j = enqueue(process.argv[i + 1], JSON.parse(process.argv[i + 2] || '{}')); console.log(j.id); }
  else loop({ once: process.argv.includes('--once') }).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { runJob, enqueue, claim, recoverStale, runOne };
