// scripts/e2e/canary-signature-visibility-floor.js — 서명 문서 공개 범위 바닥 **서버 판정** 실 HTTP 검사 (화면 없음)
//   Irene 2026-10-23: «팀 계약인데 나만이라고 공개가 나오는게 맞아? 서명을 회사이름으로 하면 개인이 마음대로 나만으로 하면 안되는 것 같은데.»
//   Fable 설계 DESIGN-CHANGE — 서명·확인 요청이 살아 있으면(party·kind 불문) L1 금지 · 바닥 L2 · 보낼 때 자동으로 올림 ·
//   보낸 뒤 L1 로 좁히기는 작성자·owner 모두 409 · 요청이 다 취소되면 풀린다. 판정 services/signatureCore.signatureVisibilityFloor 한 곳.
//   ws 6 시험 계정(owner 15 · member1 16 · member2 17 · client 18)에서 돌고 만든 문서를 **스스로 지운다**.
//   양성 대조군: signatureCore.belowSignatureFloor 가 늘 false 를 돌려주게 하면 ②의 409 가 200 으로 뒤집힌다(2026-10-23 실측).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const API = process.env.E2E_API || 'http://127.0.0.1:3003';
const OWNER = 15, M1 = 16, M2 = 17, CL = 18, BIZ = 6, PROJ_OF_M2 = 660;
const tok = (uid) => jwt.sign({ userId: uid, id: uid }, process.env.JWT_SECRET, { expiresIn: '10m' });
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const call = async (uid, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(uid) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
  return { s: r.status, j };
};
const SIGN_BODY = { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: '업무협력 계약 — 공개 범위 바닥 시험' }] },
  { type: 'signatureField', attrs: { slot: 1, party: 'us', label: null } },
  { type: 'signatureField', attrs: { slot: 2, party: 'them', label: null } },
] };

