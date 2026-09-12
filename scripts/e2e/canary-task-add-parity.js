// canary-task-add-parity — "업무 추가" 가 **어디서 열어도 같은가** (2026-09-12)
//
//   Irene: *"업무추가 팝업이 왜 새거야? 기존 업무추가 항목들하고 기능하고 다르고?"*
//          *"뭘 개발해도 새로운거 새로운 디자인. 기능형태 ui/ux 마음대로 생성하지마. 동기화도 다 되어야 해."*
//
// 세 자리에서 폼을 **실제로 열어** 필드 집합을 재고, 세 집합이 같은지 본다:
//   ① Q Task 우측 드로어  ② Q Task 표 아래 인라인  ③ Q sale 상담 → 업무 추가  ⑧ Q project 업무 탭
//
// ★ 존재 검사로는 이 계열이 안 잡힌다 — 세 벌이 다 "있었고" 내용이 달랐다.
//   그래서 `[data-field]` 집합을 **서로 비교**한다(하드코딩한 기대 목록이 아니라 서로).
// ★ 양성/음성 대조군 — 요청 탭에서는 예측(h)·반복이 **없어야** 하고(PERMISSION_MATRIX §5.7),
//   일반 탭에서는 **있어야** 한다. 한쪽만 재면 "항상 없음/항상 있음" 으로 굳어도 초록이 된다.
// ★ 행이 0건이면 **판정 불가 = 실패**로 떨어뜨린다(빈 데이터 초록 금지 — 2026-09-12 교훈).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const { launch, login, goto, gotoSPA, sleep } = require('./lib/browser');

const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, detail });

// 폼이 열려 있으면 그 안의 필드 집합. 안 열려 있으면 null (빈 배열과 구별한다 — 0 은 판정 불가다)
const FIELDS = `(() => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const form = [...document.querySelectorAll('[data-testid="task-create-form"]')].find(vis);
  if (!form) return null;
  const fields = [...form.querySelectorAll('[data-field]')].filter(vis).map((e) => e.getAttribute('data-field'));
  const title = form.querySelector('[data-testid="task-create-title"]');
  return {
    fields: fields.sort(),
    title: !!(title && vis(title)),
    titleValue: title ? title.value : null,
    rect: (() => { const r = form.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
  };
})()`;

