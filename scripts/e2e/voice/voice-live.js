require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const WebSocket = require('/opt/planq/dev-backend/node_modules/ws');
const { execFileSync } = require('child_process');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const API = 'http://localhost:3003', QN = 'http://localhost:8000';
const F = '/opt/planq/scripts/e2e/fixtures/voice/';
const FIX = '/opt/planq/scripts/e2e/voice/voice_fixture.py';
const fx = (...a) => execFileSync('/opt/planq/q-note/venv/bin/python', [FIX, ...a], { cwd: '/opt/planq/q-note', stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pcmOf = (wav) => fs.readFileSync(F + wav).subarray(44);
let H, tok; const made = [];
async function newSession(biz, mode = 'microphone', title = 'voice test') {
  const r = await (await fetch(`${QN}/api/sessions`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ business_id: biz, title: '[검증] ' + title, meeting_languages: ['en'], capture_mode: mode }) })).json();
  const id = r.data && r.data.id; made.push(id); return id;
}
async function stream(sid, pcm, { stereoWith = null } = {}) {
  const ws = new WebSocket(`ws://localhost:8000/ws/live?session_id=${sid}&token=${tok}`);
  const ev = [];
  ws.on('message', (d) => { try { ev.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  for (let i = 0; i < 300 && !ev.some((e) => e.type === 'ready' || e.type === 'error'); i++) await sleep(50);
  if (!ev.some((e) => e.type === 'ready')) { ws.close(); return { ev, err: JSON.stringify(ev).slice(0, 200) }; }
  let buf = pcm;
  if (stereoWith) {   // L = pcm(나) · R = stereoWith(상대) 인터리브
    const n = Math.min(pcm.length, stereoWith.length) >> 1;
    buf = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) { buf.writeInt16LE(pcm.readInt16LE(i * 2), i * 4); buf.writeInt16LE(stereoWith.readInt16LE(i * 2), i * 4 + 2); }
  }
  const frame = stereoWith ? 6400 : 3200;   // 0.1초
  for (let o = 0; o < buf.length; o += frame) { ws.send(buf.subarray(o, o + frame)); await sleep(50); }
  for (let i = 0; i < 20; i++) ws.send(Buffer.alloc(frame));   // 끝 무음 2초 — 마지막 발화 확정
  await sleep(6000);
  ws.send(JSON.stringify({ action: 'stop' }));
  await sleep(1500);
  ws.close();
  await sleep(500);
  return { ev };
}
// Deepgram 이 가끔 조각을 확정하지 못하고 끝난다 — 화자가 0이면 한 번 더 흘린다(판정 대상이 없으면 «이름 없음» 이 거짓 통과한다)
async function streamFor(sid, pcm, opt) {
  let r = await stream(sid, pcm, opt);
  if ((await speakersOf(sid)).length === 0) { console.log('  (retry stream', sid, ')'); r = await stream(sid, pcm, opt); }
  return r;
}
const speakersOf = async (sid) => ((await (await fetch(`${QN}/api/sessions/${sid}`, { headers: H })).json()).data || {}).speakers || [];
(async () => {
  const lj = await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'health-check@planq.kr', password: 'HealthCheck2026!' }) })).json();
  tok = lj.data.token || lj.data.accessToken; H = { Authorization: `Bearer ${tok}` };
  const since = new Date(Date.now() - 2000);
  fx('set', '1000024', 'orion-a.wav'); fx('del', '5');
  try {
    // 1) 같은 워크스페이스 멤버 목소리 → 이름
    const s1 = await newSession(5, 'microphone', '멤버 인식');
    const r1 = await streamFor(s1, pcmOf('orion-b.wav'));
    const sp1 = await speakersOf(s1);
    console.log('  s1 speakers', JSON.stringify(sp1), 'events', r1.ev.filter((e) => e.type === 'speaker_named').length, r1.err || '');
    ok(sp1.some((x) => x.participant_name === 'Perm Member' && x.name_source === 'voice_auto' && x.matched_user_id === 1000024), '① 같은 워크스페이스 멤버 → 이름 자동(voice_auto)');
    ok(r1.ev.some((e) => e.type === 'speaker_named' && e.participant_name === 'Perm Member'), '① 실시간 speaker_named 이벤트');
    // 2) 같은 WAV · 그 사람이 멤버가 아닌 워크스페이스 → 이름 없음 (음성 대조군)
    //   biz 73 은 구독 비활성이라 녹음이 막힌다 — 같은 워크스페이스에서 **멤버십만** 끊어 경계를 잰다(같은 WAV)
    await sequelize.query('UPDATE business_members SET removed_at = NOW() WHERE business_id = 5 AND user_id = 1000024');
    let s2, sp2;
    try {
      s2 = await newSession(5, 'microphone', '멤버 아님');
      await streamFor(s2, pcmOf('orion-b.wav'));
      sp2 = await speakersOf(s2);
    } finally {
      await sequelize.query('UPDATE business_members SET removed_at = NULL WHERE business_id = 5 AND user_id = 1000024');
    }
    ok(sp2.length > 0 && sp2.every((x) => !x.participant_name && !x.matched_user_id), `② 같은 목소리·멤버 아님 → 이름 없음 ${JSON.stringify(sp2)}`);
    // 3) 등록 안 한 비슷한 목소리 → 이름 없음
    const s3 = await newSession(5, 'microphone', '미등록');
    await streamFor(s3, pcmOf('arcas-b.wav'));
    const sp3 = await speakersOf(s3);
    ok(sp3.length > 0 && sp3.every((x) => !x.participant_name && !x.is_self), `③ 미등록 목소리 → 이름 없음 ${JSON.stringify(sp3.map((x) => [x.participant_name, x.match_similarity]))}`);
    // 4) 녹음자 본인 → «나»
    fx('set', '5', 'asteria-a.wav');
    const s4 = await newSession(5, 'microphone', '본인');
    await streamFor(s4, pcmOf('asteria-b.wav'));
    const sp4 = await speakersOf(s4);
    ok(sp4.some((x) => x.is_self === 1 && x.name_source === 'voice_auto' && !x.participant_name), `④ 녹음자 본인 → 나 ${JSON.stringify(sp4)}`);
    // 4b) 본인 등록 상태에서 비슷한 여성 목소리(luna, 미등록) → «나» 로 찍히지 않는다 (옛 0.62 기준이면 찍혔다)
    const s4b = await newSession(5, 'microphone', '옆사람');
    await streamFor(s4b, pcmOf('luna-b.wav'));
    const sp4b = await speakersOf(s4b);
    ok(sp4b.length > 0 && sp4b.every((x) => !x.is_self), `④b 비슷한 다른 목소리 → 나 아님 ${JSON.stringify(sp4b.map((x) => [x.is_self, x.match_similarity]))}`);
    // 5) 자동 인식 끄기 → 이름 없음
    fx('sql', "UPDATE voice_fingerprints SET match_enabled = 0 WHERE user_id = 1000024");
    const s5 = await newSession(5, 'microphone', '끔');
    await streamFor(s5, pcmOf('orion-b.wav'));
    const sp5 = await speakersOf(s5);
    ok(sp5.length > 0 && sp5.every((x) => !x.participant_name), '⑤ 자동 인식 끔 → 이름 없음');
    // 6) 회의 종료 배치 — 켜고 종료하면 이름이 붙는다 / 손으로 쓴 이름은 덮지 않는다
    fx('sql', "UPDATE voice_fingerprints SET match_enabled = 1 WHERE user_id = 1000024");
    await fetch(`${QN}/api/sessions/${s5}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
    await sleep(6000);
    const sp6 = await speakersOf(s5);
    ok(sp6.some((x) => x.participant_name === 'Perm Member' && x.name_source === 'voice_auto'), `⑥ 회의 종료 배치로 이름 ${JSON.stringify(sp6)}`);
    const s6 = await newSession(5, 'microphone', '수동');
    fx('sql', "UPDATE voice_fingerprints SET match_enabled = 0 WHERE user_id = 1000024");
    await streamFor(s6, pcmOf('orion-b.wav'));
    let sp = await speakersOf(s6);
    await fetch(`${QN}/api/sessions/${s6}/speakers/${sp[0].id}/match`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ participant_name: '손으로 쓴 이름' }) });
    fx('sql', "UPDATE voice_fingerprints SET match_enabled = 1 WHERE user_id = 1000024");
    await fetch(`${QN}/api/sessions/${s6}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
    await sleep(6000);
    sp = await speakersOf(s6);
    ok(sp[0].participant_name === '손으로 쓴 이름' && sp[0].name_source === 'manual', `⑦ 손으로 쓴 이름은 자동이 덮지 않음 ${JSON.stringify(sp[0])}`);
    // 8) 사람 고르기 — 후보 목록 / 후보 아닌 사람 400 / 이름 지우기
    const c5 = await (await fetch(`${QN}/api/sessions/${s1}/speaker-candidates`, { headers: H })).json();
    const s73 = await newSession(73, 'microphone', '다른 워크스페이스');
    const c73 = await (await fetch(`${QN}/api/sessions/${s73}/speaker-candidates`, { headers: H })).json();
    ok(c5.data.some((p) => p.user_id === 1000024) && !c73.data.some((p) => p.user_id === 1000024) && !JSON.stringify(c5).match(/voice|registered|fingerprint/i), '⑧ 후보 목록 — 워크스페이스 경계 · 등록 여부 노출 없음');
    const bad = await fetch(`${QN}/api/sessions/${s2}/speakers/${sp2[0].id}/match`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ matched_user_id: 1000024 }) });
    ok(bad.status === 200, `⑧ (대조) 멤버로 돌아온 뒤에는 같은 회의에서 고를 수 있음 (${bad.status})`);
    const sp73 = await fetch(`${QN}/api/sessions/${s73}`, { headers: H });
    // 다른 워크스페이스 회의에 그 사람을 고르면 400 — 화자 행을 하나 만들어 시험한다
    const addSp = await fetch(`${QN}/api/sessions/${s73}/speakers/0/match`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ matched_user_id: 1000024 }) });
    ok(addSp.status === 404 || addSp.status === 400, `⑧ 다른 워크스페이스 회의(화자 없음)에서 거절 ${addSp.status}`);
    const good = await (await fetch(`${QN}/api/sessions/${s3}/speakers/${sp3[0].id}/match`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ matched_user_id: 1000024 }) })).json();
    ok(good.data && good.data.participant_name === 'Perm Member' && good.data.name_source === 'manual', '⑧ 사람 고르기 → manual');
    const cl = await (await fetch(`${QN}/api/sessions/${s3}/speakers/${sp3[0].id}/match`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) })).json();
    ok(cl.data && cl.data.participant_name === null && cl.data.name_source === null && cl.data.matched_user_id === null, '⑧ 이름 지우기 → 전부 비움');
    // 9) 지운 프로필 → 이름 없음 · 이전 회의 이름은 그대로
    fx('del', '1000024');
    const s9 = await newSession(5, 'microphone', '삭제 후');
    await streamFor(s9, pcmOf('orion-b.wav'));
    const sp9 = await speakersOf(s9);
    const sp1b = await speakersOf(s1);
    ok(sp9.length > 0 && sp9.every((x) => !x.participant_name) && sp1b.some((x) => x.participant_name === 'Perm Member'), '⑨ 삭제 후 이름 없음 · 지난 회의 이름 유지');
    // 10) 감사
    const [au] = await sequelize.query("SELECT COUNT(*) n FROM audit_logs WHERE action='qnote.speaker.auto_named' AND created_at >= ?", { replacements: [since] });
    ok(au[0].n >= 3, `⑩ 자동 이름 감사 ${au[0].n}건`);
  } finally {
    for (const id of made) if (id) await fetch(`${QN}/api/sessions/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
    fx('del', '1000024'); fx('del', '5');
  }
  console.log(`\n${pass} pass / ${fail} fail`);
  await sequelize.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
