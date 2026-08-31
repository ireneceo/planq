#!/usr/bin/env node
// assetlinks.json 에 Android 앱 서명 지문(SHA-256)을 박는다 — 링크로 앱 열기(App Links)용.
//
// 지문은 **Play App Signing 의 것**을 써야 한다. 우리가 업로드에 쓰는 키가 아니라,
//   구글이 최종 서명에 쓰는 키다. Play Console > 테스트 및 릴리스 > 설정 > 앱 서명 에서
//   "앱 서명 키 인증서" 의 SHA-256 을 복사한다. 업로드 키 지문을 넣으면 링크가 조용히 안 열린다.
//
// 사용: node scripts/android-set-cert.js AB:CD:...:EF
const fs = require('fs');
const path = require('path');

const raw = process.argv[2];
if (!raw) {
  console.log('사용: node scripts/android-set-cert.js <SHA256 지문>');
  console.log('  Play Console > 테스트 및 릴리스 > 설정 > 앱 서명 > "앱 서명 키 인증서" 의 SHA-256');
  process.exit(1);
}
// 콜론 있든 없든 받는다. 대문자 16진수 + 콜론 형식으로 정규화한다.
const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
if (hex.length !== 64) {
  console.log(`✗ SHA-256 지문이 아닙니다 — 16진수 64자여야 하는데 ${hex.length}자입니다.`);
  process.exit(1);
}
const fp = hex.match(/.{2}/g).join(':');

const FILE = path.resolve(__dirname, '..', 'dev-frontend/public/.well-known/assetlinks.json');
if (!fs.existsSync(FILE)) { console.log('✗ assetlinks.json 이 없습니다:', FILE); process.exit(1); }

const before = fs.readFileSync(FILE, 'utf8');
const json = JSON.parse(before);
let changed = 0;
for (const entry of json) {
  const t = entry.target || {};
  if (t.namespace !== 'android_app') continue;
  t.sha256_cert_fingerprints = [fp];
  changed++;
}
if (!changed) { console.log('✗ android_app 항목이 없습니다.'); process.exit(1); }

fs.writeFileSync(FILE, JSON.stringify(json, null, 2) + '\n');
console.log('✓ 지문 반영:', fp);
console.log('  파일:', path.relative(path.resolve(__dirname, '..'), FILE));
console.log('  ※ 프론트 빌드 + 배포해야 운영에 반영됩니다.');
