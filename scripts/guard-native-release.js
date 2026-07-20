#!/usr/bin/env node
/**
 * guard-native-release — 네이티브 앱 출시 전 정적 불변식 가드.
 *
 * 목적: "코드로 미리 해둔 것"이 나중에 조용히 되돌아가거나, placeholder 가 그대로
 *       운영에 나가는 사고를 막는다. health-check / guard-invariants 와 같은 계열.
 *
 *   node scripts/guard-native-release.js            # 상시 항목만 (배포 가드)
 *   node scripts/guard-native-release.js --release  # 스토어 제출 전 전체 (placeholder 치환까지)
 *
 * --release 는 Apple Team ID / Android 서명 지문을 받은 뒤에 통과한다.
 * 그 전까지 상시 모드로 돌려 회귀만 막는다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FE = path.join(ROOT, 'dev-frontend');
const RELEASE = process.argv.includes('--release');

let pass = 0;
const fails = [];
const warns = [];

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const ok = (name) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); };
const fail = (name, hint) => { fails.push({ name, hint }); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      → ${hint}`); };
const warn = (name, hint) => { warns.push({ name, hint }); console.log(`  \x1b[33m⚠\x1b[0m ${name}\n      → ${hint}`); };
const section = (t) => console.log(`\n\x1b[36m\x1b[1m▶ ${t}\x1b[0m`);

// ── 1. iOS 푸시 배선 (없으면 푸시 전면 무동작) ─────────────────────────
section('IOS_PUSH');

const ent = read(path.join(FE, 'ios/App/App/App.entitlements'));
if (!ent) fail('App.entitlements 존재', 'ios/App/App/App.entitlements 가 없다 — Push capability 미구성 → didFailToRegister');
else if (!/aps-environment/.test(ent)) fail('aps-environment 키', 'entitlements 에 aps-environment 가 없다');
else ok('App.entitlements + aps-environment');

const pbx = read(path.join(FE, 'ios/App/App.xcodeproj/project.pbxproj'));
if (!pbx) fail('project.pbxproj 존재', 'Xcode 프로젝트 파일을 못 읽었다');
else {
  const n = (pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g) || []).length;
  if (n >= 2) ok(`pbxproj CODE_SIGN_ENTITLEMENTS 연결 (${n} configs)`);
  else fail('pbxproj CODE_SIGN_ENTITLEMENTS', `Debug/Release 양쪽에 필요한데 ${n}곳만 연결됨`);
}

const appd = read(path.join(FE, 'ios/App/App/AppDelegate.swift'));
if (appd && /didRegisterForRemoteNotificationsWithDeviceToken/.test(appd)
         && /didFailToRegisterForRemoteNotificationsWithError/.test(appd)) {
  ok('AppDelegate APNs 콜백 (H-1 회귀 가드)');
} else {
  fail('AppDelegate APNs 콜백', 'didRegister/didFailToRegister 가 없으면 iOS 푸시가 전면 무동작한다');
}

// ── 2. 딥링크 복귀 경로 ────────────────────────────────────────────────
section('DEEPLINK');

const plist = read(path.join(FE, 'ios/App/App/Info.plist'));
if (plist && /<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>planq<\/string>/.test(plist)) {
  ok('iOS custom scheme planq:// (UL fallback)');
} else {
  fail('iOS custom scheme', 'Info.plist CFBundleURLTypes 에 planq 스킴이 없다 — OAuth 복귀가 SFSafariViewController 에서 멈출 수 있다');
}

const manifest = read(path.join(FE, 'android/app/src/main/AndroidManifest.xml'));
if (manifest && /android:scheme="planq"/.test(manifest)) ok('Android custom scheme planq://');
else fail('Android custom scheme', 'AndroidManifest 에 planq 스킴 intent-filter 가 없다');

// ── 3. App Store 심사 (Guideline) ──────────────────────────────────────
section('APPSTORE_GUIDELINE');

const purchase = read(path.join(FE, 'src/utils/purchase.ts'));
if (purchase && /canPurchaseInApp/.test(purchase) && /isNativeApp/.test(purchase)) {
  ok('canPurchaseInApp 헬퍼 (3.1.1)');
} else {
  fail('canPurchaseInApp 헬퍼', 'src/utils/purchase.ts 가 없거나 isNativeApp 을 안 본다');
}

// 구매 표면을 여는 지점들이 게이트를 통과하는지
const GATED = [
  ['src/pages/Settings/PlanSettings.tsx', 3, '플랜 CTA + CheckoutModal + AddonSection'],
  ['src/components/Common/UsageWarningCard.tsx', 1, '사용량 초과 업그레이드 CTA'],
  ['src/components/Common/LimitReachedDialog.tsx', 1, '한도 도달 플랜 CTA'],
  ['src/components/Common/TrialStatusBanner.tsx', 1, '체험 배너 CTA'],
  ['src/components/Layout/WorkspaceBillingBanner.tsx', 1, '미결제 배너 결제 진입'],
];
for (const [rel, min, label] of GATED) {
  const src = read(path.join(FE, rel));
  if (!src) { fail(`${label} 파일 존재`, `${rel} 를 못 읽었다`); continue; }
  const n = (src.match(/canPurchaseInApp\(\)/g) || []).length;
  if (n >= min) ok(`${label} 게이트 (${n})`);
  else fail(`${label} 게이트`, `${rel} 에 canPurchaseInApp() 호출이 ${n}개 — 최소 ${min} 필요 (외부결제 유도 = 3.1.1 리젝)`);
}

// Q Bill 고객 청구서 결제는 3.1.3(e) 허용 — 막으면 안 된다 (과잉 차단 회귀 가드)
//   파일을 못 찾으면 통과시키면 안 된다. 경로가 바뀐 채 vacuous pass 하면 가드가 죽는다.
const INVOICE_PAGE = 'src/pages/QBill/PublicInvoicePage.tsx';
const invoicePage = read(path.join(FE, INVOICE_PAGE));
if (!invoicePage) {
  fail('Q Bill 청구서 페이지 존재', `${INVOICE_PAGE} 를 못 읽었다 — 경로가 바뀌었으면 이 가드를 갱신할 것(거짓 통과 방지)`);
} else if (/canPurchaseInApp/.test(invoicePage)) {
  fail('Q Bill 청구서 결제 과잉 차단', '고객 청구서 결제는 실물 용역이라 3.1.3(e) 허용 범위 — 여기에 게이트를 걸면 제품 기능이 죽는다');
} else {
  ok('Q Bill 청구서 결제 미차단 (3.1.3(e))');
}

// 계정 삭제 (5.1.1(v)) — 스토어 제출 전 필수
const hasDeleteAccount = (() => {
  const { execSync } = require('child_process');
  try {
    const out = execSync(
      `grep -rl "delete-account\\|deleteAccount\\|계정 삭제\\|회원 탈퇴" ${path.join(FE, 'src')} 2>/dev/null || true`,
      { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch { return false; }
})();
if (hasDeleteAccount) ok('앱 내 계정 삭제 (5.1.1(v))');
else if (RELEASE) fail('앱 내 계정 삭제', '계정 생성이 가능한 앱은 앱 내 계정 삭제가 필수 (Guideline 5.1.1(v)) — 스토어 제출 전 구현 필요');
else warn('앱 내 계정 삭제 미구현', 'TestFlight 는 무관하나 스토어 제출 전 필수 (5.1.1(v))');

// 4.8 — Google 로그인을 켜면 Sign in with Apple 이 필수가 된다
const LOGIN_PAGE = 'src/pages/Login/LoginPage.tsx';
const loginPage = read(path.join(FE, LOGIN_PAGE));
if (!loginPage) {
  fail('로그인 페이지 존재', `${LOGIN_PAGE} 를 못 읽었다 — 경로가 바뀌었으면 이 가드를 갱신할 것(거짓 통과 방지)`);
}
const googleLoginOn = loginPage && /GOOGLE_LOGIN_ENABLED\s*[=:]\s*true/.test(loginPage);
const appleLogin = loginPage && /(SignInWithApple|apple.*sign|siwa)/i.test(loginPage);
if (!loginPage) {
  /* 위에서 이미 fail 처리 */
} else if (googleLoginOn && !appleLogin) {
  fail('Sign in with Apple (4.8)', 'Google 로그인이 켜져 있는데 Apple 로그인이 없다 — 확정 리젝. 둘을 같이 계획해야 한다');
} else {
  ok(googleLoginOn ? 'Sign in with Apple 동반 제공' : 'Google 로그인 비노출 → 4.8 비적용');
}

