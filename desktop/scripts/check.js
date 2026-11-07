#!/usr/bin/env node
// 패키지 검사 — 만든 앱 안(app.asar)에 시험 표면이 하나도 없는가 (docs/DESKTOP_APP_DESIGN.md §8-G).
//   node scripts/check.js <win|mac> <dist 폴더>
//   양성 대조: node scripts/check.js --self-test  → 시험 구역을 남긴 가짜 preload 로 FAIL 이 나는지 본다.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FORBIDDEN = ['__test', 'planq:test:', '--planq-desktop-test', 'test-hooks', '@test-only'];

function scan(text, label) {
  const hits = FORBIDDEN.filter((w) => text.includes(w));
  if (hits.length) { console.error(`[desktop-check] ✗ ${label}: 시험 표면 ${hits.join(', ')}`); return false; }
  return true;
}

function readAsar(asarPath) {
  const asar = require(path.join(ROOT, 'node_modules', '@electron', 'asar'));
  const files = asar.listPackage(asarPath).map((f) => f.replace(/\\/g, '/'));
  let ok = true;
  if (files.some((f) => f.startsWith('/test/') || f.includes('test-hooks'))) { console.error('[desktop-check] ✗ test/ 폴더가 들어갔다'); ok = false; }
  for (const f of files.filter((x) => /^\/src\/.*\.js$/.test(x))) {
    ok = scan(asar.extractFile(asarPath, f.slice(1)).toString('utf8'), f) && ok;
  }
  const origin = JSON.parse(asar.extractFile(asarPath, 'src/origin.json').toString('utf8')).origin;
  console.log(`[desktop-check] 출처 ${origin} · src 파일 ${files.filter((x) => x.startsWith('/src/')).length}개`);
  return ok;
}

function findAsar(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'app.asar') out.push(p);
    }
  };
  walk(dir);
  return out;
}

if (process.argv[2] === '--self-test') {
  // 대조군: 잘라내기 전 원본 preload 는 FAIL, 잘라낸 것은 PASS 여야 검사기를 믿는다
  const raw = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
  const stripped = raw.replace(/\/\/ @test-only-start[\s\S]*?\/\/ @test-only-end\n?/g, '');
  const a = scan(raw, '원본 preload(대조군 — 실패해야 함)');
  const b = scan(stripped, '잘라낸 preload');
  console.log(!a && b ? '[desktop-check] self-test PASS' : '[desktop-check] self-test FAIL');
  process.exit(!a && b ? 0 : 1);
}

const dist = process.argv[3];
if (!dist || !fs.existsSync(dist)) { console.error('[desktop-check] dist 폴더 없음'); process.exit(2); }
const asars = findAsar(dist);
if (!asars.length) { console.error('[desktop-check] app.asar 를 못 찾음'); process.exit(1); }
let ok = true;
for (const a of asars) ok = readAsar(a) && ok;
console.log(ok ? `[desktop-check] PASS (${asars.length}개 패키지)` : '[desktop-check] FAIL');
process.exit(ok ? 0 : 1);
