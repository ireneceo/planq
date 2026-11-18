#!/usr/bin/env node
// PlanQ 데스크탑 앱 패키지 만들기 — node scripts/build.js <win|win-store|mac> [--origin https://planq.kr]
//   win-store = Microsoft Store 제출용 MSIX(.appx) — 윈도우 기계에서만 만들어진다(codemagic desktop-win-store).
//     Store 정체(파트너 센터 «제품 ID» 화면 값)는 환경변수 셋: PLANQ_STORE_IDENTITY_NAME · PLANQ_STORE_PUBLISHER(CN=…) ·
//     PLANQ_STORE_PUBLISHER_NAME. 서명은 Store 가 한다(우리는 무서명으로 올린다). 자동 업데이트 목록은 만들지 않는다.
//
// 하는 일 (docs/DESKTOP_APP_DESIGN.md §3-1·§3-8·§8-G):
//   1) .stage/ 에 실을 것만 옮긴다 — src/(preload 의 «@test-only» 구역은 잘라냄) · build/ 아이콘 · package.json(실행 의존성만)
//      test/ 폴더와 시험 훅은 **들어가지 않는다**.
//   2) src/origin.json 에 출처 한 값을 박는다(운영 https://planq.kr 기본 · 개발 빌드는 --origin https://dev.planq.kr).
//      앱은 실행 중 출처를 바꿀 수 없다 — 탐색 잠금의 기준이다.
//   3) electron-builder — 윈도우 NSIS(x64, 이 리눅스 서버에서 wine 으로) / 맥 dmg+zip(맥 장비 = codemagic desktop_mac).
//      자동 업데이트 목록(latest.yml · latest-mac.yml)은 <origin>/desktop/ 기준으로 같이 만든다.
//   4) 만든 뒤 scripts/check.js 로 «패키지에 시험 표면 0» 을 확인한다(실패하면 exit 1).
//
// 서명: 윈도우 코드서명·맥 Developer ID 는 Irene 할 일(인증서). 없으면 무서명으로 만든다(윈도우 SmartScreen 경고 ·
//   맥 Gatekeeper 경고 + 맥 자동 업데이트 불가). 서명 정보는 electron-builder 표준 환경변수(CSC_LINK 등)로만 받는다.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STAGE = path.join(ROOT, '.stage');
const target = process.argv[2];
if (!['win', 'win-store', 'mac'].includes(target)) { console.error('usage: node scripts/build.js <win|win-store|mac> [--origin URL]'); process.exit(2); }
const STORE = target === 'win-store';
const storeId = {
  identityName: process.env.PLANQ_STORE_IDENTITY_NAME,
  publisher: process.env.PLANQ_STORE_PUBLISHER,
  publisherDisplayName: process.env.PLANQ_STORE_PUBLISHER_NAME,
};
if (STORE && (!storeId.identityName || !/^CN=/.test(storeId.publisher || '') || !storeId.publisherDisplayName)) {
  console.error('[desktop-build] win-store 는 파트너 센터 값 셋이 필요하다: PLANQ_STORE_IDENTITY_NAME · PLANQ_STORE_PUBLISHER(CN=…) · PLANQ_STORE_PUBLISHER_NAME');
  process.exit(2);
}
const oi = process.argv.indexOf('--origin');
const origin = new URL(oi > 0 ? process.argv[oi + 1] : (process.env.PLANQ_DESKTOP_ORIGIN || 'https://planq.kr')).origin;
if (!/^https:\/\/(dev\.)?planq\.kr$/.test(origin)) { console.error(`[desktop-build] 출처는 planq.kr / dev.planq.kr 만: ${origin}`); process.exit(2); }

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const electronVersion = String(pkg.devDependencies.electron).replace(/^[^\d]*/, '');

