// canary-review-entry — 확인 요청(reviewing) 진입은 **어느 문으로 들어와도 같은가** (2026-09-08)
//
//   Irene: *"확인요청 받음 상태인데 왜 수정요청 보내는 란이 안나와?"*
//          *"내가 작성자일 때랑 작성자가 아닐 때랑 왜 달라?"*
//
//   갈린 것은 작성자 여부가 아니라 **문**이었다. 운영 실측으로 나란히 놓으니 분명했다:
//     · task #224 — 담당자가 "확인 요청 보내기"(workflow) → `review_submit` ·
//                   컨펌자 state=pending → 컨펌자에게 정상으로 보였다
//     · task #257 — 담당자가 **상태 드롭다운**(PUT status) → `status_change` 만 남고
//                   컨펌자 state 는 9월 4일의 `revision` 그대로 →
//                   컨펌자에겐 "이미 결정함" 화면(수정요청 칸 없음), 담당자는 reviewing 이라
//                   본문 잠김 = **양쪽 다 아무것도 못 하는 상태**
//
//   고치는 것은 **딱 하나**다 — 지난 라운드의 결정이 새 라운드에 남지 않게 하는 것.
//   ★ "확인 요청 보내기" 버튼이 하는 다른 일(결과물 회차 박제·알림·`review_submit` 이력)은
//     드롭다운 경로에 **끌어오지 않는다.** 신고와 무관하고, 안 하던 일이 갑자기 생기면
//     보고되지 않은 곳에서 새 문제가 난다(회차가 저절로 쌓이는 것 같은).
//     ③이 그 선을 지키는 음성 대조군이다.
//
//   재는 계약:
//     ① 드롭다운(PUT)으로 들어가도 컨펌자 state 가 **pending** 으로 리셋된다
//     ② 지난 라운드 결정이 있었으면 review_round 가 +1 된다
//     ③ 음성 대조군 — 결과물 회차가 **저절로 생기지 않는다** (범위를 넘지 않았다는 증거)
//     ④ 음성 대조군 — 컨펌자가 0명이면 PUT 도 막힌다(400)
//     ⑤ 음성 대조군 — reviewing 이 아닌 전이(in_progress)는 리셋하지 않는다
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');

const API = process.env.E2E_API || 'http://localhost:3003';
const BIZ = 5;

