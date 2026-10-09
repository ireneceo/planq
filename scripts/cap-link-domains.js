#!/usr/bin/env node
// 링크 → 앱 열기(iOS Universal Links · 안드로이드 App Links)를 **정본 한 곳**에서 쓴다 (2026-10-09).
//
// 왜: ①경로 목록이 AASA 와 AndroidManifest 두 곳에 손으로 적혀 있었다(한쪽만 고치면 갈라진다).
//     ②앱이 받는 도메인이 운영·dev 둘 다였다 — 운영 앱(planq.kr 을 보여 주는 껍데기)이 dev.planq.kr 링크를
//       받으면 경로만 꺼내 운영 서버의 같은 경로를 연다. 다른 서버의 데이터다.
//   → 경로는 scripts/native-link-paths.js, 도메인은 **그 플랫폼의 server.url 호스트 하나**(cap sync 가 만든
//     capacitor.config.json). 운영 빌드(cap:beta*)는 planq.kr 만, dev 빌드(cap:sync:dev)는 dev.planq.kr 만 받는다.
//   AASA 는 웹 파일이라 두 서버가 같은 내용(경로만)을 낸다 — 어느 앱이 받는지는 앱 쪽 도메인 목록이 정한다.
//
// 사용:  node scripts/cap-link-domains.js          세 파일을 정본대로 쓴다
//        node scripts/cap-link-domains.js --check  다르면 exit 1 (beta-check 체인·guard-native-release)
const fs = require('fs');
const path = require('path');
const P = require('./native-link-paths');

const ROOT = path.resolve(__dirname, '..');
const FE = path.join(ROOT, 'dev-frontend');
const check = process.argv.includes('--check');
let fail = 0;

const hostOf = (cfgRel) => {
  const p = path.join(FE, cfgRel);
  if (!fs.existsSync(p)) return null;
  const url = (JSON.parse(fs.readFileSync(p, 'utf8')).server || {}).url || '';
  const m = /^https:\/\/([^/]+)\/?$/.exec(url);
  return m ? m[1] : null;
};

function apply(name, file, next) {
  const cur = fs.readFileSync(file, 'utf8');
  if (cur === next) { console.log(`✓ ${name}`); return; }
  if (check) { console.log(`✗ ${name}: 정본과 다릅니다 — \`node scripts/cap-link-domains.js\``); fail++; return; }
  fs.writeFileSync(file, next);
  console.log(`✓ ${name} (갱신)`);
}

// ── AASA (웹 — 두 서버 공통) ──
{
  const file = path.join(FE, 'public/.well-known/apple-app-site-association');
  const aasa = JSON.parse(fs.readFileSync(file, 'utf8'));
  const d = aasa.applinks.details[0];
  d.components = [
    ...P.exact.map((x) => ({ '/': x, comment: 'Google 연동/로그인 복귀' })),
    ...P.prefixes.map((x) => ({ '/': `${x}*` })),
  ];
  apply('AASA 경로', file, `${JSON.stringify(aasa, null, 2)}\n`);
}

// ── iOS entitlements — 도메인 = iOS server.url 호스트 ──
{
  const host = hostOf('ios/App/App/capacitor.config.json');
  const file = path.join(FE, 'ios/App/App/App.entitlements');
  if (!host) console.log('  ios: 생성된 capacitor.config.json 이 없습니다 — 먼저 `npm run cap:sync:*` (건너뜀)');
  else {
    const cur = fs.readFileSync(file, 'utf8');
    const re = /(<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>)[\s\S]*?(\s*<\/array>)/;
    if (!re.test(cur)) { console.log('✗ ios: entitlements 에 associated-domains 가 없습니다'); fail++; }
    else apply(`iOS 앱 링크 도메인 → ${host}`, file, cur.replace(re, `$1\n\t\t<string>applinks:${host}</string>$2`));
  }
}

// ── 안드로이드 manifest — 도메인 = android server.url 호스트, 경로 = 정본 ──
{
  const host = hostOf('android/app/src/main/assets/capacitor.config.json');
  const file = path.join(FE, 'android/app/src/main/AndroidManifest.xml');
  if (!host) console.log('  android: 생성된 capacitor.config.json 이 없습니다 — 먼저 `npm run cap:sync:*` (건너뜀)');
  else {
    const cur = fs.readFileSync(file, 'utf8');
    const re = /(<!-- pq:app-links:start -->)[\s\S]*?(<!-- pq:app-links:end -->)/;
    if (!re.test(cur)) { console.log('✗ android: manifest 에 pq:app-links 표식이 없습니다'); fail++; }
    else {
      const I = '            ';
      const block = [
        `${I}<intent-filter android:autoVerify="true">`,
        `${I}    <action android:name="android.intent.action.VIEW" />`,
        `${I}    <category android:name="android.intent.category.DEFAULT" />`,
        `${I}    <category android:name="android.intent.category.BROWSABLE" />`,
        `${I}    <data android:scheme="https" android:host="${host}" />`,
        ...P.exact.map((x) => `${I}    <data android:path="${x}" />`),
        ...P.prefixes.map((x) => `${I}    <data android:pathPrefix="${x}" />`),
        `${I}</intent-filter>`,
      ].join('\n');
      apply(`안드로이드 앱 링크 → ${host}`, file, cur.replace(re, `$1\n${block}\n${I}$2`));
    }
  }
}

process.exit(fail ? 1 : 0);
