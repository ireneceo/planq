#!/usr/bin/env node
// canary-mail-search — Q Mail 검색이 **조용히 누락하지 않는가**.
//
// 신고 (Irene 2026-09-15): "보낸 사람이 Purple Here 인데 검색해도 이 이름이 안 나와."
//
// 무엇이 문제였나 — 검색은 토큰 AND 다. 각 토큰마다 메시지 테이블에서
//   `SELECT DISTINCT thread_id ... LIMIT 1000` (★ ORDER BY 없음) 으로 목록을 만들고
//   바깥에서 `id IN (그 목록)` 을 걸었다. "here" 처럼 본문에 흔한 단어("click here")는
//   수천 건이 맞아 **임의의 1000건**만 남고 나머지는 오류도 경고도 없이 탈락했다.
//   운영 dev 실측(2026-09-15): 'here' 매칭 스레드 **1368개 중 368개(27%)가 잘렸다.**
//   from_name 에 "Purple Here" 가 멀쩡히 있어도 검색에서 사라진다.
//
// ★ 이 카나리는 «찾아지는가» 를 픽스처 하나로 묻지 않는다 — 픽스처가 **우연히 1000 안에
//   들어가면 거짓 통과**한다(처음 그렇게 만들었다가 실제로 운으로 초록이 나왔다).
//   그래서 «옛 방식이 실제로 잘라 버리던 스레드» 를 데이터에서 찾아 그것으로 판정한다.
//   (memory feedback_positive_control_can_be_wrong · feedback_empty_fixture_false_verdict)
const b = require('./lib/browser');
// DB 를 직접 읽는다(대조군 계산) — 단독 실행일 때도 백엔드의 .env 를 먼저 싣는다.
//   run.js 를 통해 돌면 이미 실려 있지만, 이 파일만 돌리는 경우가 실제로 더 많다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({
  path: '/opt/planq/dev-backend/.env', quiet: true,
});

const API = process.env.MS_API || 'http://127.0.0.1:3003/api';
const COMMON = process.env.MS_COMMON || 'here';   // 본문에 흔한 단어
const OLD_CAP = 1000;                              // 옛 상한 — 대조군 계산용

const results = [];
const P = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

async function jf(url, opts = {}) {
  const r = await fetch(url, opts);
  let j = null; try { j = JSON.parse(await r.text()); } catch { /* noop */ }
  return { status: r.status, j };
}

