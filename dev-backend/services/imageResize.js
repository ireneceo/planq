// 이미지 서빙 공용 on-the-fly 리사이즈 (#97) — ?w= 파라미터 지원 + 디스크 캐시.
//   - 업로드 파일은 UUID 로 불변이므로 경로 hash 캐시로 충분 (invalidation 불필요)
//   - 허용 폭 스냅(고정 5단) — 캐시 폭발/파라미터 남용 방지
//   - gif(애니메이션)/svg 는 원본 그대로. 리사이즈 실패 시 원본 fallback (false 반환)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ALLOWED_WIDTHS = [200, 400, 800, 1024, 1600];

// ★ 2026-08-24 — 리사이즈 생성은 CPU 작업이다(sharp/libvips). 메일 스레드 하나를 열 때 이미지가
//   여러 장 동시에 오면 그만큼 동시에 인코딩이 돌아 서버를 문다(이 서버는 RAM 7.7GB).
//   생성은 **동시 2개**로 묶는다. 캐시 적중(대다수)은 이 문을 통과하지 않으므로 느려지지 않는다.
//   문이 막혀도 요청은 버리지 않고 순서를 기다린다 — 사용자에겐 조금 늦게 뜰 뿐이다.
const MAX_CONCURRENT_ENCODE = 2;
let encoding = 0;
const encodeWaiters = [];
function acquireEncode() {
  if (encoding < MAX_CONCURRENT_ENCODE) { encoding += 1; return Promise.resolve(); }
  return new Promise((resolve) => encodeWaiters.push(resolve));
}
function releaseEncode() {
  const next = encodeWaiters.shift();
  if (next) next();            // 대기자에게 자리를 넘긴다 (encoding 카운트 유지)
  else encoding = Math.max(0, encoding - 1);
}
const CACHE_ROOT = path.join(__dirname, '..', 'uploads', '.cache');
const RESIZABLE = /^image\/(jpeg|png|webp|avif|tiff?)$/i;
/** 스트림 저장소(Drive 등)에서 리사이즈할 원본의 상한. 넘으면 리사이즈를 포기한다. */
const MAX_STREAM_BYTES = 40 * 1024 * 1024;

/** 요청한 폭을 허용값으로 스냅하고 캐시 경로를 만든다. `?w` 가 없거나 못 줄이는 형식이면 null. */
function plan(req, mimeType, cacheId) {
  const raw = parseInt(req.query.w, 10);
  if (!raw || raw <= 0) return null;
  if (!RESIZABLE.test(mimeType || '')) return null;
  const width = ALLOWED_WIDTHS.reduce((best, a) => (Math.abs(a - raw) < Math.abs(best - raw) ? a : best), ALLOWED_WIDTHS[0]);
  const hash = crypto.createHash('sha1').update(String(cacheId)).digest('hex');
  const cacheDir = path.join(CACHE_ROOT, String(width));
  return { width, cacheDir, cachePath: path.join(cacheDir, `${hash}.webp`) };
}

function sendCached(res, cachePath) {
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=604800');
  fs.createReadStream(cachePath).pipe(res);
}

/**
 * 캐시본이 **이미 있으면** 그것만 내보내고 true. 아니면 false.
 *
 * ★ 2026-09-20 — 이 문이 필요한 이유: Google Drive 에 저장된 이미지는 바이트를 받아오는 것
 *   자체가 0.8~1.0초다(운영 실측). 캐시가 있는데도 Drive 를 한 번 다녀오면 그 시간이 그대로
 *   사용자 대기가 된다. **바이트를 가지러 가기 전에** 캐시를 먼저 본다.
 */
function serveCachedIfPresent(req, res, mimeType, cacheId) {
  const p = plan(req, mimeType, cacheId);
  if (!p) return false;
  try {
    if (!fs.existsSync(p.cachePath)) return false;
    sendCached(res, p.cachePath);
    return true;
  } catch { return false; }
}

/**
 * 스트림(= 로컬 파일이 아닌 저장소)을 받아 리사이즈본을 만들고 내보낸다.
 *
 * ★ 2026-09-20 (Irene: *"썸네일 이미지 늦게 뜨고 어떤 것들은 안나오고"*) —
 *   `?w=` 리사이즈가 **로컬 파일에만** 걸려 있어서, Drive 에 저장된 이미지는 원본이 통째로
 *   나갔다. 운영 실측: 7.9MB 스크린샷이 **8.1MB 그대로** 전송(로컬 같은 크기는 23KB webp).
 *   운영 워크스페이스의 이미지 371장 중 **154장이 Drive** 였다 — 목록 한 번에 수백 MB 다.
 *   HTTP/1.1(연결 6개)에서 그만한 바이트가 줄을 서면 "늦게 뜨고 어떤 건 안 뜬다" 가 된다.
 */
async function resizeStreamAndServe(req, res, stream, mimeType, cacheId) {
  const p = plan(req, mimeType, cacheId);
  if (!p) return false;
  try {
    if (fs.existsSync(p.cachePath)) { stream.destroy(); sendCached(res, p.cachePath); return true; }
    // 원본을 통째로 메모리에 들지 않는다 — 큰 파일이 오면 서버가 문다(이 서버 RAM 7.7GB).
    const chunks = [];
    let bytes = 0;
    const buf = await new Promise((resolve, reject) => {
      stream.on('data', (c) => {
        bytes += c.length;
        if (bytes > MAX_STREAM_BYTES) { stream.destroy(); reject(new Error('too_large')); return; }
        chunks.push(c);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
    await acquireEncode();
    try {
      if (!fs.existsSync(p.cachePath)) {
        fs.mkdirSync(p.cacheDir, { recursive: true });
        const sharp = require('sharp');
        const tmp = `${p.cachePath}.tmp-${process.pid}-${Date.now()}`;
        await sharp(buf).rotate().resize({ width: p.width, withoutEnlargement: true }).webp({ quality: 80 }).toFile(tmp);
        fs.renameSync(tmp, p.cachePath);
      }
    } finally { releaseEncode(); }
    sendCached(res, p.cachePath);
    return true;
  } catch (e) {
    // ★ 스트림을 이미 먹었을 수 있다 — 호출부가 원본으로 되돌릴 수 없으므로 여기서 끝낸다.
    console.warn('[imageResize] stream resize failed:', e.message);
    if (!res.headersSent) res.status(502).json({ success: false, message: 'resize_failed' });
    return true;
  }
}

/**
 * ?w= 요청이면 리사이즈본(webp)을 스트림하고 true 반환. 아니면 false (호출부가 원본 서빙).
 */
async function maybeServeResized(req, res, absPath, mimeType) {
  const p0 = plan(req, mimeType, absPath);
  if (!p0) return false;
  const { width, cacheDir, cachePath } = p0;

  try {
    if (!fs.existsSync(cachePath)) {
      await acquireEncode();
      try {
        // 대기 중에 다른 요청이 이미 만들었을 수 있다 — 다시 확인하고 중복 인코딩을 피한다.
        if (!fs.existsSync(cachePath)) {
          fs.mkdirSync(cacheDir, { recursive: true });
          const sharp = require('sharp');
          const tmp = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
          await sharp(absPath).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toFile(tmp);
          fs.renameSync(tmp, cachePath); // 동시 요청 대비 원자적 교체
        }
      } finally { releaseEncode(); }
    }
    sendCached(res, cachePath);
    return true;
  } catch (e) {
    console.warn('[imageResize] fallback to original:', e.message);
    return false;
  }
}

module.exports = { maybeServeResized, serveCachedIfPresent, resizeStreamAndServe, ALLOWED_WIDTHS };
