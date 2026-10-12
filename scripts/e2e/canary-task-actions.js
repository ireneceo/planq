// canary-task-actions — 업무 «결과물 액션» (2026-10-12, docs/TASK_ACTIONS_DESIGN.md §7 검증)
//
//   Irene: "업무에서 … 문서작성하게 보내고 … 일정을 추가하게 보내고 … 그 액션버튼을 통해 갔으면
//           해당 업무랑 연결되어 있는 거 알게 해주고"
//
//   재는 것(3폭 — 1440 · 834 · 390):
//     ① 업무 상세에 «결과물 액션» 칸과 [문서 만들기 ↗] 가 **보인다**(elementFromPoint) · 비담당자는 비활성
//     ② 누르면 문서 화면으로 가고 띠에 업무·액션 이름이 나온다 · 제목 = 액션 이름
//        데스크탑(탭 모드)은 **새 탭** — 원래 업무 화면이 그대로 남아 있다(keep-alive DOM)
//     ③ 첫 자동저장으로 액션이 «작성 중» 이 된다(DB) — 그리고 업무 칸이 **새로고침 없이** 바뀐다(소켓)
//     ④ 발행하면 완료 · 문서 밴드2 에 «업무:» 칩이 보인다
//     ⑤ 일정: ?new=1&from_action= 으로 폼이 열려 띠·제목이 차고, 만들면 액션 완료 + 일정 task_id = 업무(데스크탑·폰)
//   대조군: 연결하지 않은 다른 액션은 같은 판정이 «pending» 으로 나온다(판정이 상수가 아님) ·
//           from_action 없이 연 문서에는 띠가 없다.
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
  const cred = { email: `ta-${tag}-${Date.now()}@test.planq.kr`, password: 'TaskActionsCanary2026!' };
  const [id] = await sequelize.query(
    `INSERT INTO users (email, password_hash, name, username, platform_role, terms_accepted_at, terms_version, privacy_accepted_at, privacy_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'user', NOW(), ?, NOW(), ?, NOW(), NOW())`,
    { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `TA ${tag}`, `ta${tag}${Date.now()}`, tv, pv] });
  await sequelize.query("INSERT INTO business_members (business_id, user_id, role, joined_at, created_at, updated_at) VALUES (?, ?, 'member', NOW(), NOW(), NOW())", { replacements: [BIZ, id] });
  await sequelize.query('UPDATE users SET active_business_id = ? WHERE id = ?', { replacements: [BIZ, id] }).catch(() => null);
  return { id, cred };
}

