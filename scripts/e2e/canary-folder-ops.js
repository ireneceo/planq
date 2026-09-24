// canary-folder-ops — 폴더 삭제가 **묻는가** · 폴더째 업로드가 **구조를 만드는가** ·
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

    const myBtn = await page.$('[data-testid="docs-folder-my"]');
    push('업로드 목적지 손잡이가 있다', !!myBtn, myBtn ? 'docs-folder-my' : '없음 — 이하 미측정');
    if (!myBtn) return results;
    await myBtn.click();
    await sleep(1200);

    // ─── ③ 폴더째 업로드: 입력 손잡이 + 버튼이 보이는가
    const dirInput = await page.$('[data-testid="docs-folder-input"]');
    push('폴더 입력이 webkitdirectory 다', !!dirInput && await page.evaluate(
      (el) => el.hasAttribute('webkitdirectory'), dirInput).catch(() => false),
      dirInput ? 'docs-folder-input' : '없음');
    const folderBtnSeen = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="docs-folder-upload"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return 'size0';
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return (hit && (b.contains(hit) || hit.contains(b))) ? (b.textContent || '').trim() : 'covered';
    });
    push('[폴더 올리기] 버튼이 실제로 그려진다',
      !!folderBtnSeen && folderBtnSeen !== 'size0' && folderBtnSeen !== 'covered', String(folderBtnSeen));

    // ★ **화면을 Q file 로 되돌린다.** 앞 구간(④-D)에서 워크스페이스 트리의 **프로젝트 행**을 누르면
    //   프로젝트 페이지로 **이동**한다. 그 상태로 이어 하면 아래 `page.reload()` 가 프로젝트 URL 을
    //   다시 열고, 워크스페이스 폴더는 **숨은 keep-alive 칸**에 남아 높이 0 이 된다 —
    //   실측 진단: `ZZ카나리-삭제(h0), ZZ카나리-하위(h0) · url=/projects/p/300?tab=files`.
    //   «못 찾음» 을 기능 결함으로 읽지 않으려면 무대를 명시적으로 세워야 한다.
    await goto(page, '/files');
    await sleep(3000);

    // ─── ① 폴더 삭제 확인창 — 파일이 든 폴더를 만들고, 트리에서 삭제를 눌러 **묻는지** 본다.
    // ★ 날 `fetch` 는 **401 이다** — access token 은 앱 메모리(AuthContext)에만 있어 쿠키에도
    //   localStorage 에도 없다(lib/browser.js 머리말에 같은 함정이 적혀 있다. 2026-09-24 에
    //   이 카나리가 실제로 걸렸다 — «픽스처를 못 만들었다» 로 나왔다). 토큰을 직접 받아 쓴다.
    const fx = await page.evaluate(async (creds) => {
      const lg = await (await fetch('/api/auth/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
      })).json().catch(() => null);
      const token = lg?.data?.token || lg?.data?.accessToken;
      if (!token) return null;
      const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const me = await (await fetch('/api/auth/me', { credentials: 'include', headers: H })).json().catch(() => null);
      const biz = me?.data?.active_business_id ?? me?.data?.user?.active_business_id;
      if (!biz) return null;
      const mk = async (name, parent) => {
        const r = await fetch(`/api/folders/workspace/${biz}`, {
          method: 'POST', credentials: 'include', headers: H,
          body: JSON.stringify({ name, parent_id: parent ?? null }),
        });
        return (await r.json())?.data;
      };
      const root = await mk('ZZ카나리-삭제', null);
      const child = await mk('ZZ카나리-하위', root?.id);
      return { biz, token, rootId: root?.id, childId: child?.id };
    }, CREDS);
    push('확인창을 잴 픽스처를 만들었다', !!(fx && fx.rootId && fx.childId),
      fx ? `root=${fx.rootId} child=${fx.childId}` : '만들지 못함 — 이하 미측정');
    if (!fx || !fx.rootId) return results;

    // 하위 폴더에 파일 한 장 — **빈 폴더면 선택지가 안 나오는 것이 정답**이라 파일이 있어야 잰다.
    const [d1] = writeFiles([{ rel: `zzfolderdel-${RUN}.png`, tag: 'fd' }]);
    await page.evaluate((id) => {
      const el = document.querySelector('[data-testid="docs-file-input"]');
      if (el) el.dataset.pqTarget = String(id);
    }, fx.childId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(3500);
    // 하위 폴더를 골라 그리로 올린다(목적지를 고르면 업로드가 바로 나간다).
    // ★ 하위 폴더는 **부모를 펼쳐야** 트리에 그려진다. 앞 구간(④-D)이 트리 상태를 바꿔 놓아
    //   부모가 접힌 채였고, 그래서 «못 찾음» → 폴더 삭제 3검사가 연쇄로 빨간불이 났다.
    //   픽스처를 못 세운 것을 기능 결함으로 읽지 않도록 **부모 펼치기를 명시**한다.
    await clickTreeRow(page, 'ZZ카나리-삭제');
    await sleep(1500);
    const picked = await clickTreeRow(page, 'ZZ카나리-하위');
    const seenTitles = await page.evaluate(() => [...document.querySelectorAll('[title]')]
      .map((e) => ({ t: e.getAttribute('title'), h: Math.round(e.getBoundingClientRect().height) }))
      .filter((x) => /ZZ카나리/.test(x.t || ''))
      .map((x) => `${x.t}(h${x.h})`));
    push('픽스처 폴더를 트리에서 고를 수 있다', picked,
      picked ? 'ZZ카나리-하위 선택' : `못 찾음 — 보이는 것: ${seenTitles.join(', ') || '없음'} · url=${await page.url()}`);
    await sleep(1200);
    await pushTo(page, 'docs-file-input', [d1]);
    await sleep(6000);

    // 그 폴더의 ⋯ 메뉴에서 삭제.
    //   ★ 손잡이는 트리마다 **다르다** — 워크스페이스 폴더는 `docs-folder-menu-<id>`/`docs-folder-delete`,
    //     프로젝트 안 하위 폴더는 `docs-subfolder-menu-<id>`/`docs-subfolder-delete`.
    //     2026-09-24 에 subfolder 쪽만 찾다가 «안 물었다» 로 거짓 실패를 냈다(휴리스틱도 못 잡았다).
    //     우리 픽스처는 워크스페이스 폴더이므로 folder 쪽이다.
    const opened = await page.evaluate((id) => {
      const trig = document.querySelector(`[data-testid="docs-folder-menu-${id}"]`)
        || document.querySelector(`[data-testid="docs-subfolder-menu-${id}"]`);
      if (!trig) return 'no-trigger';
      const r = trig.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return 'trigger-hidden';
      trig.click();
      return 'opened';
    }, fx.childId);
    await sleep(700);
    if (opened === 'opened') {
      await page.evaluate(() => {
        const it = document.querySelector('[data-testid="docs-folder-delete"], [data-testid="docs-subfolder-delete"]');
        if (it) it.click();
      });
      await sleep(600);
    }
    const del = await until(page, (s) => !!s.folderWith, 12000);
    push('폴더 삭제가 **묻는다**', del.ok, del.ok ? '확인창 떴다' : `안 물었다(opened=${opened}) — 말없이 지워진다`);
    push('선택지가 둘이다 (폴더만 삭제 · 파일도 함께 삭제)',
      !!(del.snap?.folderOnly && del.snap?.folderWith),
      [del.snap?.folderOnly, del.snap?.folderWith].filter(Boolean).join(' / ') || '없음');
    push('문구가 «바로 위 폴더» 라고 말한다 (옛 «직접 업로드 루트» 는 거짓이었다)',
      /바로 위 폴더|up one level/.test(del.snap?.text || ''),
      String(del.snap?.text || '').slice(0, 120));

    // 정리 — 픽스처 폴더·파일 + **이 실행이 만든 파일 전부** 삭제.
    //   이름 접두어로 지우면 사람 자료는 안 건드린다(실행 id 가 붙어 있다).
    await page.evaluate(async (f) => {
      const H = { Authorization: `Bearer ${f.token}` };
      await fetch(`/api/folders/${f.childId}?contents=delete`, { method: 'DELETE', credentials: 'include', headers: H }).catch(() => {});
      await fetch(`/api/folders/${f.rootId}?contents=delete`, { method: 'DELETE', credentials: 'include', headers: H }).catch(() => {});
      // 이 실행이 만든 파일 — 목록에서 접두어로 찾아 지운다.
      const list = await (await fetch(`/api/files/${f.biz}?limit=500`, { credentials: 'include', headers: H })).json().catch(() => null);
      for (const row of (list?.data || [])) {
        if (typeof row?.file_name === 'string' && row.file_name.includes(f.run)) {
          await fetch(`/api/files/${f.biz}/${row.id}`, { method: 'DELETE', credentials: 'include', headers: H }).catch(() => {});
        }
      }
    }, { ...fx, run: RUN });

    return results;
  } catch (e) {
    push('카나리 실행', false, e.message);
    return results;
  } finally {
    await browser.close().catch(() => {});
    // 제 파일은 제가 치운다 — 러너 sweep 은 안전망이다(lib/cleanup purgeCanaryFilesByRun).
    results.push(await require('./lib/cleanup').purgeCanaryFilesByRun(RUN));
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
