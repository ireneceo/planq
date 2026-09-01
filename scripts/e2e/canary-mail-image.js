// scripts/e2e/canary-mail-image.js — 메일 본문에 이미지를 **넣을 수 있는가**
//
// 운영 #378 (Irene): "통일해서 맞춰서 일반적인 기능으로 해야 해. 파일 동기화랑 이미지나
//   파일 드래그 및 복사해서 넣었을 때나."
//   Q info·Q Task·Q docs 본문에는 이미지를 넣을 수 있는데 **메일 본문에만 못 넣었다** —
//   RichEditor 에 uploadUrl 이 안 넘어가 handleDrop 이 즉시 return false 했다.
//
// ★ 이 검사기가 없으면 안 되는 이유 — 이 계열의 실패는 **작성 화면에서는 멀쩡해 보인다.**
//   드래그가 무시되는지, 넣었는데 못 나가는지는 눈으로 구별이 안 된다. 그래서 실제로 떨어뜨려 본다.
//
// 발송 쪽(URL → cid: 변환)은 브라우저로 잴 수 없다(dev 는 EMAIL_SENDING_ENABLED=false).
//   그 부분은 services/emailImageEmbed.js 의 단위·MIME 검사가 맡는다. 여기는 **화면**만 본다 —
//   백엔드만 확인하고 완료라 하면 화면이 죽어 있어도 모른다(memory feedback_backend_done_ui_missing).
const b = require('./lib/browser');

const dropImage = async (page) => page.evaluate(async () => {
  // 작성 모달 안의 편집기를 고른다 — 화면에 편집기가 여럿일 수 있다.
  const bodies = [...document.querySelectorAll('.pq-editor-body')];
  const pm = bodies.find((el) => el.getBoundingClientRect().width > 0) || bodies[0];
  if (!pm) return 'no_editor';
  const cv = document.createElement('canvas');
  cv.width = 200; cv.height = 120;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#F43F5E'; cx.fillRect(0, 0, 200, 120);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const file = new File([blob], 'canary.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const r = pm.getBoundingClientRect();
  pm.dispatchEvent(new DragEvent('drop', {
    bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: Math.round(r.left + 40), clientY: Math.round(r.top + 40),
  }));
  return 'dropped';
});

const BIZ = Number(process.env.E2E_BUSINESS_ID || 5);

async function run() {
  const results = [];
  let uploadedToken = null;
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/mail?folder=all');
    await b.sleep(3000);

    const opener = await page.$('[data-testid="mail-compose-open"]');
    if (!opener) {
      // ★ 못 열었으면 **판정 불가로 실패**한다 — 0개 검사에 "이상 없음" 을 내지 않는다.
      results.push({ name: 'compose-open', ok: false, msg: '🔴 새 메일 버튼을 못 찾았다 — 검사 0개, 판정 불가' });
      return results;
    }
    await opener.click();
    await b.sleep(1500);
    const hasEditor = await page.evaluate(() =>
      [...document.querySelectorAll('.pq-editor-body')].some((el) => el.getBoundingClientRect().width > 0));
    results.push({ name: 'compose-open', ok: hasEditor,
      msg: hasEditor ? '메일 작성창 본문 편집기가 열린다' : '🔴 작성창은 열렸는데 편집기가 없다' });
    if (!hasEditor) return results;

    const dropped = await dropImage(page);
    let shown = false;
    for (let i = 0; i < 24 && !shown; i++) {
      await b.sleep(500);
      shown = await page.evaluate(() =>
        [...document.querySelectorAll('.pq-editor-body img')].some((el) => el.getBoundingClientRect().width > 0));
    }
    results.push({ name: 'drop-insert', ok: shown,
      msg: shown ? '메일 본문에 드래그한 이미지가 들어간다'
                 : `🔴 이미지가 안 들어감(drop=${dropped}) — uploadUrl 이 빠졌는지 확인` });
    if (!shown) return results;

    // 넣은 이미지가 **우리 주소**를 가리켜야 발송 시 cid 변환에 걸린다.
    //   다른 주소(예: blob:·data:)면 변환 대상이 아니라 받는 사람에게 안 보인다.
    const src = await page.evaluate(() => {
      const img = [...document.querySelectorAll('.pq-editor-body img')].find((el) => el.getBoundingClientRect().width > 0);
      return img ? img.getAttribute('src') : null;
    });
    const ours = !!src && /\/api\/files\/public-image\//.test(src);
    results.push({ name: 'src-is-ours', ok: ours,
      msg: ours ? `우리 주소로 들어간다 (발송 시 cid 변환 대상) — ${src.slice(0, 60)}`
                : `🔴 우리 주소가 아니다 — 발송 시 변환되지 않아 받는 사람에게 안 보인다: ${src}` });

    // 크기 조절 손잡이도 다른 화면과 같아야 한다(#378 의 다른 절반).
    const handle = await page.evaluate(() => {
      const body = [...document.querySelectorAll('.pq-editor-body')].find((el) => el.getBoundingClientRect().width > 0);
      return !!(body && body.querySelector('.pq-img-handle'));
    });
    results.push({ name: 'resize-handle', ok: handle,
      msg: handle ? '크기 조절 손잡이가 붙는다 (Q docs·Q Task 와 같다)' : '🔴 손잡이가 없다 — 메일만 다른 대접' });

    uploadedToken = src ? (src.match(/public-image\/([^?]+)/) || [])[1] : null;
  } finally {
    await browser.close();
  }

  // ★ 원복 — 검사기가 올린 파일을 지운다. 정기 실행이라 안 지우면 매번 쌓인다.
  //   DELETE 만 부르면 휴지통에 넣을 뿐 **바이트가 남는다** — purge 까지 부른다.
  //   (2026-09-01 Fable 지적: 이 카나리가 매 실행 파일을 남기고 있었다.)
  //   ★ 브라우저 **밖**에서 한다 — 페이지 안 `fetch(..., {credentials:'include'})` 는
  //     인증이 안 된다(앱은 Bearer 토큰을 헤더로 보낸다). 쿠키로 부르면 401 이라
  //     목록이 비어 "not_found" 가 났다. 여기선 로그인해서 토큰으로 부른다.
  if (uploadedToken) {
    results.push(await cleanupUploaded(uploadedToken));
  }
  return results;
}

