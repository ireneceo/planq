// scripts/e2e/canary-doc-coeditors.js — 문서 공동 편집자 **서버 판정** 실 HTTP 검사 (화면 없음)
//   설계 docs/DOC_COEDITORS_DESIGN.md (Fable DESIGN-OK 2026-10-23) §9 — 작성자만 편집이 기본 · owner/admin 예외 없음 ·
//   지정(작성자·오너) · 지정 불가(고객·못 읽음·L1) · 범위 좁힘 → 차단·행 유지·복귀 · 같은 술어 전수(이력 복원·첨부·AI·회차·서명·설문) ·
//   표 행 입력은 범위 밖 · 공동 편집자 금지 행위 · 해제 · 멤버 내보내기 → 행 0 · 알림·감사.
//   ws 6 시험 계정(owner 15 · member1 16 · member2 17 · client 18)에서 돌고 만든 문서·임시 멤버를 **스스로 지운다**.
//   양성 대조군: postAccess.canEditPost 를 옛 규칙(«볼 수 있으면 편집»)으로 되돌리면 ①의 member1 PUT 403 이 200 으로 뒤집힌다(2026-10-23 실측).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const API = process.env.E2E_API || 'http://127.0.0.1:3003';
const OWNER = 15, M1 = 16, M2 = 17, CL = 18, BIZ = 6;
const tok = (uid) => jwt.sign({ userId: uid, id: uid }, process.env.JWT_SECRET, { expiresIn: '10m' });
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const call = async (uid, method, path, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(uid) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
  return { s: r.status, j };
};

