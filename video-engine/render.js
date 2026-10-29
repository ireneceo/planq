// 렌더 — 장면 목록 하나를 가로(16:9)·세로(9:16) mp4 로. 한 번에 한 편씩(대기열은 엔진 단계에서).
//   시작 전 서버 공용 메모리 게이트(heavy-task-gate)와 운영 배포 표시(deploy-busy)를 보고, 막히면 기다린다(우회 안 함).
//   큰 녹화 원본은 번들에 복사하지 않고 127.0.0.1 임시 서버로 내준다.
// 실행: node render.js out/storyboards/<id>.json [--only=landscape|portrait] [--frames=0-90] [--still=12.5]
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, spawnSync } = require('child_process');
const { bundle } = require('@remotion/bundler');
const { renderMedia, renderStill, selectComposition } = require('@remotion/renderer');

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
  const map = { '/media/shots/': path.join(ROOT, 'out', 'shots'), '/media/stills/': path.join(ROOT, 'out', 'stills'), '/media/music/': path.join(ROOT, 'assets', 'music'), '/media/uploads/': path.join(ROOT, 'out', 'uploads') };
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

async function main() {
  // 인자: 대본 id(가로·세로 둘 다) 또는 장면 목록 파일 하나
  const a = process.argv[2];
  const files = a.endsWith('.json') ? [a] : ['landscape', 'portrait'].map((x) => path.join(ROOT, 'out', 'storyboards', `${a}.${x}.json`));
  const only = arg('only');
  const frames = arg('frames');
  const stillAt = arg('still');
  await waitGate();
  const { srv, base } = await serveMedia();
  try {
    const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'src', 'index.ts'), publicDir: path.join(ROOT, 'public') });
    const outDir = path.join(ROOT, 'out', 'renders'); fs.mkdirSync(outDir, { recursive: true });
    for (const file of files) {
      const sb = rewrite(JSON.parse(fs.readFileSync(file, 'utf8')), base);
      const aspect = sb.aspect || 'landscape';
      if (only && only !== aspect) continue;
      const id = aspect === 'landscape' ? 'Landscape' : 'Portrait';
      const comp = await selectComposition({ serveUrl, id, inputProps: { sb } });
      const tag = aspect === 'landscape' ? '16x9' : '9x16';
      if (stillAt) {
        for (const st of stillAt.split(',')) {
          const out = path.join(outDir, `${sb.id}-${tag}-${st}.jpg`);
          await renderStill({ composition: comp, serveUrl, inputProps: { sb }, frame: Math.min(comp.durationInFrames - 1, Math.round(+st * comp.fps)), output: out, imageFormat: 'jpeg', jpegQuality: 85 });
        }
        console.log('  정지 화면', tag, stillAt);
        continue;
      }
      const out = path.join(outDir, `${sb.id}-${tag}.mp4`);
      const t0 = Date.now(); let last = -1;
      await renderMedia({
        composition: comp, serveUrl, codec: 'h264', outputLocation: out, inputProps: { sb },
        concurrency: 2, crf: 18, x264Preset: 'medium', pixelFormat: 'yuv420p', audioBitrate: '192k', offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
        chromiumOptions: { gl: 'swangle' },
        frameRange: frames ? frames.split('-').map(Number) : undefined,
        onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; process.stdout.write(`  ${tag} ${p * 10}%\n`); } },
      });
      const mb = (fs.statSync(out).size / 1048576).toFixed(1);
      console.log(`  완성 ${out} · ${(comp.durationInFrames / comp.fps).toFixed(1)}s · ${mb}MB · ${((Date.now() - t0) / 1000).toFixed(0)}s 걸림`);
    }
  } finally { srv.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