async function seen(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return { found: true, w: Math.round(r.width), h: Math.round(r.height), disabled: el.disabled === true,
      visible: r.width > 0 && r.height > 0 && !!hit && (el === hit || el.contains(hit)), text: (el.textContent || '').trim().slice(0, 80) };
  }, sel);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const made = { users: [], tasks: [], posts: [], events: [] };
  let browser = null;
  try {
    const A = await mkUser('as'); made.users.push(A.id);   // 담당자
    const B = await mkUser('rq'); made.users.push(B.id);   // 작성자(비담당자)

    for (const vp of [{ w: 1440, h: 900, name: '데스크탑' }, { w: 834, h: 1112, name: '태블릿' }, { w: 390, h: 844, name: '폰', mobile: true }]) {
      const [tid] = await sequelize.query(
        `INSERT INTO tasks (business_id, title, created_by, request_by_user_id, assignee_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'in_progress', NOW(), NOW())`,
        { replacements: [BIZ, `[확인용] 결과물 액션 카나리 ${vp.name}`, B.id, B.id, A.id] });
      made.tasks.push(tid);
      const [a1] = await sequelize.query(
        `INSERT INTO task_action_items (business_id, task_id, order_index, kind, label, status, created_by, created_at, updated_at)
         VALUES (?, ?, 0, 'doc', ?, 'pending', ?, NOW(), NOW())`, { replacements: [BIZ, tid, `견적서 초안 ${vp.w}`, B.id] });
      const [a2] = await sequelize.query(
        `INSERT INTO task_action_items (business_id, task_id, order_index, kind, label, status, created_by, created_at, updated_at)
         VALUES (?, ?, 1, 'event', '킥오프 미팅', 'pending', ?, NOW(), NOW())`, { replacements: [BIZ, tid, B.id] });

      const launched = await b.launch({ mobile: !!vp.mobile });
      browser = launched.browser;
      const page = launched.page;
      if (!vp.mobile) await page.setViewport({ width: vp.w, height: vp.h });
      else await page.setViewport({ width: vp.w, height: vp.h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

      // ── 비담당자(작성자) — 버튼 비활성 ──
      await b.login(page, B.cred);
      await b.goto(page, `/tasks?task=${tid}`);
      await b.sleep(4500);
      const goB = await seen(page, `[data-testid="task-action-go-${a1}"]`);
      push(`${vp.name} · 비담당자에게 [문서 만들기] 는 비활성`, goB.found && goB.disabled, JSON.stringify(goB));
      const addB = await seen(page, '[data-testid="task-actions-add"]');
      push(`${vp.name} · 작성자는 [액션 추가] 가 보인다`, addB.found && addB.visible, JSON.stringify(addB));
      await browser.close(); browser = null;

      // ── 담당자 ──
      const l2 = await b.launch({ mobile: !!vp.mobile });
      browser = l2.browser;
      const p = l2.page;
      if (!vp.mobile) await p.setViewport({ width: vp.w, height: vp.h });
      else await p.setViewport({ width: vp.w, height: vp.h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await b.login(p, A.cred);
      await b.goto(p, `/tasks?task=${tid}`);
      await b.sleep(4500);
      const go = await seen(p, `[data-testid="task-action-go-${a1}"]`);
      push(`${vp.name} · 담당자에게 [문서 만들기] 가 보이고 눌린다`, go.found && go.visible && !go.disabled && (!vp.mobile || go.h >= 40),
        JSON.stringify(go));
      if (!go.found || go.disabled) { await browser.close(); browser = null; continue; }
      await p.click(`[data-testid="task-action-go-${a1}"]`);
      await b.sleep(4500);
      const after = await p.evaluate((rowSel) => ({
        path: location.pathname, search: location.search,
        banner: (document.querySelector('[data-testid="from-task-banner"]')?.textContent || '').trim(),
        taskRowAlive: !!document.querySelector(rowSel),
        titleVal: Array.from(document.querySelectorAll('input')).map((i) => i.value).find((v) => v && v.includes('견적서 초안')) || null,
      }), `[data-testid="task-action-row-${a1}"]`);
      push(`${vp.name} · 문서 화면으로 가고 띠에 업무·액션 이름`, after.path === '/docs' && after.banner.includes('견적서 초안') && after.banner.includes('결과물 액션 카나리'),
        JSON.stringify(after));
      push(`${vp.name} · 주소에서 from_action 이 지워졌다`, !after.search.includes('from_action'), after.search);
      push(`${vp.name} · 제목 = 액션 이름`, !!after.titleVal, String(after.titleVal));
      if (!vp.mobile) push(`${vp.name} · 새 탭으로 열려 업무 화면이 남아 있다`, after.taskRowAlive, `업무 행 DOM ${after.taskRowAlive}`);

      // 첫 자동저장 — 제목 끝에 한 글자를 더해 저장을 일으킨다
      const titleSel = 'input[maxlength="200"]';
      await p.focus(titleSel).catch(() => null);
      await p.keyboard.press('End').catch(() => null);
      await p.keyboard.type(' v1', { delay: 20 });
      let row = null;
      for (let i = 0; i < 12; i++) {
        await b.sleep(1000);
        [row] = await Q('SELECT status, linked_entity_type, linked_entity_id FROM task_action_items WHERE id=?', [a1]);
        if (row.linked_entity_id) break;
      }
      push(`${vp.name} · 첫 자동저장으로 액션 «작성 중» + 문서 연결`, row.status === 'active' && row.linked_entity_type === 'post', JSON.stringify(row));
      if (row.linked_entity_id) made.posts.push(row.linked_entity_id);
      // 대조군 — 연결하지 않은 다른 액션은 같은 판정이 pending
      const [ctrl] = await Q('SELECT status, linked_entity_id FROM task_action_items WHERE id=?', [a2]);
      push(`${vp.name} · 대조군: 손대지 않은 액션은 pending 그대로`, ctrl.status === 'pending' && !ctrl.linked_entity_id, JSON.stringify(ctrl));

      if (!vp.mobile && row.linked_entity_id) {
        // 남아 있는 업무 화면이 새로고침 없이 «작성 중» 으로 바뀌었는가(소켓)
        let st = null;
        for (let i = 0; i < 8; i++) {
          st = await p.evaluate((s) => document.querySelector(s)?.getAttribute('data-status') || null, `[data-testid="task-action-row-${a1}"]`);
          if (st === 'active') break;
          await b.sleep(800);
        }
        push(`${vp.name} · 업무 칸이 새로고침 없이 «작성 중»`, st === 'active', `data-status=${st}`);
      }

      // 발행 — 화면의 [저장] 을 누르는 대신 실제 저장과 같은 PUT 을 이 사용자로 보낸다
      if (row.linked_entity_id) {
        const put = await p.evaluate(async (pid) => {
          const r0 = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then((r) => r.json()).catch(() => null);
          const tok = r0?.data?.token;
          const r = await fetch(`/api/posts/${pid}`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ status: 'published', vlevel: 'L3' }) });
          return r.status;
        }, row.linked_entity_id);
        await b.sleep(1500);
        const [r2] = await Q('SELECT status FROM task_action_items WHERE id=?', [a1]);
        push(`${vp.name} · 발행하면 완료`, put === 200 && r2.status === 'completed', `PUT ${put} · ${r2.status}`);
        await b.goto(p, `/docs?post=${row.linked_entity_id}`);
        await b.sleep(4000);
        const chip = await seen(p, '[data-testid^="linked-task-chip-"]');
        push(`${vp.name} · 문서 밴드2 에 «업무:» 칩이 보인다`, chip.found && chip.visible && chip.text.includes('결과물 액션 카나리'), JSON.stringify(chip));
        const banner = await p.evaluate(() => !!document.querySelector('[data-testid="from-task-banner"]'));
        push(`${vp.name} · 대조군: from_action 없이 연 문서에는 띠가 없다`, !banner, `banner=${banner}`);
      }
      // ── 일정 — 같은 업무의 «킥오프 미팅» 액션으로 새 일정 폼을 연다(주소 하나: ?new=1&from_action=) ──
      if (vp.w !== 834) {
        await b.goto(p, `/calendar?new=1&from_action=${a2}`);
        await b.sleep(4500);
        const cal = await p.evaluate(() => {
          // ★ 탭 모드에서는 숨은 탭(업무 상세 드로어)의 aria-modal 도 DOM 에 남는다 — 일정 폼의 제출 버튼이 든 창만 본다
          const dlg = document.querySelector('[data-testid="calendar-new-submit"]')?.closest('[aria-modal="true"]') || null;
          const banner = (dlg?.querySelector('[data-testid="from-task-banner"]')?.textContent || '').trim();
          const title = Array.from(dlg?.querySelectorAll('input') || []).map((i) => i.value).find((v) => v === '킥오프 미팅') || null;
          return { open: !!dlg, banner, title, search: location.search };
        });
        push(`${vp.name} · 일정 폼이 열리고 띠·제목이 채워진다`, cal.open && cal.banner.includes('킥오프 미팅') && cal.title === '킥오프 미팅' && !cal.search.includes('from_action'), JSON.stringify(cal));
        const sub = await seen(p, '[data-testid="calendar-new-submit"]');
        if (sub.found && !sub.disabled) {
          await p.click('[data-testid="calendar-new-submit"]');
          let r3 = null;
          for (let i = 0; i < 10; i++) {
            await b.sleep(800);
            [r3] = await Q('SELECT status, linked_entity_type, linked_entity_id FROM task_action_items WHERE id=?', [a2]);
            if (r3.linked_entity_id) break;
          }
          const [ev] = r3.linked_entity_id ? await Q('SELECT task_id FROM calendar_events WHERE id=?', [r3.linked_entity_id]) : [null];
          if (r3.linked_entity_id) made.events.push(r3.linked_entity_id);
          push(`${vp.name} · 일정을 만들면 액션 완료 + 일정에 업무 연결`, r3.status === 'completed' && r3.linked_entity_type === 'calendar_event' && ev && ev.task_id === tid,
            JSON.stringify({ r3, ev }));
        } else push(`${vp.name} · 일정 [만들기] 버튼`, false, JSON.stringify(sub));
      }
      await browser.close(); browser = null;
    }
  } catch (e) {
    push('하니스', false, e.stack || String(e));
  } finally {
    if (browser) await browser.close().catch(() => null);
    // 정리 — 카나리가 만든 것만(남기면 다음 실행을 흐린다)
    for (const pid of made.posts) {
      await sequelize.query('DELETE FROM task_attachments WHERE post_id = ?', { replacements: [pid] }).catch(() => null);
      await sequelize.query('DELETE FROM post_revisions WHERE post_id = ?', { replacements: [pid] }).catch(() => null);
      await sequelize.query('DELETE FROM posts WHERE id = ?', { replacements: [pid] }).catch(() => null);
    }
    for (const eid of made.events) {
      for (const tbl of ['calendar_event_attendees', 'calendar_event_gcal_links', 'calendar_event_attachments']) await sequelize.query(`DELETE FROM ${tbl} WHERE event_id = ?`, { replacements: [eid] }).catch(() => null);
      await sequelize.query('DELETE FROM calendar_events WHERE id = ?', { replacements: [eid] }).catch(() => null);
    }
    for (const tid of made.tasks) {
      await sequelize.query('DELETE FROM task_action_items WHERE task_id = ?', { replacements: [tid] }).catch(() => null);
      await sequelize.query('DELETE FROM task_status_history WHERE task_id = ?', { replacements: [tid] }).catch(() => null);
      await sequelize.query('DELETE FROM tasks WHERE id = ?', { replacements: [tid] }).catch(() => null);
    }
    for (const uid of made.users) {
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => null);
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [uid] }).catch(() => null);
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => null);
    }
  }
  return results;
}

module.exports = { run };
