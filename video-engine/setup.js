// 처음 한 번(또는 node_modules 를 다시 깐 뒤): 글꼴·로고 복사 · 효과음 합성 · 음악 내려받기(목록 assets/music/catalog.json)
//   node setup.js   — 이미 있으면 건너뛴다. 렌더 브라우저: npx remotion browser ensure
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const R = __dirname;
const cp = (a, b) => { if (!fs.existsSync(b)) { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); console.log('복사', path.relative(R, b)); } };
for (const w of ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']) cp(path.join(R, 'node_modules/pretendard/dist/web/static/woff2', `Pretendard-${w}.woff2`), path.join(R, 'public/fonts', `Pretendard-${w}.woff2`));
// 로고 SVG 에 width/height 를 붙인다 — 크기 없는 SVG 는 렌더 브라우저가 «decode 실패» 로 장면을 죽인다
for (const f of ['planQ_white_new.svg', 'planQ_color.svg', 'favicon.svg']) {
  const dst = path.join(R, 'public/brand', f);
  if (fs.existsSync(dst) && /<svg[^>]*\swidth=/.test(fs.readFileSync(dst, 'utf8'))) continue;
  let svg = fs.readFileSync(path.join('/opt/planq/dev-frontend/public', f), 'utf8');
  const vb = /viewBox="[\d.\s-]*?\s([\d.]+)\s([\d.]+)"/.exec(svg);
  if (vb) svg = svg.replace('<svg ', `<svg width="${vb[1]}" height="${vb[2]}" `);
  fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, svg); console.log('로고', f);
}
if (!fs.existsSync(path.join(R, 'assets/sfx/click.wav'))) execFileSync('node', [path.join(R, 'lib/sfx.js')], { stdio: 'inherit' });
for (const f of fs.readdirSync(path.join(R, 'assets/sfx'))) cp(path.join(R, 'assets/sfx', f), path.join(R, 'public/sfx', f));
for (const m of JSON.parse(fs.readFileSync(path.join(R, 'assets/music/catalog.json'), 'utf8'))) {
  const dst = path.join(R, 'assets/music', m.file);
  if (!fs.existsSync(dst) && m.url) { execFileSync('curl', ['-sfL', '-o', dst, m.url]); console.log('음악', m.file); }
}
