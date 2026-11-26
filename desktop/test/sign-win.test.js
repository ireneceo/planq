// node desktop/test/sign-win.test.js — 윈도우 서명 함수 시험 (가짜 CodeSignTool 로 통과·탈락 양쪽)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const signer = require('../scripts/sign-win');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-sign-'));
// 가장 작은 PE32+ 머리: MZ · e_lfanew · PE\0\0 · 옵션 헤더 magic 0x20b · 데이터 디렉터리(보안 = 4번)
function makePe(file) {
  const b = Buffer.alloc(0x400);
  b.writeUInt16LE(0x5a4d, 0); b.writeUInt32LE(0x80, 0x3c); b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(0x20b, 0x80 + 24);
  fs.writeFileSync(file, b);
}
const SEC = 0x80 + 24 + 112 + 4 * 8;
// 가짜 도구: mode=attach 면 보안 디렉터리를 채움(진짜 서명 흉내) · mode=noop 이면 0 으로 끝나지만 안 붙임 · mode=fail 은 실패
function fakeTool(mode) {
  const dir = fs.mkdtempSync(path.join(tmp, 'tool-'));
  fs.writeFileSync(path.join(dir, 'CodeSignTool.sh'), `#!/bin/bash
f=""; for a in "$@"; do case "$a" in -input_file_path=*) f="\${a#-input_file_path=}";; esac; done
case "${mode}" in
  attach) node -e "const fs=require('fs');const b=fs.readFileSync(process.argv[1]);b.writeUInt32LE(0x300,${SEC});b.writeUInt32LE(0x100,${SEC}+4);fs.writeFileSync(process.argv[1],b)" "$f"; echo "Code signed successfully: $f";;
  noop) echo "done";;
  fail) echo "Error: invalid credentials" ; exit 1;;
esac
`);
  return dir;
}
const setEnv = (dir) => Object.assign(process.env, { PLANQ_WIN_SIGN_TOOL: dir, ESIGNER_USERNAME: 'u', ESIGNER_PASSWORD: 'p', ESIGNER_CREDENTIAL_ID: 'c', ESIGNER_TOTP_SECRET: 't' });

(async () => {
  let n = 0;
  // 값 판정
  assert.deepStrictEqual(signer.missingKeys({}), signer.KEYS); n++;
  assert.deepStrictEqual(signer.missingKeys({ PLANQ_WIN_SIGN_TOOL: 'x', ESIGNER_USERNAME: 'u', ESIGNER_PASSWORD: 'p', ESIGNER_CREDENTIAL_ID: 'c', ESIGNER_TOTP_SECRET: ' ' }), ['ESIGNER_TOTP_SECRET']); n++;
  // 서명 판정 — 무서명 PE 는 false
  const f1 = path.join(tmp, 'a.exe'); makePe(f1);
  assert.strictEqual(signer.hasAuthenticode(f1), false); n++;
  assert.strictEqual(signer.hasAuthenticode(path.join(__dirname, 'sign-win.test.js')), false); n++;   // PE 아님
  const real = path.join(__dirname, '..', 'dist', 'prod', 'PlanQ-Setup-1.1.0.exe');
  if (fs.existsSync(real)) { assert.strictEqual(signer.hasAuthenticode(real), false, '1.1.0 시험판은 무서명이어야'); n++; }
  // 진짜처럼 붙이는 도구 → 통과 + 서명 붙음
  setEnv(fakeTool('attach'));
  await signer({ path: f1, hash: 'sha256' });
  assert.strictEqual(signer.hasAuthenticode(f1), true); n++;
  // sha1 차례는 건너뜀(도구 안 부름)
  const f2 = path.join(tmp, 'b.exe'); makePe(f2);
  await signer({ path: f2, hash: 'sha1' });
  assert.strictEqual(signer.hasAuthenticode(f2), false); n++;
  // 양성 대조군: 도구가 0 으로 끝나도 서명이 안 붙으면 빌드를 멈춘다
  setEnv(fakeTool('noop'));
  await assert.rejects(signer({ path: f2, hash: 'sha256' }), /서명이 붙지 않았다/); n++;
  // 도구 실패 → 멈춤, 비밀번호는 메시지에 없음
  setEnv(fakeTool('fail'));
  await assert.rejects(signer({ path: f2, hash: 'sha256' }), (e) => /CodeSignTool 실패/.test(e.message) && !/-password=p/.test(e.message)); n++;
  // 값 빠짐 → 멈춤
  delete process.env.ESIGNER_TOTP_SECRET;
  await assert.rejects(signer({ path: f2, hash: 'sha256' }), /서명 값이 없다: ESIGNER_TOTP_SECRET/); n++;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`sign-win: ${n}/${n} 통과`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
