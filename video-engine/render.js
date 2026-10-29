// 렌더 — 장면 목록 하나를 가로(16:9)·세로(9:16) mp4 로. 한 번에 한 편씩(대기열은 엔진 단계에서).
//   시작 전 서버 공용 메모리 게이트(heavy-task-gate)와 운영 배포 표시(deploy-busy)를 보고, 막히면 기다린다(우회 안 함).
//   큰 녹화 원본은 번들에 복사하지 않고 127.0.0.1 임시 서버로 내준다.
// 실행: node render.js <대본 id | 장면 목록.json> [--only=landscape|portrait] [--still=12.5,30] [--full]
//   기본 = 조각 렌더(lib/chunks.js): 장면 조각마다 해시를 내고 data/chunks 에 있으면 재사용 → 소리만 한 번 렌더 → 이어 붙여 합친다.
//   --full = 한 번에 통째 렌더(조각 이음새 대조용).
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, spawnSync } = require('child_process');
const { bundle } = require('@remotion/bundler');
const { renderMedia, renderStill, selectComposition } = require('@remotion/renderer');
const { plan } = require('./lib/chunks');
const { ff, probe } = require('./lib/ffmpeg');

const ROOT = __dirname;
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitGate() {
  const gate = '/var/www/scripts/heavy-task-gate.sh';
  let waited = 0;
  for (;;) {
    const dep = spawnSync('/opt/planq/scripts/deploy-busy.sh', [], { encoding: 'utf8' });
    const g = fs.existsSync(gate) ? spawnSync(gate, ['build'], { encoding: 'utf8' }) : { status: 0 };
    const avail = +(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')) || [0, 0])[1] / 1024;
    if (dep.status !== 0 && g.status === 0 && avail > 2200) { if (waited) console.log(`  메모리 게이트 열림 (${waited}s 기다림)`); return; }
    if (!waited) console.log(`  기다림 — ${dep.status === 0 ? '운영 배포 중' : g.status !== 0 ? String(g.stdout || g.stderr).trim().split('\n')[0] : `여유 메모리 ${avail.toFixed(0)}MB`}`);
    if (waited > 3600) throw new Error('메모리 게이트가 1시간 동안 안 열림');
    await sleep(15000); waited += 15;
  }
}

function serveMedia() {
  // lib/chunks.js MEDIA 와 같은 대응
  const map = { '/media/shots/': path.join(ROOT, 'out', 'shots'), '/media/stills/': path.join(ROOT, 'out', 'stills'), '/media/music/': path.join(ROOT, 'assets', 'music'), '/media/uploads/': path.join(ROOT, 'data', 'assets'), '/media/voice/': path.join(ROOT, 'data', 'voice') };
  const types = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const pre = Object.keys(map).find((p) => u.startsWith(p));
    const file = pre && path.join(map[pre], path.normalize(u.slice(pre.length)).replace(/^(\.\.[/\\])+/, ''));
    if (!file || !file.startsWith(map[pre]) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const st = fs.statSync(file);
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    const head = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (range) {
      const a = range[1] ? +range[1] : 0, b = range[2] ? +range[2] : st.size - 1;
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
      fs.createReadStream(file, { start: a, end: b }).pipe(res);
    } else { res.writeHead(200, { ...head, 'Content-Length': st.size }); fs.createReadStream(file).pipe(res); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

function rewrite(obj, base) {
  if (Array.isArray(obj)) return obj.map((x) => rewrite(x, base));
  if (obj && typeof obj === 'object') { const o = {}; for (const [k, v] of Object.entries(obj)) o[k] = rewrite(v, base); return o; }
  if (typeof obj === 'string' && obj.startsWith('media/')) return `${base}/${obj}`;
  return obj;
}

const RENDER_OPTS = { concurrency: 2, crf: 18, x264Preset: 'medium', pixelFormat: 'yuv420p', offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024, chromiumOptions: { gl: 'swangle' } };
const CHUNKS = path.join(ROOT, 'data', 'chunks');
const PIDFILE = '/opt/planq/logs/video-render-running.pid';

// 렌더 중 표시 — 공용 메모리 게이트(node RSS 만 봄)가 크롬을 못 보므로 다른 빌드가 이걸 보고 기다린다(설계 §5)
function markRunning(on) {
  try { if (on) { fs.mkdirSync(path.dirname(PIDFILE), { recursive: true }); fs.writeFileSync(PIDFILE, String(process.pid)); } else if (fs.existsSync(PIDFILE) && fs.readFileSync(PIDFILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(PIDFILE); } catch { /* 표시 실패는 렌더를 막지 않는다 */ }
}

// 조각 렌더 → 소리 렌더 → 이어 붙이기 → 합치기. 반환: { out, reused, rendered, seconds }
async function renderChunked({ serveUrl, comp, sb, raw, out, log = console.log }) {
  const p = plan(raw);
  fs.mkdirSync(CHUNKS, { recursive: true });
  let reused = 0, rendered = 0;
  const files = [];
  for (const c of p.chunks) {
    const f = path.join(CHUNKS, `${c.hash}.mp4`);
    if (fs.existsSync(f) && fs.statSync(f).size > 0) { reused++; files.push(f); continue; }
    const tmp = f + '.part.mp4';
    await renderMedia({ ...RENDER_OPTS, composition: comp, serveUrl, codec: 'h264', outputLocation: tmp, inputProps: { sb }, muted: true, frameRange: [c.from, c.to - 1] });
    fs.renameSync(tmp, f); rendered++; files.push(f);
    log(`  조각 ${c.index + 1}/${p.chunks.length} ${c.id} · ${c.frames}프레임 렌더`);
  }
  const aud = path.join(CHUNKS, `audio-${p.audioHash}.m4a`);
  if (!fs.existsSync(aud)) {
    const { crf, x264Preset, pixelFormat, ...audioOpts } = RENDER_OPTS; // 오디오 코덱은 영상 옵션을 거부한다
    await renderMedia({ ...audioOpts, composition: comp, serveUrl, codec: 'aac', audioBitrate: '192k', outputLocation: aud + '.part.m4a', inputProps: { sb } });
    fs.renameSync(aud + '.part.m4a', aud);
  }
  const list = out + '.concat.txt';
  fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-i', aud, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', out]);
  fs.unlinkSync(list);
  // 이어 붙인 길이 = 장면 목록 총길이 ±1프레임 — 어긋나면 조각이 틀린 것이다(설계 §8)
  const frames = Math.round(probe(out).duration * p.fps);
  if (Math.abs(frames - p.total) > 1) throw new Error(`이어 붙인 길이 ${frames} ≠ 장면 목록 ${p.total} 프레임`);
  return { out, reused, rendered, chunks: p.chunks.length, seconds: p.total / p.fps };
}

async function renderAll({ arg0, only = null, stillAt = null, full = false, log = console.log }) {
  const files = arg0.endsWith('.json') ? [arg0] : ['landscape', 'portrait'].map((x) => path.join(ROOT, 'out', 'storyboards', `${arg0}.${x}.json`));
  await waitGate();
  const { srv, base } = await serveMedia();
  markRunning(true);
  const results = [];
  try {
    const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'src', 'index.ts'), publicDir: path.join(ROOT, 'public') });
    const outDir = path.join(ROOT, 'out', 'renders'); fs.mkdirSync(outDir, { recursive: true });
    for (const file of files) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const sb = rewrite(raw, base);
      const aspect = sb.aspect || 'landscape';
      if (only && only !== aspect) continue;
      const id = aspect === 'landscape' ? 'Landscape' : 'Portrait';
      const comp = await selectComposition({ serveUrl, id, inputProps: { sb } });
      const tag = aspect === 'landscape' ? '16x9' : '9x16';
      if (stillAt) {
        for (const st of String(stillAt).split(',')) {
          const out = path.join(outDir, `${sb.id}-${tag}-${st}.jpg`);
          await renderStill({ composition: comp, serveUrl, inputProps: { sb }, frame: Math.min(comp.durationInFrames - 1, Math.round(+st * comp.fps)), output: out, imageFormat: 'jpeg', jpegQuality: 85 });
        }
        log(`  정지 화면 ${tag} ${stillAt}`);
        continue;
      }
      const out = path.join(outDir, `${sb.id}-${tag}${full ? '-full' : ''}.mp4`);
      const t0 = Date.now();
      let r;
      if (full) {
        await renderMedia({ ...RENDER_OPTS, composition: comp, serveUrl, codec: 'h264', outputLocation: out, inputProps: { sb }, audioBitrate: '192k' });
        r = { out, reused: 0, rendered: 1, chunks: 1, seconds: comp.durationInFrames / comp.fps };
      } else r = await renderChunked({ serveUrl, comp, sb, raw, out, log });
      r.ms = Date.now() - t0; r.aspect = aspect; r.bytes = fs.statSync(out).size;
      log(`  완성 ${out} · ${r.seconds.toFixed(1)}s · ${(r.bytes / 1048576).toFixed(1)}MB · 조각 ${r.rendered} 렌더/${r.reused} 재사용 · ${(r.ms / 1000).toFixed(0)}s 걸림`);
      results.push(r);
    }
  } finally { srv.close(); markRunning(false); }
  return results;
}

if (require.main === module) {
  renderAll({ arg0: process.argv[2], only: arg('only'), stillAt: arg('still'), full: process.argv.includes('--full') })
    .catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { renderAll, waitGate, markRunning };
