#!/usr/bin/env node
// canary-header-drift — **모든 앱 화면**의 머리줄이 스크롤에 딸려 올라가지 않는가. 3폭 전수.
//
// Irene 2026-09-15: "문서 메뉴에서 상단이 스크롤 따라 자꾸 들어가" → 고친 뒤 "다른 모든 곳도
//   체크해. 같은 UI/UX 문제 없는지."
//
// ★ 왜 화면마다가 아니라 전수인가
//   Q docs 의 원인은 페이지 껍데기가 `height: 100vh` 로 **탭 스크롤 슬롯을 넘은 것**이었다.
//   그 실수는 화면마다 따로 저지를 수 있고, 저질러도 **에러가 안 난다** — 그냥 위가 올라간다.
//   한 화면씩 눈으로 보는 것은 답이 아니다(memory feedback_fix_structure_not_screen).
//
// ★ 머리줄을 휴리스틱으로 찾지 않는다
//   2026-09-15 실측 — "높이 40~80 의 가로 띠" 로 찾았더니 **알림 권한 배너**("디바이스 알림이
//   차단되어 있습니다")를 머리줄로 집었다. 그래서 공용 프리미티브에 확정 손잡이를 달았다:
//   PageShell → `page-header` · PanelHeader → `panel-header` (CLAUDE.md §17).
//   손잡이가 없는 화면은 **미측정으로 보고**한다 — 통과로 세지 않는다.
const b = require('./lib/browser');

// ★ 이 스위트는 라우트 × 폭 = 100회 넘게 이동한다. 한 페이지 인스턴스로 끝까지 가면
//   Chrome 이 불어나 **OOM 으로 죽는다**(2026-09-15 이 서버 7.9GB 에서 3회 죽었다 — 그중 2회는
//   다른 브라우저 스위트와 병렬로 돌려서였다). 두 가지로 상한을 둔다:
//   ① HDR_VPS 로 폭을 골라 청크 실행 (예: HDR_VPS=폰) — memory feedback_chunked_verification
//   ② 라우트 PAGE_RECYCLE 개마다 page 를 새로 연다(누적 메모리를 끊는다)
//   ★ 브라우저 스위트를 **병렬로 돌리지 않는다.** 죽은 검사는 빨간불도 아니고 그냥 없는 검사다.
//   ★ 이 서버에는 **PurpleHere POS 가 같이 산다.** 그쪽 `tsc --noEmit` 이 2.8GB 를 쥐는 것을
//     실측했다(2026-09-15 OOM 의 공범). 내 쪽만 순차로 돌려도 남의 빌드와 겹치면 죽는다 —
//     OOM 으로 죽었으면 **결과 0줄을 «통과» 로 읽지 말고** 메모리를 먼저 보라(free -m · ps rss).
const ALL_VPS = [
  { key: '폰',       w: 390,  h: 844 },
  { key: '태블릿',   w: 834,  h: 1112 },
  { key: '데스크탑', w: 1440, h: 900 },
];
const WANT_VPS = (process.env.HDR_VPS || '').split(',').map((x) => x.trim()).filter(Boolean);
const VPS = WANT_VPS.length ? ALL_VPS.filter((v) => WANT_VPS.includes(v.key)) : ALL_VPS;
const PAGE_RECYCLE = Number(process.env.HDR_RECYCLE || 12);
const SCROLL = 500;
const DRIFT_OK = 2;