async function clickTestId(page, id) {
  const got = await page.evaluate((sel) => {
    const el = document.querySelector(`[data-testid="${sel}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    el.scrollIntoView({ block: 'center' });
    return true;
  }, id);
  if (!got) return false;
  // 합성 click 은 mousedown 이 없어 바깥클릭 판정과 엇갈린다 — 실제 좌표 클릭.
  const box = await page.$(`[data-testid="${id}"]`);
  if (!box) return false;
  await box.click().catch(() => null);
  await sleep(700);
  return true;
}

async function openForm(page, openerTestId) {
  const clicked = await clickTestId(page, openerTestId);
  if (!clicked) return { error: `여는 버튼 [${openerTestId}] 이 화면에 없다` };
  for (let i = 0; i < 12; i++) {
    const seen = await page.evaluate(FIELDS);
    if (seen) return seen;
    await sleep(400);
  }
  return { error: `[${openerTestId}] 를 눌렀는데 폼이 안 열렸다` };
}

async function closeForm(page) {
  await page.keyboard.press('Escape').catch(() => null);
  await sleep(500);
  const still = await page.evaluate(FIELDS);
  if (still) {
    // Esc 가 안 먹는 자리(인라인)는 취소로 닫는다
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[data-testid="task-create-form"] button')];
      const cancel = btns[btns.length - 2];
      if (cancel) cancel.click();
    }).catch(() => null);
    await sleep(500);
  }
}

async function run() {
  const { browser, page } = await launch();
  const title = `canary-taskadd-${Date.now()}`;
  let createdId = null;
  try {
    await login(page);
    await goto(page, '/tasks');

    // ── ① Q Task 우측 드로어 ────────────────────────────────────────
    const drawer = await openForm(page, 'task-add-btn');
    push('① Q Task 드로어 업무 추가가 열린다', !drawer.error && drawer.fields.length > 0,
      drawer.error || `필드 ${drawer.fields.join(',')} · ${drawer.rect && drawer.rect.join('×')}`);
    await closeForm(page);

    // ── ② Q Task 표 아래 인라인 ─────────────────────────────────────
    const inline = await openForm(page, 'task-add-below');
    push('② Q Task 인라인 업무 추가가 열린다', !inline.error && inline.fields.length > 0,
      inline.error || `필드 ${inline.fields.join(',')}`);
    await closeForm(page);

    push('①②가 **같은 필드 집합**이다',
      !!(drawer.fields && inline.fields) && drawer.fields.join(',') === inline.fields.join(','),
      `드로어 [${drawer.fields || '-'}] vs 인라인 [${inline.fields || '-'}] — 달랐던 것이 신고 원인(태그가 인라인에만 있었다)`);

    // ── ④ 요청 탭 음성 대조군 — 예측(h)·반복이 없다 ──────────────────
    const tabOk = await clickTestId(page, 'qtask-tab-requested');
    const req = tabOk ? await openForm(page, 'task-add-btn') : { error: '요청 탭 버튼이 없다' };
    push('④ 요청 탭에는 예측(h)·반복이 없다 (음성 대조군)',
      !req.error && !req.fields.includes('est') && !req.fields.includes('recur'),
      req.error || `필드 ${req.fields.join(',')} — PERMISSION_MATRIX §5.7(예측시간은 담당자만)`);
    push('④-대조 일반 탭에는 예측(h)·반복이 있다 (양성 대조군)',
      !!(drawer.fields && drawer.fields.includes('est') && drawer.fields.includes('recur')),
      `드로어 필드 ${drawer.fields || '-'} — 둘 다 없으면 위 음성 판정은 무효다`);
    await closeForm(page);
    await clickTestId(page, 'qtask-tab-all');

    // ── ③ Q sale 상담 → 업무 추가 ──────────────────────────────────
    await gotoSPA(page, '/sale');
    await sleep(2500);
    const row = await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="sale-inbox-row-"]');
      return el ? el.getAttribute('data-testid').replace('sale-inbox-row-', '') : null;
    });
    if (!row) {
      push('③ Q sale 상담 행이 있다 (없으면 판정 불가 = 실패)', false,
        '상담 목록이 0건 — 이 상태로는 업무 추가 폼을 열 수 없다. 0===0 으로 통과시키지 않는다');
    } else {
      const sale = await openForm(page, `sale-inbox-task-${row}`);
      push('③ Q sale 업무 추가가 **기존 폼**으로 열린다', !sale.error && sale.fields.length > 0,
        sale.error || `필드 ${sale.fields.join(',')}`);
      push('③이 ①과 같은 필드 집합이다 (신고의 핵심)',
        !!(sale.fields && drawer.fields) && sale.fields.join(',') === drawer.fields.join(','),
        `Q sale [${sale.fields || '-'}] vs Q Task [${drawer.fields || '-'}] — 전에는 제목+설명 2칸뿐이었다`);

      // ── ⑥ 임시저장: 쓰다 닫으면 남는다 ─────────────────────────────
      await page.type('[data-testid="task-create-title"]', title, { delay: 12 });
      await sleep(900);                         // debounce
      await closeForm(page);
      const reopened = await openForm(page, `sale-inbox-task-${row}`);
      push('⑥ 쓰다 닫은 제목이 다시 열면 남아 있다',
        !reopened.error && reopened.titleValue === title,
        reopened.error || `다시 연 값 "${reopened.titleValue}" (기대 "${title}")`);

      // ── ⑤ 생성 왕복 ──────────────────────────────────────────────
      const submitted = await clickTestId(page, 'task-create-submit');
      await sleep(2500);
      const [rows] = await sequelize.query('SELECT id, business_id, created_by FROM tasks WHERE title = ?', { replacements: [title] });
      createdId = rows[0] && rows[0].id;
      push('⑤ 제출하면 업무가 실제로 생긴다 (DB 확인)',
        submitted && rows.length === 1,
        rows.length === 1 ? `task ${createdId} (biz ${rows[0].business_id})` : `DB 에 ${rows.length}건 — 제출 클릭=${submitted}`);

      // ── ⑥-2 제출 성공 뒤에는 초안이 비어 있다 ──────────────────────
      //   ★ 제출하면 만든 업무를 열러 **/tasks 로 이동한다**(의도된 동작). 돌아와서 재야 한다 —
      //     이것을 안 하면 "폼이 안 열림" 으로 읽혀 거짓 실패가 난다(첫 실행에서 실제로 그랬다).
      const movedTo = await page.evaluate(() => location.pathname + location.search);
      push('⑤-2 제출하면 만든 업무로 이동한다', /\/tasks\?task=\d+/.test(movedTo), `주소 ${movedTo}`);
      await gotoSPA(page, '/sale');
      await sleep(2500);
      const after = await openForm(page, `sale-inbox-task-${row}`);
      push('⑥-2 제출 성공 뒤 초안은 비어 있다',
        !after.error && !after.titleValue,
        after.error || `다시 연 값 "${after.titleValue}" — 비우는 것은 제출 성공·명시 취소뿐이다`);
      await closeForm(page);

      // ── ⑦ 행 클릭 → 우측 패널 ────────────────────────────────────
      const panelOpened = await page.evaluate((id) => {
        const r = document.querySelector(`[data-testid="sale-inbox-row-${id}"] button`);
        if (!r) return false;
        r.click();
        return true;
      }, row);
      await sleep(1200);
      const panel = await page.evaluate(() => {
        const view = document.querySelector('[data-testid="inquiry-panel-view"]');
        if (!view) return null;
        const r = view.getBoundingClientRect();
        const dlg = view.closest('[role="dialog"]');
        return {
          visible: r.width > 0 && r.height > 0,
          text: dlg ? (dlg.innerText || '').slice(0, 400) : '',
        };
      });
      push('⑦ 상담 행을 누르면 우측 패널이 뜬다',
        panelOpened && !!panel && panel.visible,
        panel ? `패널 텍스트: ${panel.text.replace(/\n/g, ' / ').slice(0, 160)}` : '패널이 안 열렸다(행 클릭=' + panelOpened + ')');
      // 시각이 **날 ISO** 로 새어 나오지 않는가 — 목록과 같은 포맷터를 쓰는지의 증거
      push('⑦ 패널의 시각이 사람이 읽는 형식이다',
        !!panel && !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(panel.text),
        panel ? (panel.text.match(/\d{4}[^\n]{0,24}/) || ['-'])[0] : '-');
      push('⑦ 패널이 이메일·유입경로를 보여준다',
        !!panel && /@/.test(panel.text) && /메일|채팅|게스트|Email|Chat|Guest/.test(panel.text),
        panel ? panel.text.replace(/\n/g, ' / ').slice(0, 200) : '-');

      // 재클릭 해제
      await page.evaluate((id) => {
        const r = document.querySelector(`[data-testid="sale-inbox-row-${id}"] button`);
        if (r) r.click();
      }, row);
      await sleep(900);
      const closed = await page.evaluate(() => !document.querySelector('[data-testid="inquiry-panel-view"]'));
      const panelWasOpen = !!(panel && panel.visible);
      push('⑦ 같은 행을 다시 누르면 패널이 닫힌다 (재클릭 토글)',
        panelWasOpen && closed,
        panelWasOpen ? `닫힘=${closed}` : '앞 단계에서 패널이 열리지 않았다 — 닫힘 판정 불가(실패로 떨어뜨린다)');
    }

    // ── ⑧ Q project 업무 탭 — **네 번째 자리**도 같은 폼인가 ────────────
    //   이 화면만 더 주는 것: 프로젝트 고정(프로젝트 칸 없음) · 업무 그룹(workstream).
    const pid = await (async () => {
      const [rows] = await sequelize.query(
        "SELECT id FROM projects WHERE business_id = 5 AND (status IS NULL OR status <> 'archived') ORDER BY id DESC LIMIT 1");
      return rows[0] && rows[0].id;
    })();
    if (!pid) {
      push('⑧ Q project 프로젝트가 있다 (없으면 판정 불가 = 실패)', false, 'business 5 에 프로젝트가 0건');
    } else {
      await gotoSPA(page, `/projects/p/${pid}?tab=tasks`);   // ★ 상세는 /projects/p/:id — /projects/:id 는 목록 라우트다(여기서 한 번 속았다)
      await sleep(3000);
      const proj = await openForm(page, 'project-task-add-btn');
      push('⑧ Q project 업무 추가가 **공용 폼**으로 열린다', !proj.error && proj.fields.length > 0,
        proj.error || `필드 ${proj.fields.join(',')}`);
      push('⑧ 프로젝트 칸은 없고 업무 그룹 칸이 있다 (이 화면의 맥락)',
        !!proj.fields && !proj.fields.includes('project') && proj.fields.includes('workstream'),
        `필드 ${proj.fields || '-'} — 프로젝트는 고정, 그룹은 프로젝트 안에서만 뜻이 있다`);
      push('⑧ 나머지 칸은 ①과 같다 (담당자·기간·태그·설명·첨부)',
        !!(proj.fields && drawer.fields)
          && ['assignee', 'dates', 'tags', 'desc', 'attach'].every((f) => proj.fields.includes(f)),
        `Q project [${proj.fields || '-'}] vs Q Task [${drawer.fields || '-'}]`);

      await closeForm(page);
    }
    // ── ⑨ §5.7 — 남에게 지정하면 예측(h)·반복 칸이 사라진다 (서버가 버리는 값) ──
    //   ★ Q Task(워크스페이스 범위)에서 잰다. 프로젝트 멤버가 나 하나인 프로젝트에서는
    //     고를 상대가 없어 **판정 불가**였다(처음엔 그걸 '선택 실패' 로 적어 실패로 떨어뜨렸다).
    await gotoSPA(page, '/tasks');
    await sleep(2500);
    const beforeOther = await openForm(page, 'task-add-btn');
    const ctlBox = await page.$('[data-testid="task-create-form"] [data-field="assignee"]');
    if (ctlBox) await ctlBox.click().catch(() => null);
    await sleep(700);
    const optTexts = await page.evaluate(() => [...document.querySelectorAll('[class*="-option"]')]
      .map((e) => (e.textContent || '').trim()));
    const idx = optTexts.findIndex((x) => x && !/\(나\)|\(me\)/.test(x));
    let chose = null;
    if (idx >= 0) {
      for (let i = 0; i <= idx; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      chose = optTexts[idx];
      await sleep(900);
    }
    const afterOther = await page.evaluate(FIELDS);
    push('⑨ 남에게 지정하면 예측(h)·반복이 사라진다 (§5.7 — 서버가 버리는 값)',
      !!chose && !!afterOther && !afterOther.fields.includes('est') && !afterOther.fields.includes('recur'),
      chose ? `담당자="${chose}" → 필드 ${afterOther && afterOther.fields.join(',')}`
        : `고를 상대가 없어 판정 불가 (옵션 ${optTexts.length}개: ${optTexts.join(' / ')})`);
    push('⑨ 양성 대조군 — 고르기 전에는 둘 다 있었다',
      !!(beforeOther.fields && beforeOther.fields.includes('est') && beforeOther.fields.includes('recur')),
      `고르기 전 필드 ${beforeOther.fields || beforeOther.error} — 없었다면 위 판정은 무효다`);
    await closeForm(page);
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    if (createdId) {
      await sequelize.query('DELETE FROM task_status_history WHERE task_id = ?', { replacements: [createdId] }).catch(() => null);
      await sequelize.query('DELETE FROM tasks WHERE id = ?', { replacements: [createdId] }).catch(() => null);
    }
    // 남은 초안이 다음 스위트를 흔들지 않게 지운다
    await page.evaluate(() => {
      try {
        Object.keys(localStorage).filter((k) => k.includes('planq:draft:sale-task-add')).forEach((k) => localStorage.removeItem(k));
      } catch { /* noop */ }
    }).catch(() => null);
    await browser.close().catch(() => null);
  }
  return results;
}

module.exports = { run };
