// Fable 검증 게이트 — 업무 자동추출 담당자/업무명 규칙 실증
// 전량 원복: 생성한 conversations/messages/participants/task_candidates/tasks/notifications 삭제,
//            cue_usage rollup 스냅샷 복원. 기존 데이터 무변경.
require('dotenv').config();
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const BASE = 'http://localhost:3003';
const SECRET = process.env.JWT_SECRET;
const tok = (uid) => jwt.sign({ userId: uid }, SECRET, { expiresIn: '15m' });

const created = { convs: [], msgs: [], cands: [], tasks: [], parts: [] };
let db;

async function api(method, path, userId, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Authorization': `Bearer ${tok(userId)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

async function mkConv(title, participantIds) {
  const [r] = await db.query(
    `INSERT INTO conversations (business_id, project_id, title, auto_extract_enabled, created_at, updated_at) VALUES (3, NULL, ?, 0, NOW(), NOW())`, [title]);
  const cid = r.insertId; created.convs.push(cid);
  for (const uid of participantIds) {
    const [p] = await db.query(
      `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at, created_at) VALUES (?, ?, 'member', NOW(), NOW())`, [cid, uid]);
    created.parts.push(p.insertId);
  }
  return cid;
}
async function mkMsg(convId, senderId, content) {
  const [r] = await db.query(
    `INSERT INTO messages (conversation_id, sender_id, content, is_deleted, is_ai, created_at, updated_at) VALUES (?, ?, ?, 0, 0, NOW(), NOW())`, [convId, senderId, content]);
  created.msgs.push(r.insertId);
  return r.insertId;
}
async function mkCand(convId, title, guessedAssignee) {
  const [r] = await db.query(
    `INSERT INTO task_candidates (project_id, conversation_id, extracted_at, extracted_by_user_id, title, guessed_assignee_user_id, status) VALUES (NULL, ?, NOW(), 3, ?, ?, 'pending')`,
    [convId, title, guessedAssignee]);
  created.cands.push(r.insertId);
  return r.insertId;
}

(async () => {
  db = await mysql.createConnection({ host: 'localhost', user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const startedAt = new Date();

  // cue_usage 스냅샷 (business 3, 이번 달)
  const ym = new Date().toISOString().slice(0, 7);
  const [cuBefore] = await db.query("SELECT id, action_count, token_input, token_output, cost_usd FROM cue_usage WHERE business_id=3 AND `year_month`=? AND action_type='task_extraction'", [ym]);
  console.log('SNAPSHOT cue_usage:', JSON.stringify(cuBefore));

  try {
    // ═══ Phase A — 서비스 직접 호출: pool 구성 + 이름 해석 ═══
    console.log('\n═══ Phase A: buildAssigneePool / resolveAssignees (conv 95 = Cue+고객 참여) ═══');
    const ext = require('./services/task_extractor');
    const pool = await ext.buildAssigneePool({ businessId: 3, projectId: 40, conversationId: 95 });
    console.log('A1 pool:', JSON.stringify([...pool.values()].map(v => ({ uid: v.user_id, role: v.role, acct: v.accountName, disp: v.displayName, part: v.isParticipant }))));
    const rA = ext.resolveAssignees([
      { title: 't1', guessed_assignee_name: '박태원' },   // client user 29
      { title: 't2', guessed_assignee_name: 'Cue' },      // AI user 11
      { title: 't3', guessed_assignee_name: '김대리' },   // 존재하지 않음
    ], pool);
    console.log('A2 resolve:', JSON.stringify(rA.map(x => ({ n: x.guessed_assignee_name, uid: x.guessed_assignee_user_id }))));

    // ═══ Phase B — HTTP: register 시 assertAssignable 우회 여부 ═══
    console.log('\n═══ Phase B: register overrides.assignee_id 게이트 검증 ═══');
    const c1 = await mkConv('FABLE-TEST-B 독립대화', [3, 17]);
    const k1 = await mkCand(c1, 'FABLE-B1 타워크스페이스 배정', null);
    const k2 = await mkCand(c1, 'FABLE-B2 외부고객 배정(standalone)', null);
    const k3 = await mkCand(c1, 'FABLE-B3 Cue 배정', null);
    const k4 = await mkCand(c1, 'FABLE-B4 기본 fallback', null);

    // 대조군: 수동 생성 라우트는 게이트가 있는가
    const ctrl = await api('POST', '/api/tasks', 3, { business_id: 3, title: 'FABLE-CTRL 타워크스페이스', assignee_id: 8 });
    console.log('B0 control POST /api/tasks assignee=8(타WS):', ctrl.status, JSON.stringify(ctrl.body?.message || ctrl.body?.data?.id));
    if (ctrl.status === 200 || ctrl.status === 201) created.tasks.push(ctrl.body?.data?.id);

    const b1 = await api('POST', `/api/projects/task-candidates/${k1}/register`, 3, { assignee_id: 8 });
    console.log('B1 register assignee=8(타WS user PQA):', b1.status, 'task.assignee_id=', b1.body?.data?.task?.assignee_id);
    if (b1.body?.data?.task?.id) created.tasks.push(b1.body.data.task.id);

    const b2 = await api('POST', `/api/projects/task-candidates/${k2}/register`, 3, { assignee_id: 27 });
    console.log('B2 register assignee=27(외부고객, standalone conv):', b2.status, 'task.assignee_id=', b2.body?.data?.task?.assignee_id);
    if (b2.body?.data?.task?.id) created.tasks.push(b2.body.data.task.id);

    const b3 = await api('POST', `/api/projects/task-candidates/${k3}/register`, 3, { assignee_id: 11 });
    console.log('B3 register assignee=11(Cue):', b3.status, 'task.assignee_id=', b3.body?.data?.task?.assignee_id);
    if (b3.body?.data?.task?.id) created.tasks.push(b3.body.data.task.id);

    const b4 = await api('POST', `/api/projects/task-candidates/${k4}/register`, 3, {});
    console.log('B4 register body={} (fallback):', b4.status, 'task.assignee_id=', b4.body?.data?.task?.assignee_id, '(등록자=3 이면 작성자 fallback)');
    if (b4.body?.data?.task?.id) created.tasks.push(b4.body.data.task.id);

    // 격리: 타 워크스페이스 사용자 / 고객
    const k5 = await mkCand(c1, 'FABLE-B5 격리', null);
    const iso1 = await api('GET', `/api/projects/conversations/${c1}/task-candidates`, 8);
    const iso2 = await api('POST', `/api/projects/task-candidates/${k5}/register`, 8, {});
    const iso3 = await api('GET', `/api/projects/conversations/${c1}/task-candidates`, 27);
    console.log('B5 격리 — 타WS user8 GET:', iso1.status, '| 타WS user8 register:', iso2.status, '| client27 GET:', iso3.status);
    if (iso2.body?.data?.task?.id) created.tasks.push(iso2.body.data.task.id);

    // ═══ Phase C — 실 LLM: 채팅 추출 (비멤버 이름·스팸·잡담·중복) ═══
    console.log('\n═══ Phase C: 실 LLM 채팅 추출 ═══');
    const c2 = await mkConv('FABLE-TEST-C 추출대화', [3, 17]);
    await mkMsg(c2, 3, '김대리가 견적서 보내주세요');
    await mkMsg(c2, 3, '박개발님이 랜딩페이지 히어로 배너 3종 제작해 주세요');
    await mkMsg(c2, 17, '네 알겠습니다, 진행할게요');
    await mkMsg(c2, 3, '안녕하세요! 좋은 아침이에요 ^^ 오늘 날씨 정말 좋네요');
    await mkMsg(c2, 3, '[광고] 클라우드 호스팅 70% 할인! 지금 바로 가입하세요 https://spam-example.test/promo 놓치면 후회!');
    const cx1 = await api('POST', `/api/projects/conversations/${c2}/task-candidates/extract`, 3);
    const cands1 = cx1.body?.data?.candidates || [];
    for (const cd of cands1) created.cands.push(cd.id);
    console.log('C1 추출 결과:', cx1.status, JSON.stringify(cands1.map(x => ({ id: x.id, title: x.title, assignee: x.guessed_assignee_user_id, role: x.guessed_role, src: x.source_message_ids }))));

    // 중복: 같은 요청 반복 (첫 후보 pending 인 상태)
    await mkMsg(c2, 3, '박개발님 랜딩페이지 히어로 배너 3종 제작 잊지 마세요~ 부탁드립니다');
    await mkMsg(c2, 17, '넵 확인했습니다');
    const cx2 = await api('POST', `/api/projects/conversations/${c2}/task-candidates/extract`, 3);
    const cands2 = cx2.body?.data?.candidates || [];
    for (const cd of cands2) created.cands.push(cd.id);
    console.log('C2 반복요청 재추출:', cx2.status, JSON.stringify(cands2.map(x => ({ id: x.id, title: x.title, assignee: x.guessed_assignee_user_id }))));

    // ═══ Phase D — 실 LLM: 1:1 고객 대화 → 고객이 담당자로? ═══
    console.log('\n═══ Phase D: 1:1 고객(외부인) 대화 추출 ═══');
    const c3 = await mkConv('FABLE-TEST-D 고객대화', [3, 27]);
    await mkMsg(c3, 3, '김수진님, 회사 로고 원본 AI 파일이랑 브랜드 가이드 PDF 보내주세요');
    await mkMsg(c3, 27, '네 알겠습니다. 준비해서 보내드릴게요');
    const dx = await api('POST', `/api/projects/conversations/${c3}/task-candidates/extract`, 3);
    const candsD = dx.body?.data?.candidates || [];
    for (const cd of candsD) created.cands.push(cd.id);
    console.log('D1 추출:', dx.status, JSON.stringify(candsD.map(x => ({ id: x.id, title: x.title, assignee: x.guessed_assignee_user_id }))));
    // 고객이 담당자로 추정된 후보를 그대로 등록 (프론트 기본 흐름: guessed 값 그대로)
    const dCand = candsD.find(x => x.guessed_assignee_user_id === 27);
    if (dCand) {
      const dreg = await api('POST', `/api/projects/task-candidates/${dCand.id}/register`, 3, { assignee_id: dCand.guessed_assignee_user_id });
      console.log('D2 고객담당 그대로 등록:', dreg.status, 'task.assignee_id=', dreg.body?.data?.task?.assignee_id, '(27=외부고객, standalone → 게이트라면 external_requires_project 차단이어야)');
      if (dreg.body?.data?.task?.id) created.tasks.push(dreg.body.data.task.id);
    } else {
      console.log('D2 skip — 고객 담당 추정 후보 없음');
    }

    // ═══ Phase E — 실 LLM: 메일 스레드 (스팸 + standalone 담당자 해석) ═══
    console.log('\n═══ Phase E: 메일 스레드 추출 ═══');
    const eSpam = await ext.extractEmailTaskCandidates({ emailThreadId: 779, userId: 3, businessId: 3 });
    for (const cd of (eSpam.candidates || [])) created.cands.push(cd.id);
    console.log('E1 스팸메일(779 광고) 추출:', JSON.stringify((eSpam.candidates || []).map(x => ({ id: x.id, title: x.title, assignee: x.guessed_assignee_user_id })), null, 0), 'reason=', eSpam.reason);
    const eReal = await ext.extractEmailTaskCandidates({ emailThreadId: 777, userId: 3, businessId: 3 });
    for (const cd of (eReal.candidates || [])) created.cands.push(cd.id);
    console.log('E2 실제메일(777 제안서 피드백, project_id=null) 추출:', JSON.stringify((eReal.candidates || []).map(x => ({ id: x.id, title: x.title, assignee: x.guessed_assignee_user_id, role: x.guessed_role })), null, 0), 'reason=', eReal.reason);

    console.log('\nDONE');
  } catch (e) {
    console.error('TEST ERROR:', e.message, e.stack?.split('\n')[1]);
  } finally {
    // ═══ 원복 ═══
    console.log('\n═══ CLEANUP ═══');
    try {
      if (created.tasks.length) {
        await db.query(`DELETE FROM task_status_history WHERE task_id IN (?)`, [created.tasks]).catch(() => {});
        await db.query(`DELETE FROM notifications WHERE entity_type='task' AND entity_id IN (?)`, [created.tasks]);
        const [dt] = await db.query(`DELETE FROM tasks WHERE id IN (?)`, [created.tasks]);
        console.log('tasks deleted:', dt.affectedRows, created.tasks);
      }
      if (created.cands.length) {
        const [dc] = await db.query(`DELETE FROM task_candidates WHERE id IN (?)`, [created.cands]);
        console.log('candidates deleted:', dc.affectedRows);
      }
      if (created.msgs.length) {
        const [dm] = await db.query(`DELETE FROM messages WHERE id IN (?)`, [created.msgs]);
        console.log('messages deleted:', dm.affectedRows);
      }
      if (created.parts.length) await db.query(`DELETE FROM conversation_participants WHERE id IN (?)`, [created.parts]);
      if (created.convs.length) {
        const [dv] = await db.query(`DELETE FROM conversations WHERE id IN (?)`, [created.convs]);
        console.log('conversations deleted:', dv.affectedRows);
      }
      // 혹시 놓친 FABLE 접두 잔재
      await db.query(`DELETE FROM tasks WHERE title LIKE 'FABLE-%'`);
      await db.query(`DELETE FROM task_candidates WHERE title LIKE 'FABLE-%'`);
      // cue_usage 원복
      const [cuAfter] = await db.query("SELECT id, action_count, token_input, token_output, cost_usd FROM cue_usage WHERE business_id=3 AND `year_month`=? AND action_type='task_extraction'", [ym]);
      if (cuBefore.length === 0 && cuAfter.length > 0) {
        await db.query(`DELETE FROM cue_usage WHERE id=?`, [cuAfter[0].id]);
        console.log('cue_usage row removed (없던 row)');
      } else if (cuBefore.length > 0 && cuAfter.length > 0) {
        await db.query(`UPDATE cue_usage SET action_count=?, token_input=?, token_output=?, cost_usd=? WHERE id=?`,
          [cuBefore[0].action_count, cuBefore[0].token_input, cuBefore[0].token_output, cuBefore[0].cost_usd, cuAfter[0].id]);
        console.log('cue_usage restored to snapshot');
      }
      // 테스트 중 발생한 notifications (수신자 8/27/11, 테스트 시작 이후)
      await db.query(`DELETE FROM notifications WHERE user_id IN (8,27,11) AND created_at >= ? AND title LIKE '%업무%'`, [startedAt]);
      console.log('cleanup complete');
    } catch (ce) { console.error('CLEANUP ERROR:', ce.message); }
    await db.end();
    process.exit(0);
  }
})();
