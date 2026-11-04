// 작업자가 올리는 완성본 mp4 — 조각(≤40MB)으로 받아 이어 붙이고 md5 를 검사한다 (§20.4 · §20.6).
//   임시: uploads/videos/tmp/<uuid>/{meta.json, part-<n>}  → 완성: uploads/videos/<yyyy-mm>/<uuid>.mp4
//   정적 공개 안 함 — 관리자 스트리밍 라우트만 읽는다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const VIDEO_DIR = path.join(UPLOAD_ROOT, 'videos');
const TMP = path.join(VIDEO_DIR, 'tmp');
const MAX_BYTES = 300 * 1024 * 1024;
const PART_MAX = 40 * 1024 * 1024;
const UUID = /^[0-9a-f]{32}$/;

class UploadError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

const dirOf = (id) => { if (!UUID.test(String(id))) throw new UploadError('bad_upload_id', 404); return path.join(TMP, id); };
const readMeta = (id) => { try { return JSON.parse(fs.readFileSync(path.join(dirOf(id), 'meta.json'), 'utf8')); } catch (e) { if (e instanceof UploadError) throw e; throw new UploadError('upload_not_found', 404); } };
const writeMeta = (id, m) => fs.writeFileSync(path.join(dirOf(id), 'meta.json'), JSON.stringify(m));

function start({ jobId, aspect, bytes, md5 }) {
  if (!['landscape', 'portrait'].includes(aspect)) throw new UploadError('bad_aspect');
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_BYTES) throw new UploadError('too_large', 413);
  if (!/^[0-9a-f]{32}$/.test(String(md5))) throw new UploadError('bad_md5');
  const id = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(dirOf(id), { recursive: true });
  writeMeta(id, { job_id: jobId, aspect, bytes, md5, parts: [], created_at: Date.now() });
  return { upload_id: id, part_max: PART_MAX };
}

function putPart(id, jobId, n, buf) {
  const m = readMeta(id);
  if (m.job_id !== jobId) throw new UploadError('not_your_upload', 409);
  if (m.file) throw new UploadError('already_finished', 409);
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new UploadError('bad_part');
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > PART_MAX) throw new UploadError('bad_part_size', 413);
  fs.writeFileSync(path.join(dirOf(id), `part-${n}`), buf);
  if (!m.parts.includes(n)) m.parts.push(n);
  writeMeta(id, m);
  return { part: n, bytes: buf.length };
}

// MP4 확인 — 4~8 바이트가 'ftyp'. ffprobe 가 있으면(FFPROBE) 컨테이너·코덱·길이까지(Fable 비차단 8)
function checkMp4(file) {
  const fd = fs.openSync(file, 'r'); const head = Buffer.alloc(12); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd);
  if (head.slice(4, 8).toString('latin1') !== 'ftyp') throw new UploadError('not_mp4', 415);
  const bin = process.env.FFPROBE;
  if (!bin) return { probed: false };
  let j;
  try { j = JSON.parse(execFileSync(bin, ['-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name', '-of', 'json', file], { timeout: 20000 }).toString()); }
  catch { throw new UploadError('probe_failed', 415); }
  const codecs = (j.streams || []).map((s) => s.codec_name);
  const dur = Number(j.format && j.format.duration);
  if (!/mp4/.test((j.format && j.format.format_name) || '') || !codecs.includes('h264') || !(dur > 0 && dur <= 20 * 60)) throw new UploadError('bad_video', 415);
  return { probed: true, seconds: +dur.toFixed(2) };
}

function finish(id, jobId) {
  const m = readMeta(id);
  if (m.job_id !== jobId) throw new UploadError('not_your_upload', 409);
  if (m.file) return m;
  const parts = [...m.parts].sort((a, b) => a - b);
  if (!parts.length || parts.some((p, i) => p !== i)) throw new UploadError('parts_missing');
  const ym = new Date().toISOString().slice(0, 7);
  const rel = path.join('videos', ym, `${id}.mp4`);
  const abs = path.join(UPLOAD_ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const hash = crypto.createHash('md5'); let size = 0;
  const fd = fs.openSync(abs + '.tmp', 'w');
  for (const p of parts) { const b = fs.readFileSync(path.join(dirOf(id), `part-${p}`)); hash.update(b); size += b.length; fs.writeSync(fd, b); }
  fs.closeSync(fd);
  const md5 = hash.digest('hex');
  if (size !== m.bytes || md5 !== m.md5) { fs.unlinkSync(abs + '.tmp'); throw new UploadError('checksum_mismatch', 422); }
  let probe;
  try { probe = checkMp4(abs + '.tmp'); } catch (e) { fs.unlinkSync(abs + '.tmp'); throw e; }
  fs.renameSync(abs + '.tmp', abs);
  for (const p of parts) fs.unlinkSync(path.join(dirOf(id), `part-${p}`));
  Object.assign(m, { file: rel, finished_at: Date.now(), seconds: probe.seconds || null });
  writeMeta(id, m);
  return m;
}

// 관리자 스트리밍용 — uploads/videos 밖이면 거절
function resolveVideoFile(rel) {
  const abs = path.resolve(UPLOAD_ROOT, String(rel || ''));
  if (!abs.startsWith(path.resolve(VIDEO_DIR) + path.sep) || abs.startsWith(path.resolve(TMP) + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

module.exports = { start, putPart, finish, readMeta, resolveVideoFile, UploadError, PART_MAX, MAX_BYTES };
