// Q info "삭제된 항목" 되돌리기 카나리 — 2026-09-09 신설. run.js `--suite qinfoundo`.
//
// 왜: 운영 #408 — Irene 이 Q info 항목을 실수로 지웠고 되돌릴 방법이 화면에 없었다.
//   ★ 값은 사실 지워지지 않고 있었다(저장 라우트가 custom_values 를 머지한다).
//     없었던 것은 저장이 아니라 **그 값을 다시 꺼낼 화면**이다. 그래서 이 카나리는
//     "라우트가 있다" 가 아니라 **사용자가 화면에서 실제로 되돌릴 수 있는가**를 본다.
//
// ★ 크기만 재지 않는다 — rect 가 있어도 조상이 높이 0 + overflow:hidden 이면 한 픽셀도
//   안 그려진다(2026-09 실사례). 조상 클리핑 + elementFromPoint 로 **보이는지**까지 본다.
// ★ 클릭은 page.mouse.click — 합성 click 은 mousedown 이 없어 실제 눌림과 다르다.
// ★ 음성 대조군 포함 — 지운 항목이 없는 자료에는 그 박스가 **뜨지 않아야** 한다.
//   (박스가 늘 떠 있으면 "되돌릴 수 있다" 가 아니라 그냥 장식이다.)
const b = require('./lib/browser');

const CRASH_RE = /Minified React error|Something went wrong|문제가 발생/i;

