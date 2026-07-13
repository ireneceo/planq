// Fable 게이트 — 2A 생성 계열 커버리지 갭 검증 (스냅샷이 안 본 것들)
//   G1 confirm+대화 컨텍스트 필드 전달  G2 confirm+메일 컨텍스트  G3 register 명시 null 담당자
//   G4 register 무효 담당자 원자성      G5 외부 tx rollback 시 부수효과 0
//   G6 POST cue 담당 자동 실행          G7 confirm cue 예외(예측 유지+실행)
//   G8 email register 실HTTP+계약       G9 qnote register 실HTTP+계약
//   G10 project room socket             G11 client 역할 (메뉴 게이트 비적용)
//   G12 댓글 알림 수신자·문구           G13 confirm 부분 실패 의미론
//   G14 menu none 멤버의 register 에러 표면
//   전량 원복 (cue_usage 포함).
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { sequelize } = require('./config/database');
const {
  Task, TaskReviewer, TaskComment, TaskCandidate, TaskEstimation, TaskStatusHistory,
  Notification, AuditLog, BusinessMemberPermission,
} = require('./models');
const actions = require('./services/actions/task_actions');
const { io: ioClient } = require('/opt/planq/dev-frontend/node_modules/socket.io-client');

const BASE = 'http://localhost:3003';
const LOG = '/opt/planq/logs/dev-backend-out.log';
const BIZ = 3, OWNER = 3, MEMBER = 17, CUE = 11, OTHER_BIZ = 5, CLIENT_USER = 27;
const CONV = 73, PROJ = 38, THREAD = 3033, THREAD_CLIENT = 10;
const tok = (uid) => jwt.sign({ userId: uid }, process.env.JWT_SECRET, { expiresIn: '15m' });

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const ids = { tasks: [], cands: [], comments: [] };
const api = async (method, path, userId, body) => {
  const r = await fetch(BASE + path, {
    method, headers: { Authorization: `Bearer ${tok(userId)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = require('fs');
const logSince = (offset) => fs.readFileSync(LOG, 'utf-8').slice(offset);
const waitLog = async (offset, re, timeoutMs = 45000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = logSince(offset).match(re);
    if (m) return m[0];
    await sleep(1500);
  }
  return null;
};

(async () => {
  // cue_usage 원복용 스냅샷
  const cueUsageBefore = await sequelize.query(
    'SELECT id, action_count, token_input, token_output, cost_usd FROM cue_usage WHERE business_id = 3', { type: 'SELECT' });

  // socket 채집 — bizSock(business room) / projSock(project room 만)
  const events = [];
  const bizSock = ioClient(BASE, { auth: { token: tok(OWNER) }, transports: ['websocket'] });
  const projSock = ioClient(BASE, { auth: { token: tok(OWNER) }, transports: ['websocket'] });
  await Promise.all([
    new Promise((r) => { bizSock.on('connect', r); setTimeout(r, 3000); }),
    new Promise((r) => { projSock.on('connect', r); setTimeout(r, 3000); }),
  ]);
  bizSock.emit('join:business', BIZ);
  projSock.emit('join:project', PROJ);
  for (const ev of ['task:new', 'inbox:refresh', 'comment:new']) {
    bizSock.on(ev, (p) => events.push({ room: 'biz', ev, id: p?.id || p?.task_id || null }));
    projSock.on(ev, (p) => events.push({ room: 'proj', ev, id: p?.id || p?.task_id || null }));
  }
  await sleep(500);

  let permRow = null;
  try {
    // ═══ G1 — confirm + 대화 컨텍스트: conversation_id 가 task 에 실리는가 ═══
    console.log('\nG1 confirm + context.conversation_id');
    const g1 = await api('POST', '/api/tasks/ai-create/confirm', OWNER, {
      business_id: BIZ, context: { conversation_id: CONV },
      candidates: [{ title: '[fable] 컨텍스트 대화 연결 검증' }],
    });
    check('confirm 200', g1.status === 200, `status=${g1.status}`);
    const g1id = g1.body?.data?.created?.[0]?.id;
    if (g1id) ids.tasks.push(g1id);
    const g1row = g1id ? await Task.findByPk(g1id) : null;
    check('task.conversation_id = ' + CONV, g1row && Number(g1row.conversation_id) === CONV,
      `conversation_id=${g1row?.conversation_id}`);

    // ═══ G2 — confirm + 메일 스레드 컨텍스트: email_thread_id + client_id 상속 ═══
    console.log('\nG2 confirm + context.email_thread_id');
    const g2 = await api('POST', '/api/tasks/ai-create/confirm', OWNER, {
      business_id: BIZ, context: { email_thread_id: THREAD },
      candidates: [{ title: '[fable] 컨텍스트 메일 연결 검증' }],
    });
    const g2id = g2.body?.data?.created?.[0]?.id;
    if (g2id) ids.tasks.push(g2id);
    const g2row = g2id ? await Task.findByPk(g2id) : null;
    check('task.email_thread_id = ' + THREAD, g2row && Number(g2row.email_thread_id) === THREAD,
      `email_thread_id=${g2row?.email_thread_id}`);
    check('task.client_id 상속 = ' + THREAD_CLIENT, g2row && Number(g2row.client_id) === THREAD_CLIENT,
      `client_id=${g2row?.client_id}`);

    // ═══ G3 — register 명시 assignee_id: null (프론트 TaskCandidateCard 가 실제로 보내는 형태) ═══
    console.log('\nG3 register + assignee_id: null (옛 동작: 미배정 업무)');
    const cand3 = await TaskCandidate.create({
      business_id: BIZ, project_id: PROJ, title: '[fable] 미배정 후보', status: 'pending', confidence: 0.9,
    });
    ids.cands.push(cand3.id);
    const g3 = await api('POST', `/api/projects/task-candidates/${cand3.id}/register`, OWNER, { assignee_id: null });
    check('register 200', g3.status === 200, `status=${g3.status}`);
    const g3task = g3.body?.data?.task;
    if (g3task?.id) ids.tasks.push(g3task.id);
    check('옛 동작 보존: assignee_id 는 null 이어야 (미배정)', g3task && g3task.assignee_id === null,
      `assignee_id=${g3task?.assignee_id} (null 이 아니면 등록자 강제 배정 회귀)`);

    // ═══ G4 — register 무효 담당자: 원자성 (candidate pending 유지 + task 0 + 부수효과 0) ═══
    console.log('\nG4 register 무효 담당자 → 원자성');
    const cand4 = await TaskCandidate.create({
      business_id: BIZ, project_id: PROJ, title: '[fable] 원자성 후보', status: 'pending', confidence: 0.9,
    });
    ids.cands.push(cand4.id);
    const evBefore4 = events.filter((e) => e.ev === 'task:new').length;
    const g4 = await api('POST', `/api/projects/task-candidates/${cand4.id}/register`, OWNER, { assignee_id: OTHER_BIZ });
    check('403 cannot_assign', g4.status === 403 && /^cannot_assign:/.test(g4.body?.message || ''),
      `status=${g4.status} msg=${g4.body?.message}`);
    await cand4.reload();
    check('candidate 는 pending 그대로', cand4.status === 'pending', `status=${cand4.status}`);
    const orphan = await Task.count({ where: { from_candidate_id: cand4.id } });
    check('task 0건 (롤백)', orphan === 0, `count=${orphan}`);
    await sleep(1500);
    const audit4 = await AuditLog.count({ where: { action: 'task.create', business_id: BIZ, created_at: { [Op.gte]: new Date(Date.now() - 10000) }, new_value: { [Op.like]: '%원자성%' } } });
    check('감사 로그 0건 (afterCommit 미발화)', audit4 === 0, `count=${audit4}`);
    const evAfter4 = events.filter((e) => e.ev === 'task:new').length;
    check('task:new 미발화', evAfter4 === evBefore4, `before=${evBefore4} after=${evAfter4}`);

    // ═══ G5 — 외부 tx rollback: createTask ok 후 롤백 → 부수효과 0 (서비스 직접 호출) ═══
    console.log('\nG5 외부 트랜잭션 rollback → afterCommit 미발화');
    const t5 = await sequelize.transaction();
    const r5 = await actions.createTask({ kind: 'user', userId: OWNER }, {
      businessId: BIZ, title: '[fable] 롤백될 업무', assigneeId: MEMBER,
    }, { transaction: t5 });
    check('tx 안 createTask ok', r5.ok === true, r5.ok ? '' : `code=${r5.code}`);
    const t5id = r5.ok ? r5.data.task.id : null;
    await t5.rollback();
    await sleep(2000);
    const rolledTask = t5id ? await Task.findByPk(t5id) : null;
    check('task row 없음 (롤백)', !rolledTask);
    const audit5 = t5id ? await AuditLog.count({ where: { target_type: 'task', target_id: t5id } }) : 0;
    const notif5 = t5id ? await Notification.count({ where: { link: { [Op.like]: `%task=${t5id}` } } }) : 0;
    check('감사 0 · 알림 0 (유령 알림 없음)', audit5 === 0 && notif5 === 0, `audit=${audit5} notif=${notif5}`);

    // ═══ G6 — POST /tasks 담당=Cue → executeForTask 자동 실행 ═══
    console.log('\nG6 POST /tasks 담당=Cue → 자동 실행 트리거');
    let logOffset = fs.statSync(LOG).size;
    const g6 = await api('POST', '/api/tasks', OWNER, {
      business_id: BIZ, title: '[fable] Cue 자동 실행 검증 요약 작성', assignee_id: CUE,
    });
    check('생성 200', g6.status === 200, `status=${g6.status}`);
    const g6id = g6.body?.data?.id;
    if (g6id) ids.tasks.push(g6id);
    const line6 = await waitLog(logOffset, new RegExp(`\\[cue_task_executor\\] ${g6id} `));
    check('executeForTask 트리거 발화 (로그)', !!line6, line6 || '45초 내 로그 없음');

    // ═══ G7 — confirm 담당=Cue: §5.7 예외 (예측 유지) + estimation row + 실행 트리거 ═══
    console.log('\nG7 confirm 담당=Cue → 예측 유지 + 실행');
    logOffset = fs.statSync(LOG).size;
    const g7 = await api('POST', '/api/tasks/ai-create/confirm', OWNER, {
      business_id: BIZ,
      candidates: [{ title: '[fable] Cue 요약 정리', assignee_user_id: CUE, estimated_hours: 4 }],
    });
    check('confirm 200', g7.status === 200, `status=${g7.status}`);
    const g7task = g7.body?.data?.created?.[0];
    if (g7task?.id) ids.tasks.push(g7task.id);
    check('estimated_hours 유지 (Cue 예외)', g7task && Number(g7task.estimated_hours) === 4,
      `estimated=${g7task?.estimated_hours}`);
    const est7 = g7task ? await TaskEstimation.findAll({ where: { task_id: g7task.id } }) : [];
    check('TaskEstimation row (source=ai, model=gpt-4o-mini)',
      est7.length === 1 && est7[0].source === 'ai' && est7[0].model === 'gpt-4o-mini',
      `rows=${est7.length} src=${est7[0]?.source} model=${est7[0]?.model}`);
    const line7 = await waitLog(logOffset, new RegExp(`\\[cue_task_executor\\] ${g7task?.id} `));
    check('confirm 경로도 실행 트리거 발화', !!line7, line7 || '45초 내 로그 없음');

    // ═══ G8 — email register 실HTTP (caller + 에러 계약) ═══
    console.log('\nG8 email_threads register (실HTTP)');
    const cand8 = await TaskCandidate.create({
      business_id: BIZ, email_thread_id: THREAD, title: '[fable] 메일 후보', status: 'pending', confidence: 0.9,
    });
    ids.cands.push(cand8.id);
    const evBefore8 = events.filter((e) => e.ev === 'task:new').length;
    const g8 = await api('POST', `/api/businesses/${BIZ}/email-threads/${THREAD}/task-candidates/${cand8.id}/register`, OWNER, { assignee_id: MEMBER });
    check('201 registered', g8.status === 201, `status=${g8.status}`);
    const g8task = g8.body?.data?.task;
    if (g8task?.id) ids.tasks.push(g8task.id);
    check('email_thread_id·client_id·source 정합',
      g8task && Number(g8task.email_thread_id) === THREAD && Number(g8task.client_id) === THREAD_CLIENT && g8task.source === 'internal_request',
      `thread=${g8task?.email_thread_id} client=${g8task?.client_id} source=${g8task?.source}`);
    await sleep(1500);
    const evAfter8 = events.filter((e) => e.ev === 'task:new' && e.room === 'biz' && e.id === g8task?.id).length;
    check('task:new 정확히 1회 (중복 emit 없음)', evAfter8 === 1, `count=${evAfter8}`);
    const notif8 = g8task ? await Notification.count({ where: { link: { [Op.like]: `%task=${g8task.id}` } } }) : 0;
    check('담당자 알림 정확히 1건', notif8 === 1, `count=${notif8}`);
    // 에러 계약 — cannot_assign 403
    const cand8b = await TaskCandidate.create({
      business_id: BIZ, email_thread_id: THREAD, title: '[fable] 메일 후보 무효담당', status: 'pending', confidence: 0.9,
    });
    ids.cands.push(cand8b.id);
    const g8b = await api('POST', `/api/businesses/${BIZ}/email-threads/${THREAD}/task-candidates/${cand8b.id}/register`, OWNER, { assignee_id: OTHER_BIZ });
    check('무효 담당 → 403 cannot_assign (계약 유지)', g8b.status === 403 && /^cannot_assign:/.test(g8b.body?.message || ''),
      `status=${g8b.status} msg=${g8b.body?.message}`);

    // ═══ G9 — qnote register 실HTTP + Cue 강등 ═══
    console.log('\nG9 qnote_bridge register (실HTTP) + Cue 담당 강등');
    const cand9 = await TaskCandidate.create({
      business_id: BIZ, qnote_session_id: 999999, title: '[fable] 큐노트 후보', status: 'pending', confidence: 0.9,
    });
    ids.cands.push(cand9.id);
    const g9 = await api('POST', `/api/businesses/${BIZ}/qnote-sessions/999999/task-candidates/${cand9.id}/register`, OWNER, { assignee_id: CUE });
    check('201 registered', g9.status === 201, `status=${g9.status}`);
    const g9task = g9.body?.data?.task;
    if (g9task?.id) ids.tasks.push(g9task.id);
    check('qnote_session_id 실림', g9task && Number(g9task.qnote_session_id) === 999999, `sid=${g9task?.qnote_session_id}`);
    check('Cue 담당 강등 → 등록자(사람)', g9task && Number(g9task.assignee_id) === OWNER,
      `assignee=${g9task?.assignee_id} (Cue=${CUE} 그대로면 좀비 업무 회귀)`);

    // ═══ G10 — project room socket ═══
    console.log('\nG10 project room 도 task:new 를 받는가');
    const g10 = await api('POST', '/api/tasks', OWNER, {
      business_id: BIZ, project_id: PROJ, title: '[fable] 프로젝트 룸 검증',
    });
    const g10id = g10.body?.data?.id;
    if (g10id) ids.tasks.push(g10id);
    await sleep(1500);
    const projGot = events.filter((e) => e.room === 'proj' && e.ev === 'task:new' && e.id === g10id).length;
    check('project room task:new 수신', projGot >= 1, `count=${projGot}`);

    // ═══ G11 — Client 역할: 메뉴 게이트 비적용 + 요청만 가능 ═══
    console.log('\nG11 Client 역할');
    const g11a = await api('POST', '/api/tasks', CLIENT_USER, {
      business_id: BIZ, title: '[fable] 고객 요청 업무', assignee_id: MEMBER,
    });
    check('고객 → 멤버 요청 200 (메뉴 게이트에 안 걸림)', g11a.status === 200, `status=${g11a.status} msg=${g11a.body?.message}`);
    const g11id = g11a.body?.data?.id;
    if (g11id) ids.tasks.push(g11id);
    if (g11id) {
      const rev = await TaskReviewer.findOne({ where: { task_id: g11id, user_id: CLIENT_USER } });
      check('자동 컨펌자 is_client=true (경로별 차이 보존)', !!rev && !!rev.is_client, `is_client=${rev?.is_client}`);
      const notif11 = await Notification.count({ where: { link: { [Op.like]: `%task=${g11id}` } } });
      check('담당자 알림 정확히 1건 (이중 발화 없음)', notif11 === 1, `count=${notif11}`);
    }
    const g11b = await api('POST', '/api/tasks', CLIENT_USER, { business_id: BIZ, title: '[fable] 고객 셀프' });
    check('고객 자기배정 → 403 (문구 계약)', g11b.status === 403 && /Clients can only request/.test(g11b.body?.message || ''),
      `status=${g11b.status} msg=${g11b.body?.message}`);

    // ═══ G12 — 댓글 알림 수신자·문구 ═══
    console.log('\nG12 댓글 알림 (요청 업무: member 가 달면 owner 가 받는다)');
    // g8task: owner 가 member 에게 요청한 업무 — member 가 댓글
    const before12 = await Notification.count({ where: { user_id: OWNER, link: { [Op.like]: `%task=${g8task.id}` } } });
    const g12 = await api('POST', `/api/tasks/${g8task.id}/comments`, MEMBER, { content: '[fable] 진행 공유합니다' });
    check('댓글 200', g12.status === 200, `status=${g12.status}`);
    if (g12.body?.data?.id) ids.comments.push(g12.body.data.id);
    await sleep(1500);
    const notif12 = await Notification.findAll({
      where: { user_id: OWNER, link: { [Op.like]: `%task=${g8task.id}` }, created_at: { [Op.gte]: new Date(Date.now() - 8000) } },
      order: [['id', 'DESC']],
    });
    check('요청자(owner)에게 댓글 알림 도착', notif12.length - 0 >= 1 && notif12.length > before12 - before12, `rows=${notif12.length}`);
    check('문구 계약 "님이 업무 댓글을 남김"', notif12[0] && /님이 업무 댓글을 남김/.test(notif12[0].title || ''),
      `title=${notif12[0]?.title}`);

    // ═══ G13 — confirm 부분 실패 의미론 ═══
    console.log('\nG13 confirm 부분 실패 (중간 403 → 이미 만든 것은 남는다)');
    const g13 = await api('POST', '/api/tasks/ai-create/confirm', OWNER, {
      business_id: BIZ,
      candidates: [
        { title: '[fable] 부분실패 첫번째 (유효)' },
        { title: '[fable] 부분실패 두번째 (무효담당)', assignee_user_id: OTHER_BIZ },
      ],
    });
    check('403 assignee_not_assignable', g13.status === 403 && /^assignee_not_assignable:/.test(g13.body?.message || ''),
      `status=${g13.status} msg=${g13.body?.message}`);
    const g13first = await Task.findOne({ where: { business_id: BIZ, title: '[fable] 부분실패 첫번째 (유효)' } });
    check('첫 번째 task 는 남는다 (옛 의미론 보존)', !!g13first, g13first ? `id=${g13first.id}` : '없음');
    if (g13first) ids.tasks.push(g13first.id);

    // ═══ G14 — qtask=none 멤버의 register 에러 표면 ═══
    console.log('\nG14 qtask=none 멤버 register (에러 표면 확인)');
    permRow = await BusinessMemberPermission.create({ business_id: BIZ, user_id: MEMBER, menu_key: 'qtask', level: 'none' });
    const cand14 = await TaskCandidate.create({
      business_id: BIZ, project_id: PROJ, title: '[fable] 메뉴차단 후보', status: 'pending', confidence: 0.9,
    });
    ids.cands.push(cand14.id);
    const g14 = await api('POST', `/api/projects/task-candidates/${cand14.id}/register`, MEMBER, {});
    console.log(`  INFO  register by qtask=none member → status=${g14.status} msg=${g14.body?.message || '(none)'}`);
    check('업무는 안 만들어졌다 (게이트 작동)', (await Task.count({ where: { from_candidate_id: cand14.id } })) === 0);
    await cand14.reload();
    check('candidate pending 유지', cand14.status === 'pending', `status=${cand14.status}`);
    if (g14.status >= 500) console.log('  WARN  차단은 되지만 500 — cannot_assign 처럼 403 매핑이 없다 (에러 표면)');
    await permRow.destroy(); permRow = null;

  } catch (e) {
    fail++; console.error('예외:', e.message, e.stack?.split('\n').slice(1, 3).join(' '));
  } finally {
    console.log('\n── 원복 ──');
    // Cue 실행이 아직 돌고 있으면 잠시 대기 (mid-run 삭제로 인한 크래시 로그 방지)
    await sleep(3000);
    if (permRow) await permRow.destroy();
    const tids = ids.tasks.length ? ids.tasks : [0];
    await TaskComment.destroy({ where: { task_id: tids } });
    await TaskReviewer.destroy({ where: { task_id: tids } });
    await TaskEstimation.destroy({ where: { task_id: tids } });
    await TaskStatusHistory.destroy({ where: { task_id: tids } });
    for (const id of ids.tasks) {
      await Notification.destroy({ where: { link: { [Op.like]: `%task=${id}` } } });
    }
    await AuditLog.destroy({ where: { target_type: 'task', target_id: tids } });
    await Task.destroy({ where: { id: tids } });
    await TaskCandidate.destroy({ where: { id: ids.cands.length ? ids.cands : [0] } });
    // cue_usage 원복 (실행 트리거 검증으로 오른 만큼 되돌린다)
    for (const row of cueUsageBefore) {
      await sequelize.query(
        'UPDATE cue_usage SET action_count=?, token_input=?, token_output=?, cost_usd=? WHERE id=?',
        { replacements: [row.action_count, row.token_input, row.token_output, row.cost_usd, row.id] });
    }
    await sequelize.query('DELETE FROM cue_usage WHERE business_id=3 AND id NOT IN (' + (cueUsageBefore.map(r => r.id).join(',') || '0') + ')');
    const leftT = await Task.count({ where: { id: tids } });
    const leftC = await TaskCandidate.count({ where: { id: ids.cands.length ? ids.cands : [0] } });
    const leftP = await BusinessMemberPermission.count({ where: { business_id: BIZ, user_id: MEMBER, menu_key: 'qtask' } });
    console.log(`남은 task ${leftT} · candidate ${leftC} · perm ${leftP} (모두 0이어야 한다)`);
    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    bizSock.close(); projSock.close();
    await sequelize.close();
    process.exit(0);
  }
})();
