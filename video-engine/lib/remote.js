// 운영 작업자 API 손님 — dev 작업자가 바깥으로만 부른다 (docs/DEMO_VIDEO_DESIGN.md §20.4).
//   video-engine/.env: VIDEO_API_BASE · VIDEO_WORKER_TOKEN(원문 — 이 파일 밖으로 내보내지 않는다). X-Forwarded-For 를 붙이지 않는다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

function env() {
  const f = path.join(__dirname, '..', '.env');
  const out = {};
  if (fs.existsSync(f)) for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) out[m[1]] = m[2]; }
  return { base: process.env.VIDEO_API_BASE || out.VIDEO_API_BASE, token: process.env.VIDEO_WORKER_TOKEN || out.VIDEO_WORKER_TOKEN };
}

const WHO = `${process.pid}@${os.hostname()}`;

async function call(method, p, { json, body, headers = {}, timeoutMs = 60000 } = {}) {
  const { base, token } = env();
  if (!base || !token) throw Object.assign(new Error('VIDEO_API_BASE / VIDEO_WORKER_TOKEN 없음(video-engine/.env)'), { code: 'not_configured' });
  const res = await fetch(base.replace(/\/$/, '') + '/api/video-worker' + p, {
    method, signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${token}`, 'x-worker-name': WHO, ...(json ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
  });
  let j = null; try { j = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok || !j || j.success === false) throw Object.assign(new Error(`${method} ${p} → ${res.status} ${(j && (j.message || j.code)) || ''}`), { status: res.status, code: (j && (j.code || j.message)) || `http_${res.status}` });
  return j.data;
}

// 완성본 올리기 — 40MB 조각 · 끝에 서버가 md5 를 다시 잰다
async function uploadFile(jobId, aspect, file) {
  const buf = fs.readFileSync(file);
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const s = await call('POST', '/uploads', { json: { aspect, bytes: buf.length, md5 }, headers: { 'x-job-id': String(jobId) } });
  const part = s.part_max || 40 * 1024 * 1024;
  for (let i = 0, n = 0; i < buf.length; i += part, n++) {
    await call('PUT', `/uploads/${s.upload_id}/parts/${n}`, { body: buf.subarray(i, i + part), headers: { 'content-type': 'application/octet-stream', 'x-job-id': String(jobId) }, timeoutMs: 300000 });
  }
  return call('POST', `/uploads/${s.upload_id}/finish`, { json: { job_id: jobId } });
}

module.exports = { call, uploadFile, WHO };
