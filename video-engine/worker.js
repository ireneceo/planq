// 영상 대기열 작업자 — 설계 §5. 한 번에 한 작업 · 렌더 전 메모리 게이트(render.js waitGate) · 하트비트 · 끊긴 작업은 다시 대기열로.
//   C단계는 파일 대기열(data/jobs/*.json), D단계에서 같은 runJob 을 DB(video_jobs) 대기열에 붙인다 — 작업 내용은 그대로.
//   실행: node worker.js            (계속 돈다 — D 에서 PM2 planq-video-worker)
//         node worker.js --once     (대기열이 빌 때까지 하고 끝)
//         node worker.js --enqueue <kind> '<payload json>'
//         node worker.js --remote [--once]   (D′1: 운영 작업자 API 에서 받아 감 — §20.4. video-engine/.env 의 VIDEO_API_BASE·VIDEO_WORKER_TOKEN)
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

// ── produce — 요청 1건을 끝까지(대본 → 검수 관문 → 렌더 → 올리기) (§20.3) ──
//   payload.approved_version_id 가 있으면 AI 대본을 건너뛰고 그 판으로 · gate_overrides 는 «그대로 쓰기» 한 장면(Fable 차단 5).
//   관문에 걸리면 사람 몫(review) — 실패 횟수를 세지 않고 «확인 필요» 로.
function applyOverrides(script, overrides) {
  for (const o of overrides || []) for (const sc of script.scenes || []) if (sc.kind === 'screen' && sc.shot === o.shot) sc.accept = [...new Set([...(sc.accept || []), o.beat])];
  return script;
}

async function produce(claimed, { remote, stage, log }) {
  const { job, project, version } = claimed;
  const p = job.payload || {};
  const aspects = (project.aspects && project.aspects.length ? project.aspects : ['landscape', 'portrait']);
  let script; let versionId = version && version.id;
  // 1) 대본
  stage('script');
  if (version && version.script) { script = version.script; log(`사람이 승인한 판 v${version.version_no} 으로 — AI 건너뜀`); }
  else {
    const { generate } = require('./ai/script');
    script = await generate({ mode: project.mode, template: project.template || undefined, seconds: project.target_seconds, music: project.music || undefined, id: `vp${project.id}-j${job.id}`, instruction: `${project.title}\n${project.brief || ''}`.trim() });
  }
  script.id = `vp${project.id}-j${job.id}`;
  applyOverrides(script, p.gate_overrides);
  // 2) 검수 관문 — 가로·세로 장면 목록을 만들며 걸린 것을 모은다
  stage('gate');
  const { build, attachMontageBeats } = require('./build/storyboard');
  const gate = []; const sbs = {};
  for (const aspect of aspects) {
    const sb = attachMontageBeats(build(script, aspect));
    for (const g of sb._gate || []) gate.push({ aspect, shot: g.shot, beat: g.beat, kind: g.kind, text: g.text });
    sbs[aspect] = sb;
  }
  const autoOk = !gate.length;
  if (!versionId) {
    const meta = script._ai || null; delete script._ai;
    const v = await remote.call('POST', `/jobs/${job.id}/version`, { json: { script, ai_meta: meta, approve: autoOk } });
    versionId = v.version_id;
    if (autoOk && !v.approved) return { review: { reason: 'awaiting_approval', detail: { version_id: versionId } } };
  }
  if (!autoOk) return { review: { reason: 'gate_failed', detail: { version_id: versionId, gate: gate.slice(0, 40) } } };
  for (const aspect of aspects) {
    const out = path.join(ROOT, 'out', 'storyboards', `${script.id}.${aspect}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(sbs[aspect], null, 1));
  }
  // 3) 렌더(조각 렌더 · 메모리 게이트는 render.js 가 기다린다)
  stage('render');
  const { renderAll } = require('./render');
  // 한 화면비만이면 그 장면 목록 파일을 직접 준다(renderAll 은 id 로 받으면 가로·세로 두 파일을 다 연다)
  const rendered = await renderAll({ arg0: aspects.length === 1 ? path.join(ROOT, 'out', 'storyboards', `${script.id}.${aspects[0]}.json`) : script.id, log });
  // 4) 올리기
  stage('upload');
  const outputs = [];
  for (const r of rendered) { const u = await remote.uploadFile(job.id, r.aspect, r.out); outputs.push({ upload_id: u.upload_id, seconds: r.seconds }); log(`올림 ${r.aspect} ${(r.bytes / 1e6).toFixed(1)}MB`); }
  return { outputs };
}

// ── 운영 작업자 API 대기열(--remote) ──
async function runRemoteOne() {
  const remote = require('./lib/remote');
  const claimed = await remote.call('POST', '/claim');
  if (!claimed.job) return { did: false, why: claimed.why };
  const { job } = claimed;
  let cur = { stage: 'start', progress: 0 }; const logs = [];
  // heartbeat 실패는 기록만 하고 작업을 멈추지 않는다(Fable 비차단 3)
  const beat = () => remote.call('POST', `/jobs/${job.id}/heartbeat`, { json: { ...cur, log_b64: Buffer.from(logs.join('\n').slice(-4096)).toString('base64') } }).catch((e) => console.error(`[heartbeat] ${e.message}`));
  const hb = setInterval(beat, HEARTBEAT_MS);
  const stage = (s) => { cur = { stage: s, progress: 0 }; console.log(`[produce ${job.id}] ${s}`); beat(); };
  const log = (m) => { logs.push(m); console.log(`[produce ${job.id}] ${m}`); const k = /조각 (\d+)\/(\d+)/.exec(m); if (k) cur.progress = +k[1] / +k[2]; };
  try {
    if (job.kind !== 'produce') throw Object.assign(new Error(`아직 원격으로 안 받는 작업 ${job.kind}`), { code: 'unknown_kind' });
    const r = await Promise.race([produce(claimed, { remote, stage, log }), sleep(LIMIT_MS.render + 30 * 60e3).then(() => { throw Object.assign(new Error('작업 시간 상한'), { code: 'timeout' }); })]);
    if (r.review) await remote.call('POST', `/jobs/${job.id}/fail`, { json: { code: r.review.reason, message: '', review: r.review } });
    else await remote.call('POST', `/jobs/${job.id}/complete`, { json: { outputs: r.outputs } });
    return { did: true, job: job.id, result: r.review ? `확인 필요(${r.review.reason})` : 'awaiting_link' };
  } catch (e) {
    console.error(`[produce ${job.id}] 실패 ${e.code || ''} ${e.message}`);
    await remote.call('POST', `/jobs/${job.id}/fail`, { json: { code: e.code || 'failed', message: String(e.message).slice(0, 2000) } }).catch((x) => console.error(`[fail 보고] ${x.message}`));
    return { did: true, job: job.id, result: `실패 ${e.code || ''}` };
  } finally { clearInterval(hb); }
}

async function remoteLoop({ once = false } = {}) {
  for (;;) {
    let r;
    try { r = await runRemoteOne(); } catch (e) { console.error(`[claim] ${e.message}`); r = { did: false, why: 'error' }; }
    if (r.did) { console.log(`[remote] 작업 ${r.job} → ${r.result}`); continue; }
    if (once) { console.log(`[remote] 받을 일 없음(${r.why})`); return; }
    await sleep(60000);
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
  else if (process.argv.includes('--remote')) remoteLoop({ once: process.argv.includes('--once') }).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
  else loop({ once: process.argv.includes('--once') }).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { runJob, enqueue, claim, recoverStale, runOne, produce, applyOverrides, runRemoteOne };
