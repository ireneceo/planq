// canary-task-footer — 업무 상세 하단 고정 줄 + 업무 추가 «컨펌자» 칸 (2026-10-21)
//
//   Irene: "업무상세에서 하단에 업무삭제 있잖아. 그 뒤로 이 액션버튼 추가해서 항상 아래에 푸터 고정되게 …
//           [재확인 요청하기] [확인요청하기] [진행시작하기] [완료처리하기] … 위에 있는 액션버튼과 동일한 기능으로."
//           "업무추가 할 때 컨펌자가 필요할 수 있어. 요청하기에서도 … 컨펌자 넣는 항목이 안나오네."
//
//   재는 것(3폭 — 1440 · 834 · 390):
//     ① 본문 맨 위에서도 하단 줄이 **보인다**(elementFromPoint) · 줄 바닥 = 스크롤 상자 바닥
//        양성 대조군: 줄을 position:static 으로 바꾸면 같은 판정이 «안 보임» 으로 뒤집힌다
//     ② 진행 전 업무: [진행 시작하기] 를 누르면 DB 상태가 in_progress (위 카드와 같은 함수)
//     ③ 진행 중 + 컨펌자: [확인 요청하기] → 위 카드의 메모 폼이 열려 보인다 → 한 번 더 누르면 reviewing
//     ④ 수정 요청 받은 업무: 줄에 [재확인 요청하기] · 위 카드는 «수정 완료 · 재확인 요청 →»
//     ⑤ 컨펌자(검토 중): [승인하기] 두 번 → DB 컨펌자 approved
//     ⑥ 업무 추가 폼: [내 업무]·[요청하기] 둘 다 «컨펌자» 칸이 보인다 · 컨펌자를 고르고 만들면 task_reviewers 행
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');
const b = require('./lib/browser');

const BIZ = 6;
const Q = (sql, r = []) => sequelize.query(sql, { replacements: r, type: sequelize.QueryTypes.SELECT });

async function mkUser(tag) {
  const [ver] = await Q('SELECT terms_version, privacy_version FROM platform_settings LIMIT 1').catch(() => [{}]);
  const tv = (ver && ver.terms_version) || '1.0';
  const pv = (ver && ver.privacy_version) || '1.0';
  const cred = { email: `tf-${tag}-${Date.now()}@test.planq.kr`, password: 'TaskFooterCanary2026!' };
  const [id] = await sequelize.query(
    `INSERT INTO users (email, password_hash, name, username, platform_role, terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'user', NOW(), ?, NOW(), ?, NOW(), NOW())`,
    { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `TF ${tag}`, `tf${tag}${Date.now()}`, tv, pv] });
  await sequelize.query("INSERT INTO business_members (business_id, user_id, role, joined_at, created_at, updated_at) VALUES (?, ?, 'member', NOW(), NOW(), NOW())", { replacements: [BIZ, id] });
  await sequelize.query('UPDATE users SET active_business_id = ? WHERE id = ?', { replacements: [BIZ, id] }).catch(() => null);
  return { id, cred };
}

