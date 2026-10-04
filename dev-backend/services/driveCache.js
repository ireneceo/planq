// services/driveCache.js — Google Drive 에 저장된 첨부 바이트의 **디스크 캐시** (2026-10-04).
//
// 왜 (Irene: *"파일 첨부된 거 다운로드들이 너무 느려"*):
//   운영 실측 — Drive 저장 파일(175개·591MB, 전체의 절반 이상) 3.5MB 가 첫 바이트 2.5초 · 전체 3.2초 ·
//   1.0MB/s 였다. 같은 크기의 자체 저장(planq) 파일은 sendFile 이라 즉시 나간다.
//   Drive 왕복 자체가 0.7~1.0초라 **매번 다녀오는 한** 빨라질 수 없다. 그래서 첫 번째로 받을 때
//   응답으로 흘리면서 디스크에도 같이 쓰고(tee), 그 뒤로는 디스크에서 sendFile 한다.
//
// 계약:
//   · **권한은 이 파일이 보지 않는다.** 호출부(라우트)가 권한을 다 본 뒤 readAttachmentBody 를 부르고,
//     캐시는 그 안에서만 쓰인다. 캐시가 권한을 우회하는 문이 되지 않도록 **캐시를 직접 서빙하는
//     공개 함수를 두지 않는다**(imageResize.serveCachedIfPresent 와 다른 점 — 그건 라우트가 판정 뒤에 부른다).
//   · 키 = business_id + Drive 파일 id. 크기(file_size)를 알면 **크기가 다르면 무효**(지우고 다시 받는다).
//   · 임시 파일에 쓰고 **바이트 수가 맞을 때만** rename. 끊김·오류·소비자 취소면 폐기한다.
//   · 상한(기본 3GB, LRU = 마지막 사용 시각) + TTL(기본 14일 미사용 삭제) — `sweepDriveCache`.
//     사용 시각은 파일 mtime 으로 둔다(atime 은 relatime 마운트에서 믿을 수 없다).
//   · 원본이 Drive 에서 지워지면 캐시도 지운다 — `gdrive.deleteFile` 한 곳이 부른다
//     (삭제 경로가 넷이라 호출부마다 적으면 반드시 하나가 빠진다).
//
// 위치: uploads/.cache/drive/<business_id>/<sha1(external_id)>  — 리사이즈 캐시(uploads/.cache/<폭>)와 같은 뿌리.
//   uploads 는 정적 서빙되지 않는다(경로를 알아도 밖에서 못 연다).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PassThrough } = require('stream');

const ROOT = path.join(__dirname, '..', 'uploads', '.cache', 'drive');
const MAX_TOTAL = Number(process.env.DRIVE_CACHE_MAX_BYTES) || 3 * 1024 * 1024 * 1024;
const TTL_MS = (Number(process.env.DRIVE_CACHE_TTL_DAYS) || 14) * 24 * 60 * 60 * 1000;
/** 한 파일 상한 — 이보다 크면 캐시하지 않는다(전체 상한을 혼자 다 먹지 않게). 스트림은 그대로 나간다. */
const MAX_ONE = Math.min(Number(process.env.DRIVE_CACHE_MAX_FILE_BYTES) || 512 * 1024 * 1024, MAX_TOTAL);
/** 남은 임시 파일(프로세스가 죽어 rename 도 폐기도 못 한 것) — 이보다 오래되면 지운다. */
const STALE_TMP_MS = 60 * 60 * 1000;

function safeBiz(businessId) {
  const n = Number(businessId);
  return Number.isInteger(n) && n > 0 ? String(n) : null;
}

function cachePathOf(businessId, externalId) {
  const biz = safeBiz(businessId);
  if (!biz || !externalId) return null;
  const h = crypto.createHash('sha1').update(String(externalId)).digest('hex');
  return path.join(ROOT, biz, h);
}

/**
 * 캐시 적중이면 { path, size } — 아니면 null.
 * expectedSize(>0)가 있으면 크기가 같아야 적중이다. 다르면 그 캐시본은 낡은 것이라 지운다.
 */
