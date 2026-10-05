require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const WebSocket = require('/opt/planq/dev-backend/node_modules/ws');
const { execFileSync } = require('child_process');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const API = 'http://localhost:3003', QN = 'http://localhost:8000';
const F = '/opt/planq/scripts/e2e/fixtures/voice/';
const FIX = '/opt/planq/scripts/e2e/voice/voice_fixture.py';
const fx = (...a) => execFileSync('/opt/planq/q-note/venv/bin/python', [FIX, ...a], { cwd: '/opt/planq/q-note', stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
// 픽스처 헬퍼(파이썬·torch 로드 ~5초) 사이에 서버가 keep-alive 소켓을 닫으면 undici 가 닫힌 소켓을 재사용한다 — 한 번 다시 보낸다
const _f = global.fetch;
global.fetch = async (...a) => { try { return await _f(...a); } catch (e) { if (e && e.cause && e.cause.code === 'UND_ERR_SOCKET') return _f(...a); throw e; } };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pcmOf = (wav) => fs.readFileSync(F + wav).subarray(44);
let H, tok; const made = [];
const K = process.env.INTERNAL_API_KEY;
async function newSession(biz, mode, title) {
  const r = await (await fetch(`${QN}/api/sessions`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ business_id: biz, title: '[검증] ' + title, meeting_languages: ['en'], capture_mode: mode }) })).json();
  made.push(r.data.id); return r.data.id;
}
async function stream(sid, pcm, stereoWith) {
  const ws = new WebSocket(`ws://localhost:8000/ws/live?session_id=${sid}&token=${tok}`);
  const ev = []; ws.on('message', (d) => { try { ev.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  for (let i = 0; i < 300 && !ev.some((e) => e.type === 'ready' || e.type === 'error'); i++) await sleep(50);
  let buf = pcm;
  if (stereoWith) {
    // 나(L)와 상대(R)를 번갈아 말하게 한다 — 앞 절반은 나만, 뒤 절반은 상대만(겹치면 채널 누화로 판정이 흐려진다)
    const a = pcm, b = stereoWith; const na = a.length >> 1, nb = b.length >> 1; const n = na + nb;
    buf = Buffer.alloc(n * 4);
    for (let i = 0; i < na; i++) buf.writeInt16LE(a.readInt16LE(i * 2), i * 4);
    for (let i = 0; i < nb; i++) buf.writeInt16LE(b.readInt16LE(i * 2), (na + i) * 4 + 2);
  }
  const frame = stereoWith ? 6400 : 3200;
  for (let o = 0; o < buf.length; o += frame) { ws.send(buf.subarray(o, o + frame)); await sleep(50); }
  for (let i = 0; i < 20; i++) ws.send(Buffer.alloc(frame));
  await sleep(7000); ws.send(JSON.stringify({ action: 'stop' })); await sleep(1500); ws.close(); await sleep(500);
  return ev;
}
const speakersOf = async (sid, h = H) => ((await (await fetch(`${QN}/api/sessions/${sid}`, { headers: h })).json()).data || {}).speakers || [];
(async () => {
  const lj = await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'health-check@planq.kr', password: 'HealthCheck2026!' }) })).json();
  tok = lj.data.token || lj.data.accessToken; H = { Authorization: `Bearer ${tok}` };
  fx('set', '1000024', 'orion-a.wav'); fx('set', '5', 'asteria-a.wav');
  try {
    // A) 화상회의 — 채널 0 = 나(채널), 채널 1 상대 = 지문 매칭
    const v = await newSession(5, 'web_conference', '화상');
    await stream(v, pcmOf('asteria-b.wav'), pcmOf('orion-b.wav'));
    let sp = await speakersOf(v);
    if (!sp.some((x) => x.deepgram_speaker_id >= 100)) { await stream(v, pcmOf('asteria-b.wav'), pcmOf('orion-b.wav')); sp = await speakersOf(v); }
    console.log('  video speakers', JSON.stringify(sp.map((x) => [x.deepgram_speaker_id, x.participant_name, x.is_self, x.name_source, x.match_similarity])));
    ok(sp.some((x) => x.deepgram_speaker_id === 0 && x.is_self === 1 && x.name_source === 'channel'), 'A 화상: 채널 0 = 나(channel)');
    ok(sp.some((x) => x.deepgram_speaker_id >= 100 && x.participant_name === 'Perm Member' && x.name_source === 'voice_auto'), 'A 화상: 상대 채널(100+n) = 멤버 이름');
    ok(!sp.some((x) => x.deepgram_speaker_id >= 100 && x.is_self), 'A 화상: 상대 채널에 «나» 없음(녹음자 제외)');
    // B) 공개 링크 — 화이트리스트
    await fetch(`${QN}/api/sessions/${v}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
    await sleep(3000);
    const vis = await (await fetch(`${QN}/api/sessions/${v}/visibility`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: 'L4', shared_consent: true }) })).json();
    const tokn = vis.data && vis.data.share_token;
    const pubRaw = tokn ? await (await fetch(`${QN}/api/sessions/public/by-token/${tokn}`)).text() : '';
    ok(!!tokn && pubRaw.includes('Perm Member') && !/matched_user_id|match_similarity|name_source|matched_kind|deepgram_speaker_id/.test(pubRaw), `B 공개 링크: 이름만, 자동 인식 흔적·내부 키 없음 (token=${!!tokn})`);
    // C) 열람자(생성자 아님)에게 흔적 없음 — 다른 계정이 필요해 서버 코드 경로를 직접 확인한다(L3 로 열고 같은 워크스페이스 멤버 토큰)
    //    dev 계정 비밀번호를 바꾸지 않으므로 임시 멤버를 만든다
    const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
    const email = `voice-viewer-${Date.now()}@test.planq.kr`;
    const [ps] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1');
    const [vid] = await sequelize.query("INSERT INTO users (email,password_hash,name,username,platform_role,terms_accepted_at,terms_version,privacy_accepted_at,privacy_version,created_at,updated_at) VALUES (?,?,'Voice Viewer',?,'user',NOW(),?,NOW(),?,NOW(),NOW())", { replacements: [email, await bcrypt.hash('VoiceViewer2026!', 12), `vv${Date.now()}`, ps[0].terms_version, ps[0].privacy_version] });
    await sequelize.query("INSERT INTO business_members (business_id,user_id,role,joined_at,created_at,updated_at) VALUES (5,?,'member',NOW(),NOW(),NOW())", { replacements: [vid] });
    try {
      await fetch(`${QN}/api/sessions/${v}/visibility`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: 'L3', shared_consent: true }) });
      const vj = await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'VoiceViewer2026!' }) })).json();
      const VH = { Authorization: `Bearer ${vj.data.token || vj.data.accessToken}` };
      const vr = await (await fetch(`${QN}/api/sessions/${v}`, { headers: VH })).text();
      ok(vr.includes('Perm Member') && !/matched_user_id|match_similarity|name_source/.test(vr), 'C 열람자: 이름은 보이고 자동 인식 흔적은 없음');
      const cr = await fetch(`${QN}/api/sessions/${v}/speaker-candidates`, { headers: VH });
      ok(cr.status === 403, `C 열람자는 사람 고르기 목록 못 받음 (${cr.status})`);
      const own = await (await fetch(`${QN}/api/sessions/${v}`, { headers: H })).text();
      ok(/name_source/.test(own), 'C (대조) 생성자에게는 흔적이 온다');
    } finally {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [vid] });
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [vid] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [vid] });
    }
    // D) 업로드 노트 — wav 업로드 → 화자 행 + 이름
    const fd = new FormData();
    fd.append('business_id', '5'); fd.append('language', 'en'); fd.append('title', '[검증] 업로드');
    fd.append('file', new Blob([fs.readFileSync(F + 'orion-b.wav')], { type: 'audio/wav' }), 'orion-b.wav');
    const up = await (await fetch(`${QN}/api/sessions/upload-audio`, { method: 'POST', headers: H, body: fd })).json();
    const us = up.data && up.data.session_id; if (us) made.push(us);
    let usp = [];
    for (let i = 0; i < 40; i++) { await sleep(2000); usp = await speakersOf(us); if (usp.some((x) => x.name_source)) break; }
    ok(us && usp.length > 0 && usp.some((x) => x.participant_name === 'Perm Member' && x.name_source === 'voice_auto'), `D 업로드(wav): 화자 행 + 이름 ${JSON.stringify(usp.map((x) => [x.participant_name, x.name_source, x.match_similarity]))}`);
    // E) 탈퇴(purge) — 남의 회의에 박힌 사람 연결 해제, 이름은 남음
    fx('set', '999999', 'luna-a.wav');
    fx('sql', `UPDATE speakers SET matched_user_id = 999999, matched_kind='user' WHERE id = ${usp[0] ? usp[0].id : 0}`);
    const pr = await fetch(`${QN}/api/sessions/internal/purge-user`, { method: 'POST', headers: { 'x-internal-api-key': K, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: 999999 }) });
    const left = fx('sql', 'SELECT COUNT(*) FROM voice_fingerprints WHERE user_id = 999999');
    const usp2 = await speakersOf(us);
    ok(pr.status === 200 && left === '[(0,)]' && usp2[0].matched_user_id === null && usp2[0].participant_name === 'Perm Member', `E 탈퇴: 지문 0 · 링크 해제 · 이름 유지 (${left})`);
    // F) 보관기간 — 24개월 지난 프로필 삭제 · 23.5개월은 알림 · 끝난 지 8일 회의의 화자 임베딩 삭제
    fx('set', '999998', 'luna-a.wav'); fx('set', '1000024', 'orion-a.wav');
    fx('sql', "UPDATE voice_fingerprints SET last_matched_at = datetime('now','-25 months'), updated_at = datetime('now','-25 months'), created_at = datetime('now','-25 months') WHERE user_id = 999998");
    fx('sql', "UPDATE voice_fingerprints SET last_matched_at = datetime('now','-24 months','+10 days'), updated_at = datetime('now','-24 months','+10 days'), created_at = datetime('now','-24 months','+10 days'), expiry_notified_at = NULL WHERE user_id = 1000024");
    fx('sql', `UPDATE sessions SET updated_at = datetime('now','-8 days') WHERE id = ${v}`);
    const embBefore = fx('sql', `SELECT COUNT(*) FROM speaker_embeddings WHERE speaker_id IN (SELECT id FROM speakers WHERE session_id = ${v})`);
    const since = new Date(Date.now() - 1000);
    const run = execFileSync('/opt/planq/q-note/venv/bin/python', ['-c', 'import asyncio,json;from services.voice_retention import run_once;print(json.dumps(asyncio.run(run_once())))'], { cwd: '/opt/planq/q-note', stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').pop();
    console.log('  retention', run, 'emb before', embBefore);
    const g998 = fx('sql', 'SELECT COUNT(*) FROM voice_fingerprints WHERE user_id = 999998');
    const n24 = fx('sql', 'SELECT expiry_notified_at IS NOT NULL FROM voice_fingerprints WHERE user_id = 1000024');
    const embAfter = fx('sql', `SELECT COUNT(*) FROM speaker_embeddings WHERE speaker_id IN (SELECT id FROM speakers WHERE session_id = ${v})`);
    const [nt] = await sequelize.query("SELECT title FROM notifications WHERE user_id = 1000024 AND created_at >= ? ORDER BY id DESC LIMIT 1", { replacements: [since] });
    ok(g998 === '[(0,)]', 'F 24개월 미사용 프로필 삭제');
    ok(n24 === '[(1,)]' && nt.length === 1, `F 삭제 30일 전 알림 (${nt[0] && nt[0].title})`);
    ok(embBefore !== '[(0,)]' && embAfter === '[(0,)]', `F 끝난 지 7일 지난 회의 화자 임베딩 삭제 (${embBefore}→${embAfter})`);
    await sequelize.query('DELETE FROM notifications WHERE user_id = 1000024 AND created_at >= ?', { replacements: [since] });
    const run2 = execFileSync('/opt/planq/q-note/venv/bin/python', ['-c', 'import asyncio,json;from services.voice_retention import run_once;print(json.dumps(asyncio.run(run_once())))'], { cwd: '/opt/planq/q-note', stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').pop();
    ok(JSON.parse(run2).noticed_users === 0, `F 알림은 한 번만 (${run2})`);
    // G) fail-closed — Node 키가 없으면 후보 = 녹음자만
    const fc = execFileSync('/opt/planq/q-note/venv/bin/python', ['-c', `
import asyncio, os
os.environ['INTERNAL_API_KEY'] = 'wrong-key'
from services.voice_profile import SessionCandidates
from services.database import connect
async def m():
  c = SessionCandidates(5, 5, exclude_recorder=False)
  async with connect() as db: await c.refresh(db, force=True)
  print(sorted(c.people.keys()))
asyncio.run(m())`], { cwd: '/opt/planq/q-note', stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').pop();
    ok(fc === '[5]', `G Node 실패 → 녹음자만 후보 (${fc})`);
  } finally {
    for (const id of made) if (id) await fetch(`${QN}/api/sessions/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
    for (const u of ['1000024', '5', '999999', '999998']) fx('del', u);
  }
  console.log(`\n${pass} pass / ${fail} fail`);
  await sequelize.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