async function run() {
  const results = [];
  const push = (name, ok, details) => results.push({ name, fail: ok ? 0 : 1, details: [details] });
  const { browser, page } = await b.launch();
  const made = [];
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/info');
    await b.sleep(2500);

    // ── 씨앗 — 옛 데이터와 같은 모양(지운 정의 없이 값만 고아로 남은 상태) ────────
    //   운영 doc#36 이 정확히 이 모양이다. 이름을 못 살려 "이름 추정" 으로 떠야 한다.
    const seed = await page.evaluate(async () => {
      const tok = window.__pqGetToken ? window.__pqGetToken() : '';
      const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
      const me = await (await fetch('/api/auth/me', { headers: H })).json();
      const biz = (me.data.businesses && me.data.businesses[0] && me.data.businesses[0].id) || me.data.active_business_id;
      const cols = [
        { id: 'cnry_link', name: '링크', type: 'url', show_in_list: true },
        { id: 'cnry_id', name: '아이디', type: 'text', show_in_list: true },
      ];
      const vals = { cnry_link: 'https://example.test/canary408', cnry_id: 'CNRY-408' };
      const mk = async (title, keepBoth) => {
        const r = await fetch(`/api/businesses/${biz}/kb/documents`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ title, category: 'manual', scope: 'workspace', custom_columns: cols, custom_values: vals }),
        });
        const j = await r.json();
        const id = j.data.id;
        if (!keepBoth) {
          // 항목만 빼고 값은 그대로 → 고아(= 지운 항목). __removed_cols 는 일부러 안 남긴다.
          await fetch(`/api/businesses/${biz}/kb/documents/${id}`, {
            method: 'PUT', headers: H, body: JSON.stringify({ custom_columns: [cols[1]] }),
          });
        }
        return id;
      };
      return { biz, withRemoved: await mk('[카나리] 지운 항목 있음', false), clean: await mk('[카나리] 지운 항목 없음', true) };
    });
    made.push(seed.withRemoved, seed.clean);

    // 화면에서 "보이는가" 를 재는 단일 자 — 조상 클리핑 + elementFromPoint.
    const probe = async (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return { found: false };
      // ★ 재기 전에 화면 안으로. elementFromPoint 는 뷰포트 **밖** 좌표에 null 을 준다 —
      //   스크롤을 안 하면 "가려짐" 과 "화면 밖" 이 같은 얼굴이 된다(2026-09-09 거짓 빨간불).
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      let node = el.parentElement, clipped = false;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        const pr = node.getBoundingClientRect();
        if ((cs.overflow !== 'visible' || cs.overflowY !== 'visible') && (pr.height === 0 || pr.width === 0)) { clipped = true; break; }
        node = node.parentElement;
      }
      const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy);
      return {
        found: true, w: Math.round(r.width), h: Math.round(r.height), cx, cy, clipped,
        onTop: !!hit && (hit === el || el.contains(hit) || hit.contains(el)),
        text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
      };
    }, sel);

    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));

    // ── ① 지운 항목이 있는 자료 — 박스가 실제로 보인다 ────────────────────────
    await b.gotoSPA(page, `/info?doc=${seed.withRemoved}`);
    await b.sleep(2500);
    const box = await probe('[data-testid="qinfo-removed-cols"]');
    push('① "삭제된 항목" 박스가 화면에 실제로 보인다',
      box.found && box.w > 0 && box.h > 0 && !box.clipped && box.onTop,
      JSON.stringify(box));
    push('① 값과 "이름 추정" 이 같이 보인다',
      !!box.text && box.text.includes('canary408') && /이름 추정|name guessed/.test(box.text),
      JSON.stringify(box.text));

    // ── ② 되돌리기 버튼이 보이고, 실제로 눌린다 ──────────────────────────────
    const btn = await probe('[data-testid="qinfo-restore-cnry_link"]');
    push('② 되돌리기 버튼이 보인다(터치 타깃 36px 이상)',
      btn.found && btn.h >= 36 && !btn.clipped && btn.onTop, JSON.stringify(btn));
    if (btn.found && btn.onTop) {
      await page.mouse.click(btn.cx, btn.cy);   // 합성 click 금지 — mousedown 이 없다
      await b.sleep(2000);
    }
    const after = await page.evaluate(async (docId) => {
      const tok = window.__pqGetToken ? window.__pqGetToken() : '';
      const me = await (await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + tok } })).json();
      const biz = (me.data.businesses && me.data.businesses[0] && me.data.businesses[0].id) || me.data.active_business_id;
      const r = await fetch(`/api/businesses/${biz}/kb/documents/${docId}`, { headers: { Authorization: 'Bearer ' + tok } });
      const j = await r.json();
      return { cols: (j.data.custom_columns || []).map((c) => c.id), val: (j.data.custom_values || {}).cnry_link, body: String(j.data.body || '') };
    }, seed.withRemoved);
    push('② 눌렀더니 항목이 실제로 돌아왔다', after.cols.includes('cnry_link'), JSON.stringify(after.cols));
    push('② 값이 그대로', after.val === 'https://example.test/canary408', String(after.val));
    push('② 본문에도 다시 들어갔다', after.body.includes('canary408'), JSON.stringify(after.body.slice(0, 80)));

    // ── ③ 음성 대조군 — 지운 항목이 없으면 박스가 없다 ───────────────────────
    // ★ SPA 이동은 즉시 반영되지 않는다 — 제목이 바뀔 때까지 기다린다.
    //   안 기다리면 **앞 문서를 다시 재고** 음성 대조군이 거짓 실패한다(2026-09-09 실측).
    await b.goto(page, `/info?doc=${seed.clean}`);
    await page.waitForFunction(
      () => document.body.innerText.includes('지운 항목 없음'),
      { timeout: 20000 },
    ).catch(() => null);
    await b.sleep(1200);
    const cleanShown = await page.evaluate(() => document.body.innerText.includes('지운 항목 없음'));
    push('③ 대조군 문서가 실제로 열렸다(전제 확인)', cleanShown, '제목 확인');
    const none = await probe('[data-testid="qinfo-removed-cols"]');
    push('③ 음성 대조군 — 지운 항목이 없으면 박스가 안 뜬다', !none.found, JSON.stringify(none));

    const bodyTxt = await page.evaluate(() => document.body.innerText.slice(0, 400));
    push('③ 에러 0', errs.length === 0 && !CRASH_RE.test(bodyTxt), `pageerror ${errs.length} ${JSON.stringify(errs.slice(0, 2))}`);
  } catch (e) {
    results.push({ name: 'qinfo-undo:하니스', error: true, fatal: 1, details: [e.message] });
  } finally {
    // 씨앗 정리 — 남기면 다음 회차가 남의 자료를 보고 판정한다.
    try {
      await page.evaluate(async (ids) => {
        const tok = window.__pqGetToken ? window.__pqGetToken() : '';
        const H = { Authorization: 'Bearer ' + tok };
        const me = await (await fetch('/api/auth/me', { headers: H })).json();
        const biz = (me.data.businesses && me.data.businesses[0] && me.data.businesses[0].id) || me.data.active_business_id;
        for (const id of ids) await fetch(`/api/businesses/${biz}/kb/documents/${id}`, { method: 'DELETE', headers: H }).catch(() => null);
      }, made);
    } catch { /* */ }
    await browser.close().catch(() => null);
  }
  return results;
}

module.exports = { name: 'qinfo-undo — 지운 항목을 화면에서 되돌릴 수 있는가', run };
if (require.main === module) run().then((r) => { r.forEach((x) => console.log((x.fail || x.fatal ? '❌' : '✅'), x.name, '—', (x.details || []).join(' '))); });