async function mkTask(made, { title, by, assignee, status, reviewer, reviewerState = 'pending' }) {
  const [tid] = await sequelize.query(
    `INSERT INTO tasks (business_id, title, created_by, request_by_user_id, assignee_id, status, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    { replacements: [BIZ, title, by, by, assignee, status, '<p>' + '결과물 줄 '.repeat(400) + '</p>'] });
  made.tasks.push(tid);
  if (reviewer) {
    await sequelize.query(
      `INSERT INTO task_reviewers (task_id, user_id, is_client, state, reverted_once, added_by_user_id, created_at, updated_at)
       VALUES (?, ?, 0, ?, 0, ?, NOW(), NOW())`, { replacements: [tid, reviewer, reviewerState, by] });
  }
  return tid;
}

// 하단 줄 — 스크롤 상자 맨 위에서 보이는가 · 줄 바닥이 상자 바닥에 붙었는가
async function footerState(page, { forceStatic = false } = {}) {
  return page.evaluate((forceStatic) => {
    const f = document.querySelector('[data-testid="task-detail-footer"]');
    if (!f) return { found: false };
    const wrap = f.closest('[data-testid="task-detail-footer"]');
    if (forceStatic) wrap.style.position = 'static';
    let sc = f.parentElement;
    while (sc && !(getComputedStyle(sc).overflowY === 'auto' || getComputedStyle(sc).overflowY === 'scroll')) sc = sc.parentElement;
    if (sc) sc.scrollTop = 0;
    const r = f.getBoundingClientRect();
    const sr = sc ? sc.getBoundingClientRect() : { bottom: innerHeight };
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + Math.min(r.height / 2, 20)));
    const visible = r.height > 0 && r.top < innerHeight && !!hit && f.contains(hit);
    const scrolls = sc ? sc.scrollHeight > sc.clientHeight + 40 : false;
    const btns = [...f.querySelectorAll('button')].map((x) => (x.textContent || '').trim());
    if (forceStatic) wrap.style.position = '';
    return { found: true, visible, scrolls, gap: Math.round(sr.bottom - r.bottom), btns };
  }, forceStatic);
}

async function clickTid(page, tid) {
  const h = await page.$(`[data-testid="${tid}"]`);
  if (!h) return false;
  await h.click().catch(() => null);
  return true;
}

async function seen(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + Math.min(r.width / 2, 40)), Math.round(r.top + r.height / 2));
    return { found: true, visible: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && !!hit && (el === hit || el.contains(hit)) };
  }, sel);
}

async function waitStatus(tid, want, n = 10) {
  let row = null;
  for (let i = 0; i < n; i++) {
    [row] = await Q('SELECT status FROM tasks WHERE id=?', [tid]);
    if (row.status === want) break;
    await b.sleep(700);
  }
  return row.status;
}

async function openDetail(p, tid) {
  await b.goto(p, `/tasks?task=${tid}`);
  for (let i = 0; i < 15; i++) {
    if (await p.$('[data-testid="task-detail-footer"]')) break;
    await b.sleep(500);
  }
  await b.sleep(800);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const made = { users: [], tasks: [] };
  let browser = null;
  try {
    const A = await mkUser('as'); made.users.push(A.id);   // 담당자
    const B = await mkUser('rq'); made.users.push(B.id);   // 요청자 = 컨펌자

    for (const vp of [{ w: 1440, h: 900, name: '데스크탑' }, { w: 834, h: 1112, name: '태블릿' }, { w: 390, h: 844, name: '폰', mobile: true }]) {
      const tNew = await mkTask(made, { title: `[확인용] 하단 줄 진행 전 ${vp.name}`, by: B.id, assignee: A.id, status: 'not_started' });
      const tRun = await mkTask(made, { title: `[확인용] 하단 줄 진행 중 ${vp.name}`, by: B.id, assignee: A.id, status: 'in_progress', reviewer: B.id });
      const tRev = await mkTask(made, { title: `[확인용] 하단 줄 수정 요청 ${vp.name}`, by: B.id, assignee: A.id, status: 'revision_requested', reviewer: B.id, reviewerState: 'revision' });
      const tChk = await mkTask(made, { title: `[확인용] 하단 줄 검토 중 ${vp.name}`, by: B.id, assignee: A.id, status: 'reviewing', reviewer: B.id });

      const launch = async () => {
        const l = await b.launch({ mobile: !!vp.mobile });
        if (!vp.mobile) await l.page.setViewport({ width: vp.w, height: vp.h });
        else await l.page.setViewport({ width: vp.w, height: vp.h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
        return l;
      };

      // ── 담당자 ──
      let l = await launch(); browser = l.browser; let p = l.page;
      await b.login(p, A.cred);

      await openDetail(p, tNew);
      const f1 = await footerState(p);
      push(`${vp.name} · ① 본문 맨 위에서도 하단 줄이 보이고 상자 바닥에 붙는다`, f1.found && f1.visible && Math.abs(f1.gap) <= 2,
        JSON.stringify(f1));
      const f1c = await footerState(p, { forceStatic: true });
      push(`${vp.name} · ① 대조군: 고정을 풀면 같은 판정이 «안 보임»`, f1c.found && f1c.scrolls && !f1c.visible, JSON.stringify(f1c));
      push(`${vp.name} · ② 진행 전: 줄에 [업무 삭제]·[진행 시작하기]`, f1.btns.includes('업무 삭제') && f1.btns.includes('진행 시작하기'), JSON.stringify(f1.btns));
      await clickTid(p, 'task-footer-start');
      push(`${vp.name} · ② [진행 시작하기] → in_progress`, (await waitStatus(tNew, 'in_progress')) === 'in_progress', `task ${tNew}`);

      await openDetail(p, tRun);
      const f2 = await footerState(p);
      push(`${vp.name} · ③ 진행 중+컨펌자: 줄에 [확인 요청하기]`, f2.btns.includes('확인 요청하기'), JSON.stringify(f2.btns));
      await clickTid(p, 'task-footer-submit');
      await b.sleep(1200);
      const note = await seen(p, '[data-testid="task-submit-note"]');
      push(`${vp.name} · ③ 누르면 위 카드의 메모 칸이 열려 보인다`, note.found && note.visible, JSON.stringify(note));
      const [stMid] = await Q('SELECT status FROM tasks WHERE id=?', [tRun]);
      push(`${vp.name} · ③ 첫 누름은 아직 보내지 않는다(메모 받을 자리)`, stMid.status === 'in_progress', stMid.status);
      await clickTid(p, 'task-footer-submit');
      push(`${vp.name} · ③ 한 번 더 → reviewing`, (await waitStatus(tRun, 'reviewing')) === 'reviewing', `task ${tRun}`);

      await openDetail(p, tRev);
      const f3 = await footerState(p);
      const topLbl = await p.evaluate(() => (document.querySelector('[data-testid="task-submit-open"]')?.textContent || '').trim());
      push(`${vp.name} · ④ 수정 요청 받음: 줄 [재확인 요청하기] · 카드 «수정 완료 · 재확인 요청 →»`,
        f3.btns.includes('재확인 요청하기') && topLbl.startsWith('수정 완료 · 재확인 요청'), JSON.stringify({ btns: f3.btns, topLbl }));
      await browser.close(); browser = null;

      // ── 컨펌자 ──
      l = await launch(); browser = l.browser; p = l.page;
      await b.login(p, B.cred);
      await openDetail(p, tChk);
      const f4 = await footerState(p);
      push(`${vp.name} · ⑤ 컨펌자: 줄에 [수정 요청하기]·[승인하기]`, f4.btns.includes('승인하기') && f4.btns.includes('수정 요청하기'), JSON.stringify(f4.btns));
      await clickTid(p, 'task-footer-approve');
      await b.sleep(1000);
      await clickTid(p, 'task-footer-approve');
      let rv = null;
      for (let i = 0; i < 10; i++) {
        [rv] = await Q('SELECT state FROM task_reviewers WHERE task_id=? AND user_id=?', [tChk, B.id]);
        if (rv.state === 'approved') break;
        await b.sleep(700);
      }
      push(`${vp.name} · ⑤ [승인하기] 두 번 → 컨펌자 approved`, rv.state === 'approved', JSON.stringify(rv));

      // ── 업무 추가 폼 — 컨펌자 칸 ──
      if (vp.w !== 834) {
        await b.goto(p, '/tasks');
        await b.sleep(3500);
        await clickTid(p, 'task-add-btn');
        await b.sleep(1500);
        const r1 = await seen(p, '[data-testid="task-add-reviewers"]');
        await clickTid(p, 'task-add-mode-request');
        await b.sleep(600);
        const r2 = await seen(p, '[data-testid="task-add-reviewers"]');
        push(`${vp.name} · ⑥ [내 업무]·[요청하기] 둘 다 «컨펌자» 칸이 보인다`, r1.found && r1.visible && r2.found && r2.visible, JSON.stringify({ r1, r2 }));
        await clickTid(p, 'task-add-mode-task');
        await b.sleep(400);
        const title = `[확인용] 컨펌자 넣어 만들기 ${vp.name} ${Date.now()}`;
        await p.type('[data-testid="task-create-title"]', title, { delay: 5 });
        // 컨펌자 고르기 — 셀렉트를 열고 목록에서 담당자(A) 이름을 **눌러** 고른다.
        //   ★ 터치에서는 항목이 적으면 검색칸이 없다(PlanQSelect resolveSearchable) — 타이핑+Enter 는 폰에서 아무것도 안 고른다.
        const ctl = await p.$('[data-testid="task-add-reviewers"] [class*="control"]');
        if (ctl) await ctl.click().catch(() => null);
        await b.sleep(800);
        const optBox = await p.evaluateHandle(() => [...document.querySelectorAll('[class*="option"]')]
          .find((el) => (el.textContent || '').trim().startsWith('TF as')) || null);
        const opt = optBox.asElement();
        if (opt) await opt.click().catch(() => null);
        await b.sleep(600);
        const picked = await p.evaluate(() => (document.querySelector('[data-testid="task-add-reviewers"]')?.textContent || '').includes('TF as'));
        push(`${vp.name} · ⑥ 목록에서 컨펌자를 눌러 고른다`, picked, `picked=${picked} option=${!!opt}`);
        // 메뉴가 열려 있으면 제출 버튼을 덮는다 — 제목 칸을 눌러 닫는다(Esc 는 폼 자체를 닫는다)
        await p.click('[data-testid="task-create-title"]').catch(() => null);
        await b.sleep(300);
        await clickTid(p, 'task-create-submit');
        let row = null;
        for (let i = 0; i < 12; i++) {
          [row] = await Q('SELECT id FROM tasks WHERE title=? AND business_id=?', [title, BIZ]);
          if (row) {
            const rvs = await Q('SELECT user_id FROM task_reviewers WHERE task_id=?', [row.id]);
            if (rvs.length) { row.rvs = rvs.map((x) => x.user_id); break; }
          }
          await b.sleep(700);
        }
        if (row) made.tasks.push(row.id);
        push(`${vp.name} · ⑥ 컨펌자를 골라 만들면 그 사람이 컨펌자`, !!row && (row.rvs || []).includes(A.id), JSON.stringify(row));
      }
      await browser.close(); browser = null;
    }
  } catch (e) {
    push('하니스', false, e.stack || String(e));
  } finally {
    if (browser) await browser.close().catch(() => null);
    for (const tid of made.tasks) {
      for (const tbl of ['task_reviewers', 'task_status_history', 'task_comments', 'task_tags']) {
        await sequelize.query(`DELETE FROM ${tbl} WHERE task_id = ?`, { replacements: [tid] }).catch(() => null);
      }
      await sequelize.query('DELETE FROM notifications WHERE link LIKE ?', { replacements: [`%task=${tid}%`] }).catch(() => null);
      await sequelize.query('DELETE FROM tasks WHERE id = ?', { replacements: [tid] }).catch(() => null);
    }
    for (const uid of made.users) {
      await sequelize.query('DELETE FROM notifications WHERE user_id = ?', { replacements: [uid] }).catch(() => null);
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => null);
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [uid] }).catch(() => null);
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => null);
    }
  }
  return results;
}

module.exports = { run };
