#!/usr/bin/env node
// deploy-gate-preview.js — 운영 배포의 «코드 게이트» 를 배포 버튼 **전에** 똑같이 돌려 본다 (2026-11-18)
//
//   왜: 상황판 배포 기록(~/dev-server/board/log/deploy/planq-*.log) 기준 PlanQ 배포 실패 5번 중 4번이
//     deploy-planq.sh «코드 게이트 — health-check» 에서 멈췄다 — 10-30 [clientlink] contact_user_id 빈 행 ·
//     11-05 [security] 429 · 11-16 [retention] retain_until 없는 감사 행 76건 · 11-18 ×2 [external] 별칭 미등록 도착 주소.
//     넷 다 바뀐 코드가 아니라 **개발서버 데이터·상태** 검사라 배포 버튼을 눌러야 처음 드러났고, 고칠 때까지 배포가 막혔다.
//   무엇: 배포 게이트와 **같은 명령**(health-check 전체 · 불변식 가드)을 돌려 실패를 미리 꺼낸다.
//     검사를 줄이거나 건너뛰지 않는다 — 배포가 돌릴 것을 그대로 돌린다.
//     배포 스크립트의 health-check 줄이 바뀌면(인자 추가 등) 미리보기가 다른 것을 재게 되므로 먼저 그 줄을 대조하고,
//     갈라졌으면 그 자체를 실패로 낸다(미리보기가 조용히 거짓 초록이 되지 않게).
//   어디서: 밤 전체 검사(scripts/e2e/full-sweep.sh 맨 앞 «deploygate») · /개발완료 0단계·마지막 단계 · /개발시작 1-C 가 읽는다.
//   결과: logs/deploy-gate-preview/latest.json · <날짜시각>.log · 표준출력은 run.js 와 같은 꼴(❌ 줄 + «총 실패: N»)이라
//     sweep-summary.js 가 그대로 읽는다. 종료코드 0 = 배포 게이트 통과 예상 · 1 = 배포하면 멈춘다 · 2 = 미리보기 자체 고장.
//
//   사용: node scripts/deploy-gate-preview.js            # 전체
//         node scripts/deploy-gate-preview.js --no-guard # health-check 만(가드는 /개발완료 0단계가 따로 돌릴 때)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = '/opt/planq';
const OUT = path.join(REPO, 'logs/deploy-gate-preview');
const noGuard = process.argv.includes('--no-guard');
const strip = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.mkdirSync(OUT, { recursive: true });

// 0) 배포 스크립트의 게이트 줄과 대조 — 같은 것을 재는지
const DEPLOY = path.join(REPO, 'scripts/deploy-planq.sh');
const EXPECT_HC = 'node "$REPO/scripts/health-check.js" > /tmp/deploy-gate-health.log';
const EXPECT_GUARD = 'node "$SNAP/scripts/guard-invariants.js" > /tmp/deploy-gate-guard.log';
const deploySrc = fs.existsSync(DEPLOY) ? fs.readFileSync(DEPLOY, 'utf8') : '';
const drift = [EXPECT_HC, EXPECT_GUARD].filter((l) => !deploySrc.includes(l));

// 1) 운영 배포가 도는 중이면 끝날 때까지 기다린다 — 배포도 같은 health-check 를 돌린다(겹치면 같은 검사 계정 한도·카나리 행이 부딪친다)
const busy = spawnSync(path.join(REPO, 'scripts/deploy-busy.sh'), ['--wait', '5400', 'deploy-gate-preview'], { stdio: ['ignore', 'ignore', 'inherit'] });
if (busy.status === 2) { console.log('FATAL 운영 배포가 90분 넘게 안 끝나 미리보기를 못 돌림'); process.exit(2); }

const t0 = Date.now();
const run = (args, env) => spawnSync('node', args, { cwd: REPO, encoding: 'utf8', env: Object.assign({}, process.env, env || {}), maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 });

