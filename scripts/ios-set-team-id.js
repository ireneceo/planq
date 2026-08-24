#!/usr/bin/env node
// Apple Team ID 를 Universal Links 파일(AASA)에 박는다.
//
// 왜 스크립트인가: Team ID 는 두 곳(applinks·webcredentials)에 들어가고, 한 곳만 바꾸면
//   증상이 "가끔 안 열림" 으로 나와 원인 추적이 어렵다. 손으로 고치지 않는다.
//   ios/App/App/App.entitlements 의 associated-domains 는 도메인만 적으므로 손대지 않는다.
//
// 사용:  node scripts/ios-set-team-id.js ABCDE12345
// 적용 후: 프론트 빌드 → /배포 해야 planq.kr 에서 실제로 서빙된다.
const fs = require('fs');
const path = require('path');

const teamId = (process.argv[2] || '').trim();
if (!/^[A-Z0-9]{10}$/.test(teamId)) {
  console.error('사용법: node scripts/ios-set-team-id.js <TEAM_ID>');
  console.error('  Team ID 는 대문자·숫자 10자리입니다 (App Store Connect > Membership).');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const targets = [
  path.join(ROOT, 'dev-frontend/public/.well-known/apple-app-site-association'),
  path.join(ROOT, 'dev-frontend/public/.well-known/assetlinks.json'),   // 있으면 같이(안드로이드용, 없으면 skip)
];

let changed = 0;
for (const f of targets) {
  if (!fs.existsSync(f)) continue;
  const before = fs.readFileSync(f, 'utf8');
  if (!before.includes('__APPLE_TEAM_ID__')) { console.log(`· ${path.basename(f)} — 치환할 자리 없음(이미 적용됐거나 해당 없음)`); continue; }
  const after = before.split('__APPLE_TEAM_ID__').join(teamId);
  fs.writeFileSync(f, after);
  const n = before.split('__APPLE_TEAM_ID__').length - 1;
  console.log(`✓ ${path.basename(f)} — ${n}곳 치환`);
  changed += n;
}

if (!changed) { console.log('변경 없음.'); process.exit(0); }
console.log('');
console.log('다음 단계:');
console.log('  1) cd dev-frontend && npm run build');
console.log('  2) /배포  — planq.kr 이 실제로 이 파일을 내보내야 iOS 가 도메인을 검증한다');
console.log('  3) 확인:  curl -s https://planq.kr/.well-known/apple-app-site-association');
