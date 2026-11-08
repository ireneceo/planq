// scripts/e2e/canary-qnote-newnote.js — Q note «새 노트» 메뉴 · 회의 설정 창 (2026-11-08)
//
//   Irene: «대화형이 온라인 화상이랑 마이크 두 가지로 나눠져 있잖아. 분리하는 게 좋지 않을까? … 보면 뭘 하는지 바로 알게.
//          설정 팝업도 … 다 나열된 상태에서 뭘 어떻게 설정하면 어떻게 되는지 모르겠어» → «권고대로» (+ Fable 설계 판정 반영)
//
//   ① + 를 누르면 5항목(메모 · 바로 녹음 · 온라인 회의 · 대면 회의 · 녹음 파일)이 실제로 보이고(elementFromPoint) 묶음 이름 3개 · 항목마다 아이콘·설명
//   ② 대면 회의 → 창 제목 «새 대면 회의» · 녹음 방식 줄 microphone · 옛 «캡처 방식» 칸 0 · 카드 6장 모두 접힘 · [녹음 시작] 이 보임
//   ③ 카드 두 장을 차례로 열면 둘 다 열린 채(아코디언 아님) · 요약이 실제 값으로 바뀜(참여자 이름)
//   ④ 메뉴의 선택이 초안을 이긴다 — 온라인에서 제목을 쓰고 닫은 뒤 대면으로 열면 제목은 복원 + 녹음 방식은 microphone (Fable 판정 1)
//   ⑤ [바꾸기] → web_conference · 제목 «새 온라인 회의»
//   ⑥ 온라인 회의를 못 하는 브라우저(getDisplayMedia 없음 = 양성 대조군) → 그 항목만 비활성 + «크롬·엣지» 안내
//   폭: 폰 390 · 태블릿 820 · 데스크탑 1440. 녹음은 시작하지 않는다(DB 쓰기 0 — 초안은 localStorage 라 끝에 지운다).
const { launch, login, goto, sleep } = require('./lib/browser');

const VPS = [
  { name: '폰', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: '태블릿', width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: '데스크탑', width: 1440, height: 900 },
];
const TITLE = '[확인용] 초안 우선순위';

function probeMenu() {
  const menu = document.querySelector('[data-testid="qnote-new-menu"]');
  if (!menu) return { open: false };
  const items = [...menu.querySelectorAll('button')];
  const seen = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return !!el && (el === e || e.contains(el));
  };
  return {
    open: true,
    ids: items.map((e) => e.dataset.testid),
    visible: items.filter(seen).length,
    groups: menu.querySelectorAll('[role="presentation"]').length,
    withIcon: items.filter((e) => e.querySelector('svg')).length,
    withDesc: items.filter((e) => (e.innerText || '').split('\n').filter((x) => x.trim()).length >= 2).length,
    onlineDisabled: !!menu.querySelector('[data-testid="qnote-new-online"]')?.disabled,
    onlineText: (menu.querySelector('[data-testid="qnote-new-online"]')?.innerText || '').replace(/\s+/g, ' '),
  };
}
function probeModal() {
  const d = [...document.querySelectorAll('[aria-modal="true"]')].find((e) => e.querySelector('[data-testid="qnote-start-mode"]'));
  if (!d) return { open: false };
  const cards = [...d.querySelectorAll('[data-testid^="qnote-card-"]')].filter((e) => !/-summary$/.test(e.dataset.testid));
  const heads = cards.map((c) => c.querySelector('button[aria-expanded]'));
  const start = [...d.querySelectorAll('button')].find((b) => /녹음 시작|Start recording|^저장$|^Save$/.test((b.innerText || '').trim()));
  let startSeen = false;
  if (start) {
    start.scrollIntoView({ block: 'nearest' });
    const r = start.getBoundingClientRect();
    const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    startSeen = !!el && (el === start || start.contains(el));
  }
  return {
    open: true,
    title: (d.querySelector('[data-testid="qnote-start-title"]')?.textContent || '').trim(),
    heading: d.getAttribute('aria-label') || '',
    mode: d.querySelector('[data-testid="qnote-start-mode"]').dataset.mode,
    oldCapture: /캡처 방식|Capture method/.test(d.innerText),
    cards: cards.map((c) => c.dataset.testid.replace('qnote-card-', '')),
    expanded: heads.map((h) => h && h.getAttribute('aria-expanded')),
    peopleSummary: d.querySelector('[data-testid="qnote-card-people-summary"]')?.textContent || '',
    titleValue: d.querySelector('input[type="text"]')?.value || '',
    startSeen,
  };
}