function lookup(businessId, externalId, expectedSize) {
  const p = cachePathOf(businessId, externalId);
  if (!p) return null;
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  if (!st.isFile()) return null;
  const exp = Number(expectedSize) || 0;
  if (exp > 0 && st.size !== exp) {
    try { fs.unlinkSync(p); } catch { /* 이미 없음 */ }
    return null;
  }
  // LRU 표식 — 쓸 때마다 mtime 을 지금으로(실패해도 서빙에는 영향 없다)
  const now = new Date();
  fs.utimes(p, now, now, () => {});
  return { path: p, size: st.size };
}

/**
 * Drive 스트림을 받아 **같은 바이트를 흘리는 새 스트림**을 돌려준다. 다 흐르면 캐시 파일이 생긴다.
 * @param src         Drive 응답 스트림
 * @param opts.expectedLen 정확히 이 길이일 때만 캐시한다(모르면 null — 끝까지 흐른 것만으로 인정)
 */
function teeIntoCache(src, businessId, externalId, opts = {}) {
  const finalPath = cachePathOf(businessId, externalId);
  const expectedLen = Number(opts.expectedLen) || null;
  if (!finalPath || (expectedLen && expectedLen > MAX_ONE)) return src;

  const out = new PassThrough();
  const tmp = `${finalPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  let ws = null;
  let diskOk = true;
  let written = 0;
  let srcEnded = false;
  let settled = false;

  const discard = () => {
    if (settled) return;
    settled = true;
    if (ws) { try { ws.destroy(); } catch { /* */ } }
    fs.unlink(tmp, () => {});
  };

  try {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    ws = fs.createWriteStream(tmp);
    ws.on('error', (e) => {
      // 이미 폐기한 뒤(취소·끊김)에 밀려 있던 쓰기가 내는 오류는 소음이다 — 조용히 넘긴다.
      if (!settled) console.warn('[driveCache] 캐시 쓰기 실패 — 스트림은 계속', e.message);
      diskOk = false;
      discard();
      maybeResume();
    });
  } catch (e) {
    console.warn('[driveCache] 캐시 준비 실패', e.message);
    return src;
  }

  // 둘(응답·디스크) 중 느린 쪽에 맞춘다 — 하나라도 막히면 원본을 멈춘다.
  let outBlocked = false;
  let diskBlocked = false;
  function maybeResume() {
    if (!outBlocked && (!diskBlocked || !diskOk)) src.resume();
  }
  out.on('drain', () => { outBlocked = false; maybeResume(); });
  ws.on('drain', () => { diskBlocked = false; maybeResume(); });

  src.on('data', (chunk) => {
    written += chunk.length;
    if (diskOk && !settled) {
      if (written > MAX_ONE) { diskOk = false; discard(); }
      else if (!ws.write(chunk)) diskBlocked = true;
    }
    if (!out.write(chunk)) outBlocked = true;
    if (outBlocked || (diskBlocked && diskOk)) src.pause();
  });
  src.on('end', () => {
    srcEnded = true;
    out.end();
    if (!diskOk || settled) return;
    ws.end(() => {
      if (settled) return;
      if (expectedLen && written !== expectedLen) {
        console.warn('[driveCache] 길이 불일치 — 캐시하지 않는다', { expectedLen, written });
        discard();
        return;
      }
      settled = true;
      fs.rename(tmp, finalPath, (e) => {
        if (e) { fs.unlink(tmp, () => {}); return; }
        scheduleSweep();
      });
    });
  });
  src.on('error', (e) => {
    discard();
    out.destroy(e);
  });
  // 소비자가 중간에 끊었다(취소·연결 끊김) — 원본도 끊고 반쪽 캐시는 버린다.
  out.on('close', () => {
    if (!srcEnded) {
      discard();
      try { src.destroy(); } catch { /* */ }
    }
  });
  return out;
}

/** 원본이 지워졌다 — 그 Drive 파일의 캐시본을 모든 워크스페이스 폴더에서 지운다(Drive id 는 전역 유일). */
function dropByExternalId(externalId) {
  if (!externalId) return 0;
  const h = crypto.createHash('sha1').update(String(externalId)).digest('hex');
  let n = 0;
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT); } catch { return 0; }
  for (const d of dirs) {
    const p = path.join(ROOT, d, h);
    try { fs.unlinkSync(p); n += 1; } catch { /* 없음 */ }
  }
  return n;
}

/** 워크스페이스 하나의 캐시를 통째로 비운다(연결 해제 등). */
function dropBusiness(businessId) {
  const biz = safeBiz(businessId);
  if (!biz) return;
  try { fs.rmSync(path.join(ROOT, biz), { recursive: true, force: true }); } catch { /* */ }
}

/**
 * TTL·상한 정리. 돌려주는 값은 검사·로그용.
 * ① 임시 파일 중 오래된 것 ② 마지막 사용이 TTL 보다 오래된 것 ③ 그래도 상한을 넘으면 오래 안 쓴 것부터.
 */
function sweepDriveCache(opts = {}) {
  const now = opts.now || Date.now();
  const maxTotal = opts.maxTotal || MAX_TOTAL;
  const ttl = opts.ttlMs || TTL_MS;
  const stats = { scanned: 0, removedTtl: 0, removedLru: 0, removedTmp: 0, totalBefore: 0, totalAfter: 0 };
  const entries = [];
  let dirs = [];
  try { dirs = fs.readdirSync(ROOT); } catch { return stats; }
  for (const d of dirs) {
    const dir = path.join(ROOT, d);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const p = path.join(dir, name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (!st.isFile()) continue;
      stats.scanned += 1;
      if (name.includes('.tmp-')) {
        if (now - st.mtimeMs > STALE_TMP_MS) { try { fs.unlinkSync(p); stats.removedTmp += 1; } catch { /* */ } }
        continue;
      }
      stats.totalBefore += st.size;
      if (now - st.mtimeMs > ttl) {
        try { fs.unlinkSync(p); stats.removedTtl += 1; } catch { /* */ }
        continue;
      }
      entries.push({ p, size: st.size, at: st.mtimeMs });
    }
  }
  let total = entries.reduce((s, e) => s + e.size, 0);
  if (total > maxTotal) {
    entries.sort((a, b) => a.at - b.at);
    for (const e of entries) {
      if (total <= maxTotal) break;
      try { fs.unlinkSync(e.p); total -= e.size; stats.removedLru += 1; } catch { /* */ }
    }
  }
  stats.totalAfter = total;
  return stats;
}

// 새 캐시본이 생기면 잠시 뒤 한 번 정리한다(상한을 넘긴 채 오래 두지 않게). 여러 개가 연달아 생겨도 한 번.
let sweepTimer = null;
function scheduleSweep() {
  if (sweepTimer) return;
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    try { sweepDriveCache(); } catch (e) { console.warn('[driveCache] sweep 실패', e.message); }
  }, 60 * 1000);
  if (sweepTimer.unref) sweepTimer.unref();
}

/** server.js 가 부른다 — 부팅 1분 뒤 1회 + 매시. */
function initDriveCacheSweep() {
  const run = () => {
    try {
      const s = sweepDriveCache();
      if (s.removedTtl || s.removedLru || s.removedTmp) console.log('[driveCache] sweep', s);
    } catch (e) { console.warn('[driveCache] sweep 실패', e.message); }
  };
  const t = setTimeout(run, 60 * 1000);
  if (t.unref) t.unref();
  const iv = setInterval(run, 60 * 60 * 1000);
  if (iv.unref) iv.unref();
}

module.exports = {
  lookup, teeIntoCache, dropByExternalId, dropBusiness, sweepDriveCache, initDriveCacheSweep, cachePathOf,
  ROOT, MAX_TOTAL, TTL_MS, MAX_ONE,
};
