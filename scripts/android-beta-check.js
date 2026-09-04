#!/usr/bin/env node
// Android 빌드 직전 안전 점검 — iOS(ios-beta-check.js)와 같은 역할.
//
// 왜 필요한가: capacitor.config.ts 기본값이 dev.planq.kr 이라(의도적 dev-first),
//   그냥 빌드하면 **Play 테스터 전원이 개발 서버를 쓴다**. 생성물
//   (android/app/src/main/assets/capacitor.config.json)은 gitignore 라 코드 리뷰로도 안 걸린다.
//
// 사용:  node scripts/android-beta-check.js                 현재 목표 확인
//        node scripts/android-beta-check.js --expect-prod   운영이 아니면 exit 1
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GEN = path.join(ROOT, 'dev-frontend/android/app/src/main/assets/capacitor.config.json');
const ASSETLINKS = path.join(ROOT, 'dev-frontend/public/.well-known/assetlinks.json');
const GRADLE = path.join(ROOT, 'dev-frontend/android/app/build.gradle');

const fail = [];
const warn = [];

if (!fs.existsSync(GEN)) {
  console.log('✗ 생성된 Android config 가 없습니다 — 먼저 `npm run cap:sync:prod` 를 실행하세요.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(GEN, 'utf8'));
const url = (cfg.server && cfg.server.url) || '(없음)';
const isProd = url === 'https://planq.kr';

console.log('━'.repeat(52));
console.log('  Android 빌드 목표 서버:', url);
console.log('  appId:', cfg.appId, '/ appName:', cfg.appName);
console.log('━'.repeat(52));

if (process.argv.includes('--expect-prod') && !isProd) {
  fail.push(`목표가 운영이 아닙니다 (${url}). Play 빌드 전에 \`npm run cap:sync:prod\` 를 실행하세요.`);
}

// 앱 링크 — 서명 지문이 치환됐는지. 미치환이면 링크로 앱 열기가 조용히 죽는다.
if (fs.existsSync(ASSETLINKS)) {
  const a = fs.readFileSync(ASSETLINKS, 'utf8');
  if (a.includes('__ANDROID_SHA256_CERT__')) {
    warn.push('assetlinks.json 의 서명 지문이 아직 치환되지 않았습니다 — 링크로 앱 열기(App Links)가 동작하지 않습니다. `node scripts/android-set-cert.js <SHA256>`');
  }
}

// FCM — 없으면 안드로이드 푸시가 **전혀** 가지 않는다.
//   Gradle 은 파일이 없으면 `logger.info` 한 줄 남기고 플러그인을 건너뛴다 —
//   빌드는 초록불로 성공하고 알림만 죽는 조용한 실패다. Play 빌드(--expect-prod)에서는 막는다.
//   Codemagic 은 git 저장소를 받아 빌드하므로 이 파일은 **커밋되어 있어야 한다**
//   (비밀이 아니다 — APK 에 그대로 실려 나가고 설치본에서 추출된다).
const GS = path.join(ROOT, 'dev-frontend/android/app/google-services.json');
const gsMissing = !fs.existsSync(GS);
let gsProblem = gsMissing ? 'google-services.json 이 없습니다' : null;
if (!gsMissing) {
  try {
    const gs = JSON.parse(fs.readFileSync(GS, 'utf8'));
    const pkgs = (gs.client || []).map((c) => c.client_info.android_client_info.package_name);
    if (!pkgs.includes(cfg.appId)) {
      gsProblem = `google-services.json 의 패키지(${pkgs.join(', ') || '없음'})가 appId(${cfg.appId})와 다릅니다`;
    } else {
      console.log('  FCM project:', (gs.project_info || {}).project_id, '/ package:', pkgs.join(', '));
    }
  } catch (e) {
    gsProblem = `google-services.json 을 읽을 수 없습니다 (${e.message})`;
  }
}
if (gsProblem) {
  const msg = gsProblem + ' — 안드로이드 OS 푸시 알림이 전혀 도착하지 않습니다.';
  if (process.argv.includes('--expect-prod')) fail.push(msg);
  else warn.push(msg);
}

// 버전 — Play 는 같은 versionCode 재업로드를 거부한다. 사람이 눈으로 보게 찍어준다.
if (fs.existsSync(GRADLE)) {
  const g = fs.readFileSync(GRADLE, 'utf8');
  const code = (g.match(/versionCode\s+(\d+)/) || [])[1];
  const name = (g.match(/versionName\s+"([^"]+)"/) || [])[1];
  console.log(`  versionCode: ${code} / versionName: ${name}`);
}

for (const w of warn) console.log('⚠  ' + w);
for (const f of fail) console.log('✗  ' + f);
if (!fail.length && !warn.length) console.log('✓ 점검 통과');
process.exit(fail.length ? 1 : 0);
