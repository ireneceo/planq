#!/usr/bin/env node
// iOS 빌드 직전 안전 점검 — **어느 서버를 가리키는 빌드인지** 를 사람이 눈으로 보게 한다.
//
// 왜 필요한가: capacitor.config.ts 의 기본값은 dev.planq.kr 이다(실수로 테스트 빌드가 운영을
//   건드리지 않게 한 의도적 dev-first). 그런데 **TestFlight 배포에서는 위험이 뒤집힌다** —
//   그냥 Xcode 를 열어 아카이브하면 테스터 전원이 개발 서버를 쓰게 된다.
//   생성물(ios/App/App/capacitor.config.json)은 gitignore 라 코드 리뷰로도 안 걸린다.
//   그래서 아카이브 전에 이 스크립트로 목표 서버를 확인한다.
//
// 사용:  node scripts/ios-beta-check.js            현재 목표 확인
//        node scripts/ios-beta-check.js --expect-prod   운영을 가리켜야 하는데 아니면 exit 1
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GEN = path.join(ROOT, 'dev-frontend/ios/App/App/capacitor.config.json');
const AASA = path.join(ROOT, 'dev-frontend/public/.well-known/apple-app-site-association');

const fail = [];
const warn = [];

if (!fs.existsSync(GEN)) {
  console.log('✗ 생성된 iOS config 가 없습니다 — 먼저 `npm run cap:sync:prod` 를 실행하세요.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(GEN, 'utf8'));
const url = (cfg.server && cfg.server.url) || '(없음)';
const isProd = url === 'https://planq.kr';

console.log('━'.repeat(52));
console.log('  iOS 빌드 목표 서버:', url);
console.log('  appId:', cfg.appId, '/ appName:', cfg.appName);
console.log('━'.repeat(52));

if (process.argv.includes('--expect-prod') && !isProd) {
  fail.push(`목표가 운영이 아닙니다 (${url}). TestFlight 빌드 전에 \`npm run cap:sync:prod\` 를 실행하세요.`);
}

// Universal Links — Team ID 가 치환됐는지
if (fs.existsSync(AASA)) {
  const aasa = fs.readFileSync(AASA, 'utf8');
  if (aasa.includes('__APPLE_TEAM_ID__')) {
    warn.push('AASA 의 Team ID 가 아직 치환되지 않았습니다 — Universal Links(링크로 앱 열기)가 동작하지 않습니다. `node scripts/ios-set-team-id.js <TEAM_ID>`');
  }
}

// 아이콘이 Capacitor 기본 로고인지 (파일 크기로 판별 — 기본 로고는 110522 bytes)
const ICON = path.join(ROOT, 'dev-frontend/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
if (fs.existsSync(ICON) && fs.statSync(ICON).size === 110522) {
  fail.push('앱 아이콘이 Capacitor 기본 로고입니다 — 교체하지 않으면 남의 로고로 제출하게 됩니다.');
}

// 생성물이 **소스보다 오래됐는가** — `cap sync` 를 잊고 아카이브하면 옛 설정으로 나간다.
//   실제로 2026-09-14 실측 시 iOS 생성물(8/25)은 presentationOptions 가 빈 배열이었다 —
//   그 상태로 빌드하면 8/27 에 고친 "포그라운드도 OS 배너" 가 되돌아간다.
{
  const SRC = path.join(ROOT, 'dev-frontend/capacitor.config.ts');
  if (fs.existsSync(SRC) && fs.statSync(GEN).mtimeMs < fs.statSync(SRC).mtimeMs) {
    warn.push('생성된 config 가 capacitor.config.ts 보다 오래됐습니다 — 아카이브 전에 `npm run cap:beta`(또는 cap:beta:android) 를 실행하세요.');
  }
}

// 오프라인 폴백 화면이 **이 빌드의 서버**로 돌아갈 수 있는지 (2026-09-14).
//   errorPath 로 뜨는 화면은 앱 번들 안의 로컬 파일이라, 서버 URL 이 안 박혀 있으면
//   한 번 떨어진 사용자가 영영 못 나온다(알림을 눌러도 그 화면 그대로).
{
  const { execFileSync } = require('child_process');
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/cap-offline-fallback.js'), '--check'], { stdio: 'pipe' });
    console.log('  오프라인 폴백: 서버 URL 일치');
  } catch (e) {
    fail.push('오프라인 폴백의 서버 URL 이 server.url 과 다릅니다 — `node scripts/cap-offline-fallback.js` 를 실행하세요.\n     ' + String(e.stdout || '').trim());
  }
}

for (const w of warn) console.log('⚠  ' + w);
for (const f of fail) console.log('✗  ' + f);
if (!fail.length && !warn.length) console.log('✓ 점검 통과');
process.exit(fail.length ? 1 : 0);
