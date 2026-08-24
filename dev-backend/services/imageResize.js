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

/**
 * ?w= 요청이면 리사이즈본(webp)을 스트림하고 true 반환. 아니면 false (호출부가 원본 서빙).
 */
async function maybeServeResized(req, res, absPath, mimeType) {
  const raw = parseInt(req.query.w, 10);
  if (!raw || raw <= 0) return false;
  if (!RESIZABLE.test(mimeType || '')) return false;

  // 허용 폭으로 스냅 (가장 가까운 값)
  const width = ALLOWED_WIDTHS.reduce((best, a) => (Math.abs(a - raw) < Math.abs(best - raw) ? a : best), ALLOWED_WIDTHS[0]);

  const hash = crypto.createHash('sha1').update(absPath).digest('hex');
  const cacheDir = path.join(CACHE_ROOT, String(width));
  const cachePath = path.join(cacheDir, `${hash}.webp`);

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
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=604800');
    fs.createReadStream(cachePath).pipe(res);
    return true;
  } catch (e) {
    console.warn('[imageResize] fallback to original:', e.message);
    return false;
  }
}

module.exports = { maybeServeResized, ALLOWED_WIDTHS };
