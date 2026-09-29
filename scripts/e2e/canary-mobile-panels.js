// canary-mobile-panels — 폰·태블릿에서 우측패널·메뉴·쓰기 화면이 «나갈 수 있고 보이는가» (2026-09-29)
//
//   운영 #437 "확인필요에서 업무 누르면 닫지도 못하고 뒤로도 못가고 … 다른 우측패널도 다 동일, 헬프도"
//   운영 #441 "팝업이 열려도 햄버거가 나오네. 누르면 최상으로 메뉴가 떠야 해 / Cue 팝업이 햄버거 열린 채로"
//   운영 #436 "메일 답장 … 키보드 올리면 내용이 아예 안보여. 버튼이 꼭 같이 올라와야 해?"
//   운영 #427 "폴더 안에서 전체 삭제를 할 수 있어야 해" (전체 선택이 파일을 하나 고른 뒤에만 보였다)
//
// 재는 것
//   ① 뒤로 가기 = 패널 닫기 — 폰(미러 모드, useBackToClose). 탭 모드는 음성 대조
//   ①b 주소로 여는 패널(Q task) — 세 폭 모두: 뒤로=닫힘 · X 로 닫으면 주소가 깨끗하고 뒤로 가도 다시 안 열림(탭 모드는 UrlMirror) — 확인필요에서 업무를 열고 뒤로 → 패널 닫힘 + 같은 페이지
//      · 버튼(X)으로 닫으면 쌓아 둔 칸이 걷혀, 뒤로 한 번에 페이지를 떠난다(먹통 뒤로 없음)
//      · Q task(주소를 replace 로 바꿔 여는 패널)도 같다 · X 로 닫은 뒤 뒤로 가도 다시 열리지 않는다
//      · 탭 모드는 UrlMirror 가 탭 안 replace 를 replace 로 옮겨야 성립한다(push 로 쌓으면 닫은 업무가 다시 열렸다)
//   ② 패널이 떠 있어도 햄버거 메뉴는 **맨 위**에 그려진다(elementFromPoint) · 메뉴의 Cue 를 누르면 메뉴가 닫힌다
//      · 양성 대조군: 메뉴 z-index 를 옛 값(100)으로 되돌리면 ② 가 실패로 뒤집힌다
//   ③ 메일 답장 쓰기 모드(키보드 up): 앱 헤더 접힘 · 메타 줄 숨김 · 버튼 줄 붙박이 해제 · 원문이 보인다
//      · 음성 대조군: 키보드를 내리면 헤더·버튼 줄이 돌아온다
//   ④ Q file 선택 모드: 아무것도 안 골라도 [전체 선택] 이 보이고, 누르면 전부 골라진다
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAIL_THREAD = Number(process.env.E2E_MAIL_THREAD || 3609);

