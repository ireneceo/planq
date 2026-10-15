#!/usr/bin/env node
// scripts/gen-confusables.js — Unicode confusables.txt 에서 «ASCII 영문자·숫자로 떨어지는» 항목만 뽑아
//   services/data/confusables-latin.json 을 만든다 (docs/MAIL_IMPERSONATION_DESIGN.md §7).
//
// 왜 부분집합인가 — 우리가 비교하는 대상(아는 도메인)은 ASCII 다. 비라틴↔비라틴 쌍은 쓸 데가 없다.
//   npm 패키지는 쓰지 않는다(갱신·공급망 보장 없음). 판(버전)은 고정 — 바꿀 때 이 스크립트를 다시 돌린다.
//
// 사용: node scripts/gen-confusables.js [로컬 confusables.txt 경로]
//   경로가 없으면 고정 판 주소에서 받는다.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const VERSION = '18.0.0';
const URL = `https://www.unicode.org/Public/${VERSION}/security/confusables.txt`;
const OUT = path.join(__dirname, '..', 'services', 'data', 'confusables-latin.json');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); res.resume(); return; }
      let s = ''; res.setEncoding('utf8'); res.on('data', (c) => { s += c; }); res.on('end', () => resolve(s));
    }).on('error', reject);
  });
}

(async () => {
  const src = process.argv[2];
  const text = src ? fs.readFileSync(src, 'utf8') : await fetchText(URL);
  const ver = (text.match(/^#\s*Version:\s*(\S+)/m) || [])[1];
  if (ver !== VERSION) { console.error(`판이 다르다: 파일 ${ver} ≠ 고정 ${VERSION}`); process.exit(1); }
  const map = {};
  for (const line of text.split('\n')) {
    const body = line.split('#')[0].trim();
    if (!body) continue;
    const [from, to] = body.split(';').map((x) => x.trim());
    if (!from || !to || from.includes(' ')) continue;
    const target = to.split(/\s+/).map((h) => String.fromCodePoint(parseInt(h, 16))).join('');
    if (!/^[0-9A-Za-z]{1,3}$/.test(target)) continue;
    const ch = String.fromCodePoint(parseInt(from, 16));
    if (ch === target) continue;
    map[from.toUpperCase()] = target;
  }
  const out = { source: URL, version: VERSION, generated: new Date().toISOString().slice(0, 10), count: Object.keys(map).length, map };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`${out.count} 항목 → ${OUT}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