// ── 4. Universal Links / App Links 서빙 자산 ───────────────────────────
section('WELLKNOWN');

const aasaPath = path.join(FE, 'public/.well-known/apple-app-site-association');
const alPath = path.join(FE, 'public/.well-known/assetlinks.json');
const aasa = read(aasaPath);
const al = read(alPath);

if (!aasa) fail('AASA 파일 존재', `${aasaPath} 없음`);
else {
  try { JSON.parse(aasa); ok('AASA JSON 유효'); }
  catch { fail('AASA JSON 유효', 'JSON 파싱 실패 — iOS 가 도메인 검증에 실패한다'); }
  if (/__APPLE_TEAM_ID__/.test(aasa)) {
    if (RELEASE) fail('AASA Team ID 치환', 'Apple Team ID placeholder 가 남아 있다 — Universal Links 가 발화하지 않는다');
    else warn('AASA Team ID 미치환', 'Apple Developer 등록 후 __APPLE_TEAM_ID__ 를 실제 Team ID 로 치환할 것');
  } else ok('AASA Team ID 치환됨');
}

if (!al) fail('assetlinks 파일 존재', `${alPath} 없음`);
else {
  try { JSON.parse(al); ok('assetlinks JSON 유효'); }
  catch { fail('assetlinks JSON 유효', 'JSON 파싱 실패'); }
  if (/__ANDROID_SHA256_CERT__/.test(al)) {
    if (RELEASE) fail('assetlinks 지문 치환', 'Android 서명 SHA-256 지문 placeholder 가 남아 있다 — App Links autoVerify 실패');
    else warn('assetlinks 지문 미치환', 'Play Console 앱 서명 키 SHA-256 을 받은 뒤 치환할 것');
  } else ok('assetlinks 지문 치환됨');
}