const VPS = [
  { key: '폰 390', mobile: true, mirror: true, vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '태블릿 768', mobile: true, vp: { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '데스크탑 1440', mobile: false, vp: { width: 1440, height: 900 } },
];
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const drawerOpen = (page) => page.evaluate(() => !!document.querySelector('[data-pq-drawer-panel], [role="dialog"][aria-modal="true"]'));
async function openInboxTask(page) {
  await b.goto(page, '/inbox');
  await b.dismissBlockers(page);
  const ok = await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]')).find((e) => /승인 대기|확인 요청|요청/.test(e.innerText) && !/답장/.test(e.innerText));
    if (!t) return false; t.click(); return true;
  });
  await sleep(1600);
  return ok;
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  const { browser } = await b.launch();
  try {
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport(v.vp);
      if (v.mobile) await page.setUserAgent(MOBILE_UA);
      page.setDefaultTimeout(30000);
      await b.login(page);

      // ── ① 뒤로 가기 = 닫기 ──
      if (!(await openInboxTask(page)) || !(await drawerOpen(page))) {
        push(`${v.key} · ① 픽스처`, false, '확인필요에 업무 카드가 없거나 패널이 안 열림 — 미측정');
      } else {
        await page.goBack().catch(() => null); await sleep(1200);
        const after = await page.evaluate(() => location.pathname);
        const open = await drawerOpen(page);
        if (!v.mirror) {
          // 탭 모드(태블릿·데스크탑): 화면 상태로 여는 패널은 훅이 비킨다(히스토리는 UrlMirror 한 곳) — 종전 동작
          push(`${v.key} · ① 음성 대조: 탭 모드는 훅이 칸을 쌓지 않는다(뒤로=페이지 떠남)`, after !== '/inbox', `주소=${after} · 패널=${open ? '열림' : '닫힘'}`);
        } else {
          push(`${v.key} · ① 뒤로 가기 → 패널만 닫힘`, !open && after === '/inbox', `패널=${open ? '열림' : '닫힘'} · 주소=${after}`);
          // X 로 닫은 뒤 뒤로 한 번이면 /inbox 를 떠나야 한다(칸이 걷혔는가)
          await openInboxTask(page);
          const closed = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('[data-pq-drawer-panel] button, [role="dialog"][aria-modal="true"] button'))
              .find((x) => /닫기|close/i.test((x.getAttribute('aria-label') || '') + (x.getAttribute('title') || '')));
            if (!btn) return false; btn.click(); return true;
          });
          await sleep(900);
          await page.goBack().catch(() => null); await sleep(1200);
          const after2 = await page.evaluate(() => location.pathname);
          push(`${v.key} · ① X 로 닫은 뒤 뒤로 한 번 = 페이지를 떠남`, closed && after2 !== '/inbox', `닫기 버튼=${closed} · 뒤로 뒤 주소=${after2}`);
        }
      }

      // ── ①b 주소로 여는 패널(Q task ?task= — replace 로 연다) ── 미러(폰)·탭 모드(태블릿·데스크탑) 모두
      {
        await b.goto(page, '/dashboard');
        await b.goto(page, '/tasks');
        await b.dismissBlockers(page);
        const openRow = () => page.evaluate(() => {
          // 행 자체를 누른다 — 행 onClick 은 버튼·링크 위 클릭을 무시한다
          const row = Array.from(document.querySelectorAll('[data-task-row]')).find((r) => r.getBoundingClientRect().height > 0);
          if (!row) return false;
          row.click(); return true;
        });
        // 이미 열려 있으면(마지막 업무 복원) 먼저 닫는다
        if (await drawerOpen(page)) { await page.keyboard.press('Escape'); await sleep(800); }
        const ok = await openRow(); await sleep(1500);
        if (!ok || !(await drawerOpen(page))) push(`${v.key} · ①b 픽스처`, false, 'Q task 업무 행을 못 열었다 — 미측정');
        else {
          await page.goBack().catch(() => null); await sleep(1300);
          const a = await page.evaluate(() => ({ path: location.pathname, q: location.search }));
          const o = await drawerOpen(page);
          push(`${v.key} · ①b Q task 업무 → 뒤로 = 패널만 닫힘`, !o && a.path === '/tasks' && !/task=/.test(a.q), `패널=${o ? '열림' : '닫힘'} · ${a.path}${a.q}`);
          await openRow(); await sleep(1500);
          await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('[data-pq-drawer-panel] button, [role="dialog"][aria-modal="true"] button'))
              .find((x) => /닫기|close/i.test((x.getAttribute('aria-label') || '') + (x.getAttribute('title') || '')));
            btn && btn.click();
          });
          await sleep(1000);
          const c1 = await page.evaluate(() => location.pathname + location.search);
          await page.goBack().catch(() => null); await sleep(1300);
          const c2 = await page.evaluate(() => location.pathname + location.search);
          const reopened = await drawerOpen(page);
          push(`${v.key} · ①b X 로 닫으면 주소에서 ?task= 가 빠지고, 뒤로 = 다시 열리지 않고 떠남`, !/task=/.test(c1) && !reopened && !/task=/.test(c2) && !c2.startsWith('/tasks'), `닫은 뒤 ${c1} → 뒤로 ${c2} · 패널=${reopened ? '다시 열림' : '닫힘'}`);
        }
      }

      // ── ② 메뉴는 맨 위 · Cue 누르면 메뉴 닫힘 (좁은 폭만 — 데스크탑은 메뉴가 늘 떠 있다) ──
      if (v.mobile && v.vp.width <= 1024) {
        await openInboxTask(page);
        const probe = async () => page.evaluate(() => {
          const hb = Array.from(document.querySelectorAll('button')).find((x) => /사이드바 펼치기|expand/i.test(x.getAttribute('aria-label') || ''));
          if (!hb) return { err: 'no_hamburger' };
          hb.click();
          return { ok: true };
        });
        const p1 = await probe(); await sleep(600);
        const onTop = async () => page.evaluate(() => {
          const cue = document.querySelector('[data-testid="nav-cue"]');
          if (!cue) return { err: 'no_nav_cue' };
          const r = cue.getBoundingClientRect();
          const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { top: !!h && (h === cue || cue.contains(h)), hit: h ? h.tagName + '.' + String(h.className).split(' ')[0] : null };
        });
        const t1 = p1.err ? p1 : await onTop();
        push(`${v.key} · ② 패널 위에서 연 메뉴가 맨 위에 그려짐`, !t1.err && t1.top, JSON.stringify(t1));
        // 양성 대조군 — 옛 층(100)으로 되돌리면 뒤집혀야 한다
        if (!t1.err) {
          const bad = await page.evaluate(() => {
            const cue = document.querySelector('[data-testid="nav-cue"]');
            let sb = cue; while (sb && getComputedStyle(sb).position !== 'fixed') sb = sb.parentElement;
            if (!sb) return { err: 'no_sidebar' };
            const prev = sb.style.zIndex; sb.style.zIndex = '100';
            const r = cue.getBoundingClientRect();
            const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            const top = !!h && (h === cue || cue.contains(h));
            sb.style.zIndex = prev;
            return { top };
          });
          push(`${v.key} · ② 대조군: 옛 층(100)이면 패널 뒤로 깔린다`, !bad.err && bad.top === false, JSON.stringify(bad));
          // Cue 누르면 메뉴 닫힘
          await page.evaluate(() => document.querySelector('[data-testid="nav-cue"]').click());
          await sleep(900);
          const st = await page.evaluate(() => {
            const cue = document.querySelector('[data-testid="nav-cue"]');
            let sb = cue; while (sb && getComputedStyle(sb).position !== 'fixed') sb = sb.parentElement;
            const r = sb ? sb.getBoundingClientRect() : null;
            return { sidebarVisible: !!r && r.right > 10, closeBtn: !!Array.from(document.querySelectorAll('button')).find((x) => /메뉴 닫기/.test(x.getAttribute('aria-label') || '') && x.getBoundingClientRect().right > 10) };
          });
          push(`${v.key} · ② 메뉴에서 Cue 를 열면 메뉴는 닫힌다`, !st.sidebarVisible, JSON.stringify(st));
        }
        await page.keyboard.press('Escape').catch(() => null);
      }

      // ── ③ 메일 답장 쓰기 모드 (폰만 — 키보드 계약은 ≤768) ──
      if (v.key.startsWith('폰')) {
        await b.goto(page, `/mail?thread=${MAIL_THREAD}`);
        await b.dismissBlockers(page);
        await sleep(1200);
        const btn = await page.$('[data-testid="mail-reply-open"]');
        if (!btn) { push(`${v.key} · ③ 픽스처`, false, `메일 ${MAIL_THREAD} 답장 버튼 없음 — 미측정`); }
        else {
          await btn.click(); await sleep(1400);
          const ed = await page.$('[data-pq-writing] [contenteditable="true"]');
          if (!ed) { push(`${v.key} · ③ 픽스처`, false, '답장 에디터 없음 — 미측정'); }
          else {
            await ed.focus();
            const cdp = await page.target().createCDPSession();
            const H = v.vp.height;
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.vp.width, height: H - 336, mobile: true, deviceScaleFactor: 2 });
            await sleep(900);
            const m = () => page.evaluate(() => {
              const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
              const hb = Array.from(document.querySelectorAll('[data-pq-mobile-header] button')).find((x) => vis(x));
              const meta = document.querySelector('[data-testid="detail-meta-bar"]');
              const send = Array.from(document.querySelectorAll('[data-pq-writing] button')).find((x) => /보내기|Send/.test(x.innerText));
              let bar = send; while (bar && getComputedStyle(bar).position !== 'sticky' && bar.parentElement && !bar.parentElement.hasAttribute('data-pq-writing')) bar = bar.parentElement;
              const foot = document.querySelector('[data-pq-writing]');
              const msgs = foot && foot.previousElementSibling;
              return {
                kb: document.body.getAttribute('data-keyboard-up'),
                header: !!hb, meta: vis(meta),
                actions: bar ? getComputedStyle(bar).position : 'none',
                msgsH: msgs ? Math.round(msgs.getBoundingClientRect().height) : -1,
                vvh: Math.round(visualViewport.height),
              };
            });
            const up = await m();
            push(`${v.key} · ③ 키보드 up: 헤더 접힘 · 메타 숨김 · 버튼 줄 붙박이 해제`,
              up.kb === '1' && !up.header && !up.meta && up.actions !== 'sticky', JSON.stringify(up));
            push(`${v.key} · ③ 키보드 up: 원문이 보인다(≥ 80px)`, up.msgsH >= 80, `원문 영역 ${up.msgsH}px / 보이는 높이 ${up.vvh}`);
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.vp.width, height: H, mobile: true, deviceScaleFactor: 2 });
            await sleep(900);
            const down = await m();
            push(`${v.key} · ③ 음성 대조: 키보드 내리면 헤더·메타·붙박이 버튼 복귀`,
              down.kb !== '1' && down.header && down.meta && down.actions === 'sticky', JSON.stringify(down));
            await cdp.detach().catch(() => {});
            // 답장창 닫기 — 남기면 초안이 다음 실행에 섞인다
            await page.evaluate(() => { const c = Array.from(document.querySelectorAll('[data-pq-writing] button')).find((x) => /^(취소|Cancel)$/.test(x.innerText.trim())); c && c.click(); });
            await sleep(600);
          }
        }
      }

      // ── ④ Q file 선택 모드 — 고르기 전에도 [전체 선택] ──
      await b.goto(page, '/files');
      await b.dismissBlockers(page);
      await sleep(1200);
      const entered = await page.evaluate(() => {
        const x = Array.from(document.querySelectorAll('button')).find((e) => /^(선택|Select)$/.test(e.innerText.trim()));
        if (!x) return false; x.click(); return true;
      });
      await sleep(700);
      const sa = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="files-bulk-bar"]');
        const btn = document.querySelector('[data-testid="files-bulk-select-all"]');
        if (!bar || !btn) return { bar: !!bar, btn: !!btn };
        const r = btn.getBoundingClientRect();
        const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { bar: true, btn: true, painted: !!h && (h === btn || btn.contains(h)), text: bar.innerText.split('\n')[0] };
      });
      push(`${v.key} · ④ 선택 모드에서 고르기 전에도 [전체 선택] 이 보인다`, entered && sa.painted, JSON.stringify({ entered, ...sa }));
      if (sa.painted) {
        await page.click('[data-testid="files-bulk-select-all"]'); await sleep(500);
        const txt = await page.evaluate(() => document.querySelector('[data-testid="files-bulk-bar"]').innerText.split('\n')[0]);
        const n = Number((txt.match(/(\d+)/) || [])[1] || 0);
        push(`${v.key} · ④ [전체 선택] 을 누르면 골라진다`, n > 0, txt);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { name: '폰·태블릿 우측패널 뒤로 · 메뉴 층 · 메일 쓰기 모드 · 폴더 전체 선택 (#437·#441·#436·#427)', run };
