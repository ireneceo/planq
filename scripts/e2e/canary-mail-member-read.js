// canary-mail-member-read — 공용 메일 «멤버별 읽음» · «답변 담당 → 업무» (2026-10-22 · docs/MAIL_MEMBER_READ_AND_REPLY_OWNER_DESIGN.md §7)
//
//   Irene: *"그냥 읽음 표시는 누구 기준이야? … 내가 읽은 건지 아닌지 기준이고 읽은 거랑 답변한거 멤버별로 … 답변 담당자 지정 … 업무로 연결해서 자동등록"*
//   실HTTP(포트 3003)로 잰다 — A 가 열어도 B 는 안 읽음 · 「모두 읽음」은 나만 · 새 메일은 모두에게 다시 안 읽음 ·
//   지정 = 업무 1건·알림 1통 · 담당 바꾸기(작성자만, 아니면 403) · 업무 쪽 담당 변경 → 메일 거울 · 남의 답장 = 댓글 ·
//   요청 답변 업무도 담당자 답장 = 완료(자동 컨펌자 없음 · 요청자에게 완료 알림) · 주소 모드 목록도 사람 기준 · 답변 불필요 = 취소 · «내가 답변» 은 답장하면 완료(임시 답변 제외) · 남의 사람 400.
//   ★ dev 전용 — 시험 계정은 dev-login(DEV_LOGIN_SECRET)으로 들어간다. 픽스처 스레드·업무는 끝에 지운다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const crypto = require('crypto');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const BASE = 'http://127.0.0.1:3003';
const BIZ = 6, ACCT = 425;
const U = { owner: 15, member: 16, member2: 17 };