async function run() {
  const results = []; const created = [];
  let section = '';
  const ok = (cond, msg, extra) => { results.push({ name: `coeditors:${section}${msg}`, fail: cond ? 0 : 1, details: [cond ? 'ok' : (extra !== undefined ? JSON.stringify(extra).slice(0, 300) : 'fail')] }); };
  const console = { log: (m) => { section = String(m).split(' ')[0] + ' '; } };
  const mk = async (uid, extra = {}) => {
    const r = await call(uid, 'POST', '/api/posts', { business_id: BIZ, title: `__T__ coedit ${Date.now()}`, content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }, ...extra });
    const id = r.j?.data?.id; if (id) created.push(id); return { id, r };
  };
  const put = (uid, id, title) => call(uid, 'PUT', `/api/posts/${id}`, { title });
  const detail = (uid, id) => call(uid, 'GET', `/api/posts/${id}`);
  let recId = null, d4 = null;
  try {
    console.log('1. 새 규칙 — member2 L3 문서: 지정 안 된 member1·owner 는 못 고친다');
    const { id: d1, r: c1 } = await mk(M2, { vlevel: 'L3' });
    ok(!!d1, 'member2 문서 생성', c1.j);
    ok((await put(M1, d1, 'm1 edit')).s === 403, 'member1 PUT 403');
    ok((await put(OWNER, d1, 'owner edit')).s === 403, 'owner PUT 403 (예외 없음)');
    ok((await put(M2, d1, 'author edit')).s === 200, '작성자 PUT 200');
    let d = await detail(M1, d1);
    ok(d.j?.data?.can_edit === false && Array.isArray(d.j?.data?.co_editors) && d.j.data.co_editors.length === 0, 'member1 상세 can_edit=false · co_editors []');
    ok(d.j?.data?.can_manage_editors === false, 'member1 can_manage_editors=false');
    // 옛 규칙 음성 대조군 — 공개 범위 술어는 member1 에게 «읽기 가능» 이다(옛 규칙이면 편집도 됐다)
    ok(d.s === 200, '대조: member1 은 읽기 200 (옛 «볼 수 있으면 편집» 이면 PUT 200 이었다)');

    console.log('1b. owner 가 자기를 지정 → PUT 200 + 작성자 알림 + 감사');
    const since = new Date(Date.now() - 1000);
    let a = await call(OWNER, 'POST', `/api/posts/${d1}/editors`, { user_id: OWNER });
    ok(a.s === 200 && a.j.data.some((x) => x.user_id === OWNER), 'owner 자기 지정 200', a);
    ok((await put(OWNER, d1, 'owner edit2')).s === 200, 'owner PUT 200');
    await new Promise((r) => setTimeout(r, 1500));
    const n1 = await sql("SELECT user_id,title FROM notifications WHERE event_kind='doc_editor' AND entity_id=? AND created_at>=?", [d1, since]);
    ok(n1.some((x) => x.user_id === M2) && !n1.some((x) => x.user_id === OWNER), '작성자(member2)에게 알림 1 · 자기 지정은 자기 알림 없음', n1);
    const au = await sql("SELECT COUNT(*) n FROM audit_logs WHERE action='post.editors_update' AND target_id=? AND created_at>=?", [d1, since]);
    ok(Number(au[0].n) === 1, '감사 1행', au);

    console.log('2. 작성자가 member1 지정 → PUT 200 · 재조회 일치 · editor_id');
    a = await call(M2, 'POST', `/api/posts/${d1}/editors`, { user_id: M1 });
    ok(a.s === 200, '작성자 지정 200', a);
    ok((await call(M1, 'POST', `/api/posts/${d1}/editors`, { user_id: OWNER })).s === 403, '공동 편집자는 지정 못 함 403');
    ok((await put(M1, d1, 'by m1')).s === 200, 'member1 PUT 200');
    d = await detail(M2, d1);
    ok(d.j.data.title === 'by m1' && (d.j.data.editor_id ?? d.j.data.editor?.id) === M1, '재조회 제목·editor 일치', { t: d.j.data.title, e: d.j.data.editor });
    ok(d.j.data.co_editors.length === 2 && d.j.data.can_manage_editors === true, '작성자 상세 공동 편집자 2 · 관리 가능');
    ok(!JSON.stringify(d.j.data.co_editors).includes('@'), 'co_editors 에 이메일 없음');
    const n2 = await sql("SELECT user_id FROM notifications WHERE event_kind='doc_editor' AND entity_id=? AND user_id=?", [d1, M1]);
    ok(n2.length === 1, 'member1 에게 지정 알림 1');
    d = await detail(M1, d1); ok(d.j.data.can_edit === true, 'member1 상세 can_edit=true');

    console.log('3. 지정 불가 대상');
    ok((await call(M2, 'POST', `/api/posts/${d1}/editors`, { user_id: CL })).s === 400, '고객 지정 400');
    const { id: d2 } = await mk(M2, { vlevel: 'L2', project_id: 714 });
    const v2 = await call(M2, 'PUT', `/api/posts/${d2}/visibility`, { level: 'L2', project_id: 714 });
    ok(v2.s === 200, 'L2 프로젝트 714 (member1 비참여)', v2);
    ok((await call(M2, 'POST', `/api/posts/${d2}/editors`, { user_id: M1 })).s === 409, '못 읽는 사람 지정 409');
    const { id: d3 } = await mk(M2, { vlevel: 'L1' });
    await call(M2, 'PUT', `/api/posts/${d3}/visibility`, { level: 'L1' });
    ok((await call(M2, 'POST', `/api/posts/${d3}/editors`, { user_id: M1 })).s === 409, 'L1 문서 지정 409');
    ok((await call(CL, 'POST', `/api/posts/${d1}/editors`, { user_id: M1 })).s !== 200, '고객이 지정 시도 거절');

    console.log('4. 범위 좁힘 → 판정 차단 · 행 유지 · 다시 넓히면 복귀');
    ok((await call(M2, 'PUT', `/api/posts/${d1}/visibility`, { level: 'L2', project_id: 714 })).s === 200, 'd1 → L2 프로젝트 714');
    ok((await put(M1, d1, 'narrow')).s === 403, '범위 밖 member1 PUT 403');
    d = await detail(M2, d1);
    ok(d.j.data.co_editors.find((x) => x.user_id === M1)?.readable === false, 'readable:false');
    ok((await call(M2, 'PUT', `/api/posts/${d1}/visibility`, { level: 'L3', project_id: null })).s === 200, '다시 L3');
    ok((await put(M1, d1, 'wide again')).s === 200, '행 유지 → member1 PUT 200');

    console.log('6. 같은 술어 전수 — 공동 편집자 통과 / 비지정 멤버 403');
    // 이력 복원
    const revs = await call(M2, 'GET', `/api/posts/${d1}/revisions`);
    const rid = (revs.j?.data || [])[0]?.id;
    ok(!!rid, '이력 있음', revs.j);
    if (rid) {
      ok((await call(OWNER === 0 ? 0 : 17 + 1000000, 'POST', `/api/posts/${d1}/revisions/${rid}/restore`)).s >= 400, '(무관 계정 거절)');
    }
    // owner 는 지금 공동 편집자 — 비지정 멤버 대조군은 owner 를 빼고 쓴다
    await call(M2, 'DELETE', `/api/posts/${d1}/editors/${OWNER}`);
    ok((await put(OWNER, d1, 'x')).s === 403, 'owner 해제 뒤 PUT 403');
    if (rid) {
      ok((await call(OWNER, 'POST', `/api/posts/${d1}/revisions/${rid}/restore`)).s === 403, '이력 복원: 비지정 403');
      ok((await call(M1, 'POST', `/api/posts/${d1}/revisions/${rid}/restore`)).s === 200, '이력 복원: 공동 편집자 200');
    }
    // 첨부 추가/삭제
    const [file] = await sql('SELECT id FROM files WHERE business_id=? AND deleted_at IS NULL AND vlevel IN (\'L3\',\'L4\') ORDER BY id DESC LIMIT 1', [BIZ]);
    if (file) {
      ok((await call(OWNER, 'POST', `/api/posts/${d1}/attachments`, { file_ids: [file.id] })).s === 403, '첨부 추가: 비지정 403');
      const at = await call(M1, 'POST', `/api/posts/${d1}/attachments`, { file_ids: [file.id] });
      ok(at.s === 200 || at.s === 201, '첨부 추가: 공동 편집자 200', at);
      const [att] = await sql('SELECT id FROM post_attachments WHERE post_id=? ORDER BY id DESC LIMIT 1', [d1]);
      if (att) {
        ok((await call(OWNER, 'DELETE', `/api/posts/${d1}/attachments/${att.id}`)).s === 403, '첨부 삭제: 비지정 403');
        ok((await call(M1, 'DELETE', `/api/posts/${d1}/attachments/${att.id}`)).s === 200, '첨부 삭제: 공동 편집자 200');
      }
    } else ok(false, 'member1 L3 파일 없음 — 첨부 검사 못 함');
    // AI 앱 update (행동 계층 같은 함수)
    const pa = require('/opt/planq/dev-backend/services/actions/post_actions');
    const aiOwner = await pa.checkEditable({ kind: 'user', userId: OWNER, platformRole: null }, { businessId: BIZ, postId: d1 });
    ok(!aiOwner.ok && aiOwner.code === 'post_edit_forbidden', 'AI 쓰기 판정: 비지정 거절', aiOwner);
    const aiM1 = await pa.checkEditable({ kind: 'user', userId: M1, platformRole: null }, { businessId: BIZ, postId: d1 });
    ok(aiM1.ok, 'AI 쓰기 판정: 공동 편집자 통과', aiM1);
    // 회차 닫기 (요청 없음 → 판정 통과하면 403 아님)
    // 회차 닫기는 편집이 아니라 서명 관리 축(services/signatureList.canManageRows — 요청자 ∨ 편집자 ∨ owner/admin ∧ 읽기, b8f52f57 Fable PASS) — owner 는 통과
    ok((await call(OWNER, 'POST', `/api/posts/${d1}/signatures/close-round`, {})).s !== 403, '회차 닫기: owner(서명 관리) 통과');
    ok((await call(M1, 'POST', `/api/posts/${d1}/signatures/close-round`, {})).s !== 403, '회차 닫기: 공동 편집자 판정 통과');
    // 서명 요청 만들기 — 비지정 403 만(만들면 문서가 잠긴다). 공동 편집자는 별도 문서로.
    ok((await call(OWNER, 'POST', `/api/posts/${d1}/signatures`, { signers: [{ slot: 1, party: 'us', user_id: OWNER }] })).s === 403, '서명 요청: 비지정 403');
    ({ id: d4 } = await mk(M2, { vlevel: 'L3' }));
    await call(M2, 'POST', `/api/posts/${d4}/editors`, { user_id: M1 });
    const sg = await call(M1, 'POST', `/api/posts/${d4}/signatures`, { signers: [{ slot: 1, party: 'us', user_id: M1, name: '이디자' }] });
    ok(sg.s !== 403, '서명 요청: 공동 편집자 판정 통과', sg.s);
    // 설문 관리 — 표 문서
    const rec = await call(M2, 'POST', '/api/records', { business_id: BIZ, name: `__T__ coedit table ${Date.now()}` });
    recId = rec.j?.data?.id; const tablePost = rec.j?.data?.post_id || (await sql('SELECT id FROM posts WHERE q_record_id=?', [recId]))[0]?.id;
    if (tablePost) created.push(tablePost);
    ok(!!recId && !!tablePost, '표 문서 생성', rec.j);
    if (recId) {
      await call(M2, 'PUT', `/api/posts/${tablePost}/visibility`, { level: 'L3' });
      ok((await call(OWNER, 'PUT', `/api/records/${recId}/survey`, { settings: {} })).s === 403, '설문 관리: 비지정 403');
      await call(M2, 'POST', `/api/posts/${tablePost}/editors`, { user_id: M1 });
      ok((await call(M1, 'PUT', `/api/records/${recId}/survey`, { settings: {} })).s === 200, '설문 관리: 공동 편집자 200');
      console.log('8. 표 행 입력은 범위 밖 — 비지정 멤버도 행 추가 200, posts PUT 403');
      const row = await call(OWNER, 'POST', `/api/records/${recId}/rows`, { values: {} });
      ok(row.s === 200 || row.s === 201, '비지정 owner 행 추가 200', row);
      ok((await put(OWNER, tablePost, 'tbl')).s === 403, '같은 사람 posts PUT 403');
    }

    console.log('7. 공동 편집자에게 안 주는 것');
    ok((await call(M1, 'PUT', `/api/posts/${d1}/visibility`, { level: 'L3' })).s === 403, '공개 범위 403');
    ok((await call(M1, 'PUT', `/api/posts/${d1}/security-level`, { level: 'general' })).s === 403, '보안등급 403');
    ok((await call(M1, 'PUT', `/api/posts/${d1}`, { project_id: 35 })).s === 403, '프로젝트 옮기기(PUT) 403');
    for (const lv of ['L4', 'L1']) {
      ok((await call(M1, 'PUT', `/api/posts/${d1}`, { vlevel: lv })).s === 403, `공개 범위(PUT 본문 vlevel ${lv}) 403`);
    }
    ok((await detail(M2, d1)).j?.data?.vlevel === 'L3', '공개 범위 값 불변(L3)');
    ok((await call(M1, 'PUT', `/api/posts/${d1}`, { vlevel: 'L3', title: 'same vlevel ok' })).s === 200, '같은 vlevel 다시 싣는 저장은 200');
    const mv = await pa.movePostToProject({ kind: 'user', userId: M1, platformRole: null }, { businessId: BIZ, postId: d1, projectId: 35 });
    ok(!mv.ok && mv.code === 'post_move_forbidden', '프로젝트 옮기기(AI) 거절', mv);
    ok((await call(M1, 'PUT', `/api/posts/${d1}`, { title: 'same project ok' })).s === 200, '프로젝트 안 바꾸는 저장은 200');
    ok((await call(M1, 'DELETE', `/api/posts/${d1}/editors/${M1}`)).s === 403, '지정 해제 403');
    ok((await call(M1, 'DELETE', `/api/posts/${d1}`)).s === 403, '삭제 403');
    ok((await put(CL, d1, 'client')).s === 403, '고객 PUT 403');

    console.log('5. 해제 → 403 · 멤버 내보내기 → 행 0');
    ok((await call(M2, 'DELETE', `/api/posts/${d1}/editors/${M1}`)).s === 200, '작성자 해제 200');
    ok((await put(M1, d1, 'after remove')).s === 403, '해제 뒤 PUT 403');
    // 임시 멤버 — 만들고 지정하고 내보낸다
    const email = `coedit-tmp-${Date.now()}@test.planq.kr`;
    await sql("INSERT INTO users (email,name,password_hash,status,platform_role,created_at,updated_at) VALUES (?,?,'x','active','user',NOW(),NOW())", [email, '임시편집자']).catch(async () => sql("INSERT INTO users (email,name,password_hash,status,created_at,updated_at) VALUES (?,?,'x','active',NOW(),NOW())", [email, '임시편집자']));
    const [tu] = await sql('SELECT id FROM users WHERE email=?', [email]);
    await sql("INSERT INTO business_members (business_id,user_id,role,joined_at,created_at,updated_at) VALUES (?,?,'member',NOW(),NOW(),NOW())", [BIZ, tu.id]);
    const [bm] = await sql('SELECT id FROM business_members WHERE business_id=? AND user_id=?', [BIZ, tu.id]);
    ok((await call(M2, 'POST', `/api/posts/${d1}/editors`, { user_id: tu.id })).s === 200, '임시 멤버 지정');
    ok((await put(tu.id, d1, 'tmp edit')).s === 200, '임시 멤버 PUT 200');
    const rm = await call(OWNER, 'DELETE', `/api/businesses/${BIZ}/members/${bm.id}`);
    ok(rm.s === 200, '멤버 내보내기 200', rm);
    const left = await sql('SELECT COUNT(*) n FROM post_editors WHERE user_id=?', [tu.id]);
    ok(Number(left[0].n) === 0, 'post_editors 행 0');
    await sql('UPDATE business_members SET removed_at=NULL WHERE id=?', [bm.id]);
    ok((await put(tu.id, d1, 'rejoined')).s === 403, '다시 들어와도 자동 복귀 없음 403');
    await sql('DELETE FROM business_members WHERE id=?', [bm.id]);
    await sql('DELETE FROM users WHERE id=?', [tu.id]).catch(() => null);

  } catch (e) {
    results.push({ name: 'coeditors:run', fail: 1, details: [`🔴 ${e.message}`] });
  } finally {
  // 정리 — 시험 문서 지움(휴지통 아닌 실제 삭제)
    for (const id of created.concat([d4].filter(Boolean))) {
      await sql('DELETE FROM signature_requests WHERE entity_type=\'post\' AND entity_id=?', [id]).catch(() => null);
      await sql('DELETE FROM post_attachments WHERE post_id=?', [id]).catch(() => null);
      await sql('DELETE FROM post_revisions WHERE post_id=?', [id]).catch(() => null);
      await sql('DELETE FROM post_editors WHERE post_id=?', [id]).catch(() => null);
      await sql('DELETE FROM notifications WHERE entity_type=\'post\' AND entity_id=?', [id]).catch(() => null);
      await sql('DELETE FROM posts WHERE id=?', [id]).catch((e) => console.log('cleanup', id, e.message));
    }
    if (recId) { await sql('DELETE FROM q_record_rows WHERE q_record_id=?', [recId]).catch(() => null); await sql('DELETE FROM q_record_audits WHERE q_record_id=?', [recId]).catch(() => null); await sql('DELETE FROM q_records WHERE id=?', [recId]).catch(() => null); }
  }
  return results;
}

module.exports = { run };