async function cleanupUploaded(token) {
  const mk = (ok, msg) => ({ name: 'cleanup', ok, msg });
  try {
    const lr = await fetch(b.BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }),
    });
    const lj = await lr.json();
    const tok = lj.data?.accessToken || lj.data?.token;
    if (!tok) return mk(false, '🔴 원복용 로그인 실패 — 파일이 남는다');
    const H = { Authorization: 'Bearer ' + tok };
    const r = await fetch(`${b.BASE}/api/files/${BIZ}?limit=200`, { headers: H });
    const j = await r.json().catch(() => ({}));
    const rows = Array.isArray(j.data) ? j.data : [];
    const hit = rows.find((f) => String(f.file_path || '').endsWith(token));
    if (!hit) return mk(false, `🔴 원복 대상(${token.slice(0, 12)}…)을 목록에서 못 찾았다 — 남는다`);
    // dedup 으로 같은 행이 재사용되면 ref_count 만 늘어 있다. 그래도 지우면 참조가 줄고
    // 0 이 될 때 바이트가 사라진다(purgeFile 이 판단한다) — 우리가 늘린 만큼만 되돌린다.
    await fetch(`${b.BASE}/api/files/${BIZ}/${hit.id}`, { method: 'DELETE', headers: H }).catch(() => null);
    const p = await fetch(`${b.BASE}/api/files/${BIZ}/${hit.id}/purge`, { method: 'DELETE', headers: H });
    return p.ok
      ? mk(true, `검사기가 올린 파일을 지웠다 (id=${hit.id}, 바이트까지)`)
      : mk(false, `🔴 purge 실패(${p.status}) — 휴지통에만 들어가 바이트가 남는다`);
  } catch (e) {
    return mk(false, `🔴 원복 중 오류: ${e.message}`);
  }
}

// ★ 러너 계약 — 형제 카나리와 **같은 모양**이어야 한다.
//   run.js 의 printSuite 는 `r.fail` 을 센다. 항등함수로 넘기면 `{ok:false}` 가 그대로 가서
//   **✅ 로 찍히고 실패 0 으로 집계된다** — 게이트에 안 붙은 가드는 없는 가드다.
//   (2026-09-01 Fable 실측으로 잡힘. 단독 실행만 빨갛고 스위트는 영원히 초록이었다.)
function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}
module.exports = { run: async () => toRunnerShape(await run()), name: 'mail-image' };

if (require.main === module) {
  run().then((rows) => {
    rows.forEach((r) => console.log(`  ${r.ok ? '✓' : '✗'} ${r.name} — ${r.msg}`));
    const bad = rows.filter((r) => !r.ok).length;
    console.log('\n' + (bad === 0 ? '✓ PASS' : `✗ FAIL — ${bad}건`));
    process.exit(bad === 0 ? 0 : 1);
  }).catch((e) => { console.error('검사기 자체 오류:', e.message); process.exit(2); });
}