async function run() {
  const results = [];
  const push = (n, ok, m) => results.push({ name: n, fail: ok ? 0 : 1, details: [m] });
  const stamp = Date.now();
  const made = { users: [], tasks: [] };
  try {
    const mkUser = async (tag) => {
      const cred = { email: `rev-${tag}-${stamp}@test.planq.kr`, password: 'ReviewEntry2026!' };
      const [uid] = await sequelize.query(
        `INSERT INTO users (email, password_hash, name, username, platform_role, terms_accepted_at, privacy_accepted_at, created_at, updated_at)
         VALUES (?,?,?,?,'user',NOW(),NOW(),NOW(),NOW())`,
        { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `Rev ${tag}`, `rev${tag}${stamp}`.slice(0, 30)] });
      await sequelize.query("INSERT INTO business_members (business_id,user_id,role,created_at,updated_at) VALUES (?,?,'member',NOW(),NOW())",
        { replacements: [BIZ, uid] });
      made.users.push(uid);
      return { uid, cred };
    };
    const assignee = await mkUser('asg');
    const reviewer = await mkUser('rev');

    const login = async (cred) => {
      const r = await fetch(`${API}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred),
      });
      const j = await r.json();
      return j?.data?.token || j?.data?.accessToken;
    };
    const token = await login(assignee.cred);
    const put = (id, body) => fetch(`${API}/api/tasks/by-business/${BIZ}/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    // 신고와 **같은 모양**의 업무를 만든다: 수정요청 받은 상태 + 컨펌자가 이미 revision 결정
    const mkTask = async (withReviewer) => {
      const [tid] = await sequelize.query(
        `INSERT INTO tasks (business_id,title,created_by,assignee_id,request_by_user_id,status,review_policy,review_round,body,due_date,created_at,updated_at)
         VALUES (?,?,?,?,?, 'revision_requested','all',2,'<p>결과물</p>',CURDATE(),NOW(),NOW())`,
        { replacements: [BIZ, `리뷰진입 카나리 ${stamp}`, reviewer.uid, assignee.uid, reviewer.uid] });
      made.tasks.push(tid);
      if (withReviewer) {
        await sequelize.query(
          "INSERT INTO task_reviewers (task_id,user_id,is_client,state,reverted_once,action_at,added_by_user_id,created_at,updated_at) VALUES (?,?,0,'revision',0,NOW(),?,NOW(),NOW())",
          { replacements: [tid, reviewer.uid, reviewer.uid] });
      }
      return tid;
    };

    const tid = await mkTask(true);
    const res = await put(tid, { status: 'reviewing' });

    const rowOf = async (id) => (await sequelize.query('SELECT status, review_round FROM tasks WHERE id=?',
      { replacements: [id], type: sequelize.QueryTypes.SELECT }))[0];
    const revOf = async (id) => (await sequelize.query('SELECT state, action_at FROM task_reviewers WHERE task_id=?',
      { replacements: [id], type: sequelize.QueryTypes.SELECT }))[0];
    const verCount = async (id) => Number((await sequelize.query(
      'SELECT COUNT(*) c FROM task_deliverable_versions WHERE task_id=?',
      { replacements: [id], type: sequelize.QueryTypes.SELECT }))[0].c);

    const t1 = await rowOf(tid); const r1 = await revOf(tid); const v1 = await verCount(tid);
    push('① 드롭다운(PUT)으로 들어가도 컨펌자가 pending 으로 리셋된다',
      res.status === 200 && r1 && r1.state === 'pending',
      `HTTP ${res.status} · 컨펌자 state=${r1 && r1.state} (pending 이어야 한다 — revision 이면 신고 재현)`);
    push('② 지난 라운드 결정이 있었으므로 review_round 가 +1 된다',
      t1 && Number(t1.review_round) === 3,
      `round=${t1 && t1.review_round} (3 이어야 한다)`);
    push('③ 결과물 회차가 저절로 생기지 않는다 (음성 대조군 — 범위를 넘지 않았다)',
      v1 === 0,
      `회차 ${v1}건 (0 이어야 한다 — 생기면 드롭다운이 제출 버튼 흉내를 낸 것)`);

    // ④ 음성 대조군 — 컨펌자 0명
    const tid2 = await mkTask(false);
    const res2 = await put(tid2, { status: 'reviewing' });
    const t2 = await rowOf(tid2);
    push('④ 컨펌자 0명이면 PUT 도 막힌다 (음성 대조군)',
      res2.status >= 400 && t2.status !== 'reviewing',
      `HTTP ${res2.status} · status=${t2.status}`);

    // ⑤ 음성 대조군 — reviewing 이 아닌 전이는 리셋하지 않는다
    const tid3 = await mkTask(true);
    const res3 = await put(tid3, { status: 'in_progress' });
    const r3 = await revOf(tid3); const t3 = await rowOf(tid3);
    push('⑤ reviewing 이 아닌 전이는 컨펌자를 건드리지 않는다 (음성 대조군)',
      res3.status === 200 && t3.status === 'in_progress' && r3.state === 'revision' && Number(t3.review_round) === 2,
      `HTTP ${res3.status} · status=${t3.status} · state=${r3 && r3.state} · round=${t3.review_round}`);
  } catch (e) {
    push('카나리 실행', false, String((e && e.stack) || e).slice(0, 300));
  } finally {
    for (const tid of made.tasks) {
      for (const tb of ['task_status_history', 'task_reviewers', 'task_deliverable_versions', 'task_comments']) {
        await sequelize.query(`DELETE FROM ${tb} WHERE task_id = ?`, { replacements: [tid] }).catch(() => {});
      }
      await sequelize.query('DELETE FROM tasks WHERE id = ?', { replacements: [tid] }).catch(() => {});
    }
    for (const uid of made.users) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [uid] }).catch(() => {});
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => {});
      await sequelize.query('DELETE FROM notifications WHERE user_id = ?', { replacements: [uid] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run };