async function run() {
  const results = [];
  if (!process.env.DEV_LOGIN_SECRET) return [{ name: 'mailread', unmeasured: true, details: ['DEV_LOGIN_SECRET 없음 — dev 전용 검사'] }];
  let cur = '';
  const section = (s) => { cur = s; };
  const ok = (c, m) => results.push({ name: `${cur.split(' ')[0]} ${m}`.slice(0, 160), fail: c ? 0 : 1, details: [m] });
  const q = (s, r) => sequelize.query(s, { type: 'SELECT', replacements: r });
  const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function token(as) {
    const p = b64u(JSON.stringify({ as, scope: { ws: BIZ }, next: '/', exp: Date.now() + 60000, n: crypto.randomUUID() }));
    const sig = b64u(crypto.createHmac('sha256', process.env.DEV_LOGIN_SECRET).update(p).digest());
    const r = await fetch(`${BASE}/api/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: `v1.${p}.${sig}` }) });
    const j = await r.json(); if (!j.data) throw new Error('login ' + as); return j.data.token;
  }
  const T = {};
  async function api(as, method, path, body) {
    const r = await fetch(`${BASE}/api/businesses/${BIZ}${path}`, { method, headers: { Authorization: `Bearer ${T[as]}`, 'Content-Type': 'application/json', 'X-Workspace-Id': String(BIZ) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  }
  async function unreadIn(as, tid) {
    const r = await api(as, 'GET', `/email-threads?folder=all&unread=true&limit=200`);
    return (r.j.data || []).some((t) => t.id === tid);
  }
  async function rowFor(as, tid) {
    const r = await api(as, 'GET', `/email-threads?folder=all&limit=200`);
    return (r.j.data || []).find((t) => t.id === tid);
  }
  let tid = null;
  try {
    for (const k of Object.keys(U)) T[k] = await token(k);
    // 픽스처 — [확인용] 받은 메일 1통
    const now = new Date();
    [tid] = await sequelize.query(`INSERT INTO email_threads (business_id, account_id, subject, status, reply_needed, triage, message_count, unread_count, last_message_at, last_message_direction, last_message_preview, vlevel, created_at, updated_at)
      VALUES (${BIZ}, ${ACCT}, '[카나리] 멤버별 읽음 확인', 'open', 1, 'human', 1, 1, NOW(), 'inbound', '견적 부탁드립니다', 'L3', NOW(), NOW())`);
    const [mid] = await sequelize.query(`INSERT INTO email_messages (business_id, thread_id, direction, message_id, from_email, from_name, to_emails, subject, body_text, body_html, is_read, sent_at, delivery_status, created_at, updated_at)
      VALUES (${BIZ}, ${tid}, 'inbound', '<check-${Date.now()}@test.planq.kr>', 'buyer@test.planq.kr', '[확인용] 구매 담당', '[{"email":"check-mail@test.planq.kr"}]', '[카나리] 멤버별 읽음 확인', '견적 부탁드립니다', '<p>견적 부탁드립니다</p>', 0, NOW(), 'delivered', NOW(), NOW())`);
    await sequelize.query(`UPDATE email_threads SET last_inbound_message_id = ${mid} WHERE id = ${tid}`);

    section('① 처음 — 셋 다 안 읽음');
    ok(await unreadIn('owner', tid) && await unreadIn('member', tid) && await unreadIn('member2', tid), '셋 다 unread=true 목록에 있음');
    ok((await rowFor('owner', tid))?.unread_count === 1, '목록 unread_count 1(owner)');

    section('② 오너가 열어 읽음 → 멤버들은 그대로');
    let r = await api('owner', 'GET', `/email-threads/${tid}`);
    ok(r.status === 200 && r.j.data.unread_count === 1, `상세 열기 전 unread 1 (${r.j.data && r.j.data.unread_count})`);
    r = await api('owner', 'POST', `/email-threads/${tid}/mark-read`);
    ok(r.status === 200, 'mark-read 200');
    ok(!(await unreadIn('owner', tid)), '오너 목록에서 읽음');
    ok(await unreadIn('member', tid), '이디자는 여전히 안 읽음');
    ok((await rowFor('member', tid))?.unread_count === 1, '이디자 목록 unread_count 1');
    // 주소 모드 목록(«이 주소와 오간 메일») 도 같은 사람 기준 — Fable C9(옛 공용 칸을 그대로 내던 곳)
    const addr = async (as) => ((await api(as, 'GET', `/email-addresses/${encodeURIComponent('buyer@test.planq.kr')}/threads?limit=200`)).j.data || []).find((t) => t.id === tid);
    ok((await addr('owner'))?.unread_count === 0 && (await addr('member'))?.unread_count === 1, '주소 모드 목록: 오너 0 · 이디자 1');
    r = await api('member', 'GET', `/email-threads/${tid}`);
    const rs = r.j.data.read_status;
    ok(rs && Array.isArray(rs.readers), 'read_status 있음(공용 계정)');
    const me = (id) => rs.readers.find((x) => x.user_id === id);
    ok(me(U.owner)?.read === true && !!me(U.owner)?.read_at, '명단: 김오너 읽음 + 시각');
    ok(me(U.member)?.read === false && me(U.member2)?.read === false, '명단: 이디자·박개발 안 읽음');
    ok(!rs.readers.some((x) => x.user_id === 19), '명단에 Cue(AI) 없음');

    section('③ 이디자 «모두 읽음»(이 스레드) → 박개발은 그대로');
    r = await api('member', 'POST', `/email-threads/bulk-read`, { thread_ids: [tid] });
    ok(r.status === 200 && r.j.data.updated === 1, `bulk-read updated 1 (${JSON.stringify(r.j.data)})`);
    ok(!(await unreadIn('member', tid)) && await unreadIn('member2', tid), '이디자 읽음 · 박개발 안 읽음');
    r = await api('member', 'POST', `/email-threads/bulk-read`, { thread_ids: [tid] });
    ok(r.status === 400, `다시 누르면 할 것 없음(400 no_threads) — ${r.status}`);

    section('④ 새 메일이 오면 다시 안 읽음(모두에게)');
    const [mid2] = await sequelize.query(`INSERT INTO email_messages (business_id, thread_id, direction, message_id, from_email, from_name, to_emails, subject, body_text, is_read, sent_at, delivery_status, created_at, updated_at)
      VALUES (${BIZ}, ${tid}, 'inbound', '<check2-${Date.now()}@test.planq.kr>', 'buyer@test.planq.kr', '[확인용] 구매 담당', '[{"email":"check-mail@test.planq.kr"}]', 'Re: 견적', '추가 질문', 0, DATE_ADD(NOW(), INTERVAL 1 SECOND), 'delivered', NOW(), NOW())`);
    await sequelize.query(`UPDATE email_threads SET last_inbound_message_id = ${mid2} WHERE id = ${tid}`);
    ok(await unreadIn('owner', tid) && await unreadIn('member', tid), '오너·이디자 다시 안 읽음');

    section('⑤ 답변 담당 지정 → 업무 1건');
    const since = new Date(Date.now() - 2000);
    r = await api('owner', 'POST', `/email-threads/${tid}/assign`, { user_id: U.member2 });
    ok(r.status === 200 && r.j.data.task_created === true && r.j.data.task_id, `지정 200 · 업무 생김 (${JSON.stringify(r.j.data)})`);
    const taskId = r.j.data.task_id;
    let [task] = await q(`SELECT * FROM tasks WHERE id = ?`, [taskId]);
    ok(task.assignee_id === U.member2 && task.created_by === U.owner && task.email_thread_id === tid && task.created_via === 'mail_reply', '업무: 담당 박개발 · 작성 김오너 · 메일 연결 · mail_reply');
    ok(String(task.title).startsWith('메일 답변: [카나리] 멤버별 읽음'), `제목 «${task.title}»`);
    ok(!!task.due_date, `마감 ${task.due_date}`);
    ok(task.vlevel === 'L3', '공용 계정 = L3');
    let [th] = await q(`SELECT reply_task_id FROM email_threads WHERE id = ?`, [tid]);
    ok(th.reply_task_id === taskId, 'reply_task_id 박힘');
    let parts = await q(`SELECT user_id, is_assigned FROM email_thread_participants WHERE thread_id = ? AND is_assigned = 1`, [tid]);
    ok(parts.length === 1 && parts[0].user_id === U.member2, '담당 거울 = 박개발 1명');
    await new Promise((s) => setTimeout(s, 1500));
    const notes = await q(`SELECT title, link FROM notifications WHERE user_id = ? AND created_at >= ? AND (link LIKE ? OR link LIKE ?)`, [U.member2, since, `%thread=${tid}%`, `%task=${taskId}%`]);
    ok(notes.length === 1, `박개발 알림 1통 (${notes.map((n) => n.title).join(' | ')})`);
    r = await api('member2', 'GET', `/email-threads/${tid}`);
    ok(r.j.data.reply_task && r.j.data.reply_task.id === taskId && r.j.data.assignee_user_id === U.member2, '상세에 reply_task·담당');

    section('⑥ 담당 바꾸기 — 작성자(오너)는 됨 / 담당자(이디자)는 403');
    r = await api('owner', 'POST', `/email-threads/${tid}/assign`, { user_id: U.member });
    ok(r.status === 200 && r.j.data.task_id === taskId && r.j.data.task_created === false, '오너: 같은 업무 담당 이디자로');
    [task] = await q(`SELECT assignee_id FROM tasks WHERE id = ?`, [taskId]);
    parts = await q(`SELECT user_id FROM email_thread_participants WHERE thread_id = ? AND is_assigned = 1`, [tid]);
    ok(task.assignee_id === U.member && parts.length === 1 && parts[0].user_id === U.member, '업무·거울 둘 다 이디자');
    r = await api('member', 'POST', `/email-threads/${tid}/assign`, { user_id: U.member2 });
    ok(r.status === 403 && /cannot_reassign_task/.test(JSON.stringify(r.j)), `이디자(작성자 아님) 403 cannot_reassign_task — ${r.status}`);

    section('⑦ 업무 쪽에서 담당 바꾸면 메일 거울이 따라온다');
    const tr = await fetch(`${BASE}/api/tasks/by-business/${BIZ}/${taskId}`, { method: 'PUT', headers: { Authorization: `Bearer ${T.owner}`, 'Content-Type': 'application/json', 'X-Workspace-Id': String(BIZ) }, body: JSON.stringify({ assignee_id: U.member2 }) });
    ok(tr.status === 200, `업무 PUT 200 (${tr.status})`);
    parts = await q(`SELECT user_id FROM email_thread_participants WHERE thread_id = ? AND is_assigned = 1`, [tid]);
    ok(parts.length === 1 && parts[0].user_id === U.member2, '메일 담당 거울 = 박개발');

    section('⑧ 담당자 아닌 이디자가 답장 → 업무 그대로 + 댓글');
    r = await api('member', 'POST', `/email-threads/${tid}/messages`, { body_html: '<p>[확인용] 확인 후 답드리겠습니다</p>' });
    ok(r.status === 200, `이디자 답장 200 (${r.status})`);
    [task] = await q(`SELECT status FROM tasks WHERE id = ?`, [taskId]);
    ok(!['completed', 'canceled'].includes(task.status), `업무 열림 유지 (${task.status})`);
    const cm = await q(`SELECT user_id, content, visibility FROM task_comments WHERE task_id = ?`, [taskId]);
    ok(cm.length === 1 && cm[0].user_id === U.member && cm[0].visibility === 'internal', `댓글 1 (${cm.map((c) => c.content).join('|')})`);

    section('⑨ 담당자 박개발이 답장 → 요청 업무도 완료(메일 답변 업무는 자동 컨펌자 없음 — Fable 결정)');
    const rv0 = await q('SELECT COUNT(*) n FROM task_reviewers WHERE task_id = ?', [taskId]);
    ok(Number(rv0[0].n) === 0, '요청 답변 업무에 자동 컨펌자 없음');
    const since9 = new Date(Date.now() - 2000);
    r = await api('member2', 'POST', `/email-threads/${tid}/messages`, { body_html: '<p>[카나리] 견적서 보내드립니다</p>' });
    ok(r.status === 200, '박개발 답장 200');
    [task] = await q('SELECT status, completed_at FROM tasks WHERE id = ?', [taskId]);
    ok(task.status === 'completed' && !!task.completed_at, `답장 → 완료 (${task.status})`);
    await new Promise((s2) => setTimeout(s2, 1200));
    const doneNote = await q('SELECT id FROM notifications WHERE user_id = ? AND created_at >= ? AND link LIKE ?', [U.owner, since9, `%task=${taskId}%`]);
    ok(doneNote.length >= 1, `요청자(오너)에게 완료 알림 (${doneNote.length})`);
    r = await api('owner', 'GET', `/email-threads/${tid}`);
    const repl = r.j.data.read_status.repliers;
    ok(repl.length === 2 && repl[0].user_id === U.member2 && repl[0].after_last_inbound, `답장 명단 최근순 (${JSON.stringify(repl.map((x) => x.name))})`);

    section('⑩ 다시 요청 → 새 업무 · «답변 불필요» → 취소');
    r = await api('owner', 'POST', `/email-threads/${tid}/assign`, { user_id: U.member });
    const t2 = r.j.data.task_id;
    ok(r.status === 200 && r.j.data.task_created && t2 !== taskId, `새 업무 ${t2}`);
    r = await api('owner', 'POST', `/email-threads/${tid}/dismiss-reply`);
    [task] = await q('SELECT status FROM tasks WHERE id = ?', [t2]);
    ok(r.status === 200 && task.status === 'canceled', `취소 (${task.status})`);

    section('⑪ «내가 답변할게요» → 임시 답변은 그대로 · 최종 답장하면 완료');
    r = await api('owner', 'POST', `/email-threads/${tid}/assign`, { user_id: U.owner });
    const t3 = r.j.data.task_id;
    ok(r.status === 200 && r.j.data.task_created && t3 !== t2, `새 업무 ${t3}`);
    r = await api('owner', 'POST', `/email-threads/${tid}/messages`, { body_html: '<p>[카나리] 임시 답변</p>', keep_reply_needed: true });
    [task] = await q('SELECT status FROM tasks WHERE id = ?', [t3]);
    ok(r.status === 200 && !['completed', 'canceled'].includes(task.status), `임시 답변은 완료 안 함 (${task.status})`);
    r = await api('owner', 'POST', `/email-threads/${tid}/messages`, { body_html: '<p>[카나리] 최종 답변</p>' });
    [task] = await q('SELECT status, completed_at FROM tasks WHERE id = ?', [t3]);
    ok(task.status === 'completed' && !!task.completed_at, `답장 → 완료 (${task.status})`);

    section('⑫ 담당 해제 → 거울 비움 · 경계');
    r = await api('owner', 'POST', `/email-threads/${tid}/assign`, { user_id: null });
    parts = await q(`SELECT user_id FROM email_thread_participants WHERE thread_id = ? AND is_assigned = 1`, [tid]);
    ok(r.status === 200 && parts.length === 0, '담당 해제 → 거울 비움');
    r = await api('owner', 'POST', `/email-threads/${tid}/assign`, { user_id: 1 });
    ok(r.status === 400 && /assignee_cannot_see_mail/.test(JSON.stringify(r.j)), `다른 워크스페이스 사람 지정 400 (${r.status})`);
    const cnt = await q(`SELECT COUNT(*) n FROM tasks WHERE email_thread_id = ?`, [tid]);
    ok(Number(cnt[0].n) === 3, `업무는 3건뿐 (${cnt[0].n})`);
    r = await api('member', 'POST', `/email-threads/${tid}/mark-handled`);
    ok(r.status === 200, '확인 완료(닫힌 업무만 있음) 200 — 훅이 메일 동작을 막지 않음');

  } catch (e) {
    results.push({ name: 'mailread 하니스', fail: 1, details: [String(e && e.stack || e).slice(0, 400)] });
  } finally {
    // 픽스처를 지운다 — 남기면 다음 실행·다른 검사의 조건이 바뀐다(memory feedback_canary_pollutes_next_suite)
    if (tid) {
      try {
        const ts = await q('SELECT id FROM tasks WHERE email_thread_id = ?', [tid]);
        const ids = ts.map((t) => t.id);
        if (ids.length) {
          for (const tb of ['task_comments', 'task_status_history', 'task_reviewers']) await sequelize.query(`DELETE FROM ${tb} WHERE task_id IN (:ids)`, { replacements: { ids } }).catch(() => null);
          await sequelize.query(`DELETE FROM notifications WHERE entity_type = 'task' AND entity_id IN (:ids)`, { replacements: { ids } }).catch(() => null);
          // 업무 알림은 entity 칸이 비고 링크만 있다 — 링크로도 지운다(Fable N11: 지워진 업무로 가는 알림이 쌓였다)
          for (const id of ids) await sequelize.query('DELETE FROM notifications WHERE link LIKE :l', { replacements: { l: `%task=${id}` } }).catch(() => null);
          await sequelize.query('DELETE FROM tasks WHERE id IN (:ids)', { replacements: { ids } });
        }
        await sequelize.query(`DELETE FROM notifications WHERE link LIKE :l`, { replacements: { l: `%thread=${tid}%` } }).catch(() => null);
        for (const tb of ['email_thread_participants', 'email_messages']) await sequelize.query(`DELETE FROM ${tb} WHERE thread_id = ?`, { replacements: [tid] });
        await sequelize.query('DELETE FROM email_threads WHERE id = ?', { replacements: [tid] });
      } catch (e) { results.push({ name: 'mailread 픽스처 정리', fail: 1, details: [e.message] }); }
    }
  }
  return results;
}

module.exports = { run };