async function openMenu(page) {
  await page.click('[data-testid="qnote-new"]');
  await sleep(400);
  return page.evaluate(probeMenu);
}
async function closeModal(page) {
  const ok = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[aria-modal="true"]')].find((e) => e.querySelector('[data-testid="qnote-start-mode"]'));
    const b = d && [...d.querySelectorAll('button')].find((x) => /^(취소|Cancel)$/.test((x.innerText || '').trim()));
    if (b) b.click();
    return !!b;
  });
  await sleep(400);
  return ok;
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  for (const vp of VPS) {
    const { browser, page } = await launch({ mobile: !!vp.isMobile });
    try {
      await page.setViewport({ width: vp.width, height: vp.height, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 1 });
      await login(page);
      await goto(page, '/notes');
      await sleep(2000);
      await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('qnote-meeting-start')) localStorage.removeItem(k); });

      // ① 메뉴
      const m = await openMenu(page);
      const order = 'qnote-new-memo,qnote-quick-record,qnote-new-online,qnote-new-offline,qnote-upload-audio';
      push(`${vp.name}/① 5항목이 보인다 · 순서`, m.open && m.visible === 5 && m.ids.join(',') === order,
        `보임 ${m.visible} · [${(m.ids || []).join(',')}]`);
      push(`${vp.name}/① 묶음 3 · 아이콘 5 · 설명 5`, m.groups === 3 && m.withIcon === 5 && m.withDesc === 5,
        `묶음 ${m.groups} · 아이콘 ${m.withIcon} · 설명 ${m.withDesc}`);
      push(`${vp.name}/① 크롬에서는 온라인 회의가 켜져 있다`, m.onlineDisabled === false, `disabled=${m.onlineDisabled}`);

      // ② 대면 회의
      await page.click('[data-testid="qnote-new-offline"]');
      await sleep(700);
      let d = await page.evaluate(probeModal);
      push(`${vp.name}/② 대면 회의 창 — 제목·녹음 방식`, d.open && d.mode === 'microphone' && /대면|In-person/.test(d.heading + d.title),
        `열림 ${d.open} · mode=${d.mode} · 제목 «${d.title}»`);
      push(`${vp.name}/② 옛 «캡처 방식» 칸 없음 · 카드 6장 모두 접힘`, d.open && !d.oldCapture && d.cards.length === 6 && d.expanded.every((x) => x === 'false'),
        `캡처칸 ${d.oldCapture} · 카드 [${(d.cards || []).join(',')}] · 펼침 [${(d.expanded || []).join(',')}]`);
      push(`${vp.name}/② [녹음 시작] 이 화면에 보인다`, d.startSeen, `보임=${d.startSeen}`);

      // ③ 두 장 열기 + 요약
      await page.click('[data-testid="qnote-card-people"] button[aria-expanded]');
      await sleep(250);
      await page.evaluate(() => {
        const inp = document.querySelector('[data-testid="qnote-card-people"] input');
        if (inp) { inp.focus(); }
      });
      await page.keyboard.type('김확인');
      await page.click('[data-testid="qnote-card-materials"] button[aria-expanded]');
      await sleep(250);
      d = await page.evaluate(probeModal);
      const iPeople = d.cards.indexOf('people'); const iMat = d.cards.indexOf('materials');
      push(`${vp.name}/③ 두 장이 같이 열려 있다 · 요약 = 이름`, d.expanded[iPeople] === 'true' && d.expanded[iMat] === 'true' && d.peopleSummary.includes('김확인'),
        `참여자 ${d.expanded[iPeople]} · 자료 ${d.expanded[iMat]} · 요약 «${d.peopleSummary}»`);
      await closeModal(page);

      // ④ 초안 vs 메뉴 선택 — 온라인에서 제목을 쓰고 닫기 → 대면으로 열기
      await openMenu(page);
      await page.click('[data-testid="qnote-new-online"]');
      await sleep(700);
      await page.evaluate(() => {
        const d0 = [...document.querySelectorAll('[aria-modal="true"]')].find((e) => e.querySelector('[data-testid="qnote-start-mode"]'));
        d0.querySelector('input[type="text"]').focus();
      });
      await page.keyboard.type(TITLE);
      await sleep(900);   // 초안 자동 저장 500ms
      const dOnline = await page.evaluate(probeModal);
      await closeModal(page);
      await openMenu(page);
      await page.click('[data-testid="qnote-new-offline"]');
      await sleep(700);
      d = await page.evaluate(probeModal);
      push(`${vp.name}/④ 메뉴 선택이 초안을 이긴다(제목은 복원)`, dOnline.mode === 'web_conference' && d.mode === 'microphone' && d.titleValue === TITLE,
        `앞 창 ${dOnline.mode} → 지금 ${d.mode} · 제목 «${d.titleValue}»`);

      // ⑤ 바꾸기
      await page.click('[data-testid="qnote-start-mode-change"]');
      await sleep(300);
      d = await page.evaluate(probeModal);
      push(`${vp.name}/⑤ [바꾸기] → 온라인 회의`, d.mode === 'web_conference' && /온라인|online/i.test(d.heading + d.title),
        `mode=${d.mode} · 제목 «${d.title}»`);
      await closeModal(page);
      await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('qnote-meeting-start')) localStorage.removeItem(k); });

      // ⑥ 양성 대조군 — 화면 공유가 없는 브라우저
      const p2 = await browser.newPage();
      await p2.setViewport({ width: vp.width, height: vp.height, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 1 });
      await p2.evaluateOnNewDocument(() => {
        try { Object.defineProperty(MediaDevices.prototype, 'getDisplayMedia', { value: undefined, configurable: true }); } catch { /* */ }
      });
      await goto(p2, '/notes');
      await sleep(2000);
      const m2 = await openMenu(p2);
      push(`${vp.name}/⑥ 화면 공유 없는 브라우저 → 온라인만 비활성 + 안내`, m2.onlineDisabled === true && /크롬|Chrome/.test(m2.onlineText) && m2.visible === 5,
        `disabled=${m2.onlineDisabled} · «${m2.onlineText}» · 보임 ${m2.visible}`);
      await p2.close();
    } catch (e) {
      push(`${vp.name}/실행`, false, `🔴 ${e.message}`);
    } finally {
      await browser.close();
    }
  }
  return results;
}

module.exports = { name: 'qnotenewnote', run };
