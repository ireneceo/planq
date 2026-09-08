// canary-deliverable-version — 결과물을 **댓글이 아니라 회차로** 남길 수 있는가 (2026-09-07)
//
//   Irene: "업무상세 결과물에 새버전 결과 추가버튼 만들어달라고.
//           자꾸 직원이 댓글에 달잖아. 결과물을 추가해서 계속 남기는 걸 알기 쉽게 해달라니까."
//
//   여태 버전이 생기는 문은 "확인 요청 보내기" 하나뿐이었다. 중간 결과를 남길 자리가 없어
//   담당자가 댓글에 결과물을 붙였다. 여기서는 **화면에 그 버튼이 있고, 눌러서 실제로 회차가
//   남고, 입력란이 비워지는지**를 잰다 — 서버만 되고 화면에 안 붙으면 고친 게 아니다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const b = require('./lib/browser');

const BIZ = 5;
const REQUESTER = 5;

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let taskId = null, tmpId = null, browser = null;
  try {
    const cred = { email: `dv-canary-${Date.now()}@test.planq.kr`, password: 'DeliverVerCanary2026!' };
    // ★ 약관 동의를 같이 심는다. 새 계정은 로그인하면 **약관 재동의 모달**이 전면을 덮어
    //   그 아래 버튼이 눌리지 않는다(2026-09-07 실측: z-index 300 백드롭이 elementFromPoint 를 가져갔다).
    //   제품이 옳게 동작하는 것이므로 화면을 고치는 게 아니라 **시드를 현실에 맞춘다.**
    const [ver] = await sequelize.query('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1',
      { type: sequelize.QueryTypes.SELECT }).then((r) => [r]).catch(() => [{}]);
    const tv = (ver && ver.terms_version) || '1.0';
    const pv = (ver && ver.privacy_version) || '1.0';
    const [uid] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role,
                          terms_accepted_at, terms_version, privacy_accepted_at, privacy_version,
                          created_at, updated_at)
       VALUES (?, ?, 'DV Canary', ?, 'user', NOW(), ?, NOW(), ?, NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `dvc${Date.now()}`, tv, pv] });
    tmpId = uid;
    await sequelize.query(
      "INSERT INTO business_members (business_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'member', NOW(), NOW())",
      { replacements: [BIZ, tmpId] });
    const [tid] = await sequelize.query(
      `INSERT INTO tasks (business_id, title, body, created_by, request_by_user_id, assignee_id, status, created_at, updated_at)
       VALUES (?, '결과물 회차 카나리', '<p>1차 결과 내용</p>', ?, ?, ?, 'in_progress', NOW(), NOW())`,
      { replacements: [BIZ, REQUESTER, REQUESTER, tmpId] });
    taskId = tid;

    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page, cred);
    await b.goto(page, `/tasks?task=${taskId}`);
    await b.sleep(4000);

    // ① 버튼이 화면에 **보이는가** — 크기만이 아니라 그 좌표에서 실제로 잡히는지까지
    //   ★ 드로어는 스크롤된다. 화면 밖이면 elementFromPoint 가 null 이라 "안 보임" 으로 나온다 —
    //     그건 가려진 것이 아니라 **아직 안 스크롤한 것**이다. 먼저 시야로 옮기고 잰다.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="task-body-new-version"]');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await b.sleep(600);
    const seen = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="task-body-new-version"]');
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      return {
        found: true, text: (el.textContent || '').trim(),
        w: Math.round(r.width), h: Math.round(r.height),
        disabled: el.disabled === true,
        visible: r.width > 0 && r.height > 0 && !!hit && (el === hit || el.contains(hit) || hit.contains(el)),
      };
    });
    push('결과물에 회차 남기기 버튼이 있다',
      seen.found && seen.visible && !seen.disabled,
      seen.found ? `"${seen.text}" ${seen.w}×${seen.h} 보임=${seen.visible} 잠김=${seen.disabled}` : '버튼이 없다 (신고 원인)');

    const before = await sequelize.query('SELECT COUNT(*) c FROM task_deliverable_versions WHERE task_id = ?',
      { replacements: [taskId], type: sequelize.QueryTypes.SELECT });

    // ② 눌러서 실제로 회차가 남는가
    //   ★ 2026-09-08 — 응답 상태를 **같이** 잰다. 여태 부수효과(행 생성·입력란 비움)만 재서
    //     `ReferenceError: createAuditLog is not defined` 로 **500** 이 나는데도 초록이었다:
    //     그 예외는 트랜잭션 **커밋 뒤**에 터져 행은 이미 남고 화면만 "남기지 못했습니다" 였다.
    //     Irene 신고 원문이 정확히 그 문구다. 성공 경로를 안 태우면 검사는 거짓말을 한다
    //     (memory: feedback_code_move_needs_success_path · feedback_guard_must_be_falsified).
    const posts = [];
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && /\/deliverable-versions$/.test(r.url())) posts.push(r.status());
    });
    if (seen.found && seen.visible && !seen.disabled) {
      await page.click('[data-testid="task-body-new-version"]');
      await b.sleep(3500);
    }
    push('POST 응답이 2xx 다 (부수효과만 보면 500 을 놓친다)',
      posts.length === 1 && posts[0] >= 200 && posts[0] < 300,
      `응답 ${JSON.stringify(posts)} — 기대 [201]`);
    const onScreenErr = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const hit = ['회차로 남기지 못했습니다', 'Could not save', '남기지 못했'].find((m) => txt.includes(m));
      return hit || null;
    });
    push('화면에 실패 문구가 뜨지 않는다', !onScreenErr, onScreenErr ? `문구: "${onScreenErr}"` : '없음');
    const after = await sequelize.query(
      'SELECT round, body FROM task_deliverable_versions WHERE task_id = ? ORDER BY round DESC',
      { replacements: [taskId], type: sequelize.QueryTypes.SELECT });
    push('누르면 회차가 남는다',
      after.length === Number(before[0].c) + 1 && String(after[0] && after[0].body).includes('1차 결과 내용'),
      `${before[0].c}건 → ${after.length}건 · v${after[0] && after[0].round} 본문 보존=${String(after[0] && after[0].body).includes('1차 결과 내용')}`);

    // ③ 입력란이 비워졌는가 — 남겼는데 그대로면 같은 내용을 두 번 남기게 된다
    const t2 = await sequelize.query('SELECT body FROM tasks WHERE id = ?',
      { replacements: [taskId], type: sequelize.QueryTypes.SELECT });
    const left = String(t2[0] && t2[0].body || '').replace(/<[^>]*>/g, '').trim();
    push('남긴 뒤 입력란이 비워진다', left === '', `남은 글자 "${left.slice(0, 30)}"`);

    // ④ 이력 목록에 그 회차가 보이는가 (서버만 되고 화면에 안 붙으면 고친 게 아니다)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await b.sleep(4000);
    const inHistory = await page.evaluate(() => (document.body.innerText || '').includes('v1'));
    push('이력에 회차가 보인다', inHistory, inHistory ? '화면에서 v1 확인' : '화면에서 못 찾음');
  } catch (e) {
    push('카나리 실행', false, String(e && e.message || e));
  } finally {
    try { if (browser) await browser.close(); } catch { /* noop */ }
    if (taskId) {
      for (const tb of ['task_deliverable_versions', 'task_status_history', 'task_comments', 'task_reviewers']) {
        await sequelize.query(`DELETE FROM ${tb} WHERE task_id = ?`, { replacements: [taskId] }).catch(() => {});
      }
      await sequelize.query('DELETE FROM tasks WHERE id = ?', { replacements: [taskId] }).catch(() => {});
    }
    if (tmpId) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [tmpId] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [tmpId] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run };
