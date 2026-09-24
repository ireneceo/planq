// canary-upload-retry — 업로드 배치가 **조용히 잘리지 않는가**. (운영 신고 2026-09-24)
//
// 무엇을 재나
//   ① 429 를 받으면 «실패» 가 아니라 «대기» 로 그리고 **스스로 이어서** 올린다.
//      (실측 배경: 메뉴 사진 48장 중 30장만 올라가고 18장이 「요청이 너무 잦습니다」로 죽었다.
//       서버 상한은 300/분으로 올렸지만 상한은 상한이므로 이 안전망이 없으면 큰 배치가 또 잘린다.)
//   ② 정말 실패했을 때 **한 번에 조치**할 수 있다 — [전체 재시도]·[실패 목록 지우기]·[모두 중단].
//      (Irene: *"실패리스트 이렇게 많이 뜨면 … 지금 하나씩 삭제하게 해. 아니면 그냥 나가야 해."*)
//
// 어떻게 재나 — 429 를 **network 계층에서 주입**한다. 실제로 300장을 올려 상한을 때리는 것은
//   느리고 남는 데이터가 많다. 주입이면 판정이 결정적이고 잔여가 없다.
//   ★ 주입한 429 에는 `RateLimit-Reset` 을 실어 준다 — 화면이 그 값을 읽어 대기 시간을 정한다.
//     (서버가 실제로 그 헤더를 주는지는 별도로 확인했다: 301번째 요청에서 `RateLimit-Reset: 54`.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, login, goto, sleep, CREDS } = require('./lib/browser');

/** 1x1 PNG — 우리가 재는 것은 바이트가 아니라 «요청의 운명» 이다. */
const PNG1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');

const UP_RE = /\/api\/files\/\d+$/;

/** uploadFile 이 읽을 임시 파일 — 끝에서 한 번에 치운다(중간에 지우면 업로드가 죽는다). */
const TMP_DIRS = [];
/** ★ 실행마다 다른 이름 — 지난 실행이 남긴 동명 파일이 있으면 **중복 확인창이 먼저 떠**
 *   업로드가 시작되지 않는다(2026-09-24 실측: 「업로드가 실제로 시작된다」 실패).
 *   카나리가 자기 잔여물로 자기를 깨뜨리는 계열이다(Fable 지적 ⑥과 같은 원인). */
const RUN = Date.now().toString(36).slice(-6);

/**
 * 숨은 <input type=file> 에 파일을 넣는다 — 화면과 같은 경로(handleFiles)를 태운다.
 *
 * ★ `el.files = new DataTransfer().files` 는 **헤드리스에서 안 먹는다** (2026-09-24 실측:
 *   대입 직후 `el.files.length === 0`, 업로드 요청 0건). 그래서 판정이 «패널이 없다» →
 *   «비워졌다» 로 뒤집혀 **거짓 통과**가 났다. puppeteer 의 `uploadFile` 은 실제 파일을 쓴다.
 */
async function pushFiles(page, names) {
  const h = await page.$('[data-testid="docs-file-input"]');
  if (!h) return 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-up-'));
  const paths = names.map((n) => {
    const p = path.join(dir, n);
    fs.writeFileSync(p, PNG1x1);
    return p;
  });
  await h.uploadFile(...paths);
  // ★ 여기서 지우지 않는다 — 업로드는 비동기라 브라우저가 아직 바이트를 안 읽었을 수 있다.
  //   지우면 «파일이 없다» 로 실패하고 그것을 기능 결함으로 읽게 된다. 끝에서 한 번에 치운다.
  TMP_DIRS.push(dir);
  return paths.length;
}

/** 업로드 요청을 가로채 처음 `failFirst` 번은 429, 그 뒤는 그대로 통과. failFirst=-1 이면 항상 429. */
async function interceptUploads(page, failFirst, resetSec) {
  let n = 0;
  await page.setRequestInterception(true);
  const handler = (req) => {
    const isUpload = req.method() === 'POST' && UP_RE.test(req.url());
    if (!isUpload) { req.continue().catch(() => {}); return; }
    n++;
    if (failFirst === -1 || n <= failFirst) {
      req.respond({
        status: 429,
        headers: { 'Content-Type': 'application/json', 'RateLimit-Reset': String(resetSec) },
        body: JSON.stringify({ success: false, message: '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' }),
      }).catch(() => {});
      return;
    }
    req.continue().catch(() => {});
  };
  page.on('request', handler);
  return {
    count: () => n,
    off: async () => { page.off('request', handler); await page.setRequestInterception(false).catch(() => {}); },
  };
}

