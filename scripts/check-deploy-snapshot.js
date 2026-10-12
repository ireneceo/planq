#!/usr/bin/env node
/**
 * 배포 사본 백엔드 검사 — 문법 + 상대 require 대상 존재 (2026-10-12)
 *
 * 왜: 운영 배포가 «마지막 커밋의 사본» 에서 나간다(scripts/make-deploy-snapshot.sh).
 *   예전에는 «배포되는 코드 = dev pm2 가 돌리는 코드» 라 health-check 가 그 코드를 실제로 때렸다.
 *   이제 health-check 는 작업 폴더(미커밋 포함) 코드를 때리고, **사본 코드는 운영 pm2 재시작 전까지
 *   한 번도 실행되지 않는다.** 커밋에서 빠진 파일(작업 폴더에만 있는 새 모듈을 require)·편집 도중
 *   커밋된 문법 오류는 운영이 한 번 죽은 뒤에야 보인다. 그 두 가지를 여기서 막는다.
 *   (PurpleHere 같은 전환의 Fable 게이트 C3 와 같은 구멍 — 2026-10-11.)
 *
 * 방법: 파일마다 CommonJS 감싸개로 vm.Script 컴파일(실행 안 함 — 프로세스 하나라 node --check 전수보다 빠르다).
 *   require('./…'·'../…') 의 **문자열 리터럴**만 그 파일 위치에서 require.resolve 로 찾는다.
 *   (패키지 이름·동적 require 는 보지 않는다 — 패키지는 운영 npm ci 가 lock 으로 깐다.)
 *
 * 사용: node scripts/check-deploy-snapshot.js <사본 루트>     실패 시 exit 1
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, 'dev-backend'))) {
  console.error('사용: node scripts/check-deploy-snapshot.js <사본 루트>');
  process.exit(2);
}
const BE = path.join(root, 'dev-backend');
const SKIP_DIRS = new Set(['node_modules', 'uploads', 'logs', 'backups', 'secrets', '.claude']);

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isSymbolicLink()) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(p, out); }
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(BE, []);
const syntaxErr = [];
const missing = [];
const REQ = /\brequire\(\s*(['"])(\.{1,2}\/[^'"]*)\1\s*\)/g;

for (const f of files) {
  let src = fs.readFileSync(f, 'utf8');
  if (src.startsWith('#!')) src = '//' + src.slice(2);
  try {
    // eslint-disable-next-line no-new
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {${src}\n})`, { filename: f });
  } catch (e) {
    syntaxErr.push(`${path.relative(root, f)}: ${String(e.message).split('\n')[0]}`);
    continue;
  }
  // 주석 안의 require 예시는 거르지 않는다 — 대신 줄 주석으로 시작하는 줄은 건너뛴다.
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    REQ.lastIndex = 0;
    let m;
    while ((m = REQ.exec(line))) {
      try {
        require.resolve(m[2], { paths: [path.dirname(f)] });
      } catch (_) {
        missing.push(`${path.relative(root, f)}:${i + 1}: require('${m[2]}') — 커밋에 없음`);
      }
    }
  }
}

console.log(`[snapshot-check] 백엔드 ${files.length}개 파일 · 문법 오류 ${syntaxErr.length} · 없는 require ${missing.length}`);
for (const s of syntaxErr.slice(0, 20)) console.log(`  ✗ 문법  ${s}`);
for (const s of missing.slice(0, 20)) console.log(`  ✗ 누락  ${s}`);
if (files.length === 0) { console.log('  ✗ 검사한 파일이 0개 — 사본이 비었다'); process.exit(1); }
process.exit(syntaxErr.length || missing.length ? 1 : 0);
