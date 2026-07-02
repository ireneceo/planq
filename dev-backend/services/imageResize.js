// 이미지 서빙 공용 on-the-fly 리사이즈 (#97) — ?w= 파라미터 지원 + 디스크 캐시.
//   - 업로드 파일은 UUID 로 불변이므로 경로 hash 캐시로 충분 (invalidation 불필요)
//   - 허용 폭 스냅(고정 5단) — 캐시 폭발/파라미터 남용 방지
//   - gif(애니메이션)/svg 는 원본 그대로. 리사이즈 실패 시 원본 fallback (false 반환)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ALLOWED_WIDTHS = [200, 400, 800, 1024, 1600];
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
      fs.mkdirSync(cacheDir, { recursive: true });
      const sharp = require('sharp');
      const tmp = `${cachePath}.tmp-${process.pid}`;
      await sharp(absPath).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toFile(tmp);
      fs.renameSync(tmp, cachePath); // 동시 요청 대비 원자적 교체
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
