#!/usr/bin/env node
// 상황판 «들어온 문의» 칸 올리기 — 개발시작.md 1-B (설계 docs/FEEDBACK_AUTOREPLY_BOARD_DESIGN.md §2)
//
//   --build [--out <파일>] [--deployed <운영 커밋>]   표준입력 = 운영 조회 결과(한 줄에 JSON 하나, src 'fb'|'landing') → 줄 뼈대 JSON
//                            (기본 /opt/planq/.claude/plans/inquiries-board.json · 커밋 안 함). title·draft 는 비워 둔다.
//                            --deployed = 운영 backend/.last-deployed-commit — AI 조사 «이미 고쳐짐» 커밋이 운영에 나갔는지 근거로 쓴다(없으면 «모름»).
//   --post [--file <파일>]   방이 title(우리 말 요약)·draft 를 채운 파일을 검사 → POST /api/inquiries. 걸리면 안 올리고 exit 1.
//   --fail "<이유>"          운영을 못 읽었을 때 — ok:false 만 올린다(지난 목록 유지). 빈 목록을 ok:true 로 올리지 않는다.
//
// 개발서버에서만 돈다. 운영에 쓰지 않는다. DB·모델을 열지 않는다.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { buildItems, checkForPost } = require('../services/feedbackBoard');

const BOARD = process.env.BOARD_URL || 'http://127.0.0.1:8800';
const DEFAULT_FILE = path.join(__dirname, '..', '..', '.claude', 'plans', 'inquiries-board.json');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(pathname, BOARD);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Origin: 'http://localhost:8800' } }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (_) { /* 본문 아님 */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(data);
  });
}

async function readStdin() {
  const chunks = []; for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  if (args.includes('--build')) {
    const raw = await readStdin();
    const rows = []; const bad = [];
    raw.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l, i) => {
      if (!l.startsWith('{')) return; // 머리줄·경고 줄
      try { rows.push(JSON.parse(l)); } catch (_) { bad.push(i + 1); }
    });
    if (bad.length) { console.error(`[feedback-board] JSON 아닌 줄 ${bad.length}개(${bad.slice(0, 5).join(',')}) — 조회를 확인`); process.exit(1); }
    const deployedRef = String(opt('--deployed') || '').trim();
    let isDeployed = null;
    if (/^[0-9a-f]{7,40}$/.test(deployedRef)) {
      const repo = path.join(__dirname, '..', '..');
      isDeployed = (commit) => {
        const c = String(commit || '').trim();
        if (!/^[0-9a-f]{7,40}$/.test(c)) return null;
        try { execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', c, deployedRef], { stdio: 'ignore' }); return true; } catch (e) {
          return e.status === 1 ? false : null; // 1 = 조상 아님(배포 전) · 그 밖 = 커밋을 모름
        }
      };
    } else if (deployedRef) { console.error(`[feedback-board] --deployed 값이 커밋 모양 아님 — 무시(운영 반영 «모름»)`); }
    const { items, total } = buildItems(rows, { isDeployed });
    const out = opt('--out') || DEFAULT_FILE;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ builtAt: new Date().toISOString(), total, items, base: items }, null, 2));
    console.log(`[feedback-board] 뼈대 ${items.length}줄(전체 ${total}) → ${out} · Irene 필요 ${items.filter((x) => x.needsIrene).length} — 각 줄 title(우리 말 요약)·필요한 줄 draft 를 채운 뒤 --post`);
    return;
  }
  if (args.includes('--fail')) {
    const note = String(opt('--fail') || '이유 없음').slice(0, 200);
    const r = await post('/api/inquiries', { project: 'planq', ok: false, note, items: [] });
    console.log(`[feedback-board] 확인 못 함 올림 — HTTP ${r.status} ${JSON.stringify(r.json)}`);
    process.exit(r.status === 200 ? 0 : (r.status === 404 ? 0 : 1));
  }
  if (args.includes('--post')) {
    const file = opt('--file') || DEFAULT_FILE;
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const filled = doc.items || [];
    // 기계 뼈대(base)는 --build 가 남긴 사본 — 방은 items 만 고친다. needsIrene·ref·link·queueRef·replied 는 base 값으로 나간다.
    if (!Array.isArray(doc.base)) { console.error('[feedback-board] base(기계 뼈대)가 없음 — --build 부터 다시'); process.exit(1); }
    const { ok, errors, items } = checkForPost(filled, doc.base);
    if (!ok) { console.error(`[feedback-board] 올리지 않음 — 검사 ${errors.length}건:\n  ${errors.join('\n  ')}`); process.exit(1); }
    const note = doc.total > items.length ? `전체 ${doc.total}건 중 ${items.length}건` : '';
    const r = await post('/api/inquiries', { project: 'planq', ok: true, checkedAt: doc.builtAt, note, items });
    if (r.status === 404) { console.log('[feedback-board] 상황판에 칸 없음(404) — 건너뜀'); return; }
    console.log(`[feedback-board] HTTP ${r.status} ${JSON.stringify(r.json)}`);
    process.exit(r.status === 200 && r.json && r.json.ok ? 0 : 1);
  }
  console.error('쓰임: --build [--out f] < 조회결과 | --post [--file f] | --fail "<이유>"');
  process.exit(2);
}

main().catch((e) => { console.error('[feedback-board]', e.message); process.exit(1); });