/** 업로드 큐 패널의 현재 상태를 읽는다. */
function readPanel(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const panel = [...document.querySelectorAll('[role="status"]')].filter(vis)
      .find((e) => /업로드|Upload/.test(e.getAttribute('aria-label') || ''));
    if (!panel) return { open: false };
    const txt = panel.innerText || '';
    const btn = (id) => {
      const b = panel.querySelector(`[data-testid="${id}"]`);
      return b && vis(b) ? (b.textContent || '').trim() : null;
    };
    return {
      open: true, text: txt,
      rows: panel.querySelectorAll('[role="status"] > div').length,
      retry: btn('upload-retry-failed'),
      clear: btn('upload-clear-failed'),
      cancelAll: btn('upload-cancel-all'),
    };
  });
}

/** 조건이 참이 될 때까지 폴링 — 고정 sleep 으로 재면 렌더 전 값을 읽는다. */
async function until(page, fn, ms = 30000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    last = await readPanel(page);
    if (fn(last)) return { ok: true, snap: last };
    await sleep(400);
  }
  return { ok: false, snap: last };
}

/** 이 실행이 만든 파일을 **실제로** 지운다. 옛 구현은 아무것도 안 하고 숫자만 돌려줬다. */
async function cleanup(page) {
  return page.evaluate(async ([creds, run]) => {
    try {
      const lg = await (await fetch('/api/auth/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
      })).json();
      const token = lg?.data?.token || lg?.data?.accessToken;
      if (!token) return 0;
      const H = { Authorization: `Bearer ${token}` };
      const me = await (await fetch('/api/auth/me', { credentials: 'include', headers: H })).json();
      const biz = me?.data?.active_business_id ?? me?.data?.user?.active_business_id;
      if (!biz) return 0;
      const list = await (await fetch(`/api/files/${biz}?limit=500`, { credentials: 'include', headers: H })).json();
      let n = 0;
      for (const row of (list?.data || [])) {
        if (typeof row?.file_name === 'string' && row.file_name.includes(run)) {
          const r = await fetch(`/api/files/${biz}/${row.id}`, { method: 'DELETE', credentials: 'include', headers: H });
          if (r.ok) n++;
        }
      }
      return n;
    } catch { return 0; }
  }, [CREDS, RUN]);
}

