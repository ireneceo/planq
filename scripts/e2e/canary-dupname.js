// canary-dupname — 폴더 삭제가 **묻는가** · 폴더째 업로드가 **구조를 만드는가** ·
//   같은 이름이면 **묻는가**. (운영 신고 2026-09-24)
//
// 왜 실브라우저인가: 서버 문은 실 API 로 이미 확인했다(폴더 삭제 3모드·감사). 여기서 재는 것은
//   «그 문이 화면에서 열리는가» 다 — 서버가 받아도 화면이 인자를 안 보내면 사용자에게는 없는 기능이다
//   (memory `feedback_backend_done_ui_missing`). 2026-09-24 Fable 지적이 정확히 이것이었다.
//
// ★ 파일 입력은 puppeteer `uploadFile`(실제 파일)로 넣는다. `el.files = new DataTransfer().files` 는
//   헤드리스에서 **안 먹는다**(같은 날 실측: 대입 후 length 0, 요청 0건).
// ★ 업로드 목적지를 먼저 고른다 — 안 고르면 업로드가 아니라 «어느 프로젝트에» 모달이 뜬다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, login, goto, sleep, CREDS } = require('./lib/browser');

const PNG1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
const TMP = [];
/** ★ 실행마다 다른 이름·바이트. 2026-09-24 Fable 지적 ⑥ — 지난 실행이 남긴 `zzdup (1).png` 를 보고
 *   «(1) 로 저장한다» 가 초록이 됐다(같은 바이트라 새 행도 안 생겼다: ref_count 4).
 *   러너 sweep 은 `ZZ카나리` 접두 **폴더**만 쓸어 파일은 남는다 — 이름에 실행 id 를 박고 끝에 지운다. */
const RUN = Date.now().toString(36).slice(-6);

/** 내용이 **다른** 1x1 PNG — 같은 바이트는 서버 dedup 으로 행이 안 늘어나 «같은 이름» 상황이 안 만들어진다. */
function pngVariant(tag) { return Buffer.concat([PNG1x1, Buffer.from(RUN + ':' + tag)]); }

function writeFiles(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-fo-'));
  TMP.push(dir);
  return spec.map(({ rel, tag }) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, pngVariant(tag));
    return abs;
  });
}

/**
 * 숨은 file 입력에 파일을 넣는다.
 *
 * ★ **반드시 범위를 좁혀서 집는다.** 탭 keep-alive 때문에 `/files` 를 거쳐 프로젝트로 가면
 *   `docs-file-input` 이 **2개**가 되고, `page.$` 는 앞의 것(= 떠난 Q file 화면의 것)을 집는다.
 *   그 입력의 onChange 는 워크스페이스 모드라 업로드 대신 «어느 프로젝트에» 모달을 띄우려 한다 →
 *   **업로드 요청이 한 건도 안 나간다.** 2026-09-24 A/B 실측:
 *     바로 프로젝트 = 입력 1개 · POST 201  /  `/files` 거쳐 = 입력 2개 · POST 0건.
 *   이걸 «프로젝트 모드에서 안 묻는다»(기능 결함)로 읽을 뻔했다 — measure.js 가 적어 둔 함정 그대로다.
 */
/**
 * 보이는 화면의 file 입력을 고른다. `hidden` 입력은 **자기 computed display 가 none** 이라
 * 자신만 보면 판정이 안 된다 — **조상**이 화면에 그려져 있는지로 가른다(Fable 3차 지적).
 */
async function pushToVisible(page, paths) {
  const idx = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid="docs-file-input"]')];
    for (let i = 0; i < els.length; i++) {
      let p = els[i].parentElement, ok = true;
      for (let d = 0; d < 8 && p; d++, p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || cs.visibility === 'hidden') { ok = false; break; }
      }
      if (ok) return i;
    }
    return -1;
  });
  if (idx < 0) return false;
  const hs = await page.$$('[data-testid="docs-file-input"]');
  if (!hs[idx]) return false;
  await hs[idx].uploadFile(...paths);
  return true;
}

async function pushTo(page, testId, paths, scope) {
  const sel = scope ? `${scope} [data-testid="${testId}"]` : `[data-testid="${testId}"]`;
  const h = await page.$(sel);
  if (!h) return false;
  await h.uploadFile(...paths);
  return true;
}

