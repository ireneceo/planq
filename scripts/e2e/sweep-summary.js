#!/usr/bin/env node
// sweep-summary.js — full-sweep 결과 폴더를 읽어 summary.md(사람) · summary.json(상황판·개발시작) 을 만든다.
//   판정은 run.js 출력 그대로 읽는다: ❌ 실패 · 🔥 하니스 오염 · ⚪ 미측정(통과로 세지 않는다) · 종료코드.
//   사용: node scripts/e2e/sweep-summary.js logs/sweep/2026-10-07
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
if (!dir) { console.error('usage: sweep-summary.js <dir>'); process.exit(2); }
const prog = fs.existsSync(path.join(dir, 'progress.txt')) ? fs.readFileSync(path.join(dir, 'progress.txt'), 'utf8').trim().split('\n').filter(Boolean) : [];
const rows = [];
for (const line of prog) {
  const m = line.match(/^(\S+) rc=(\d+) fail=(\S+) sec=(\d+)/);
  if (!m) continue;
  const [, suite, rc, fail, sec] = m;
  const log = fs.existsSync(path.join(dir, `${suite}.log`)) ? fs.readFileSync(path.join(dir, `${suite}.log`), 'utf8') : '';
  const bad = log.split('\n').filter((l) => /^(❌|🔥|⚪)/.test(l)).map((l) => l.slice(0, 220));
  const fatal = /^FATAL /m.test(log) || Number(rc) === 2 || Number(rc) === 124;
  const status = Number(rc) === 0 ? 'pass' : (Number(rc) === 124 ? 'timeout' : (fatal ? 'crash' : 'fail'));
  rows.push({ suite, rc: Number(rc), fail: fail === '?' ? null : Number(fail), sec: Number(sec), status, bad: bad.slice(0, 15), tail: status === 'crash' || status === 'timeout' ? log.trim().split('\n').slice(-4).join(' | ').slice(0, 300) : '' });
}
const count = (s) => rows.filter((r) => r.status === s).length;
const sum = { date: path.basename(dir), total: rows.length, pass: count('pass'), fail: count('fail'), crash: count('crash'), timeout: count('timeout'), minutes: Math.round(rows.reduce((a, r) => a + r.sec, 0) / 60), rows };
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(sum, null, 1));
const md = [`# 전체 검사 ${sum.date}`, '', `스위트 ${sum.total} · 통과 ${sum.pass} · 실패 ${sum.fail} · 하니스 죽음 ${sum.crash} · 시간초과 ${sum.timeout} · ${sum.minutes}분`, ''];
for (const r of rows.filter((x) => x.status !== 'pass')) {
  md.push(`## ${r.status === 'fail' ? '❌' : '🔥'} ${r.suite} (${r.status}, 실패 ${r.fail ?? '?'}, ${r.sec}s)`);
  r.bad.forEach((b) => md.push(`- ${b}`));
  if (r.tail) md.push(`- 끝 출력: ${r.tail}`);
  md.push('');
}
md.push('## 통과', rows.filter((x) => x.status === 'pass').map((r) => r.suite).join(' · '));
fs.writeFileSync(path.join(dir, 'summary.md'), md.join('\n'));
console.log(md.slice(0, 3).join('\n'));
