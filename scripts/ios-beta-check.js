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

// 공유 확장(ShareExtension) — 본 앱과 버전·App Group 이 같은가 (#434 ② iOS, docs/NATIVE_SHARE_RECEIVE.md 결정 8).
//   버전이 다르면 App Store Connect 가 업로드를 거부한다(빌드 40분 뒤에야 안다).
//   App Group 이 빠지거나 다르면 확장이 넘긴 파일을 본 앱이 못 읽는다 — 공유가 조용히 사라진다.
//   cap-link-domains.js 가 App.entitlements 를 다시 쓰므로 그 회귀를 여기서 잡는다.
for (const f of checkShareExtension()) fail.push(f);

function checkShareExtension() {
  const out = [];
  const IOS = path.join(ROOT, 'dev-frontend/ios/App');
  const pbx = fs.readFileSync(path.join(IOS, 'App.xcodeproj/project.pbxproj'), 'utf8');
  // 번들 ID 별 설정값 (Debug·Release 모두)
  const byBundle = {};
  for (const m of pbx.matchAll(/isa = XCBuildConfiguration;[\s\S]*?buildSettings = \{([\s\S]*?)\n\t\t\t\};/g)) {
    const body = m[1];
    const get = (k) => { const r = new RegExp(`\\n\\s*${k} = "?([^";\\n]+)"?;`).exec(body); return r ? r[1] : null; };
    const id = get('PRODUCT_BUNDLE_IDENTIFIER');
    if (!id) continue;
    (byBundle[id] = byBundle[id] || []).push({ build: get('CURRENT_PROJECT_VERSION'), ver: get('MARKETING_VERSION') });
  }
  const app = byBundle['app.planq'];
  const ext = byBundle['app.planq.ShareExtension'];
  if (!app) { out.push('project.pbxproj 에 app.planq 설정이 없습니다'); return out; }
  if (!ext) { console.log('  공유 확장: 타깃 없음 (건너뜀)'); return out; }
  const vals = (k) => new Set([...app, ...ext].map((c) => c[k]));
  for (const [k, label] of [['build', 'CURRENT_PROJECT_VERSION'], ['ver', 'MARKETING_VERSION']]) {
    const s = vals(k);
    if (s.size !== 1 || s.has(null)) out.push(`공유 확장과 본 앱의 ${label} 가 다릅니다 (${[...s].join(' / ')}) — 같은 값으로 맞추세요(다르면 업로드 거부).`);
  }
  // Info.plist — agvtool 이 숫자를 직접 써 넣었을 수도 있으니 두 파일 값도 맞춰 본다
  const plistVal = (rel, key) => {
    const t = fs.readFileSync(path.join(IOS, rel), 'utf8');
    const r = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(t);
    return r ? r[1] : null;
  };
  for (const key of ['CFBundleVersion', 'CFBundleShortVersionString']) {
    const a = plistVal('App/Info.plist', key);
    const e = plistVal('ShareExtension/Info.plist', key);
    if (a !== e) out.push(`Info.plist ${key} 가 다릅니다 — 본 앱 ${a} / 공유 확장 ${e}`);
  }
  const groups = (rel) => {
    const t = fs.readFileSync(path.join(IOS, rel), 'utf8');
    const r = /<key>com\.apple\.security\.application-groups<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(t);
    return r ? [...r[1].matchAll(/<string>([^<]+)<\/string>/g)].map((x) => x[1]).sort().join(',') : '';
  };
  const ga = groups('App/App.entitlements');
  const ge = groups('ShareExtension/ShareExtension.entitlements');
  if (!ga || ga !== ge) out.push(`App Group 이 다르거나 없습니다 — 본 앱 [${ga}] / 공유 확장 [${ge}] (둘 다 group.app.planq)`);
  if (!out.length) console.log(`  공유 확장: 버전·App Group 일치 (${[...vals('ver')][0]} (${[...vals('build')][0]}) · ${ga})`);
  return out;
}

for (const w of warn) console.log('⚠  ' + w);
for (const f of fail) console.log('✗  ' + f);
if (!fail.length && !warn.length) console.log('✓ 점검 통과');
process.exit(fail.length ? 1 : 0);