async function run() {
  const results = []; const created = [];
  let section = '';
  const ok = (cond, msg, extra) => { results.push({ name: `sigfloor:${section}${msg}`, fail: cond ? 0 : 1, details: [cond ? 'ok' : (extra !== undefined ? JSON.stringify(extra).slice(0, 300) : 'fail')] }); };
  const console = { log: (m) => { section = String(m).split(' ')[0] + ' '; } };
  const mk = async (uid, extra = {}) => {
    const r = await call(uid, 'POST', '/api/posts', { business_id: BIZ, title: `__T__ sigfloor ${Date.now()}`, content_json: SIGN_BODY, status: 'published', ...extra });
    const id = r.j?.data?.id; if (id) created.push(id); return { id, r };
  };
  const vl = async (id) => (await sql('SELECT vlevel, project_id, target_member_ids FROM posts WHERE id=?', [id]))[0];
  const send = (uid, id, body) => call(uid, 'POST', `/api/posts/${id}/signatures`, { expires_in_days: 7, send_chat: false, ...body });
  try {
    console.log('1. 프로젝트 없는 L1 문서 + 우리 쪽(member2)·받는 쪽 서명 → 보내는 순간 L2 특정 멤버(작성자 ∪ 우리 쪽 서명자)');
    const { id: d1, r: c1 } = await mk(M1, { vlevel: 'L1' });
    ok(!!d1 && (await vl(d1)).vlevel === 'L1', 'member1 L1 문서 생성', c1.j);
    ok((await call(M2, 'GET', `/api/posts/${d1}`)).s !== 200, '대조: 보내기 전 member2 는 못 읽음');
    const s1 = await send(M1, d1, { kind: 'sign', signers: [{ slot: 1, party: 'us', user_id: M2, email: '' }, { slot: 2, party: 'them', email: 'sigfloor-them@example.com', name: '시험 고객' }] });
    ok(s1.s === 200, '서명 요청 200', s1.j);
    ok(s1.j?.data?.visibility_raised?.from === 'L1' && s1.j?.data?.visibility_raised?.to === 'L2' && s1.j?.data?.visibility_raised?.audience === 'members', '응답 visibility_raised L1→L2 members', s1.j?.data?.visibility_raised);
    let v = await vl(d1);
    const tm = (typeof v.target_member_ids === 'string' ? JSON.parse(v.target_member_ids) : v.target_member_ids) || [];
    ok(v.vlevel === 'L2' && v.project_id === null && tm.includes(M1) && tm.includes(M2), `DB vlevel L2 · 명단 ${JSON.stringify(tm)}`, v);
    ok((await call(M2, 'GET', `/api/posts/${d1}`)).s === 200, '우리 쪽 서명자 member2 읽기 200');
    const od = await call(OWNER, 'GET', `/api/posts/${d1}`);
    ok(od.s === 200 && od.j?.data?.signature_visibility_floor === 'L2', 'owner 읽기 200 · 상세 signature_visibility_floor=L2', od.j?.data?.signature_visibility_floor);
    ok((await call(CL, 'GET', `/api/posts/${d1}`)).s !== 200, '고객(관계 없음) 은 여전히 못 읽음');
    const mg = await call(OWNER, 'GET', `/api/signatures/manage/${BIZ}?limit=500`);
    const row = (mg.j?.data || []).find((x) => Number(x.entity_id) === d1);
    ok(!!row && row.hidden !== true && !!row.entity_title, 'owner 서명 관리에서 «비공개 문서» 아님(제목 보임)', row || mg.s);
    const au = await sql("SELECT COUNT(*) n FROM audit_logs WHERE action='post.visibility_change' AND target_id=? AND JSON_EXTRACT(new_value,'$.reason')='signature_floor'", [d1]);
    ok(Number(au[0].n) === 1, '감사 1행(reason signature_floor)', au);

    console.log('2. 보낸 뒤 L1 로 좁히기 — 작성자·owner 모두 409, 두 문 모두');
    for (const [who, uid] of [['작성자', M1], ['owner', OWNER]]) {
      const r = await call(uid, 'PUT', `/api/posts/${d1}/visibility`, { level: 'L1' });
      ok(r.s === 409 && r.j?.code === 'signature_visibility_floor' && r.j?.floor === 'L2', `${who} PUT visibility L1 409`, r);
    }
    ok((await vl(d1)).vlevel === 'L2', '값 불변 L2');
    const up = await call(M1, 'PUT', `/api/posts/${d1}/visibility`, { level: 'L3' });
    ok(up.s === 200 && (await vl(d1)).vlevel === 'L3', '넓히기(L3) 는 200');

    console.log('2b. L2 «특정 멤버» 로 바꾸기 — 서명자는 서버가 명단에 합친다 · 멤버 아닌 id 는 400');
    const lm = await call(M1, 'PUT', `/api/posts/${d1}/visibility`, { level: 'L2', target_member_ids: [OWNER] });
    v = await vl(d1);
    const tm2 = (typeof v.target_member_ids === 'string' ? JSON.parse(v.target_member_ids) : v.target_member_ids) || [];
    ok(lm.s === 200 && v.vlevel === 'L2' && [OWNER, M1, M2].every((x) => tm2.includes(x)), `owner 만 골라도 명단 ${JSON.stringify(tm2)} (작성자·서명자 합침)`, lm.j);
    ok((await call(M1, 'PUT', `/api/posts/${d1}/visibility`, { level: 'L2', target_member_ids: [CL] })).s === 400, '고객 id 는 400(멤버만)');
    ok((await call(M1, 'PUT', `/api/posts/${d1}/visibility`, { level: 'L2' })).s === 400, '명단·프로젝트 없이 L2 는 여전히 400');
    const { id: d6 } = await mk(M1, { vlevel: 'L3' });
    const l6 = await call(M1, 'PUT', `/api/posts/${d6}/visibility`, { level: 'L2', target_member_ids: [M1] });
    ok(l6.s === 200 && (await call(M2, 'GET', `/api/posts/${d6}`)).s !== 200 && (await call(OWNER, 'GET', `/api/posts/${d6}`)).s === 200, '서명 없는 문서 L2 특정 멤버(나) — member2 못 읽음 · owner 읽음', l6.j);

    console.log('3. 확인 요청(confirm)·받는 쪽만 — 같은 바닥');
    const { id: d2 } = await mk(M1, { vlevel: 'L1' });
    const s2 = await send(M1, d2, { kind: 'confirm', signers: [{ email: 'sigfloor-confirm@example.com', name: '확인 고객' }] });
    ok(s2.s === 200 && (await vl(d2)).vlevel === 'L2', 'confirm/them 보내기 → L2', { s: s2.s, j: s2.j?.message, v: await vl(d2) });
    ok((await call(M1, 'PUT', `/api/posts/${d2}/visibility`, { level: 'L1' })).s === 409, 'confirm 문서도 L1 409');
    // 확인 요청은 본문을 잠그지 않는다 — 그래서 PUT 본문 vlevel 문을 여기서 잰다(서명 문서는 잠금 409 가 먼저 막는다)
    const pv = await call(M1, 'PUT', `/api/posts/${d2}`, { vlevel: 'L1' });
    ok(pv.s === 409 && pv.j?.code === 'signature_visibility_floor', '작성자 PUT 본문 vlevel L1 409', pv);
    { const o = await call(OWNER, 'PUT', `/api/posts/${d2}`, { vlevel: 'L1' }); ok([403, 409].includes(o.s) && (await vl(d2)).vlevel === 'L2', `owner PUT 본문 vlevel L1 거절(${o.s} — 편집자가 아니면 403 이 먼저)`, o); }
    ok((await call(M1, 'PUT', `/api/posts/${d2}`, { vlevel: 'L2', title: 'same' })).s === 200, '같은 값 다시 싣는 저장 200');

    console.log('4. 프로젝트 문서 — 소속 그대로 L2(프로젝트)');
    const { id: d3 } = await mk(M2, { vlevel: 'L1', project_id: PROJ_OF_M2 });
    v = await vl(d3);
    ok(v.vlevel === 'L1' && v.project_id === PROJ_OF_M2, '프로젝트 L1 문서 생성', v);
    const s3 = await send(M2, d3, { kind: 'sign', signers: [{ slot: 1, party: 'us', user_id: M2, email: '' }, { slot: 2, party: 'them', email: 'sigfloor-proj@example.com' }] });
    v = await vl(d3);
    ok(s3.s === 200 && s3.j?.data?.visibility_raised?.audience === 'project' && v.vlevel === 'L2' && v.project_id === PROJ_OF_M2, 'L2 project · project_id 유지', { s: s3.s, r: s3.j?.data?.visibility_raised, v });

    console.log('5. 이미 L3 인 문서 — 건드리지 않는다(좁히지 않음)');
    const { id: d4 } = await mk(M1, { vlevel: 'L3' });
    const s4 = await send(M1, d4, { kind: 'sign', signers: [{ slot: 1, party: 'us', user_id: M1, email: '' }, { slot: 2, party: 'them', email: 'sigfloor-l3@example.com' }] });
    ok(s4.s === 200 && s4.j?.data?.visibility_raised == null && (await vl(d4)).vlevel === 'L3', 'L3 그대로 · visibility_raised null', s4.j?.data?.visibility_raised);

    console.log('6. 대조군 — 요청을 전부 취소하면 풀린다 · 요청 없는 문서는 L1 200');
    const reqs = await sql("SELECT id FROM signature_requests WHERE entity_type='post' AND entity_id=?", [d2]);
    for (const r of reqs) {
      const del = await call(M1, 'DELETE', `/api/signatures/${r.id}`);
      ok(del.s === 200, `요청 ${r.id} 취소 200`, del);
    }
    const back = await call(M1, 'PUT', `/api/posts/${d2}/visibility`, { level: 'L1' });
    ok(back.s === 200 && (await vl(d2)).vlevel === 'L1', '취소 뒤 L1 200', back);
    const { id: d5 } = await mk(M1, { vlevel: 'L3' });
    ok((await call(M1, 'PUT', `/api/posts/${d5}/visibility`, { level: 'L1' })).s === 200, '요청 없는 문서 L1 200');
  } catch (e) {
    results.push({ name: 'sigfloor:실행', fail: 1, details: [String(e && e.stack || e).slice(0, 300)] });
  } finally {
    for (const id of created) {
      await sql("DELETE FROM signature_requests WHERE entity_type='post' AND entity_id=?", [id]).catch(() => null);
      await sql('DELETE FROM post_attachments WHERE post_id=?', [id]).catch(() => null);
      await sql('DELETE FROM post_revisions WHERE post_id=?', [id]).catch(() => null);
      await sql('DELETE FROM post_editors WHERE post_id=?', [id]).catch(() => null);
      await sql("DELETE FROM notifications WHERE entity_type='post' AND entity_id=?", [id]).catch(() => null);
      await sql('DELETE FROM posts WHERE id=?', [id]).catch(() => null);
    }
  }
  return results;
}

module.exports = { run };
if (require.main === module) {
  run().then((rs) => {
    for (const r of rs) process.stdout.write(`${r.fail ? '✗' : '✓'} ${r.name}${r.fail ? ' — ' + r.details.join(' ') : ''}\n`);
    const f = rs.filter((r) => r.fail).length;
    process.stdout.write(`\n${rs.length - f}/${rs.length}\n`);
    process.exit(f ? 1 : 0);
  });
}