// ── 5. 웹 회귀 0 (네이티브 분기가 웹을 건드리면 안 된다) ────────────────
section('WEB_REGRESSION');
{
  const { execSync } = require('child_process');
  try {
    const out = execSync(
      `grep -rn "from '@capacitor/" ${path.join(FE, 'src')} --include=*.ts --include=*.tsx | grep -v "await import" || true`,
      { encoding: 'utf8' }).trim();
    const lines = out ? out.split('\n') : [];
    // native.ts 의 @capacitor/core static import 1건은 설계상 허용
    const unexpected = lines.filter(l => !/src\/services\/native\.ts/.test(l));
    if (unexpected.length === 0) ok(`@capacitor static import 격리 (허용 1건 외 ${unexpected.length})`);
    else fail('@capacitor static import 격리',
      `native.ts 밖에서 static import ${unexpected.length}건 — 웹 번들이 커지고 초기화 경로가 오염된다:\n         ${unexpected.slice(0, 3).join('\n         ')}`);
  } catch (e) { warn('static import 검사 실패', String(e.message).slice(0, 80)); }
}

// ── 결과 ───────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
if (warns.length) console.log(`\x1b[33m⚠ 경고 ${warns.length}건 (릴리스 전 해소 필요)\x1b[0m`);
if (fails.length === 0) {
  console.log(`\x1b[32m\x1b[1m✓ 네이티브 릴리스 가드 통과 (${pass}/${pass})\x1b[0m${RELEASE ? ' [release mode]' : ''}`);
  process.exit(0);
}
console.log(`\x1b[31m\x1b[1m✗ 실패 ${fails.length}건 / 통과 ${pass}\x1b[0m`);
process.exit(1);
