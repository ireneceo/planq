// canary-chat-reply — Q talk 답장(인용) · 안 읽은 대화만 보기 (2026-11-12)
//
//   Irene: "채널톡 쓰는 고객사가 우리 거 같이 쓸건데 이거 제대로 사용하게 불편한 채팅영역 기능 없는지 체크해줘."
//   서버는 reply_to_message_id 를 받았지만 화면에 답장 버튼이 없었다(늘 undefined 로 보냄).
//
// 재는 것 (폰·태블릿·데스크탑):
//   ① 메시지 도구줄에 답장 버튼이 그려진다 → 누르면 입력창 위 «…에게 답장» 띠가 그려지고 입력칸이 가려지지 않는다
//   ② 보내면 DB 의 reply_to_message_id = 원문 id · 띠가 사라진다 · 새 메시지 위 인용 줄이 그려진다
//   ③ 인용 줄을 누르면 원문이 화면 안으로 온다
//   ④ (데스크탑) Esc 로 띠가 닫힌다
//   ⑤ 대화 목록 «안 읽음» — 안 읽은 방만 남고(배지 있음 또는 지금 연 방) 다 읽은 방은 빠진다 · «전체» 로 돌아온다
//   ⑥ 양성 대조군 — 인용 줄을 숨기는 CSS 를 넣으면 ② 의 «그려짐» 판정이 뒤집힌다
require('./lib/mem-slot');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const BIZ = 5;
const OWNER = 5;           // health-check@planq.kr
const VIEWPORTS = [
  { key: '폰 390×844', touch: true, vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '태블릿 834×1112', touch: true, vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '데스크탑 1440×900', touch: false, vp: { width: 1440, height: 900 } },
];