// ★ 실제 라우트만 넣는다. 2026-09-15 첫 실행에 `/clients`·`/signatures`·`/help` 를 넣었는데
//   **셋 다 없는 경로**였다(정본은 `/business/clients`·`/signatures/received`·`/help-popout`).
//   SPA 는 없는 페이지도 200 이라 «머리줄 손잡이 없음» 으로만 보이고 조용히 미측정이 된다
//   (memory feedback_http_200_is_not_content). 목록은 App.tsx 의 path= 와 대조해 유지한다.
const ROUTES = (process.env.HDR_ROUTES || [
  '/dashboard', '/inbox', '/todo', '/talk', '/mail', '/tasks', '/projects', '/calendar',
  '/notes', '/docs', '/info', '/files', '/bills', '/billing', '/sale', '/knowledge',
  '/personal-vault', '/records', '/attendance', '/insights', '/signatures/received', '/guide',
  '/stats',
  '/business/settings', '/business/members', '/business/clients', '/business/org',
  '/business/settings/notifications',
  '/profile', '/profile/integrations', '/me/work-settings', '/me/feedback',
  '/notifications', '/whats-new', '/settings', '/admin/dashboard', '/admin/users',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const results = [];
const P = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

/** 바깥(탭 슬롯 쪽) 스크롤러를 굴리고, 각 머리줄의 y 변화를 돌려준다 */
const MEASURE = `(px) => {
  const heads = [...document.querySelectorAll('[data-testid="page-header"],[data-testid="panel-header"]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 40 && r.height > 8; });
  if (!heads.length) return { none: true };

  // 굴릴 대상 = 머리줄의 **조상** 중 실제로 넘치는 것들(= 바깥 컨테이너).
  //   머리줄이 패널 안에 얌전히 있으면 이런 조상이 없고, 그게 정상이다.
  // * 첫 번째에서 멈추지 않는다 — 안쪽 스크롤러와 바깥 슬롯이 겹치면 첫 번째는 안쪽이고
  //   진짜 범인은 바깥이다. 안쪽만 굴리면 머리줄은 원래 안 움직이므로 **거짓 초록**이 된다.
  //   조상 사슬에서 넘치는 것을 **전부** 모아 같이 굴린다.
  const targets = new Set();
  for (const el of heads) {
    let n = el.parentElement;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 8) targets.add(n);
      n = n.parentElement;
    }
  }
  const de = document.scrollingElement;
  const docScrolls = de.scrollHeight > de.clientHeight + 8;
  if (docScrolls) targets.add(de);
  if (!targets.size) {
    return { ok: true, heads: heads.length, moved: 0, why: '머리줄 위로 굴러가는 컨테이너가 없다 (정상)' };
  }

  const before = heads.map((el) => Math.round(el.getBoundingClientRect().top));
  const prev = [...targets].map((t) => [t, t.scrollTop]);
  for (const [t, p0] of prev) { t.scrollTop = p0 + px; void t.offsetHeight; }
  const movedTotal = prev.reduce((a, [t, p0]) => a + (t.scrollTop - p0), 0);
  const after = heads.map((el) => Math.round(el.getBoundingClientRect().top));
  for (const [t, p0] of prev) t.scrollTop = p0;

  const drifts = before.map((y, i) => Math.abs(after[i] - y));
  return {
    heads: heads.length, moved: movedTotal,
    maxDrift: Math.max(...drifts),
    detail: before.map((y, i) => y + '→' + after[i]).join(' · '),
  };
}`;

async function run() {
  const { browser, page: firstPage } = await b.launch({});
  let page = firstPage;
  const noHandle = [];
  let measured = 0;
  try {
    await b.login(page);
    let sinceRecycle = 0;
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h });
      const bad = [];
      let skipped = 0, seen = 0;
      for (const r of ROUTES) {
        // 누적 메모리를 끊는다 — 쿠키는 브라우저 컨텍스트에 남으므로 재로그인은 필요 없다
        if (++sinceRecycle >= PAGE_RECYCLE) {
          sinceRecycle = 0;
          const fresh = await browser.newPage();
          fresh.setDefaultTimeout(30000);
          await fresh.setViewport({ width: vp.w, height: vp.h });
          await page.close().catch(() => {});
          page = fresh;
        }
        let m;
        try {
          await b.goto(page, r);
          await b.sleep(1000);
          await b.dismissBlockers(page).catch(() => {});
          m = await page.evaluate((src, px) => eval(src)(px), MEASURE, SCROLL);
        } catch (e) { bad.push(`${r} ERR ${String(e.message).slice(0, 34)}`); continue; }
        if (m.none) { skipped++; if (vp.key === '데스크탑') noHandle.push(r); continue; }
        seen++;
        if (m.ok || m.moved < 40) { measured++; continue; }   // 굴릴 것이 없으면 구조상 안전
        measured++;
        if (m.maxDrift > DRIFT_OK) bad.push(`${r} 드리프트 ${m.maxDrift}px (${m.detail} · ${m.moved}px 굴림)`);
      }
      P(`[${vp.key}] 머리줄이 스크롤에 딸려 올라가지 않는다`, bad.length === 0,
        bad.length ? bad.join(' | ') : `${seen}/${ROUTES.length} 화면 판정 · 손잡이 없음 ${skipped}`);
    }

    // ★ 양성 대조군 — 검사기가 살아 있는가. Q docs 껍데기에 100vh 를 되살리면 잡아야 한다.
    await page.setViewport({ width: 1440, height: 900 });
    await b.goto(page, '/docs');
    await b.sleep(1500); await b.dismissBlockers(page).catch(() => {});
    // * 처음엔 «grid + overflow:hidden 인 조상» 을 Q docs Layout 으로 보고 그 부모에 100vh 를
    //   박았다. 그런데 사이드바 안에도 그 조건에 맞는 요소가 있어 **엉뚱한 것을 집었고**,
    //   대조군이 0px 굴림으로 조용히 실패했다(2026-09-15 실측). 추측으로 찾지 않는다 —
    //   **탭 슬롯을 먼저 찾고, 머리줄을 품은 그 직계 자식**(= 페이지 껍데기)에 박는다.
    const revived = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="panel-header"]');
      if (!h) return { ok: false, why: 'panel-header 없음' };
      let slot = h.parentElement;
      while (slot && slot !== document.documentElement) {
        const st = getComputedStyle(slot);
        if (/(auto|scroll)/.test(st.overflowY) && slot.clientHeight > 0) break;
        slot = slot.parentElement;
      }
      if (!slot || slot === document.documentElement) return { ok: false, why: '탭 슬롯을 못 찾음' };
      const shell = [...slot.children].find((c) => c.contains(h));
      if (!shell) return { ok: false, why: '슬롯 안에서 껍데기를 못 찾음' };
      const beforeH = Math.round(shell.getBoundingClientRect().height);
      shell.style.height = '100vh';
      const afterH = Math.round(shell.getBoundingClientRect().height);
      // 정말 넘치게 만들었는지 **그 자리에서 확인**한다 — 못 만들었으면 대조군이 아니다
      return { ok: slot.scrollHeight > slot.clientHeight + 8, why: '',
               slotH: slot.clientHeight, beforeH, afterH, slotSH: slot.scrollHeight };
    });
    if (!revived.ok) P('양성 대조군 — 결함을 되살릴 수 있다', false,
      `${revived.why || '넘치게 만들지 못했다'} (슬롯 ${revived.slotH} · 껍데기 ${revived.beforeH}→${revived.afterH} · 슬롯 sh ${revived.slotSH})`);
    else {
      await b.sleep(300);
      const ctl = await page.evaluate((src, px) => eval(src)(px), MEASURE, SCROLL);
      P('양성 대조군 — 100vh 를 되살리면 **잡는다**',
        !ctl.none && !ctl.ok && ctl.moved >= 40 && ctl.maxDrift > DRIFT_OK,
        ctl.none ? '머리줄 없음'
          : ctl.ok ? `굴러가는 조상이 없다 — 대조군이 안 세워졌다 (${ctl.why || ''})`
          : `드리프트 ${ctl.maxDrift}px (${ctl.detail} · ${ctl.moved}px 굴림) · 껍데기 ${revived.beforeH}→${revived.afterH} vs 슬롯 ${revived.slotH}`);
    }

    P('커버리지 — 무엇을 쟀고 무엇을 못 쟀는가', true,
      `${VPS.length}폭(${VPS.map((v) => v.key).join('/')}) × ${ROUTES.length}라우트 = 판정 ${measured}건 · ` +
      `머리줄 손잡이 없는 화면 ${noHandle.length}곳${noHandle.length ? ': ' + noHandle.join(' ') : ''}`);
  } finally { await browser.close(); }
  return results;
}

module.exports = { name: 'headerdrift', run };

if (require.main === module) {
  run().then((rs) => {
    let f = 0;
    for (const x of rs) { if (x.fail) f++; console.log(`${x.fail ? '✗' : '✓'} ${x.name}${x.details.length ? '\n    ' + x.details.join('\n    ') : ''}`); }
    console.log(f ? `\n✗ 실패 ${f}/${rs.length}` : `\n✓ 전부 통과 (${rs.length})`);
    process.exit(f ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e); process.exit(1); });
}
