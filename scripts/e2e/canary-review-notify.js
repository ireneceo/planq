// canary-review-notify — 컨펌 요청이 **요청자에게도** 닿는가 (2026-09-07)
//
//   Irene: "내가 보낸 업무가 도로 확인요청 왔을 때는 확인필요도 안나와."
//
//   여태 submitForReview 의 알림은 **컨펌자에게만** 갔다. 요청자는 자기가 시킨 일이
//   결과물까지 온 것을 모르고 지나간다. 확인 필요 목록은 별도로 고쳤고(canary-inbox-count),
//   여기서는 **알림 원장에 행이 생기는가**를 잰다.
//
//   계약 두 줄:
//     ① 요청자 ≠ 컨펌자 → 요청자에게 "컨펌 진행" 1건
//     ② 요청자 == 컨펌자 → **한 건만** 간다("컨펌 요청"). 두 번 울리면 안 된다.
//   ★ 실HTTP 로 담당자가 실제로 제출한다 — 서비스 함수만 부르면 라우트·권한을 안 태운다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');

const API = process.env.E2E_API || 'http://localhost:3003';
const BIZ = 5;
const REQUESTER = 5;            // health-check — 업무를 보낸 사람
const OTHER_REVIEWER = 1000024; // 요청자가 아닌 제3의 컨펌자

async function login(email, password) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j?.data?.token && !j?.data?.accessToken) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 120));
  return j.data.token || j.data.accessToken;
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const taskIds = [];
  let tmpId = null;
  try {
    // 담당자 역할의 임시 계정 — 기존 계정 비밀번호는 절대 바꾸지 않는다(CLAUDE.md 금지사항).
    const cred = { email: `rn-canary-${Date.now()}@test.planq.kr`, password: 'ReviewNotify2026!' };
    const hash = await bcrypt.hash(cred.password, 12);
    const [uid] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, created_at, updated_at)
       VALUES (?, ?, 'Review Notify Canary', ?, 'user', NOW(), NOW())`,
      { replacements: [cred.email, hash, `rncan${Date.now()}`] });
    tmpId = uid;
    await sequelize.query(
      "INSERT INTO business_members (business_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', NOW(), NOW())",
      { replacements: [BIZ, tmpId] });
    const token = await login(cred.email, cred.password);

    const cases = [
      { label: '요청자 ≠ 컨펌자', reviewer: OTHER_REVIEWER, expectAction: '컨펌 진행' },
      { label: '요청자 == 컨펌자', reviewer: REQUESTER, expectAction: '컨펌 요청' },
    ];
    for (const c of cases) {
      const [id] = await sequelize.query(
        `INSERT INTO tasks (business_id, title, created_by, request_by_user_id, assignee_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'in_progress', NOW(), NOW())`,
        { replacements: [BIZ, `review-notify 카나리 ${Date.now()}`, REQUESTER, REQUESTER, tmpId] });
      taskIds.push(id);
      await sequelize.query(
        `INSERT INTO task_reviewers (task_id, user_id, state, added_by_user_id, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, NOW(), NOW())`,
        { replacements: [id, c.reviewer, REQUESTER] });

      const since = new Date(Date.now() - 1000);
      const r = await fetch(`${API}/api/tasks/${id}/submit-review`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
      });
      await new Promise((s) => setTimeout(s, 2500));
      const rows = await sequelize.query(
        'SELECT title FROM notifications WHERE user_id = ? AND created_at >= ? AND link LIKE ?',
        { replacements: [REQUESTER, since, `%${id}%`], type: sequelize.QueryTypes.SELECT });

      push(`${c.label} — 요청자에게 알림이 간다`,
        r.status === 200 && rows.length === 1,
        `submit=${r.status} · 알림 ${rows.length}건 (정확히 1건이어야 — 0 이면 모르고 지나가고, 2 면 두 번 울린다)`);
      push(`${c.label} — 알맞은 말로 온다`,
        rows.length === 1 && String(rows[0].title).includes(c.expectAction),
        `"${rows[0] ? rows[0].title : '(없음)'}" — "${c.expectAction}" 이어야 한다`);
    }
  } catch (e) {
    push('카나리 실행', false, String(e && e.message || e));
  } finally {
    for (const id of taskIds) {
      await sequelize.query('DELETE FROM notifications WHERE link LIKE ?', { replacements: [`%${id}%`] }).catch(() => {});
      for (const t of ['task_reviewers', 'task_status_history', 'task_comments']) {
        await sequelize.query(`DELETE FROM ${t} WHERE task_id = ?`, { replacements: [id] }).catch(() => {});
      }
      await sequelize.query('DELETE FROM tasks WHERE id = ?', { replacements: [id] }).catch(() => {});
    }
    if (tmpId) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [tmpId] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [tmpId] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run };