async function mkConv(title) {
  const [id] = await sequelize.query(
    `INSERT INTO conversations (business_id, title, channel_type, status, last_message_at, created_at, updated_at)
     VALUES (?, ?, 'internal', 'active', NOW(), NOW(), NOW())`, { replacements: [BIZ, title] });
  await sequelize.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at, created_at)
     VALUES (?, ?, 'member', NOW(), NOW())`, { replacements: [id, OWNER] });
  return id;
}
async function seed() {
  const replyConv = await mkConv('[카나리] 답장');
  for (let i = 1; i <= 40; i++) {   // 화면보다 길게 — «원문으로 이동» 을 재려면 원문이 화면 밖이어야 한다
    await sequelize.query(
      `INSERT INTO messages (conversation_id, sender_id, content, kind, created_at, updated_at)
       VALUES (?, ?, ?, 'text', DATE_SUB(NOW(), INTERVAL ? MINUTE), NOW())`,
      { replacements: [replyConv, OWNER, `[카나리] 답장 확인용 메시지 ${i}`, 60 - i] });
  }
  // 안 읽은 방 — 다른 사람이 쓴 글 · 내 읽음 커서 없음
  const [[other]] = await sequelize.query('SELECT id FROM users WHERE id <> ? AND is_ai = 0 ORDER BY id LIMIT 1', { replacements: [OWNER] });
  const unreadConv = await mkConv('[카나리] 안 읽은 방');
  await sequelize.query(
    `INSERT INTO messages (conversation_id, sender_id, content, kind, created_at, updated_at) VALUES (?, ?, '[카나리] 안 읽은 글', 'text', NOW(), NOW())`,
    { replacements: [unreadConv, other.id] });
  // 다 읽은 방 — 내가 쓴 글뿐
  const readConv = await mkConv('[카나리] 다 읽은 방');
  await sequelize.query(
    `INSERT INTO messages (conversation_id, sender_id, content, kind, created_at, updated_at) VALUES (?, ?, '[카나리] 내 글', 'text', NOW(), NOW())`,
    { replacements: [readConv, OWNER] });
  return { replyConv, unreadConv, readConv };
}
async function cleanup(ids) {
  for (const id of Object.values(ids || {})) {
    if (!id) continue;
    await sequelize.query('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)', { replacements: [id] });
    await sequelize.query('DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)', { replacements: [id] }).catch(() => null);
    await sequelize.query('DELETE FROM messages WHERE conversation_id = ?', { replacements: [id] });
    await sequelize.query('DELETE FROM conversation_participants WHERE conversation_id = ?', { replacements: [id] });
    await sequelize.query('DELETE FROM conversations WHERE id = ?', { replacements: [id] });
  }
}

// 그려졌는가 — 조상 opacity/visibility/display · 크기 · 가운데 점이 자기 자신
const PAINTED = (sel) => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) return { ok: false, why: 'none' };
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') return { ok: false, why: 'hidden' };
  }
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { ok: false, why: 'zero' };
  const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { ok: !!h && (h === el || el.contains(h)), why: h ? (h.getAttribute('data-testid') || h.tagName) : 'nohit', top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
};

async function tapOrClick(page, sel, touch) {
  const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return { x: x.left + x.width / 2, y: x.top + x.height / 2 }; }, sel);
  if (!r) return false;
  if (touch) await page.touchscreen.tap(r.x, r.y); else await page.mouse.click(r.x, r.y);
  return true;
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let ids = null, browser = null;
  try {
    ids = await seed();
    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    await b.login(page);

    for (const { key, vp, touch } of VIEWPORTS) {
      await page.setViewport(vp);
      await b.goto(page, `/talk?conv=${ids.replyConv}`);
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]').length >= 40, { timeout: 20000 }).catch(() => null);
      await b.sleep(1000);
      const msgIds = await page.evaluate(() => [...document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]')].map((e) => Number(e.getAttribute('data-msg-id'))).filter((x) => x > 0));
      if (msgIds.length < 40) { push(`${key} · 픽스처`, false, `메시지 ${msgIds.length}개 — 미측정`); continue; }
      const target = msgIds[0];   // 맨 위 — 보낸 뒤 화면 밖이라 «원문으로 이동» 을 잴 수 있다
      // 사람이 올려 본 것처럼 — 바닥 고정은 휠·터치 표식이 있을 때만 풀린다(ChatPanel pinBottomRef). 표식 없이 굴리면 띠가 뜰 때 바닥으로 끌려간다.
      await page.evaluate((id) => {
        const l = document.querySelector('[data-testid="qtalk-messages"]');
        l.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -400 }));
        document.querySelector(`[data-msg-id="${id}"]`).scrollIntoView({ block: 'center' });
      }, target);
      await b.sleep(300);

      // ① 도구줄 → 답장
      const box = await page.evaluate((id) => { const r = document.querySelector(`[data-msg-id="${id}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 14) }; }, target);
      if (touch) await page.touchscreen.tap(box.x, box.y); else await page.mouse.move(box.x, box.y);
      await b.sleep(400);
      const btn = await page.evaluate(PAINTED, `[data-testid="chat-reply-${target}"]`);
      push(`${key} · 도구줄에 답장 버튼이 그려짐`, btn.ok, JSON.stringify(btn));
      if (!btn.ok) continue;
      await tapOrClick(page, `[data-testid="chat-reply-${target}"]`, touch);
      await b.sleep(400);
      const band = await page.evaluate(PAINTED, '[data-testid="chat-reply-band"]');
      const input = await page.evaluate(PAINTED, '[data-testid="qtalk-input"]');
      const bandText = await page.evaluate(() => document.querySelector('[data-testid="chat-reply-band"]')?.innerText || '');
      push(`${key} · 답장 띠가 그려지고 입력칸이 보임`, band.ok && input.ok && band.bottom <= input.top + 2 && /답장 확인용 메시지 1/.test(bandText),
        `띠 ${JSON.stringify(band)} · 입력 ${JSON.stringify(input)} · «${bandText.replace(/\n/g, ' / ')}»`);

      // ④ Esc (데스크탑만 — 터치 키보드엔 Esc 가 없다)
      if (!touch) {
        const T = (id) => Math.round(document.querySelector(`[data-msg-id="${id}"]`).getBoundingClientRect().top);
        const t0 = await page.evaluate(T, target);
        await page.focus('[data-testid="qtalk-input"]');
        await b.sleep(300);
        const t1 = await page.evaluate(T, target);
        await page.keyboard.press('Escape');
        await b.sleep(200);
        const gone = await page.evaluate(() => !document.querySelector('[data-testid="chat-reply-band"]'));
        const t2 = await page.evaluate(T, target);
        push(`${key} · 띠 열고 닫는 동안 목록이 튀지 않음`, Math.abs(t1 - t0) < 60 && Math.abs(t2 - t1) < 60, `원문 top ${t0} → 입력 누름 ${t1} → Esc ${t2}`);
        push(`${key} · Esc 로 답장 띠 닫힘`, gone, `닫힘=${gone}`);
        // 띠가 닫히면 목록 높이가 바뀌어 자리가 움직인다 — 다시 잰다
        const box2 = await page.evaluate((id) => { const r = document.querySelector(`[data-msg-id="${id}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 14) }; }, target);
        await page.mouse.move(box2.x, box2.y); await b.sleep(300);
        await tapOrClick(page, `[data-testid="chat-reply-${target}"]`, touch); await b.sleep(300);
        const again = await page.evaluate(() => !!document.querySelector('[data-testid="chat-reply-band"]'));
        push(`${key} · 닫은 뒤 다시 답장 누르면 띠가 다시 뜸`, again, `띠=${again}`);
      }

      // ② 보내기
      const text = `[카나리] 답장 본문 ${key}`;
      await page.focus('[data-testid="qtalk-input"]');
      await page.keyboard.type(text);
      await tapOrClick(page, '[data-testid="qtalk-send"]', touch);
      await b.sleep(1800);
      const [[row]] = await sequelize.query('SELECT id, reply_to_message_id r FROM messages WHERE conversation_id = ? AND content = ? ORDER BY id DESC LIMIT 1', { replacements: [ids.replyConv, text] });
      const bandGone = await page.evaluate(() => !document.querySelector('[data-testid="chat-reply-band"]'));
      push(`${key} · 저장된 답장 = 원문 id · 띠 사라짐`, !!row && Number(row.r) === target && bandGone, `DB reply_to=${row && row.r} 기대 ${target} · 띠 사라짐=${bandGone}`);
      if (!row) continue;
      await page.evaluate(() => { const l = document.querySelector('[data-testid="qtalk-messages"]'); l.scrollTop = l.scrollHeight; });
      await b.sleep(400);
      const qsel = `[data-msg-id="${row.id}"] [data-testid="chat-reply-quote"]`;
      const quote = await page.evaluate(PAINTED, qsel);
      push(`${key} · 새 메시지 위 인용 줄이 그려짐`, quote.ok, JSON.stringify(quote));

      // ⑥ 대조군 (첫 폭만)
      if (key.startsWith('폰')) {
        const h = await page.addStyleTag({ content: '[data-testid="chat-reply-quote"]{visibility:hidden!important}' });
        const bad = await page.evaluate(PAINTED, qsel);
        push(`${key} · 대조군: 인용 줄을 숨기면 판정이 뒤집힘`, !bad.ok, JSON.stringify(bad));
        await page.evaluate((el) => el.remove(), h);
        await b.sleep(200);
      }

      // ③ 원문으로 이동
      const VIEW = (id) => { const r = document.querySelector(`[data-msg-id="${id}"]`).getBoundingClientRect(); const l = document.querySelector('[data-testid="qtalk-messages"]').getBoundingClientRect(); return { top: Math.round(r.top), inView: r.top >= l.top - 1 && r.bottom <= l.bottom + 1 }; };
      const before = await page.evaluate(VIEW, target);
      await tapOrClick(page, qsel, touch);
      await b.sleep(1200);
      const after = await page.evaluate(VIEW, target);
      push(`${key} · 인용 줄 누르면 원문이 화면 안으로`, !before.inView && after.inView, `전 ${JSON.stringify(before)} → 후 ${JSON.stringify(after)}`);
    }

    // ⑤ 안 읽음 거르기 — 목록이 보이는 폭(데스크탑·폰 목록 화면)
    for (const { key, vp } of [VIEWPORTS[2], VIEWPORTS[0]]) {
      await page.setViewport(vp);
      await b.goto(page, '/talk');
      await page.waitForFunction((a) => !!document.querySelector(`[data-qtalk-chat="${a}"]`), { timeout: 15000 }, ids.readConv).catch(() => null);
      await b.sleep(600);
      const tog = await page.evaluate(PAINTED, '[data-testid="qtalk-filter-unread"]');
      if (!tog.ok) { push(`${key} · 안 읽음 버튼 그려짐`, false, JSON.stringify(tog)); continue; }
      const allN = await page.evaluate(() => document.querySelectorAll('[data-qtalk-chat]').length);
      await tapOrClick(page, '[data-testid="qtalk-filter-unread"]', key.startsWith('폰'));
      await b.sleep(400);
      const st = await page.evaluate((u, r) => {
        const rows = [...document.querySelectorAll('[data-qtalk-chat]')];
        const act = new URLSearchParams(location.search).get('conv');   // 지금 연 방은 배지가 없어도 남는다(읽는 순간 0)
        const bad = rows.filter((x) => !x.querySelector('[data-testid="qtalk-unread-badge"]') && x.getAttribute('data-qtalk-chat') !== act).length;
        return { n: rows.length, bad, hasUnread: !!document.querySelector(`[data-qtalk-chat="${u}"]`), hasRead: !!document.querySelector(`[data-qtalk-chat="${r}"]`) };
      }, ids.unreadConv, ids.readConv);
      push(`${key} · «안 읽음» 은 안 읽은 방만`, st.hasUnread && !st.hasRead && st.bad === 0 && st.n < allN, `전체 ${allN} → ${st.n} · 배지 없는 행 ${st.bad} · 안읽은방=${st.hasUnread} 읽은방=${st.hasRead}`);
      await tapOrClick(page, '[data-testid="qtalk-filter-all"]', key.startsWith('폰'));
      await b.sleep(300);
      const back = await page.evaluate(() => document.querySelectorAll('[data-qtalk-chat]').length);
      push(`${key} · «전체» 로 돌아옴`, back === allN, `${back} / ${allN}`);
    }
  } catch (e) {
    results.push({ name: 'canary-chat-reply', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    await cleanup(ids).catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-chat-reply' };
