// 대본 판 — 지우지 않는다. 되돌리기 = 옛 판을 복사한 새 판(설계 §2 video_versions 의 파일판 — D 에서 DB 로 옮긴다).
//   data/projects/<id>/v<n>.json = { version, parent, source, note, created_at, script }
//   storyboards/<id>.json = 지금 판(렌더가 읽는 것)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const dir = (id) => path.join(ROOT, 'data', 'projects', id);

function list(id) {
  if (!fs.existsSync(dir(id))) return [];
  return fs.readdirSync(dir(id)).filter((f) => /^v\d+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(dir(id), f), 'utf8'))).sort((a, b) => a.version - b.version);
}
function save(id, script, { source, note, parent = null }) {
  fs.mkdirSync(dir(id), { recursive: true });
  const all = list(id);
  const version = (all.length ? all[all.length - 1].version : 0) + 1;
  const rec = { version, parent, source, note, created_at: new Date().toISOString(), script };
  fs.writeFileSync(path.join(dir(id), `v${version}.json`), JSON.stringify(rec, null, 2));
  fs.writeFileSync(path.join(ROOT, 'storyboards', `${id}.json`), JSON.stringify(script, null, 2));
  return rec;
}
// 처음 판이 없으면 지금 대본을 v1 로
function ensureV1(id) {
  if (list(id).length) return;
  const cur = JSON.parse(fs.readFileSync(path.join(ROOT, 'storyboards', `${id}.json`), 'utf8'));
  save(id, cur, { source: cur._ai ? 'ai' : 'human', note: '처음 판' });
}
function revert(id, n) {
  const v = list(id).find((x) => x.version === n);
  if (!v) throw new Error(`v${n} 없음`);
  return save(id, v.script, { source: 'revert', note: `v${n} 로 되돌림`, parent: n });
}
// 두 판의 장면 차이(사람이 보는 요약)
function diff(a, b) {
  const out = [];
  const n = Math.max(a.scenes.length, b.scenes.length);
  for (let i = 0; i < n; i++) {
    const x = a.scenes[i], y = b.scenes[i];
    if (!x) out.push(`+ 장면 ${i + 1} 추가 (${y.kind})`);
    else if (!y) out.push(`- 장면 ${i + 1} 삭제 (${x.kind})`);
    else if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`~ 장면 ${i + 1} (${y.kind}) 바뀜`);
  }
  for (const k of ['template', 'music', 'templateOverrides']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`~ ${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
  return out;
}
module.exports = { list, save, ensureV1, revert, diff };
