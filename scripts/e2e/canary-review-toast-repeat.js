// canary-review-toast-repeat — 컨펌 대기 업무를 **고치기만** 해도 "검토 요청" 토스트가 다시 뜨는가 (2026-10-06)
//
//   Irene: "K-DINE NOODLE - 디자인 진행 / 메뉴판 이 알림이 갑자기 왔어. 담당자가 아무것도 안 했대."
//   운영 실측: 그 시각 서버 알림·푸시는 0건. 담당자가 진행률(100→0)·시간만 고쳤고, 그 task:updated 를 받은
//   컨펌자 화면 토스터가 "지금 상태가 reviewing" 이라는 이유만으로 다시 띄웠다.
//
//   잰다: ① 진짜 전이(in_progress → reviewing)는 토스트가 뜬다 (양성 — 고친 뒤에도 알림이 죽지 않았다)
//         ② reviewing 인 채 진행률만 바꾸면 **새 토스트가 없다** (신고 재현 지점)
//   배우(담당자)는 임시 계정, 보는 사람(컨펌자)은 health-check(id 5).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const b = require('./lib/browser');

const BIZ = 5;
const REVIEWER = 5;
const API = 'http://127.0.0.1:3003';
const TITLE = `토스트 반복 카나리 ${Date.now()}`;

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let taskId = null, tmpId = null, browser = null;
  try {
    const cred = { email: `trt-canary-${Date.now()}@test.planq.kr`, password: 'ToastRepeatCanary2026!' };
    const [ver] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1',
      { type: sequelize.QueryTypes.SELECT }).then((r) => [r]).catch(() => [{}]);
    const [uid] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role,
                          terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
       VALUES (?, ?, 'TRT Canary', ?, 'user', NOW(), ?, NOW(), ?, NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `trt${Date.now()}`,
        (ver && ver.terms_version) || '1.0', (ver && ver.privacy_version) || '1.0'] });
    tmpId = uid;
    await sequelize.query(
      "INSERT INTO business_members (business_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', NOW(), NOW())",
      { replacements: [BIZ, tmpId] });
    const [tid] = await sequelize.query(
      `INSERT INTO tasks (business_id, title, created_by, request_by_user_id, assignee_id, status, progress_percent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'in_progress', 50, NOW(), NOW())`,
      { replacements: [BIZ, TITLE, tmpId, tmpId, tmpId] });
    taskId = tid;

    // 배우 로그인(API)
    const lr = await (await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cred) })).json();
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${lr.data.token}`, 'X-Workspace-Id': String(BIZ) };
    const call = async (method, path, body) => {
      const r = await fetch(`${API}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
      return r.status;
    };
    const st1 = await call('POST', `/api/tasks/${taskId}/reviewers`, { user_id: REVIEWER });

    // 보는 사람(컨펌자) 화면
    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/dashboard');
    await b.sleep(5000);
    const toastCount = () => page.evaluate((title) =>
      [...document.querySelectorAll('[role="alert"]')].filter((el) => (el.textContent || '').includes(title)).length, TITLE);
    const closeToasts = () => page.evaluate((title) => {
      [...document.querySelectorAll('[role="alert"]')].filter((el) => (el.textContent || '').includes(title))
        .forEach((el) => { const x = el.querySelector('button[aria-label]'); if (x) x.click(); });
    }, TITLE);

    // 전이를 보게 한다: in_progress 상태에서 한 번 고친다(화면이 직전 상태를 기억) — 이 자체는 토스트 0 이어야 한다
    const st2 = await call('PUT', `/api/tasks/by-business/${BIZ}/${taskId}`, { progress_percent: 60 });
    await b.sleep(2500);
    const c0 = await toastCount();
    push('진행 중 업무를 고치는 것은 토스트가 아니다', c0 === 0, `PUT ${st2} · 토스트 ${c0}건`);

    // ① 진짜 컨펌 요청
    const st3 = await call('POST', `/api/tasks/${taskId}/submit-review`, {});
    await b.sleep(3500);
    const c1 = await toastCount();
    push('① 진짜 컨펌 요청은 토스트가 뜬다(양성)', c1 >= 1, `reviewers ${st1} · submit-review ${st3} · 토스트 ${c1}건`);
    await closeToasts();
    await b.sleep(800);
    const c1b = await toastCount();

    // ② 상태는 그대로(reviewing) 진행률만 바꾼다 — 신고 재현
    const st4 = await call('PUT', `/api/tasks/by-business/${BIZ}/${taskId}`, { progress_percent: 0 });
    await b.sleep(3500);
    const c2 = await toastCount();
    const [row] = await sequelize.query('SELECT status, progress_percent FROM tasks WHERE id = ?',
      { replacements: [taskId], type: sequelize.QueryTypes.SELECT });
    push('② reviewing 인 채 고치기만 하면 토스트가 다시 뜨지 않는다',
      c2 === 0 && row.status === 'reviewing' && Number(row.progress_percent) === 0,
      `닫은 뒤 ${c1b}건 · PUT ${st4} · 상태 ${row.status}/${row.progress_percent}% · 토스트 ${c2}건`);
  } catch (e) {
    push('실행', false, e.stack || String(e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (taskId) {
      for (const tbl of ['task_reviewers', 'task_status_history', 'notifications']) {
        const col = tbl === 'notifications' ? "entity_type='task' AND entity_id" : 'task_id';
        await sequelize.query(`DELETE FROM ${tbl} WHERE ${col} = ?`, { replacements: [taskId] }).catch(() => {});
      }
      await sequelize.query('DELETE FROM tasks WHERE id = ?', { replacements: [taskId] }).catch(() => {});
    }
    if (tmpId) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [tmpId] }).catch(() => {});
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [tmpId] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [tmpId] }).catch(() => {});
    }
  }
  return results;
}

if (require.main === module) {
  run().then((r) => {
    r.forEach((x) => console.log(x.fail ? 'FAIL' : 'PASS', x.name, '—', x.details.join(' ')));
    process.exit(r.some((x) => x.fail) ? 1 : 0);
  }).finally(() => sequelize.close().catch(() => {}));
}
module.exports = { run };
