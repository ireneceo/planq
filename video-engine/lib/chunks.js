// 조각 렌더 계획 — 장면 목록을 장면 단위 프레임 조각으로 나누고, 조각마다 «이 조각의 그림을 정하는 모든 것» 의 해시를 낸다.
//   설계 docs/DEMO_VIDEO_DESIGN.md §8 · Fable 차단 2:
//   조각 i = [장면 i 시작, 장면 i+1 시작) 프레임. 앞부분엔 장면 i−1 의 꼬리(겹침·사라짐)가 같이 그려지고,
//   배경은 절대 시각으로 흐르며, mixed 전환 종류는 장면 번호로 정해진다 → 해시에 그것들을 다 넣는다.
//   길이가 바뀌는 수정은 뒤 장면들의 startFrame 이 바뀌어 저절로 «그 장면부터 뒤 전부» 다시 그려진다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MIX = ['zoom', 'slide', 'fade', 'wipe']; // src/Video.tsx 와 같은 순서여야 한다

const sha = (x) => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');

// 파일 md5 — 크기·수정 시각이 같으면 다시 읽지 않는다(녹화 원본은 수백 MB)
const md5Cache = new Map();
function fileMd5(file) {
  const st = fs.statSync(file);
  const key = `${file}:${st.size}:${st.mtimeMs}`;
  if (md5Cache.has(key)) return md5Cache.get(key);
  const h = crypto.createHash('md5');
  const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(1 << 20);
  let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  const v = h.digest('hex'); md5Cache.set(key, v); return v;
}

// 엔진 판 — 그리는 코드(src)·글꼴·로고가 바뀌면 옛 조각은 전부 무효
let engineVer = null;
function engineVersion() {
  if (engineVer) return engineVer;
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else files.push(p); } };
  for (const d of ['src', 'public/fonts', 'public/brand']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  files.sort();
  engineVer = sha(files.map((f) => path.relative(ROOT, f) + ':' + fileMd5(f)).join('\n') + require(path.join(ROOT, 'package.json')).dependencies.remotion);
  return engineVer;
}

// media/… 경로 → 실제 파일(serveMedia 와 같은 대응)
const MEDIA = { 'media/shots/': 'out/shots', 'media/stills/': 'out/stills', 'media/music/': 'assets/music', 'media/uploads/': 'data/assets', 'media/voice/': 'data/voice' };
function mediaFile(ref) {
  const pre = Object.keys(MEDIA).find((p) => ref.startsWith(p));
  return pre ? path.join(ROOT, MEDIA[pre], ref.slice(pre.length)) : null;
}
// 장면이 쓰는 소재 파일의 md5 목록
function sceneMedia(sc) {
  const refs = [];
  const visit = (o) => { if (Array.isArray(o)) o.forEach(visit); else if (o && typeof o === 'object') Object.values(o).forEach(visit); else if (typeof o === 'string' && o.startsWith('media/')) refs.push(o); };
  visit(sc);
  return [...new Set(refs)].sort().map((r) => { const f = mediaFile(r); return `${r}:${f && fs.existsSync(f) ? fileMd5(f) : 'missing'}`; });
}

// src/Video.tsx timeline() 과 같은 계산(같은 반올림) — 둘이 갈리면 이음새가 어긋난다
function timeline(sb) {
  let at = 0;
  return sb.scenes.map((sc, i) => {
    const trans = i === 0 ? 0 : (sc.transIn ?? sb.template.transitionSec);
    at = i === 0 ? 0 : at - trans;
    const start = at; at += sc.dur;
    return { sc, i, start, trans, kind: sc.transKind || (sb.template.transition === 'mixed' ? MIX[i % MIX.length] : sb.template.transition) };
  });
}

function plan(sb) {
  const fps = sb.fps;
  const tl = timeline(sb);
  const last = tl[tl.length - 1];
  const total = Math.ceil((last.start + last.sc.dur) * fps); // Root.tsx calculateMetadata 와 같은 값
  const eng = engineVersion();
  const brand = ['brand/planQ_white_new.svg', 'brand/favicon.svg'].map((f) => fileMd5(path.join(ROOT, 'public', f)));
  const tplHash = sha(sb.template);
  const chunks = tl.map((x, k) => {
    const from = Math.round(x.start * fps);
    const to = k + 1 < tl.length ? Math.round(tl[k + 1].start * fps) : total;
    const prev = tl[k - 1], next = tl[k + 1];
    const hash = sha({
      eng, fps, aspect: sb.aspect, tpl: tplHash, brand,
      prev: prev ? { sc: prev.sc, kind: prev.kind, trans: prev.trans, media: sceneMedia(prev.sc) } : null,
      cur: { sc: x.sc, kind: x.kind, trans: x.trans, media: sceneMedia(x.sc) },
      next: next ? { trans: next.trans, kind: next.kind } : null,
      from, to,
    });
    return { index: k, id: x.sc.id, from, to, frames: to - from, hash };
  }).filter((c) => c.frames > 0);
  // 소리 해시 — 음악·효과음·목소리·전체 길이
  const audioHash = sha({ eng, music: sb.music, sfx: sb.sfx, voice: sb.voice, total, tplSfx: sb.template.sfx, musicVolume: sb.template.musicVolume, duck: sb.template.duck,
    media: sceneMedia({ m: sb.music, v: sb.voice }) });
  return { fps, total, chunks, audioHash };
}

module.exports = { plan, timeline, engineVersion, fileMd5, mediaFile, sha };