async function run() {
  const { sequelize } = require('/opt/planq/dev-backend/config/database');
  const login = await jf(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }),
  });
  const tok = login.j?.data?.token;
  if (!tok) { P('로그인', false, `status ${login.status}`); return results; }
  const H = { Authorization: `Bearer ${tok}` };

  const bz = await jf(`${API}/businesses`, { headers: H });
  const biz = (bz.j?.data || [])[0]?.id;
  if (!biz) { P('워크스페이스를 찾았다', false, '0건'); return results; }

  const [accts] = await sequelize.query(
    `SELECT id FROM email_accounts WHERE business_id = ${Number(biz)}`);
  if (!accts.length) { P('메일 계정이 있다 (0건 = 판정 불가)', false, '이 워크스페이스에 계정 0'); return results; }
  const acctIds = accts.map((a) => Number(a.id)).join(',');

  // ── 옛 방식이 잘라 버리던 스레드 집합을 실제로 계산한다
  const kw = `%${COMMON}%`;
  const base = `SELECT DISTINCT thread_id FROM email_messages
      WHERE business_id = ${Number(biz)}
        AND thread_id IN (SELECT id FROM email_threads WHERE business_id = ${Number(biz)} AND account_id IN (${acctIds}))
        AND (body_text LIKE '${kw}' OR subject LIKE '${kw}' OR from_name LIKE '${kw}'
             OR from_email LIKE '${kw}' OR REPLACE(subject,' ','') LIKE '${kw}'
             OR REPLACE(COALESCE(from_name,''),' ','') LIKE '${kw}')`;
  const [kept] = await sequelize.query(`${base} LIMIT ${OLD_CAP}`);
  const [all] = await sequelize.query(base);
  const keptSet = new Set(kept.map((r) => Number(r.thread_id)));
  const cut = all.map((r) => Number(r.thread_id)).filter((id) => !keptSet.has(id));

  if (all.length <= OLD_CAP) {
    // 데이터가 상한에 못 미치면 이 계열을 **재현할 수 없다** — 통과로 세지 않는다
    P(`대조군을 세울 수 있다 ('${COMMON}' 매칭이 옛 상한 ${OLD_CAP}을 넘는가)`, false,
      `매칭 ${all.length}개 ≤ ${OLD_CAP} — 이 데이터로는 누락을 재현할 수 없다(미측정)`);
    return results;
  }
  P(`대조군 — 옛 방식이 잘라내던 스레드가 실재한다`, cut.length > 0,
    `'${COMMON}' 매칭 ${all.length}개 중 **${cut.length}개(${Math.round(cut.length / all.length * 100)}%)가 잘렸다**`);

  // ── 잘린 것 중 «제목·미리보기에도 그 단어가 없는» 것 = 다른 경로로도 못 걸리던 진짜 유실
  const [cand] = await sequelize.query(
    `SELECT t.id, t.subject FROM email_threads t
      WHERE t.id IN (${cut.slice(0, 500).join(',')})
        AND COALESCE(t.subject,'') NOT LIKE '${kw}'
        AND COALESCE(t.last_message_preview,'') NOT LIKE '${kw}'
        AND t.subject IS NOT NULL AND t.subject <> ''
      LIMIT 20`);
  const target = cand.map((c) => ({
    id: Number(c.id),
    word: String(c.subject).split(/\s+/).find((w) => w.length >= 4 && /^[A-Za-z가-힣]+$/.test(w)),
    subject: String(c.subject),
  })).find((c) => c.word);

  if (!target) {
    P('판정 대상을 찾았다 (0건 = 판정 불가)', false, '잘린 스레드 중 쓸 만한 제목 토큰이 없다');
    return results;
  }

  // ── 지금 검색이 그것을 찾는가
  const q = `${COMMON} ${target.word}`;
  const res = await jf(`${API}/businesses/${biz}/email-threads?q=${encodeURIComponent(q)}&limit=200`, { headers: H });
  const rows = res.j?.data || [];
  const found = rows.some((x) => Number(x.id) === target.id);
  P('① 흔한 단어가 섞여도 **잘리지 않는다** (옛 상한이면 못 찾던 스레드)', found,
    `검색어 "${q}" · thread=${target.id} "${target.subject.slice(0, 34)}" · 결과 ${rows.length}건 · ${found ? '포함' : '★없음★'}`);

  // ── 결과 행이 자기 폴더를 말하는가 (검색이 폴더를 넘으므로 필수)
  const withFolder = rows.filter((x) => x && x.folder);
  P('② 결과 행이 자기 폴더를 말한다', rows.length > 0 && withFolder.length === rows.length,
    `${withFolder.length}/${rows.length} 행에 folder 있음`);

  // ── 폴더를 넘어 찾는가 — 좁은 폴더에 서서 같은 검색
  const res2 = await jf(`${API}/businesses/${biz}/email-threads?folder=reply_needed&q=${encodeURIComponent(q)}&limit=200`, { headers: H });
  const rows2 = res2.j?.data || [];
  P('③ 다른 폴더에 서서 검색해도 찾는다', rows2.some((x) => Number(x.id) === target.id),
    `folder=reply_needed 로 검색 · 결과 ${rows2.length}건`);

  // ── 음성 대조군 — 없는 말은 안 나와야 한다(검색이 통째로 열려 버린 게 아님을 증명)
  const res3 = await jf(`${API}/businesses/${biz}/email-threads?q=${encodeURIComponent('zzz없는단어zzz')}&limit=50`, { headers: H });
  const rows3 = res3.j?.data || [];
  P('④ 음성 대조군 — 없는 말은 0건', rows3.length === 0, `결과 ${rows3.length}건`);

  P('커버리지 — 무엇을 쟀는가', true,
    `워크스페이스 ${biz} · 계정 ${accts.length} · '${COMMON}' 매칭 ${all.length} · 옛 방식 유실 ${cut.length}`);
  return results;
}

module.exports = { name: 'mailsearch', run };

if (require.main === module) {
  run().then((rs) => {
    let f = 0;
    for (const x of rs) { if (x.fail) f++; console.log(`${x.fail ? '✗' : '✓'} ${x.name}${x.details.length ? ' — ' + x.details.join(' / ') : ''}`); }
    console.log(f ? `\n✗ 실패 ${f}/${rs.length}` : `\n✓ 전부 통과 (${rs.length})`);
    process.exit(f ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e); process.exit(1); });
}
