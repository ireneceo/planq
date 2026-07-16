#!/usr/bin/env node
// ⑥ 멀티탭 — shell(App.tsx) 의 MainLayout 래핑 인증 라우트 == pane config(routes/appRoutes.tsx) drift 가드.
// 두 벌이 어긋나 데스크탑/모바일 한쪽만 404 나는 사고를 기계로 차단(Fable 지적).
// 신규 인증 페이지 추가 시 양쪽에 넣어야 통과. 실행: node scripts/guard-app-routes.js
const fs = require('fs');
const path = require('path');
const FE = path.resolve(__dirname, '..', 'dev-frontend');

const app = fs.readFileSync(path.join(FE, 'src/App.tsx'), 'utf8');
const cfg = fs.readFileSync(path.join(FE, 'src/routes/appRoutes.tsx'), 'utf8');

// App.tsx: <Route ...> 블록별로, path 있고 element 가 <MainLayout> 포함, wildcard(*) 제외
const appPaths = [];
for (const b of app.split(/<Route\s/).slice(1)) {
  const pm = b.match(/^path="([^"]+)"/);
  if (!pm) continue;
  const p = pm[1];
  if (p.endsWith('*')) continue;              // wildcard 는 config 밖(App 전용)
  if (/<MainLayout>/.test(b)) appPaths.push(p);
}

// appRoutes.tsx: { path: '...' }
const cfgPaths = [...cfg.matchAll(/\{\s*path:\s*'([^']+)'/g)].map((m) => m[1]);

const A = new Set(appPaths), C = new Set(cfgPaths);
const missingInCfg = [...A].filter((p) => !C.has(p));  // App 엔 있는데 config 누락 → pane 에서 404
const extraInCfg = [...C].filter((p) => !A.has(p));    // config 엔 있는데 App 누락 → shell 에서 404

if (missingInCfg.length || extraInCfg.length) {
  console.error('✗ ROUTE DRIFT — shell(App.tsx) 과 pane(appRoutes.tsx) 라우트 불일치:');
  if (missingInCfg.length) console.error('  config 누락(App 에만):', missingInCfg.join(', '));
  if (extraInCfg.length) console.error('  App 누락(config 에만):', extraInCfg.join(', '));
  process.exit(1);
}
console.log(`✓ app/pane 인증 라우트 일치 (${A.size}개)`);
