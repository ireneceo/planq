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

// 백업 — 앱은 **원격 껍데기**라 로그인 세션이 WebView 저장소에 남는다.
//   `allowBackup="true"`(Capacitor 기본값) 이면 그 세션이 사용자 Drive 로 백업되고
//   **다른 기기로 복원**된다. 업무용 앱에서 세션이 기기를 옮겨 다니는 것은 의도가 아니다.
//
// ★ 판정은 `scripts/android-manifest-assert.js` 한 곳이다 — **문자열이 아니라 트리로** 본다.
//   이 검사를 문자열로 두 번 썼고 두 번 다 뚫렸다(Fable 25·26차): 속성 삭제·홑따옴표·빈 규칙파일 ·
//   주석 안의 가짜 false · exclude 주석 처리 · `<exclude path=…>` 부분 제외 · `<activity>` 에 달기 ·
//   **`src/release/` 소스셋의 tools:replace**. 파서는 주석을 노드로 분리하고 «어느 요소의 속성인가» 를 안다.
//
// ★ 그리고 **소스는 제품이 아니다.** 여기서 통과해도 병합에서 뒤집힐 수 있으므로,
//   빌드 뒤 `scripts/android-packaged-backup-check.js` 가 **링크된 리소스 두 벌**(APK·AAB 경로)에 같은 술어를 건다.
//   이쪽은 빠른 사전 검사이고, **제품 판정은 빌드 뒤 `android-packaged-backup-check.js`** 가 한다
//   (aapt2 로 링크된 리소스 테이블을 읽는다).
const MA = require('./android-manifest-assert');
const SRC = path.join(ROOT, 'dev-frontend/android/app/src');
const backupErrs = [
  ...MA.assertManifest(path.join(SRC, 'main/AndroidManifest.xml'),
    { resolveRules: path.join(SRC, 'main/res'), label: 'AndroidManifest' }),
  ...MA.assertNoSourceSetOverride(SRC),
  // ★ 규칙 파일이 `res/xml-v31/` 나 `src/release/res/xml/` 로 덮이면 매니페스트는 멀쩡한 채
  //   제품에서만 다른 규칙이 쓰인다(Fable 27차). 이름은 매니페스트가 가리키는 것을 따른다.
  ...MA.assertSingleRulesLocation(SRC, MA.rulesNameOf(path.join(SRC, 'main/AndroidManifest.xml'))),
];
backupErrs.forEach((e) => fail.push(e));
if (!backupErrs.length) console.log('  백업: allowBackup=false · 규칙 두 섹션 전 도메인 · 소스셋 덮어쓰기 없음 ✓');

// targetSdk — Play 는 매년 최소 target API 를 올리고, 미달이면 **업로드 자체를 거부**한다.
//   2026-09-04 실사례: targetSdk 35 로 올렸다가 "must target at least API level 36" 로 거부.
//   빌드는 성공한 뒤 업로드에서 막히므로, 빌드 시점에 먼저 세운다.
//   ★ Play 요구치가 오르면 이 상수를 같이 올린다.
const PLAY_MIN_TARGET_SDK = 36;
const VARS = path.join(ROOT, 'dev-frontend/android/variables.gradle');
if (fs.existsSync(VARS)) {
  const v = fs.readFileSync(VARS, 'utf8');
  const target = Number((v.match(/targetSdkVersion\s*=\s*(\d+)/) || [])[1]);
  const compile = Number((v.match(/compileSdkVersion\s*=\s*(\d+)/) || [])[1]);
  console.log(`  targetSdk: ${target} / compileSdk: ${compile}`);
  if (!(target >= PLAY_MIN_TARGET_SDK)) {
    fail.push(`targetSdk 가 ${target} 입니다 — Play 는 최소 ${PLAY_MIN_TARGET_SDK} 를 요구하며 업로드를 거부합니다.`);
  }
  if (compile < target) {
    fail.push(`compileSdk(${compile}) 가 targetSdk(${target}) 보다 낮습니다 — Gradle 이 빌드를 거부합니다.`);
  }
}

// 버전 — Play 는 같은 versionCode 재업로드를 거부한다. 사람이 눈으로 보게 찍어준다.
if (fs.existsSync(GRADLE)) {
  const g = fs.readFileSync(GRADLE, 'utf8');
  const code = (g.match(/versionCode\s+(\d+)/) || [])[1];
  const name = (g.match(/versionName\s+"([^"]+)"/) || [])[1];
  console.log(`  versionCode: ${code} / versionName: ${name}`);
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