// ── 1) .stage ──
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'src'), { recursive: true });
fs.mkdirSync(path.join(STAGE, 'build'), { recursive: true });
const stripTestOnly = (code) => code.replace(/\/\/ @test-only-start[\s\S]*?\/\/ @test-only-end\n?/g, '');
for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
  if (f === 'origin.json') continue;
  let code = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
  if (f.endsWith('.js')) code = stripTestOnly(code);
  fs.writeFileSync(path.join(STAGE, 'src', f), code);
}
fs.copyFileSync(path.join(ROOT, 'build', 'icon.png'), path.join(STAGE, 'build', 'icon.png'));
fs.copyFileSync(path.join(ROOT, 'build', 'entitlements.mac.plist'), path.join(STAGE, 'build', 'entitlements.mac.plist'));   // 맥 서명 권한(마이크)
if (STORE) {
  // Store 타일 그림(build/appx — scripts/make-appx-assets.js) · 자동 실행 StartupTask
  fs.cpSync(path.join(ROOT, 'build', 'appx'), path.join(STAGE, 'build', 'appx'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'build', 'appx-extensions.xml'), path.join(STAGE, 'build', 'appx-extensions.xml'));
}
fs.writeFileSync(path.join(STAGE, 'src', 'origin.json'), JSON.stringify({ origin }) + '\n');
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
  name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description,
  main: pkg.main, author: pkg.author, homepage: pkg.homepage, private: true,
  dependencies: pkg.dependencies,
}, null, 2) + '\n');
console.log(`[desktop-build] stage 준비 — 출처 ${origin} · electron ${electronVersion} · v${pkg.version}`);
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: STAGE, stdio: 'inherit' });

// ── 2) electron-builder 설정 ──
const config = {
  appId: 'kr.planq.desktop',
  productName: 'PlanQ',
  electronVersion,
  directories: { output: path.join(ROOT, 'dist', `${origin.includes('dev.') ? 'dev' : 'prod'}${STORE ? '-store' : ''}`), buildResources: 'build' },
  files: ['src/**', 'package.json', 'node_modules/**'],
  icon: 'build/icon.png',
  protocols: [{ name: 'PlanQ', schemes: ['planq'] }],
  publish: [{ provider: 'generic', url: `${origin}/desktop/` }],
  artifactName: 'PlanQ-${version}-${os}-${arch}.${ext}',
  win: { target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'PlanQ-Setup-${version}.${ext}' },
  nsis: { oneClick: true, perMachine: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'PlanQ' },
  mac: {
    target: [{ target: 'dmg', arch: ['universal'] }, { target: 'zip', arch: ['universal'] }],   // zip 은 자동 업데이트용
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    // 서명·공증 때만 의미가 있다 — 마이크 권한(audio-input)이 없으면 서명한 앱에서 Q note 녹음이 막힌다.
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: { NSMicrophoneUsageDescription: 'PlanQ uses the microphone for Q Note meeting notes.' },
  },
};
if (STORE) {
  config.win = { target: [{ target: 'appx', arch: ['x64'] }], artifactName: 'PlanQ-Store-${version}.${ext}' };
  config.appx = {
    ...storeId,
    applicationId: 'PlanQ',
    displayName: 'PlanQ',
    backgroundColor: 'transparent',
    languages: ['ko-KR', 'en-US'],
    addAutoLaunchExtension: false,
    customExtensionsPath: 'build/appx-extensions.xml',
    // runFullTrust 는 electron-builder 가 늘 넣는다. 마이크(Q note) — MSIX 는 선언이 없으면 윈도우가 막는다
    capabilities: ['internetClient', 'microphone'],
  };
  delete config.publish;   // Store 가 업데이트를 배달한다 — latest.yml 을 만들지 않는다(main.js 도 STORE 면 electron-updater 끔)
}
fs.writeFileSync(path.join(STAGE, 'electron-builder.json'), JSON.stringify(config, null, 2));

// ── 3) 만들기 ──
const bin = path.join(ROOT, 'node_modules', '.bin', 'electron-builder');
const env = { ...process.env };
if (!env.CSC_LINK) env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';   // 인증서가 없으면 무서명(설계 §6 Irene 할 일 ①③)
execFileSync(bin, [`--${STORE ? 'win' : target}`, '--projectDir', STAGE, '--config', 'electron-builder.json', '--publish', 'never'], { cwd: ROOT, stdio: 'inherit', env });

// ── 4) 시험 표면 0 확인 ──
execFileSync(process.execPath, [path.join(__dirname, 'check.js'), STORE ? 'win-store' : target, config.directories.output], { stdio: 'inherit' });
console.log(`[desktop-build] 완료 → ${config.directories.output}`);
