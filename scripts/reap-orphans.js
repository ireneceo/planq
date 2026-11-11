#!/usr/bin/env node
// scripts/reap-orphans.js — PlanQ 가 개발서버에 남긴 고아 프로세스 정리 (2026-11-11)
//   왜: 서버 방 11-11 발견 — e2e 크롬(부모 없음, 6일째 · 메모리 약 0.2GB)과 dev-backend 폴더의
//     `node -e "require('./routes/…')"` 확인용 프로세스 4개(1~5일째)가 끝나지 않고 남아 있었다.
//     · 크롬: 시험 node 가 SIGKILL(자리표 상자 137·timeout -s KILL)로 죽으면 browser.close() 가 안 돌아 크롬만 남는다.
//     · node -e: 라우트·모델을 require 하면 DB 풀·타이머가 이벤트 루프를 붙잡아 스스로 끝나지 않는다.
//       (재발 막기는 훅 .claude/hooks/node-eval-guard.sh — 이 스크립트는 그래도 남은 것을 치운다)
//   무엇을 끄나(셋 다 맞아야): ① 내 사용자 ② 작업 폴더(cwd)가 /opt/planq 아래 ③ 아래 둘 중 하나
//     · 크롬 본체(puppeteer 크롬, --type= 없음)이고 부모가 1(고아) — 살아 있는 시험의 크롬은 부모가 node 라 안 걸린다.
//       dev-backend server.js 가 띄운 크롬도 부모가 server.js 라 안 걸린다. 본체를 끄면 하위 프로세스도 같이 끝난다.
//     · `node -e`/`node --eval` 이고 1시간 넘게 돌고 있음.
//   다른 솔루션(/var/www · /opt/lingo) 프로세스는 cwd 가 달라 건드리지 않는다.
//   부르는 곳: scripts/e2e/lib/mem-slot.js(시험 시작마다 — 자리 잡기 전) · 손으로 `node scripts/reap-orphans.js [--dry]`.
const fs = require('fs');

const ROOT = '/opt/planq';
const NODE_EVAL_MAX_SEC = process.env.REAP_NODE_EVAL_MAX_SEC ? Number(process.env.REAP_NODE_EVAL_MAX_SEC) : 3600; // 시험용으로만 낮춘다
const CLK = 100; // USER_HZ — 리눅스 기본

function readProc(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ppid = Number(rest[1]);
    const startTicks = Number(rest[19]);
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    const uid = fs.statSync(`/proc/${pid}`).uid;
    return { pid, ppid, startTicks, cmd, cwd, uid };
  } catch { return null; } // 이미 끝났거나 남의 프로세스
}

function uptimeSec() {
  return Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
}

function findOrphans() {
  const myUid = process.getuid();
  const up = uptimeSec();
  const out = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    const p = readProc(name);
    if (!p || p.uid !== myUid || !p.cmd.length) continue;
    if (p.cwd !== ROOT && !p.cwd.startsWith(ROOT + '/')) continue;
    const age = Math.round(up - p.startTicks / CLK);
    const exe = p.cmd[0];
    const isChromeMain = /\/puppeteer\/chrome\/.*\/chrome$/.test(exe) && !p.cmd.some((a) => a.startsWith('--type='));
    if (isChromeMain && p.ppid === 1) { out.push({ ...p, age, why: 'orphan-chrome' }); continue; }
    const isNodeEval = /(^|\/)node$/.test(exe) && (p.cmd[1] === '-e' || p.cmd[1] === '--eval' || p.cmd[1] === '-p');
    if (isNodeEval && age > NODE_EVAL_MAX_SEC) out.push({ ...p, age, why: 'stale-node-eval' });
  }
  return out;
}

function reap({ dry = false, log = console.error } = {}) {
  let found = [];
  try { found = findOrphans(); } catch (e) { log(`[reap-orphans] 찾기 실패: ${e.message}`); return []; }
  for (const p of found) {
    const line = `[reap-orphans] ${dry ? '(안 끔) ' : ''}${p.why} pid ${p.pid} · ${Math.round(p.age / 3600)}시간째 · ${p.cmd.join(' ').slice(0, 120)}`;
    log(line);
    if (dry) continue;
    try { process.kill(p.pid, 'SIGTERM'); } catch { /* 이미 끝남 */ }
  }
  return found;
}

module.exports = { reap, findOrphans };

if (require.main === module) {
  const found = reap({ dry: process.argv.includes('--dry'), log: console.log });
  if (!found.length) console.log('[reap-orphans] 남은 고아 프로세스 0');
}