// 2) health-check — 배포 게이트와 같은 명령(인자 없음 = 전 카테고리)
const hc = run([path.join(REPO, 'scripts/health-check.js')]);
const hcOut = strip(hc.stdout) + strip(hc.stderr);
const failures = [];
const idx = hcOut.lastIndexOf('깨진 항목:');
if (idx >= 0) {
  const lines = hcOut.slice(idx).split('\n').slice(1);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s+\d+\.\s+(\[[a-z0-9]+\].*)$/);
    if (!m) continue;
    const next = lines[i + 1] && !/^\s+\d+\.\s+\[/.test(lines[i + 1]) ? lines[i + 1].trim() : '';
    failures.push({ gate: 'health-check', item: m[1].trim(), detail: next.slice(0, 400) });
  }
}
const totalLine = (hcOut.match(/\d+ FAILED \/ \d+ passed \/ \d+ total|ALL PASSED\s+\(\d+\/\d+\)/) || [])[0] || '';
if (hc.status !== 0 && failures.length === 0) {
  failures.push({ gate: 'health-check', item: `종료코드 ${hc.status ?? hc.signal} — 실패 목록을 못 읽음`, detail: hcOut.trim().split('\n').slice(-4).join(' | ').slice(0, 400) });
}

// 3) 불변식 가드 — 배포는 깨끗한 사본을 보지만 여기는 작업 폴더(커밋 안 한 변경까지)를 본다. 사본에서만 다른 것은 deploy 쪽 사본 검사 몫.
let guard = null;
if (!noGuard) {
  guard = run([path.join(REPO, 'scripts/guard-invariants.js')]);
  if (guard.status !== 0) {
    const g = strip(guard.stdout) + strip(guard.stderr);
    const bad = g.split('\n').filter((l) => /FAIL|✗|❌/.test(l)).slice(0, 10).map((l) => l.trim().slice(0, 300));
    failures.push({ gate: 'guard-invariants', item: `불변식 가드 실패 (종료코드 ${guard.status})`, detail: bad.join(' | ').slice(0, 600) });
  }
}

for (const d of drift) {
  failures.push({ gate: 'preview', item: '배포 스크립트의 게이트 줄이 바뀜 — 미리보기가 배포와 다른 것을 재고 있을 수 있음', detail: `deploy-planq.sh 에 없음: ${d} → scripts/deploy-gate-preview.js 를 같이 고칠 것` });
}

const sec = Math.round((Date.now() - t0) / 1000);
const head = spawnSync('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const result = {
  at: new Date().toISOString(), head, sec, pass: failures.length === 0,
  healthCheck: { rc: hc.status, summary: strip(totalLine) },
  guard: guard ? { rc: guard.status } : 'skipped',
  failures,
};
const logFile = path.join(OUT, `${stamp}.log`);
fs.writeFileSync(logFile, `${JSON.stringify(result, null, 1)}\n\n──── health-check 출력 ────\n${hcOut}${guard ? `\n──── guard-invariants 출력 ────\n${strip(guard.stdout)}${strip(guard.stderr)}` : ''}`);
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(Object.assign({ log: logFile }, result), null, 1));
// 30일 지난 기록 정리
for (const f of fs.readdirSync(OUT)) {
  const p = path.join(OUT, f);
  if (f.endsWith('.log') && Date.now() - fs.statSync(p).mtimeMs > 30 * 86400e3) fs.unlinkSync(p);
}

console.log(`배포 게이트 미리보기 · HEAD ${head} · ${sec}초 · health-check ${strip(totalLine) || `rc=${hc.status}`}${guard ? ` · 가드 rc=${guard.status}` : ''}`);
for (const f of failures) console.log(`❌ [${f.gate}] ${f.item}${f.detail ? ` — ${f.detail}` : ''}`);
console.log(failures.length ? '→ 지금 배포하면 «코드 게이트» 에서 멈춘다. 위 항목을 고치고(데이터면 그 검사가 안내하는 스크립트) 다시 돌린다. 검사를 끄거나 건너뛰지 않는다.' : '✅ 배포 게이트 통과 예상');
console.log(`자세히: ${logFile}`);
console.log(`\n━━━ 총 실패: ${failures.length} ━━━`);
process.exit(failures.length ? 1 : 0);