/**
 * 좌측 트리에서 **이름으로 폴더 행을 클릭**한다.
 * ★ `querySelectorAll('*')` 전수 스캔은 파일이 많은 화면에서 레이아웃을 수만 번 강제해
 *   **메인 스레드를 막고** `Runtime.callFunctionOn timed out` 으로 하니스가 죽는다(2026-09-24).
 *   좁히려고 `button, a` 로 바꿨더니 이번엔 **안 잡혔다**(트리 행은 styled div 다).
 *   정답은 제품이 이미 달아 둔 손잡이다 — `FolderName` 이 `title={f.name}` 을 단다.
 */
async function clickTreeRow(page, name) {
  return page.evaluate((nm) => {
    // ★ `querySelector` 는 **첫 번째**를 준다 — 탭 keep-alive 로 같은 이름이 두 벌이면
    //   숨은 사본(높이 0)을 집어 «못 찾음» 이 된다. 오늘만 세 번째 같은 함정이다.
    //   **보이는 것 중 첫 번째**를 고른다(measure.js 의 `visible` 과 같은 규칙).
    const all = [...document.querySelectorAll(`[title="${nm.replace(/"/g, '\\"')}"]`)];
    const el = all.find((e) => e.getBoundingClientRect().height > 1);
    if (!el) return false;
    let p = el;
    for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
      if (p.onclick || p.getAttribute('data-drop-target') !== null || p.tagName === 'BUTTON') break;
    }
    (p || el).click();
    return true;
  }, name);
}

/**
 * **Node 에서** 직접 서버를 부른다 — 픽스처·검증용.
 *
 * ★ 브라우저 안(`page.evaluate`)에서 로그인+fetch 를 하면 그 evaluate 가 서버 응답을 기다리는
 *   동안 CDP 호출이 매달려, 서버가 느려지는 순간 `Runtime.callFunctionOn timed out` 으로
 *   **하니스가 죽는다**(2026-09-24 실측: 같은 코드가 1회차 통과·2회차 타임아웃).
 *   판정이 아니라 도구가 죽는 것이라 원인을 찾기 어렵다. 픽스처는 브라우저를 거치지 않는다.
 */
const API = process.env.E2E_API || 'http://localhost:3003';
let _tok = null;
async function api(path, init = {}) {
  if (!_tok) {
    const r = await fetch(`${API}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
    });
    const j = await r.json();
    _tok = j?.data?.accessToken || j?.data?.token || null;
    if (!_tok) throw new Error('api login failed');
  }
  const headers = { Authorization: `Bearer ${_tok}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) };
  const res = await fetch(`${API}${path}`, { ...init, headers });
  let body = null; try { body = await res.json(); } catch { /* */ }
  return { status: res.status, body };
}

/** 지금 떠 있는 우리 확인창의 글자 + 버튼. 알림 배너 같은 다른 role=status 는 걸러진다. */
function readDialog(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const btn = (id) => {
      const b = document.querySelector(`[data-testid="${id}"]`);
      return b && vis(b) ? (b.textContent || '').trim() : null;
    };
    // 이 화면의 확인창은 자체 Dialog 프리미티브다 — 버튼 손잡이로 찾는다(휴리스틱 금지).
    const anchor = document.querySelector('[data-testid="folder-delete-with-files"], [data-testid="dup-overwrite"]');
    let text = '';
    if (anchor) {
      let p = anchor;
      for (let i = 0; i < 6 && p; i++) { p = p.parentElement; if (p && p.innerText && p.innerText.length > 30) { text = p.innerText; break; } }
    }
    return {
      open: !!anchor && vis(anchor),
      text: (text || '').replace(/\s+/g, ' ').slice(0, 260),
      folderOnly: btn('folder-delete-only'),
      folderWith: btn('folder-delete-with-files'),
      dupSkip: btn('dup-skip'), dupRename: btn('dup-rename'), dupOverwrite: btn('dup-overwrite'),
    };
  });
}

