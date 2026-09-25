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

    // ④-b **히스토리 시각이 빈칸이 아니다** (2026-09-25, Fable 이 찾은 기존 결함)
    //   `GET /workflow` 는 `history[].created_at` 을 주는데 화면은 `createdAt` 을 읽어
    //   **2026-04-25 부터 5개월간 시각이 빈칸**이었다. 아무도 신고하지 않았다 —
    //   빈칸은 «고장» 으로 보이지 않기 때문이다. 그래서 기계가 센다.
    //   ★ 손잡이는 `data-testid="task-history-time"` 다. **휴리스틱 selector 를 쓰지 않는다** —
    //     `[class*="TimelineItem"]` 으로 찾았더니 빌드된 styled-components 의 해시 클래스에는
    //     컴포넌트 이름이 없어 **0건**이 나왔다(미측정으로 떨어졌다).
    //   ★ 이력 행을 **먼저 심는다.** 카나리 업무는 SQL INSERT 로 만들어 status 전이가 없어
    //     행이 0건이고, 그러면 `every()` 가 빈 배열에 true 를 돌려 **거짓 통과**한다
    //     (memory feedback_empty_fixture_false_verdict).
    await sequelize.query(
      // ★ 이 표에는 `updated_at` 이 없다(이력은 고쳐지지 않는다) — 넣으면 Unknown column 이다
      `INSERT INTO task_status_history (task_id, event_type, from_status, to_status, actor_user_id, created_at)
       VALUES (?, 'status_change', 'not_started', 'in_progress', ?, DATE_SUB(NOW(), INTERVAL 4 HOUR)),
              (?, 'status_change', 'in_progress', 'reviewing',   ?, DATE_SUB(NOW(), INTERVAL 1 HOUR))`,
      { replacements: [taskId, tmpId, taskId, tmpId] });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await b.sleep(4000);
    // ★ 히스토리 섹션은 **기본이 접힘**이다 — 펼치지 않으면 손잡이가 0건이라 «미측정» 으로 떨어진다
    const opened = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="task-history-toggle"]');
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    });
    push('히스토리 섹션을 펼칠 수 있다', opened, opened ? '손잡이 클릭' : '손잡이가 없다');
    await b.sleep(1200);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="task-history-time"]');
      if (el) el.scrollIntoView({ block: 'center' });
    });
    await b.sleep(500);
    const histTimes = await page.evaluate(() => Array.from(
      document.querySelectorAll('[data-testid="task-history-time"]'),
    ).map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height) };
    }));
    // 심은 행이 2건이므로 **2건 이상**이어야 실제로 잰 것이다 (0건 = 미측정, 초록으로 세지 않는다)
    push('히스토리 시각이 빈칸이 아니다 (5개월 묵은 결함)',
      histTimes.length >= 2 && histTimes.every((r) => /^\d\d-\d\d \d\d:\d\d$/.test(r.text) && r.w > 0 && r.h > 0),
      histTimes.length === 0
        ? '⬜ 손잡이 0건 — 미측정 (히스토리 섹션이 안 그려졌다)'
        : `행 ${histTimes.length}건 · ${histTimes.map((r) => `${JSON.stringify(r.text)} ${r.w}×${r.h}`).join(' · ')}`);

    // ⑤ **새 댓글은 아래에 붙는다 — 과거가 위** (2026-09-25 신고)
    //   Irene: "댓글을 달았는데 아래로 안 붙고 위로 붙어서 올라간 줄 몰랐어. 과거가 위로 정렬되어야지."
    //   원인은 정렬이 아니라 **이름**이었다: 조회는 `createdAt`, 저장 응답은 `created_at` 만 실어
    //   새 댓글의 시각이 빈 문자열이 되고, 빈 문자열은 모든 날짜보다 작아 맨 위로 갔다.
    //   ★ 그래서 «순서» 와 «시각이 보이는가» 를 **같이** 잰다 — 시각이 빈칸이면 순서가 우연히
    //     맞아도 같은 결함이 남아 있는 것이다. 정렬 규칙만 보면 이 계열을 놓친다.
    //   ★★ 픽스처가 결함을 재현해야 한다. **UI 로만 두 건을 넣으면 거짓 통과한다** —
    //      둘 다 저장 응답에서 와서 시각이 똑같이 빈 값이 되고, 정렬이 «우연히» 입력순으로
    //      유지된다(2026-09-25 실측: 버그를 되살렸는데 순서 검사 2건이 그대로 초록이었다).
    //      결함은 **조회로 온 과거 댓글 + 저장 응답으로 온 새 댓글**이 섞일 때만 드러난다.
    //      그래서 과거 댓글 1건을 **DB 에 먼저 심고**(화면은 GET 으로 받는다) 새 댓글을 UI 로 넣는다.
    await sequelize.query(
      `INSERT INTO task_comments (task_id, user_id, content, visibility, created_at, updated_at)
       VALUES (?, ?, 'ZZ 카나리 댓글 과거', 'internal', DATE_SUB(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
      { replacements: [taskId, tmpId] });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await b.sleep(4000);
    const seq = [];
    for (const text of ['ZZ 카나리 댓글 새것']) {
      const ok = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="task-comment-input"]');
        if (el) el.scrollIntoView({ block: 'center' });
        return !!el;
      });
      if (!ok) { seq.push(null); break; }
      await b.sleep(400);
      await page.click('[data-testid="task-comment-input"]');
      await page.type('[data-testid="task-comment-input"]', text, { delay: 12 });
      await page.click('[data-testid="task-comment-send"]');
      await b.sleep(2500);
      // 화면에 그려진 댓글들의 **DOM 순서**와 각 줄의 시각 글자를 같이 읽는다
      seq.push(await page.evaluate(() => Array.from(
        document.querySelectorAll('[data-testid^="task-comment-"]'),
      ).filter((el) => /^task-comment-\d+$/.test(el.dataset.testid)).map((el) => {
        const head = el.querySelector('span');
        return {
          id: Number(el.dataset.testid.replace('task-comment-', '')),
          body: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          time: head ? (head.textContent || '').trim() : '',
          top: Math.round(el.getBoundingClientRect().top),
        };
      })));
    }
    const last = seq[seq.length - 1];
    const twoRows = Array.isArray(last) && last.length >= 2;
    const newestLast = twoRows && last[last.length - 1].body.includes('새것') && last[0].body.includes('과거');
    push('새 댓글이 목록 **맨 아래**에 붙는다 (과거가 위)',
      newestLast,
      twoRows
        ? `DOM 순서: ${last.map((r) => r.body.replace(/.*ZZ 카나리 댓글 /, '')).join(' → ')}`
        : `댓글 행 ${Array.isArray(last) ? last.length : 0}건 — 과거 1건 + 새것 1건이어야 판정된다`);
    // 좌표로도 확인 — DOM 순서가 맞아도 CSS 가 뒤집으면(column-reverse) 사용자는 위에서 본다.
    //   ★ **DOM 순서대로 top 을 비교하면 안 된다** — 그 값은 내용과 무관하게 항상 증가해서
    //     결함을 되살려도 뒤집히지 않는다(2026-09-25 실측: 순서가 «새것 → 과거» 인데도 초록).
    //     행을 **내용으로 찾아** 비교한다.
    const rowPast = twoRows ? last.find((r) => r.body.includes('과거')) : null;
    const rowNew = twoRows ? last.find((r) => r.body.includes('새것')) : null;
    push('화면 좌표도 과거가 위다 (CSS 역전 없음)',
      !!rowPast && !!rowNew && rowPast.top < rowNew.top,
      rowPast && rowNew ? `과거 top=${rowPast.top} · 새것 top=${rowNew.top}` : '미측정');
    push('새 댓글에 시각이 **보인다** (빈칸이면 같은 결함이다)',
      twoRows && last.every((r) => /\d\d-\d\d/.test(r.time)),
      twoRows ? `시각: ${last.map((r) => JSON.stringify(r.time)).join(' · ')}` : '미측정');
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
