#!/usr/bin/env node
// 오프라인 폴백 화면에 **그 플랫폼이 가리키는 서버 URL** 을 박아 넣는다 (2026-09-14).
//
// 왜 필요한가: errorPath 로 뜨는 화면은 앱 번들 안의 로컬 파일이라 `location.reload()` 로는
//   영영 서버로 못 돌아간다(알림을 눌러도 그 화면 그대로 — Irene 2026-09-14 신고).
//   그래서 절대 URL 로 나가야 하는데, 그 값은 dev 빌드와 운영 빌드가 **달라야** 한다.
//   손으로 적으면 반드시 갈라지므로 각 플랫폼의 capacitor.config.json(server.url)에서 읽어
//   `cap sync` 직후에 자동으로 채운다.
//
// 사용:  node scripts/cap-offline-fallback.js          ios·android 둘 다 채움
//        node scripts/cap-offline-fallback.js --check  값이 server.url 과 다르면 exit 1 (게이트)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MARK = /var PQ_SERVER = '[^']*'; \/\* pq:server-url \*\//;
const TARGETS = [
  { name: 'ios', cfg: 'dev-frontend/ios/App/App/capacitor.config.json', page: 'dev-frontend/ios/App/App/public/index.html' },
  { name: 'android', cfg: 'dev-frontend/android/app/src/main/assets/capacitor.config.json', page: 'dev-frontend/android/app/src/main/assets/public/index.html' },
];

const check = process.argv.includes('--check');
let fail = 0;

for (const t of TARGETS) {
  const cfgPath = path.join(ROOT, t.cfg);
  const pagePath = path.join(ROOT, t.page);
  if (!fs.existsSync(cfgPath) || !fs.existsSync(pagePath)) {
    console.log(`  ${t.name}: 생성물이 없습니다 — 먼저 \`npm run cap:sync:*\` (건너뜀)`);
    continue;
  }
  const url = (JSON.parse(fs.readFileSync(cfgPath, 'utf8')).server || {}).url || '';
  if (!/^https:\/\//.test(url)) { console.log(`✗ ${t.name}: server.url 이 https 가 아닙니다 (${url})`); fail++; continue; }
  const html = fs.readFileSync(pagePath, 'utf8');
  if (!MARK.test(html)) {
    // 마커가 없으면 옛 폴백 파일이다 — 조용히 넘어가면 "고쳤는데 안 된다" 가 된다.
    console.log(`✗ ${t.name}: 오프라인 폴백에 pq:server-url 마커가 없습니다 (www-placeholder 를 다시 sync 하세요)`);
    fail++; continue;
  }
  const want = `var PQ_SERVER = '${url}'; /* pq:server-url */`;
  const cur = html.match(MARK)[0];
  if (cur === want) { console.log(`✓ ${t.name}: 오프라인 폴백 → ${url}`); continue; }
  if (check) { console.log(`✗ ${t.name}: 오프라인 폴백이 ${cur.match(/'([^']*)'/)[1]} 인데 server.url 은 ${url}`); fail++; continue; }
  fs.writeFileSync(pagePath, html.replace(MARK, want));
  console.log(`✓ ${t.name}: 오프라인 폴백 → ${url} (갱신)`);
}

process.exit(fail ? 1 : 0);