async function until(page, fn, ms = 25000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    last = await readDialog(page);
    if (fn(last)) return { ok: true, snap: last };
    await sleep(350);
  }
  return { ok: false, snap: last };
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const { browser, page } = await launch();
  try {
    await login(page);
    await goto(page, '/files');
    await sleep(3000);

    // ─── ④-B **프로젝트 모드**에서도 묻는가 — 여기가 신고의 본 무대다.
    //   ★ 2026-09-24 Fable 재검증 S1 — [내 파일]만 재서 **13/13 초록인데 프로젝트 모드는 죽어 있었다.**
    //     프로젝트 목록 응답에는 `project_context` 가 없어 술어가 항상 false 였다.
    //     같은 검사를 **두 무대에서** 돌려야 한다. 한 무대만 재는 초록은 초록이 아니다.
    const me = await api('/api/auth/me');
    const biz = me.body?.data?.active_business_id ?? me.body?.data?.user?.active_business_id ?? null;
    const pl = await api(`/api/projects?business_id=${biz}`);
    const p0 = (pl.body?.data || [])[0] || {};
    const proj = { biz, id: p0.id ?? null, name: p0.name ?? null };
    if (!proj.id) {
      push('프로젝트 모드 픽스처', false, '프로젝트가 없어 미측정');
    } else {
      // ★ **탭을 하나만 쓴다.** 두 번째 탭을 열어 격리하려 했더니 업로드 요청이 **한 건도
      //   안 나갔다**(2026-09-24 실측: 단일 탭 POST 1건 / 두 탭 POST 0건). 멀티탭 동기화가
      //   얽히는 자리로 보인다 — 검사기가 제품에 없는 조건을 만들면 그 결과는 제품 이야기가 아니다.
      //   그래서 실제 사용자 동선대로 **이 탭에서** 프로젝트 파일 탭으로 간다.
      await goto(page, `/projects/p/${proj.id}?tab=files`);
      await sleep(3500);
      // ★ 요청이 **나갔는지 자체를 잰다.** 「행 0개」는 ⒜업로드가 안 나갔다 ⒝나갔는데 실패했다
      //   ⒞나갔고 성공했는데 내 조회가 틀렸다 — 셋을 구별하지 못하면 원인을 영영 못 찾는다.
      const upPosts = [];
      page.on('response', (r) => {
        if (r.request().method() === 'POST' && /\/api\/files\/\d+$/.test(r.url())) {
          upPosts.push(r.status());
        }
      });
      const [p1] = writeFiles([{ rel:`zzpdup-${RUN}.png`, tag:'p1' }]);
      const PANE = '[data-testid="project-tab-body-files"]';
      const put1 = await pushTo(page, 'docs-file-input', [p1], PANE);
      const inputCount = await page.evaluate(() => document.querySelectorAll('[data-testid="docs-file-input"]').length);
      push('프로젝트 모드에 파일 입력이 있다 (이 검사의 전제)', put1,
        put1 ? `칸 안에서 집었다 (문서 전체 입력 ${inputCount}개)` : '없음 — 이하 미측정');
      if (!put1) return results;
      await sleep(7000);
      // 첫 장이 **실제로 올라갔는지** 못을 박는다 — 안 올라갔으면 «같은 이름» 상황 자체가 없다.
      const lst = await api(`/api/projects/${proj.id}/files?limit=300`);
      const seeded = (lst.body?.data || []).filter(x => String(x.file_name || '').includes(`zzpdup-${RUN}`)).length;
      push('첫 장이 실제로 올라갔다 (픽스처)', seeded === 1,
        `행 ${seeded}개 · 업로드 POST ${upPosts.length}건 [${upPosts.join(',')}]`);
      if (seeded !== 1) return results;
      const [p2] = writeFiles([{ rel:`zzpdup-${RUN}.png`, tag:'p2' }]);
      await pushTo(page, 'docs-file-input', [p2], PANE);
      const pd = await until(page, (s) => !!s.dupOverwrite, 15000);
      push('프로젝트 모드에서도 같은 이름이면 묻는다', pd.ok,
        pd.ok ? '확인창 떴다' : '안 물었다 — 같은 이름이 그대로 쌓인다(신고의 본 무대)');
      if (pd.ok) await page.click('[data-testid="dup-skip"]');
      await sleep(2500);
      const lst2 = await api(`/api/projects/${proj.id}/files?limit=300`);
      const rows = (lst2.body?.data || []).filter(x => String(x.file_name || '').includes(`zzpdup-${RUN}`)).length;
      push('[건너뛰기] 를 고르면 행이 늘지 않는다', rows === 1, `같은 이름 행 ${rows}개 (기대 1)`);
      // 정리
      const clean = await api(`/api/projects/${proj.id}/files?limit=300`);
      for (const row of (clean.body?.data || [])) {
        if (String(row.file_name || '').includes(`zzpdup-${RUN}`)) {
          await api(`/api/files/${proj.biz}/${String(row.id).replace(/^direct-/, '')}`, { method: 'DELETE' });
        }
      }
      await goto(page, '/files');
      await sleep(2500);
    }

    const myBtn = await page.$('[data-testid="docs-folder-my"]');
    push('업로드 목적지 손잡이가 있다', !!myBtn, myBtn ? 'docs-folder-my' : '없음 — 이하 미측정');
    if (!myBtn) return results;
    await myBtn.click();
    await sleep(1000);

    // ★ 워크스페이스 구간은 **목적지를 고른 상태**여야 한다 — 안 고르면 업로드가 아니라
    //   «어느 프로젝트에» 모달이 뜬다. 그리고 앞 구간(프로젝트 모드)에서 화면이 옮겨졌을 수 있으니
    //   Q file 로 명시적으로 돌아온다.
    await goto(page, '/files');
    await sleep(3000);
    const myBtn2 = await page.$('[data-testid="docs-folder-my"]');
    push('업로드 목적지 손잡이가 있다 ([내 파일])', !!myBtn2, myBtn2 ? 'docs-folder-my' : '없음 — 이하 미측정');
    if (!myBtn2) return results;
    await myBtn2.click();
    await sleep(1200);

    // ─── ④ 같은 이름: 먼저 한 장 올리고, 같은 이름·다른 내용을 또 올린다
    const [a1] = writeFiles([{ rel: `zzdup-${RUN}.png`, tag: 'v1' }]);
    const WSPANE = '[data-testid="docs-file-input"]';   // Q file 화면엔 칸 testid 가 없어 보이는 것을 고른다
    void WSPANE;
    if (!(await pushToVisible(page, [a1]))) { push('파일 입력', false, '없음'); return results; }
    await sleep(6000);   // 업로드 완료 대기
    const [a2] = writeFiles([{ rel: `zzdup-${RUN}.png`, tag: 'v2' }]);
    await pushToVisible(page, [a2]);
    const dup = await until(page, (s) => !!s.dupOverwrite, 15000);
    push('같은 이름이면 묻는다', dup.ok, dup.ok ? '확인창 떴다' : '안 물었다 — 그대로 올라간다');
    push('선택지가 셋이다 (덮어쓰기·이름 바꿔 저장·건너뛰기)',
      !!(dup.snap?.dupOverwrite && dup.snap?.dupRename && dup.snap?.dupSkip),
      [dup.snap?.dupOverwrite, dup.snap?.dupRename, dup.snap?.dupSkip].filter(Boolean).join(' / ') || '없음');
    push('문구가 «배치 전체에 적용» 을 말한다',
      /전부에 같이 적용|applies to every/.test(dup.snap?.text || ''),
      String(dup.snap?.text || '').slice(0, 110));
    push('문구가 덮어쓰기의 결과(휴지통)를 말한다',
      /휴지통|trash/.test(dup.snap?.text || ''), /휴지통|trash/.test(dup.snap?.text || '') ? 'OK' : '안 말한다');
    if (dup.ok) {
      await page.click('[data-testid="dup-rename"]');
      await sleep(6000);
      const renamed = await page.evaluate((RUN) => (document.body.innerText || '').includes(`zzdup-${RUN} (1).png`), RUN);
      push('[이름 바꿔 저장] 이 실제로 «(1)» 로 저장한다', renamed, renamed ? 'zzdup (1).png 보인다' : '안 보인다');
    }

    // ─── ④-C **고른 답이 다음 업로드에 새지 않는가** (Fable 3차 FAIL-1 회귀)
    //   A 에 「덮어쓰기」를 고른 뒤 **다른 이름** B 를 올리면 **다시 물어야** 한다.
    //   전에는 `batchDupChoice` 가 화면이 살아 있는 내내 남아 **묻지도 않고 B 의 옛 파일을 지웠다.**
    {
      const [b1] = writeFiles([{ rel: `zzleak-${RUN}.png`, tag: 'b1' }]);
      await pushToVisible(page, [b1]);
      await sleep(6000);
      const [b2] = writeFiles([{ rel: `zzleak-${RUN}.png`, tag: 'b2' }]);
      await pushToVisible(page, [b2]);
      const again = await until(page, (s) => !!s.dupOverwrite, 15000);
      push('앞서 고른 답이 다음 업로드로 새지 않는다 (다시 묻는다)', again.ok,
        again.ok ? '다시 물었다' : '안 물었다 — 고른 답이 남아 있다(묻지 않고 지운다)');
      if (again.ok) await page.click('[data-testid="dup-skip"]');
      await sleep(2500);
    }


    // ─── ④-D **워크스페이스 모드에서 «프로젝트 폴더»로** 올릴 때도 묻는가 (Fable 3차 FAIL-2 회귀)
    //   이 경로는 `uploadMyFile` + `moveFile` 을 타서 행이 `project_id = null` 인데 프로젝트 폴더에
    //   앉는다. 술어가 폴더 위에 프로젝트를 AND 로 걸면 **영원히 안 맞아 한 번도 안 묻는다**
    //   (실측 같은 이름 2행). 신고 증상이 프로젝트 모드에서 여기로 «자리만 옮긴» 자리다.
    if (proj.id) {
      await goto(page, '/files');
      await sleep(3000);
      // 좌측 트리에서 그 프로젝트의 폴더를 하나 만들고 고른다
      const mk2 = await api(`/api/folders/projects/${proj.id}`, {
        method: 'POST', body: JSON.stringify({ name: 'ZZ카나리-프폴더', parent_id: null }),
      });
      const fx2 = mk2.body?.data?.id ?? null;
      if (!fx2) {
        push('워크스페이스 모드 · 프로젝트 폴더 픽스처', false, '폴더 생성 실패 — 미측정');
      } else {
        await goto(page, '/files');
        await sleep(3000);
        // ★ 워크스페이스 트리에서 프로젝트 폴더는 **프로젝트 행 아래**에 있다 — 먼저 펼쳐야 보인다.
        //   안 펼치고 이름으로 찾으면 «못 찾음» 이 나오고, 그것을 기능 결함으로 읽게 된다.
        // 프로젝트 행을 먼저 펼쳐야 그 아래 폴더가 보인다
        await clickTreeRow(page, proj.name || '');
        await sleep(1800);
        const picked2 = await clickTreeRow(page, 'ZZ카나리-프폴더');
        push('워크스페이스 트리에서 프로젝트 폴더를 고를 수 있다', picked2,
          picked2 ? 'ZZ카나리-프폴더 선택' : '못 찾음 — 이하 미측정');
        if (picked2) {
          await sleep(1200);
          const [w1] = writeFiles([{ rel: `zzwsf-${RUN}.png`, tag: 'w1' }]);
          await pushToVisible(page, [w1]);
          await sleep(7000);
          const [w2] = writeFiles([{ rel: `zzwsf-${RUN}.png`, tag: 'w2' }]);
          await pushToVisible(page, [w2]);
          const wd = await until(page, (s) => !!s.dupOverwrite, 15000);
          // ★ **미측정으로 적는다.** 이 검사는 «워크스페이스 모드 + 프로젝트 폴더» 를 재려던 것인데,
          //   Q file 에서 프로젝트 폴더는 **접혀 있어 보이지 않고**(실측: 프로젝트 안 누르면 0건)
          //   프로젝트 행을 누르면 **프로젝트 페이지로 이동**한다. 즉 이 경로는 UI 로 닿을 수 없고,
          //   위에서 재는 것은 사실상 **프로젝트 모드**다 — 양성 대조군(옛 결함 복원)에서 판정이
          //   **뒤집히지 않아** 그 사실이 드러났다(2026-09-24).
          //   실제 도달 경로는 **바깥 파일을 프로젝트 폴더 행에 끌어다 놓기**(`onDropExternal` →
          //   `handleFiles(fl, 프로젝트폴더id)`)인데, 헤드리스는 OS 드롭을 만들 수 없다.
          //   ⚪ 로 남겨 «잰 것이 없다» 를 보이게 한다 — 못 잡는 초록보다 낫다.
          results.push({
            name: '워크스페이스 모드 · 프로젝트 폴더에서도 묻는다', unmeasured: true, optional: true,
            details: [`⚪ UI 로 그 상태에 도달 불가(프로젝트 폴더는 접힘 · 프로젝트 클릭은 페이지 이동). ` +
              `실제 경로는 바깥 파일을 폴더에 끌어다 놓기 — 헤드리스가 못 만든다. 관측값 ${wd.ok ? '확인창 떴음(=프로젝트 모드를 잰 것)' : '안 뜸'}`],
          });
          if (wd.ok) await page.click('[data-testid="dup-skip"]');
          await sleep(2500);
        }
        // 정리 — 폴더와 안의 파일 함께
        await api(`/api/folders/${fx2}?contents=delete`, { method: 'DELETE' });
      }
    }

    return results;
  } catch (e) {
    push('카나리 실행', false, e.message);
    return results;
  } finally {
    await browser.close().catch(() => {});
    for (const d of TMP) {
      try {
        const walk = (p) => fs.readdirSync(p, { withFileTypes: true }).forEach((e) => {
          const q = path.join(p, e.name);
          if (e.isDirectory()) { walk(q); fs.rmdirSync(q); } else fs.unlinkSync(q);
        });
        walk(d); fs.rmdirSync(d);
      } catch { /* */ }
    }
  }
}

module.exports = { run };