async function run() {
  const out = [];
  // ★ 러너 계약 — `{ name, fail, details[] }`. `{pass, detail}` 로 넣으면 printSuite 가
  //   fail 을 0 으로 읽어 **무엇을 넣든 전부 ✅** 로 찍힌다(거짓 초록).
  const ok = (name, pass, detail) => out.push({ name, fail: pass ? 0 : 1, details: [String(detail ?? '')] });
  const { browser, page } = await launch();
  const names1 = [`zzcanary-${RUN}-r1.png`, `zzcanary-${RUN}-r2.png`, `zzcanary-${RUN}-r3.png`];
  const names2 = [`zzcanary-${RUN}-f1.png`, `zzcanary-${RUN}-f2.png`];
  try {
    await login(page);
    await goto(page, '/files');
    await sleep(3000);
    const hasInput = await page.$('[data-testid="docs-file-input"]');
    ok('파일 입력 손잡이가 있다', !!hasInput, hasInput ? 'docs-file-input' : '없음 — 이하 미측정');
    if (!hasInput) return out;

    // ★ **목적지를 먼저 고른다.** Q file 에서 아무 폴더도 안 고른 채 올리면 업로드가 아니라
    //   «어느 프로젝트에 넣을까» 모달이 뜬다(`handleFiles` → `setPendingUpload`). 그걸 모르고
    //   바로 밀어 넣었다가 «요청 0건» 을 기능 결함으로 읽을 뻔했다(2026-09-24).
    const myBtn = await page.$('[data-testid="docs-folder-my"]');
    ok('업로드 목적지를 고를 수 있다 (내 파일)', !!myBtn, myBtn ? 'docs-folder-my' : '없음 — 이하 미측정');
    if (!myBtn) return out;
    await myBtn.click();
    await sleep(1200);

    // ── ① 429 두 번 → 대기 → 자동 재시도로 전부 성공
    const i1 = await interceptUploads(page, 2, 3);
    const n1 = await pushFiles(page, names1);
    // ★ 픽스처 못 — 패널이 **뜬 적이 있어야** 아래 «비워졌다» 가 뜻을 갖는다.
    //   이 못이 없어서 2026-09-24 첫 실행이 «패널 없음» 을 «성공적으로 비워짐» 으로 읽었다(거짓 통과).
    const appeared = await until(page, (s) => s.open, 20000);
    ok('업로드가 실제로 시작된다 (큐 패널이 뜬다)', appeared.ok && n1 > 0,
      appeared.ok ? `파일 ${n1}건 · 요청 ${i1.count()}건` : `패널이 안 뜸 — 요청 ${i1.count()}건 (이하 미측정)`);
    if (!appeared.ok) { await i1.off(); return out; }
    // ★ «재시도 대기» 로만 판정한다. queued 의 「대기 중」과 겹치는 패턴(/대기/)을 쓰면
    //   **순서를 기다리는 행**을 집어 거짓 통과가 난다(2026-09-24 실측으로 잡았다).
    const waited = await until(page, (s) => s.open && /재시도 대기|Retrying/.test(s.text), 20000);
    ok('429 를 «대기» 로 그린다 (실패 아님)', waited.ok,
      waited.ok ? '패널에 대기 표시' : `끝까지 안 나옴 — ${String(waited.snap?.text || '').slice(0, 80)}`);
    ok('대기 문구가 «자동으로 이어서» 를 말한다',
      /초 후|in \d+s|자동/.test(waited.snap?.text || ''),
      String(waited.snap?.text || '').replace(/\s+/g, ' ').slice(0, 90));
    // ★ **서버가 준 리셋 시간을 실제로 쓰는가.** 주입값 3초가 화면에 나와야 한다.
    //   여기서 15초(기본값)가 나오면 헤더가 유실된 것이다 — xhrSend 가 Content-Type 만
    //   베껴 주고 있어서 실제로 그랬다(2026-09-24). 숫자를 안 재면 «대기는 뜬다» 로 통과한다.
    ok('서버가 준 재시도 시점을 쓴다 (기본값 15초로 안 떨어진다)',
      /[·\s](1|2|3)초 후|in [123]s/.test(waited.snap?.text || ''),
      (String(waited.snap?.text || '').match(/\d+초 후|in \d+s/) || ['(못 찾음)'])[0] + ' ← 주입 3초');

    const drained = await until(page, (s) => !s.open, 40000);
    ok('기다렸다가 스스로 이어서 올린다 (패널이 비워진다)', drained.ok,
      drained.ok ? `주입 429 ${2}건 뒤 전부 성공` : `남아 있음 — ${String(drained.snap?.text || '').slice(0, 80)}`);
    await i1.off();

    // ── ② 계속 429 → MAX_WAITS 소진 후 실패 + 일괄 버튼
    const i2 = await interceptUploads(page, -1, 1);
    await pushFiles(page, names2);
    const failed = await until(page, (s) => s.open && !!s.retry, 120000);
    ok('끝내 안 되면 실패로 떨어진다', failed.ok,
      failed.ok ? '실패 상태 도달' : '90초 안에 실패로 안 떨어짐(미측정)');
    ok('[전체 재시도] 가 보인다', !!failed.snap?.retry, failed.snap?.retry || '없음');
    ok('[실패 목록 지우기] 가 보인다', !!failed.snap?.clear, failed.snap?.clear || '없음');
    ok('머리줄이 실패 건수를 말한다', /실패\s*\d+|\d+\s*failed/i.test(failed.snap?.text || ''),
      String(failed.snap?.text || '').replace(/\s+/g, ' ').slice(0, 70));
    await i2.off();

    // [실패 목록 지우기] 가 실제로 비우는가 — 버튼이 보이는 것과 듣는 것은 다르다
    if (failed.snap?.clear) {
      await page.click('[data-testid="upload-clear-failed"]');
      const cleared = await until(page, (s) => !s.open, 8000);
      ok('[실패 목록 지우기] 가 실제로 목록을 비운다', cleared.ok,
        cleared.ok ? '패널 사라짐' : '눌러도 남아 있다');
    }

    const cleaned = await cleanup(page);
    ok('이 실행이 만든 파일을 치웠다', true, `${cleaned}건 삭제`);
  } catch (e) {
    ok('카나리 실행', false, e.message);
  } finally {
    await browser.close().catch(() => {});
    for (const d of TMP_DIRS) {
      try { fs.readdirSync(d).forEach((f) => fs.unlinkSync(path.join(d, f))); fs.rmdirSync(d); } catch { /* */ }
    }
  }
  // ★ 러너는 run() 이 **배열**을 돌려주기를 기대한다. `{name, results}` 로 싸면
  //   `results is not iterable` FATAL 로 끝난다(실측).
  return out;
}

module.exports = { run };
