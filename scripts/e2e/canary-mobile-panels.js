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

          // ── ①c 열린 채 다른 업무로 갈아타기(A→B) → X → 뒤로 = B 가 다시 열리면 안 된다 (2026-10-01 Fable FAIL)
          //   탭 모드에서 갈아타기를 새 칸으로 쌓으면 «바로 전 칸» 이 A 주소가 되어 닫기가 back 이 아니라 push 가 됐다.
          //   폰(미러)은 패널이 전면이라 옆 행을 누를 수 없다 — 탭 모드 폭만 잰다.
          if (!v.mirror) {
            await b.goto(page, '/dashboard');
            await b.goto(page, '/tasks');
            await b.dismissBlockers(page);
            if (await drawerOpen(page)) { await page.keyboard.press('Escape'); await sleep(800); }
            const clickRow = (i) => page.evaluate((i) => {
              // ★ 패널이 열리면 배경막이 목록을 덮어 실제 클릭은 옆 행에 안 닿는다(닫기가 된다).
              //   A→B 는 패널 안 «관련 업무» 링크·업무 찾기로 생긴다 — 같은 replace 이동을 행 click() 으로 재현한다.
              const rows = Array.from(document.querySelectorAll('[data-task-row]')).filter((r) => r.getBoundingClientRect().height > 0);
              // 지금 열린 업무가 아닌 행 — 같은 행을 다시 누르면 토글로 닫힌다
              const cur = (location.search.match(/task=(\d+)/) || [])[1];
              const row = rows.filter((r) => r.getAttribute('data-row-id') !== cur)[i];
              if (!row) return null;
              row.click();
              return row.getAttribute('data-row-id');
            }, i);
            const a = await clickRow(0); await sleep(1500);
            const qa = await page.evaluate(() => location.search);
            const bId = await clickRow(0); await sleep(1500);
            const qb = await page.evaluate(() => location.search);
            if (!a || !bId || !/task=/.test(qa) || !/task=/.test(qb) || qa === qb) {
              push(`${v.key} · ①c 픽스처`, false, `두 업무로 갈아타지 못했다 — 미측정 (${qa} → ${qb})`);
            } else {
              await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('[data-pq-drawer-panel] button, [role="dialog"][aria-modal="true"] button'))
                  .find((x) => /닫기|close/i.test((x.getAttribute('aria-label') || '') + (x.getAttribute('title') || '')));
                btn && btn.click();
              });
              await sleep(1000);
              const d1 = await page.evaluate(() => location.pathname + location.search);
              await page.goBack().catch(() => null); await sleep(1300);
              const d2 = await page.evaluate(() => location.pathname + location.search);
              const re = await drawerOpen(page);
              push(`${v.key} · ①c A→B 갈아탄 뒤 X → 뒤로 = 다시 열리지 않음`, !/task=/.test(d1) && !re && !/task=/.test(d2), `${qa} → ${qb} → 닫음 ${d1} → 뒤로 ${d2} · 패널=${re ? '다시 열림' : '닫힘'}`);
            }

            // ── ①d 다른 탭에 갔다 온 뒤 X → 뒤로 = 다시 열리지 않음 (2026-10-01, Fable 잔존 지적)
            //   탭 전환은 주소창을 replace 하며 칸 번호(pqIdx)를 버린다 → 닫기가 «전 칸» 을 몰라 push 로 떨어지고
            //   뒤로 가면 닫은 업무가 다시 열렸다.
            {
              const tabsInfo = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="tabstrip-tab-"]'))
                .map((el) => ({ id: el.getAttribute('data-testid'), sel: el.getAttribute('aria-selected') === 'true', text: el.innerText.trim() })));
              await b.goto(page, '/mail'); await sleep(1200);
              await b.goto(page, '/tasks'); await b.dismissBlockers(page); await sleep(1200);
              if (await drawerOpen(page)) { await page.keyboard.press('Escape'); await sleep(800); }
              const a2 = await clickRow(0); await sleep(1500);
              const q1 = await page.evaluate(() => location.search);
              const tl = await tabsInfo();
              const me = tl.find((x) => x.sel); const other = tl.find((x) => !x.sel);
              if (!a2 || !/task=/.test(q1) || !me || !other) {
                push(`${v.key} · ①d 픽스처`, false, `탭 ${tl.length}개 · ${q1} — 미측정`);
              } else {
                await page.click(`[data-testid="${other.id}"]`); await sleep(1200);
                await page.click(`[data-testid="${me.id}"]`); await sleep(1500);
                const q2 = await page.evaluate(() => location.search);
                await page.evaluate(() => {
                  const btn = Array.from(document.querySelectorAll('[data-pq-drawer-panel] button, [role="dialog"][aria-modal="true"] button'))
                    .find((x) => /닫기|close/i.test((x.getAttribute('aria-label') || '') + (x.getAttribute('title') || '')));
                  btn && btn.click();
                });
                await sleep(1000);
                const e1 = await page.evaluate(() => location.pathname + location.search);
                await page.goBack().catch(() => null); await sleep(1300);
                const e2 = await page.evaluate(() => location.pathname + location.search);
                const re2 = await drawerOpen(page);
                const ok2 = /task=/.test(q2) && !/task=/.test(e1) && !(e2.startsWith('/tasks') && /task=/.test(e2)) && !re2;
                push(`${v.key} · ①d 다른 탭 갔다 와서 X → 뒤로 = 다시 열리지 않음`, ok2, `${q1} → 탭 왕복 ${q2} → 닫음 ${e1} → 뒤로 ${e2} · 패널=${re2 ? '다시 열림' : '닫힘'}`);
              }
            }

            // ── ①e 탭 왕복 뒤 A→B 갈아타기 → X → 뒤로 = A 도 B 도 다시 열리지 않음 (Fable 2026-10-01 실측 잔존 경로)
            {
              const tabsInfo2 = () => page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="tabstrip-tab-"]'))
                .map((el) => ({ id: el.getAttribute('data-testid'), sel: el.getAttribute('aria-selected') === 'true' })));
              await b.goto(page, '/mail'); await sleep(1200);
              await b.goto(page, '/tasks'); await b.dismissBlockers(page); await sleep(1200);
              if (await drawerOpen(page)) { await page.keyboard.press('Escape'); await sleep(800); }
              const a3 = await clickRow(0); await sleep(1500);
              const p1 = await page.evaluate(() => location.search);
              const tl2 = await tabsInfo2();
              const me2 = tl2.find((x) => x.sel); const other2 = tl2.find((x) => !x.sel);
              if (!a3 || !/task=/.test(p1) || !me2 || !other2) {
                push(`${v.key} · ①e 픽스처`, false, `탭 ${tl2.length}개 · ${p1} — 미측정`);
              } else {
                await page.click(`[data-testid="${other2.id}"]`); await sleep(1200);
                await page.click(`[data-testid="${me2.id}"]`); await sleep(1500);
                const b3 = await clickRow(0); await sleep(1500);
                const p2 = await page.evaluate(() => location.search);
                if (!b3 || p2 === p1 || !/task=/.test(p2)) {
                  push(`${v.key} · ①e 픽스처`, false, `갈아타기 실패 ${p1} → ${p2} — 미측정`);
                } else {
                  await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('[data-pq-drawer-panel] button, [role="dialog"][aria-modal="true"] button'))
                      .find((x) => /닫기|close/i.test((x.getAttribute('aria-label') || '') + (x.getAttribute('title') || '')));
                    btn && btn.click();
                  });
                  await sleep(1000);
                  const f1 = await page.evaluate(() => location.pathname + location.search);
                  await page.goBack().catch(() => null); await sleep(1300);
                  const f2 = await page.evaluate(() => location.pathname + location.search);
                  const re3 = await drawerOpen(page);
                  const ok3 = !/task=/.test(f1) && !(f2.startsWith('/tasks') && /task=/.test(f2)) && !re3;
                  push(`${v.key} · ①e 탭 왕복 뒤 A→B → X → 뒤로 = 다시 열리지 않음`, ok3, `${p1} → 탭 왕복 → ${p2} → 닫음 ${f1} → 뒤로 ${f2} · 패널=${re3 ? '다시 열림' : '닫힘'}`);
                }
              }
            }

            // ── ①f 필터를 바꾼 뒤 업무 열기 → 뒤로 = 패널만 닫히고 필터는 그대로 (Fable 메모 2026-10-01)
            {
              await b.goto(page, '/dashboard');
              await b.goto(page, '/tasks'); await b.dismissBlockers(page); await sleep(1200);
              if (await drawerOpen(page)) { await page.keyboard.press('Escape'); await sleep(800); }
              const tabBtn = await page.$('[data-testid="qtask-tab-all"]');
              if (!tabBtn) { push(`${v.key} · ①f 픽스처`, false, '전체 업무 탭 버튼 없음 — 미측정'); }
              else {
                await tabBtn.click(); await sleep(1500);
                const g0 = await page.evaluate(() => location.search);
                const a4 = await clickRow(0); await sleep(1500);
                const g1 = await page.evaluate(() => location.search);
                if (!a4 || !/task=/.test(g1)) { push(`${v.key} · ①f 픽스처`, false, `업무 못 엶 ${g0} → ${g1} — 미측정`); }
                else {
                  await page.goBack().catch(() => null); await sleep(1300);
                  const g2 = await page.evaluate(() => location.pathname + location.search);
                  const re4 = await drawerOpen(page);
                  const ok4 = !re4 && g2.startsWith('/tasks') && !/task=/.test(g2) && g2.includes(g0.replace(/^\?/, '') || '__none__');
                  push(`${v.key} · ①f 필터 바꾼 뒤 업무 → 뒤로 = 패널만 닫히고 필터 유지`, ok4, `필터 ${g0} → 열기 ${g1} → 뒤로 ${g2} · 패널=${re4 ? '열림' : '닫힘'}`);
                }
              }
            }
          }
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
